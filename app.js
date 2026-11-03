
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";

import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";

import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  addDoc,
  collection,
  query,
  where,
  getDocs,
  deleteDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import firebaseConfig from "./firebase-config.js";

import {
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY,
  RECEIPT_BUCKET
} from "./supabase-config.js";

// --------------------------------------------------
// 1. CONEXIONES
// --------------------------------------------------

const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);

const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY,
  {
    accessToken: async () => {
      const user = auth.currentUser;
      return user ? await user.getIdToken() : null;
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  }
);

// --------------------------------------------------
// 2. VARIABLES
// --------------------------------------------------

let currentUser = null;
let currentProfile = null;
let movements = [];
let showingAll = false;
let loadingUid = null;

const $ = (id) => document.getElementById(id);

const isAdmin = () => currentProfile?.rol === "admin";

function message(elementId, text, error = false) {
  const element = $(elementId);
  if (!element) return;

  element.textContent = text;
  element.style.color = error ? "#ff7777" : "#d9a62e";
}

function setConnection(text, error = false) {
  const element = $("connectionStatus");
  if (!element) return;

  element.textContent = text;
  element.style.color = error ? "#ff7777" : "#d9a62e";
}

function money(value) {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0
  }).format(Number(value) || 0);
}

function safeText(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}

function showError(error) {
  console.error("BER APP:", error);

  const detail = error?.message || "Error desconocido";
  setConnection("Error: " + detail, true);
  message("authMessage", "No se pudo cargar la aplicación: " + detail, true);
}

// --------------------------------------------------
// 3. AUTENTICACIÓN
// --------------------------------------------------

const loginForm = $("loginForm");

loginForm?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const email = $("email")?.value.trim();
  const password = $("password")?.value;

  if (!email || !password) {
    message("authMessage", "Escribe tu correo y contraseña.", true);
    return;
  }

  message("authMessage", "Ingresando...");
  setConnection("Verificando acceso...");

  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (error) {
    console.error(error);
    message("authMessage", "No se pudo ingresar: " + error.message, true);
    setConnection("Error de inicio de sesión", true);
  }
});

$("showSignup")?.addEventListener("click", async () => {
  const email = $("email")?.value.trim();
  const password = $("password")?.value;

  if (!email || !password) {
    message("authMessage", "Escribe correo y contraseña.", true);
    return;
  }

  if (password.length < 6) {
    message("authMessage", "La contraseña debe tener al menos 6 caracteres.", true);
    return;
  }

  try {
    message("authMessage", "Creando cuenta...");
    await createUserWithEmailAndPassword(auth, email, password);
  } catch (error) {
    console.error(error);
    message("authMessage", "No se pudo crear la cuenta: " + error.message, true);
  }
});

$("logoutBtn")?.addEventListener("click", async () => {
  try {
    await signOut(auth);
  } catch (error) {
    showError(error);
  }
});

// --------------------------------------------------
// 4. PERFIL Y PERMISOS
// --------------------------------------------------

async function loadProfile(user) {
  const reference = doc(db, "usuarios", user.uid);
  const snapshot = await getDoc(reference);

  if (!snapshot.exists()) {
    const newProfile = {
      nombre: user.displayName || user.email,
      email: user.email,
      rol: "empleado",
      activo: true
    };

    await setDoc(reference, newProfile);
    currentProfile = newProfile;
  } else {
    currentProfile = snapshot.data();
  }

  if (currentProfile.activo === false) {
    await signOut(auth);
    throw new Error("Tu cuenta se encuentra desactivada.");
  }

  if ($("signedUser")) {
    $("signedUser").textContent = user.email;
  }

  if ($("roleLabel")) {
    $("roleLabel").textContent = isAdmin()
      ? "ADMINISTRADOR"
      : "EMPLEADO";
  }

  if ($("welcomeTitle")) {
    $("welcomeTitle").textContent =
      `Bienvenido, ${currentProfile.nombre || "usuario"}`;
  }

  if ($("adminTools")) {
    $("adminTools").style.display = isAdmin() ? "block" : "none";
  }

  if ($("targetEmployeeWrap")) {
    $("targetEmployeeWrap").style.display = isAdmin() ? "block" : "none";
  }

  // El administrador comienza consultando todos los movimientos.
  showingAll = isAdmin();
}

// --------------------------------------------------
// 5. CARGAR APLICACIÓN
// --------------------------------------------------

async function loadApp() {
  $("authPanel")?.classList.add("hidden");
  $("appPanel")?.classList.remove("hidden");

  setConnection("Conectando con Firebase...");

  await loadMovements();

  setConnection("Conectado");
  $("splash")?.classList.add("hidden");
}

// --------------------------------------------------
// 6. REGISTRAR MOVIMIENTO
// --------------------------------------------------

$("movementForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const saveButton = $("saveMovementBtn");

  if (saveButton) saveButton.disabled = true;

  let uploadedPath = null;

  try {
    if (!currentUser || !currentProfile) {
      throw new Error("No hay una sesión activa.");
    }

    const tipo = $("movementType")?.value;
    const fecha = $("movementDate")?.value;
    const valor = Number($("amount")?.value);
    const categoria = $("category")?.value || "Sin clasificar";
    const descripcion = $("description")?.value.trim() || "";
    const file = $("receipt")?.files?.[0];

    if (!tipo || !fecha || !Number.isFinite(valor) || valor <= 0) {
      throw new Error("Completa el tipo, la fecha y el valor.");
    }

    if (tipo === "gasto" && !file) {
      throw new Error("Selecciona el comprobante del gasto.");
    }

    let recipient = currentUser;
    let recipientProfile = currentProfile;

    // El administrador puede asignar viáticos a empleados.
    if (isAdmin() && tipo === "viatico") {
      const targetEmail = $("targetEmployee")?.value.trim();

      if (targetEmail) {
        const employee = await findEmployeeByEmail(targetEmail);

        if (!employee) {
          throw new Error("No se encontró ese empleado.");
        }

        recipient = employee.user;
        recipientProfile = employee.profile;
      }
    }

    // Validación y subida de comprobante.
    let storagePath = null;
    let fileName = null;

    if (file) {
      const extension = file.name.split(".").pop().toLowerCase();

      const allowedTypes = [
        "image/jpeg",
        "image/png",
        "image/webp",
        "application/pdf"
      ];

      const allowedExtensions = ["jpg", "jpeg", "png", "webp", "pdf"];

      if (
        !allowedTypes.includes(file.type) ||
        !allowedExtensions.includes(extension)
      ) {
        throw new Error("Solo se permiten JPG, PNG, WEBP y PDF.");
      }

      if (file.size > 10 * 1024 * 1024) {
        throw new Error("El archivo supera el límite de 10 MB.");
      }

      const uniqueName =
        `${Date.now()}_${crypto.randomUUID()}.${extension}`;

      storagePath = `${recipient.uid}/${uniqueName}`;
      fileName = file.name;

      const { error: uploadError } = await supabase.storage
        .from(RECEIPT_BUCKET)
        .upload(storagePath, file, {
          contentType: file.type,
          upsert: false
        });

      if (uploadError) throw uploadError;

      uploadedPath = storagePath;
    }

    await addDoc(collection(db, "movimientos"), {
      uid: recipient.uid,
      emailEmpleado: recipient.email,
      nombreEmpleado: recipientProfile.nombre || recipient.email,
      tipo,
      fecha,
      categoria,
      valor,
      descripcion,
      comprobante: storagePath,
      nombreArchivo: fileName,
      estadoContable: tipo === "gasto" ? "pendiente" : "registrado",
      creadoPor: currentUser.uid,
      creadoEn: serverTimestamp()
    });

    $("movementForm").reset();

    message("formMessage", "Movimiento registrado correctamente.");

    showingAll = isAdmin();
    await loadMovements();

  } catch (error) {
    console.error(error);

    // Si falló Firestore después de subir el archivo,
    // intentamos retirar el archivo para no dejarlo huérfano.
    if (uploadedPath) {
      try {
        await supabase.storage
          .from(RECEIPT_BUCKET)
          .remove([uploadedPath]);
      } catch (cleanupError) {
        console.error("No se pudo limpiar el archivo:", cleanupError);
      }
    }

    message(
      "formMessage",
      error.message || "No se pudo guardar el movimiento.",
      true
    );

  } finally {
    if (saveButton) saveButton.disabled = false;
  }
});

// --------------------------------------------------
// 7. BUSCAR EMPLEADO
// --------------------------------------------------

async function findEmployeeByEmail(email) {
  const usersSnapshot = await getDocs(collection(db, "usuarios"));

  const normalizedEmail = email.toLowerCase();

  for (const userDoc of usersSnapshot.docs) {
    const profile = userDoc.data();

    if ((profile.email || "").toLowerCase() === normalizedEmail) {
      return {
        user: {
          uid: userDoc.id,
          email: profile.email
        },
        profile
      };
    }
  }

  return null;
}

// --------------------------------------------------
// 8. CARGAR MOVIMIENTOS
// --------------------------------------------------

async function loadMovements() {
  if (!currentUser) {
    throw new Error("No existe una sesión activa.");
  }

  let movementQuery;

  if (isAdmin() && showingAll) {
    movementQuery = collection(db, "movimientos");
  } else {
    movementQuery = query(
      collection(db, "movimientos"),
      where("uid", "==", currentUser.uid)
    );
  }

  const snapshot = await getDocs(movementQuery);

  movements = snapshot.docs.map((item) => ({
    id: item.id,
    ...item.data()
  }));

  movements.sort((a, b) =>
    String(b.fecha || "").localeCompare(String(a.fecha || ""))
  );

  await renderMovements();
  updateTotals();
}

// --------------------------------------------------
// 9. MOSTRAR MOVIMIENTOS Y COMPROBANTES
// --------------------------------------------------

async function renderMovements() {
  const container = $("movementsList");
  if (!container) return;

  if (!movements.length) {
    container.innerHTML = "<p>No hay movimientos registrados.</p>";
    return;
  }

  const cards = await Promise.all(
    movements.map(async (item) => {
      let receiptUrl = null;

      if (item.comprobante) {
        try {
          const { data, error } = await supabase.storage
            .from(RECEIPT_BUCKET)
            .createSignedUrl(item.comprobante, 3600);

          if (error) {
            console.error("Error al consultar comprobante:", error);
          } else {
            receiptUrl = data?.signedUrl || null;
          }
        } catch (error) {
          console.error("Error de Supabase:", error);
        }
      }

      const canDelete = isAdmin() || item.uid === currentUser.uid;

      return `
        <article class="movement-card">
          <div class="movement-info">
            <h3>${safeText(item.nombreEmpleado || item.emailEmpleado)}</h3>
            <p><strong>Tipo:</strong> ${safeText(item.tipo)}</p>
            <p><strong>Fecha:</strong> ${safeText(item.fecha)}</p>
            <p><strong>Categoría:</strong> ${safeText(item.categoria)}</p>
            <p><strong>Valor:</strong> ${money(item.valor)}</p>
            <p><strong>Estado:</strong> ${safeText(item.estadoContable || "pendiente")}</p>
            ${item.descripcion ? `<p>${safeText(item.descripcion)}</p>` : ""}
            ${item.nombreArchivo ? `<p><strong>Archivo:</strong> ${safeText(item.nombreArchivo)}</p>` : ""}
          </div>

          ${receiptUrl ? `
            <a href="${receiptUrl}" target="_blank" rel="noopener noreferrer">
              VER COMPROBANTE
            </a>
          ` : ""}

          ${item.tipo === "gasto" && isAdmin() ? `
            <button type="button" data-account="${item.id}">
              CONTABILIZAR
            </button>
          ` : ""}

          ${canDelete ? `
            <button type="button" data-delete="${item.id}">
              ELIMINAR
            </button>
          ` : ""}
        </article>
      `;
    })
  );

  container.innerHTML = cards.join("");

  container.querySelectorAll("[data-delete]").forEach((button) => {
    button.addEventListener("click", () => {
      deleteMovement(button.dataset.delete);
    });
  });

  container.querySelectorAll("[data-account]").forEach((button) => {
    button.addEventListener("click", () => {
      accountMovement(button.dataset.account);
    });
  });
}

// --------------------------------------------------
// 10. CONTABILIZAR COMPROBANTE
// --------------------------------------------------

async function accountMovement(id) {
  if (!isAdmin()) {
    alert("Solo un administrador puede contabilizar gastos.");
    return;
  }

  const item = movements.find((movement) => movement.id === id);
  if (!item) return;

  const fecha = prompt("Fecha de la factura:", item.fecha || "");
  if (fecha === null) return;

  const proveedor = prompt("Nombre del proveedor:", "");
  if (proveedor === null) return;

  const nit = prompt("NIT del proveedor (opcional):", "");
  if (nit === null) return;

  const categoria = prompt(
    "Categoría del gasto:",
    item.categoria || "Otros"
  );
  if (categoria === null) return;

  const total = Number(
    prompt("Valor total de la factura:", String(item.valor || ""))
  );

  if (!Number.isFinite(total) || total <= 0) {
    alert("El valor ingresado no es válido.");
    return;
  }

  try {
    await setDoc(
      doc(db, "movimientos", id),
      {
        fechaContable: fecha,
        proveedor,
        nit,
        categoria,
        valor: total,
        estadoContable: "contabilizado",
        contabilizadoPor: currentUser.uid,
        contabilizadoEn: serverTimestamp()
      },
      { merge: true }
    );

    alert("Comprobante contabilizado y actualizado.");
    await loadMovements();

  } catch (error) {
    console.error(error);
    alert("No se pudo contabilizar: " + error.message);
  }
}

// --------------------------------------------------
// 11. ELIMINAR MOVIMIENTO Y COMPROBANTE
// --------------------------------------------------

async function deleteMovement(id) {
  const item = movements.find((movement) => movement.id === id);
  if (!item) return;

  if (!isAdmin() && item.uid !== currentUser.uid) {
    alert("No tienes permiso para eliminar este documento.");
    return;
  }

  if (!confirm("¿Deseas eliminar este movimiento y su comprobante?")) {
    return;
  }

  try {
    if (item.comprobante) {
      const { error } = await supabase.storage
        .from(RECEIPT_BUCKET)
        .remove([item.comprobante]);

      if (error) throw error;
    }

    await deleteDoc(doc(db, "movimientos", id));

    alert("Documento eliminado.");
    await loadMovements();

  } catch (error) {
    console.error(error);
    alert("No se pudo eliminar: " + error.message);
  }
}

// --------------------------------------------------
// 12. TOTALES Y SALDOS
// --------------------------------------------------

function updateTotals() {
  const advances = movements
    .filter((item) => item.tipo === "viatico")
    .reduce((sum, item) => sum + Number(item.valor || 0), 0);

  const expenses = movements
    .filter((item) => item.tipo === "gasto")
    .reduce((sum, item) => sum + Number(item.valor || 0), 0);

  const remaining = advances - expenses;

  if ($("totalAdvances")) {
    $("totalAdvances").textContent = money(advances);
  }

  if ($("totalExpenses")) {
    $("totalExpenses").textContent = money(expenses);
  }

  if ($("balance")) {
    $("balance").textContent = money(remaining);
  }
}

// --------------------------------------------------
// 13. CONSULTA ADMINISTRATIVA
// --------------------------------------------------

$("allMovementsBtn")?.addEventListener("click", async () => {
  if (!isAdmin()) return;

  try {
    showingAll = true;
    await loadMovements();
  } catch (error) {
    showError(error);
  }
});

$("filterEmployeeBtn")?.addEventListener("click", async () => {
  if (!isAdmin()) return;

  const email = $("employeeFilter")?.value.trim();

  try {
    if (!email) {
      showingAll = true;
      await loadMovements();
      return;
    }

    const employee = await findEmployeeByEmail(email);

    if (!employee) {
      alert("No se encontró el empleado.");
      return;
    }

    const snapshot = await getDocs(
      query(
        collection(db, "movimientos"),
        where("uid", "==", employee.user.uid)
      )
    );

    movements = snapshot.docs.map((item) => ({
      id: item.id,
      ...item.data()
    }));

    movements.sort((a, b) =>
      String(b.fecha || "").localeCompare(String(a.fecha || ""))
    );

    await renderMovements();
    updateTotals();

  } catch (error) {
    showError(error);
  }
});

// --------------------------------------------------
// 14. EXPORTAR INFORMACIÓN A CSV
// --------------------------------------------------

$("exportBtn")?.addEventListener("click", () => {
  if (!isAdmin()) return;

  const headers = [
    "Empleado",
    "Correo",
    "Tipo",
    "Fecha",
    "Categoría",
    "Proveedor",
    "NIT",
    "Valor",
    "Estado contable"
  ];

  const rows = movements.map((item) => [
    item.nombreEmpleado,
    item.emailEmpleado,
    item.tipo,
    item.fecha,
    item.categoria,
    item.proveedor || "",
    item.nit || "",
    item.valor,
    item.estadoContable || ""
  ]);

  const csv = [headers, ...rows]
    .map((row) =>
      row.map((value) =>
        `"${String(value ?? "").replace(/"/g, '""')}"`
      ).join(";")
    )
    .join("\n");

  const blob = new Blob(["\uFEFF" + csv], {
    type: "text/csv;charset=utf-8;"
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = "reporte_viaticos_BER.csv";
  link.click();

  URL.revokeObjectURL(url);
});

// --------------------------------------------------
// 15. ACTUALIZAR INFORMACIÓN
// --------------------------------------------------

$("refreshBtn")?.addEventListener("click", async () => {
  try {
    await loadMovements();
    setConnection("Conectado");
  } catch (error) {
    showError(error);
  }
});

// --------------------------------------------------
// 16. ESTADO DE INTERNET
// --------------------------------------------------

function updateConnection() {
  if (!navigator.onLine) {
    setConnection("Sin conexión a internet", true);
  }
}

window.addEventListener("online", () => {
  setConnection("Internet disponible. Actualiza la información.");
});

window.addEventListener("offline", updateConnection);

// --------------------------------------------------
// 17. INICIO DE SESIÓN Y CARGA AUTOMÁTICA
// --------------------------------------------------

onAuthStateChanged(auth, async (user) => {
  currentUser = user;

  if (!user) {
    currentProfile = null;
    movements = [];
    showingAll = false;
    loadingUid = null;

    $("authPanel")?.classList.remove("hidden");
    $("appPanel")?.classList.add("hidden");
    $("splash")?.classList.add("hidden");

    setConnection("Sesión cerrada");
    return;
  }

  // Evita cargar dos veces la misma sesión.
  if (loadingUid === user.uid) return;

  loadingUid = user.uid;

  setConnection("Conectando con Firebase...");

  try {
    await loadProfile(user);
    await loadApp();

  } catch (error) {
    showError(error);

    // Muestra el error en lugar de dejar la aplicación
    // indefinidamente en el estado de conexión.
    $("authPanel")?.classList.add("hidden");
    $("appPanel")?.classList.remove("hidden");
    $("splash")?.classList.add("hidden");

    loadingUid = null;
  }
});
