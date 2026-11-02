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
      return auth.currentUser
        ? await auth.currentUser.getIdToken()
        : null;
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

const $ = (id) => document.getElementById(id);

const isAdmin = () => currentProfile?.rol === "admin";

function message(elementId, text, error = false) {
  const element = $(elementId);
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

// --------------------------------------------------
// 3. AUTENTICACIÓN
// --------------------------------------------------

const loginForm = $("loginForm");

loginForm?.addEventListener("submit", async (event) => {
  event.preventDefault();

  message("authMessage", "Ingresando...");

  try {
    await signInWithEmailAndPassword(
      auth,
      $("email").value.trim(),
      $("password").value
    );
  } catch (error) {
    message("authMessage", "No se pudo ingresar: " + error.message, true);
  }
});

$("showSignup")?.addEventListener("click", async () => {
  const email = $("email")?.value.trim();
  const password = $("password")?.value;

  if (!email || !password) {
    message("authMessage", "Escribe correo y contraseña.", true);
    return;
  }

  try {
    message("authMessage", "Creando cuenta...");
    await createUserWithEmailAndPassword(auth, email, password);
  } catch (error) {
    message("authMessage", "No se pudo crear la cuenta: " + error.message, true);
  }
});

$("logoutBtn")?.addEventListener("click", async () => {
  await signOut(auth);
});

// --------------------------------------------------
// 4. PERFIL Y PERMISOS
// --------------------------------------------------

async function loadProfile(user) {
  const reference = doc(db, "usuarios", user.uid);
  const snapshot = await getDoc(reference);

  if (!snapshot.exists()) {
    currentProfile = {
      nombre: user.displayName || user.email,
      email: user.email,
      rol: "empleado",
      activo: true
    };

    await setDoc(reference, currentProfile);
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
    $("roleLabel").textContent = isAdmin() ? "ADMINISTRADOR" : "EMPLEADO";
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
}

// --------------------------------------------------
// 5. CARGAR APLICACIÓN
// --------------------------------------------------

async function loadApp() {
  $("authPanel")?.classList.add("hidden");
  $("appPanel")?.classList.remove("hidden");

  await loadMovements();

  if ($("splash")) {
    $("splash").classList.add("hidden");
  }
}

// --------------------------------------------------
// 6. REGISTRAR MOVIMIENTO
// --------------------------------------------------

$("movementForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const saveButton = $("saveMovementBtn");
  if (saveButton) saveButton.disabled = true;

  try {
    const tipo = $("movementType")?.value;
    const fecha = $("movementDate")?.value;
    const valor = Number($("amount")?.value);
    const categoria = $("category")?.value || "Sin clasificar";
    const descripcion = $("description")?.value.trim() || "";
    const file = $("receipt")?.files?.[0];

    if (!tipo || !fecha || !valor || valor <= 0) {
      throw new Error("Completa el tipo, la fecha y el valor.");
    }

    if (tipo === "gasto" && !file) {
      throw new Error("Selecciona la fotografía del comprobante.");
    }

    if (file) {
      if (!file.type.startsWith("image/")) {
        throw new Error("Solo se permiten fotografías de comprobantes.");
      }

      if (file.size > 10 * 1024 * 1024) {
        throw new Error("La fotografía supera el límite de 10 MB.");
      }
    }

    let recipient = currentUser;
    let recipientProfile = currentProfile;

    // El administrador puede asignar un viático a un empleado.
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

    // El empleado puede registrar su propio viático.
    if (!isAdmin() && tipo === "viatico") {
      recipient = currentUser;
      recipientProfile = currentProfile;
    }

    let storagePath = null;
    let fileName = null;

    if (file) {
      const extension = file.name.split(".").pop();
      const uniqueName = `${Date.now()}_${crypto.randomUUID()}.${extension}`;
      storagePath = `${recipient.uid}/${uniqueName}`;
      fileName = file.name;

      const { error: uploadError } = await supabase.storage
        .from(RECEIPT_BUCKET)
        .upload(storagePath, file, {
          contentType: file.type,
          upsert: false
        });

      if (uploadError) throw uploadError;
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
    message("formMessage", error.message || "No se pudo guardar.", true);
  } finally {
    if (saveButton) saveButton.disabled = false;
  }
});

// --------------------------------------------------
// 7. BUSCAR EMPLEADO
// --------------------------------------------------

async function findEmployeeByEmail(email) {
  const usersSnapshot = await getDocs(collection(db, "usuarios"));

  for (const userDoc of usersSnapshot.docs) {
    const profile = userDoc.data();

    if ((profile.email || "").toLowerCase() === email.toLowerCase()) {
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

  renderMovements();
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

  const cards = await Promise.all(movements.map(async (item) => {
    let receiptUrl = null;

    if (item.comprobante) {
      const { data } = await supabase.storage
        .from(RECEIPT_BUCKET)
        .createSignedUrl(item.comprobante, 3600);

      receiptUrl = data?.signedUrl || null;
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
          ${item.descripcion ? <p>${safeText(item.descripcion)}</p> : ""}
        </div>

        ${receiptUrl ? `
          <a href="${receiptUrl}" target="_blank" rel="noopener">
            VER COMPROBANTE
          </a>
        ` : ""}

        ${item.tipo === "gasto" ? `
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
  }));

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
// 11. ELIMINAR MOVIMIENTO Y FOTOGRAFÍA
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
// 13. FILTRO Y CONSULTA ADMINISTRATIVA
// --------------------------------------------------

$("allMovementsBtn")?.addEventListener("click", async () => {
  if (!isAdmin()) return;

  showingAll = true;
  await loadMovements();
});

$("filterEmployeeBtn")?.addEventListener("click", async () => {
  if (!isAdmin()) return;

  const email = $("employeeFilter")?.value.trim();

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

$("refreshBtn")?.addEventListener("click", loadMovements);

// --------------------------------------------------
// 16. ESTADO DE CONEXIÓN
// --------------------------------------------------

function updateConnection() {
  const status = $("connectionStatus");
  if (!status) return;

  status.textContent = navigator.onLine
    ? "Conectado"
    : "Sin conexión";
}

window.addEventListener("online", updateConnection);
window.addEventListener("offline", updateConnection);

// --------------------------------------------------
// 17. INICIO DE SESIÓN AUTOMÁTICO
// --------------------------------------------------

onAuthStateChanged(auth, async (user) => {
  currentUser = user;

  if (!user) {
    currentProfile = null;

    $("authPanel")?.classList.remove("hidden");
    $("appPanel")?.classList.add("hidden");
    $("splash")?.classList.add("hidden");

    return;
  }

  try {
    await loadProfile(user);
    await loadApp();
    updateConnection();

  } catch (error) {
    console.error(error);
    alert(error.message || "Error al cargar la aplicación.");
  }
});