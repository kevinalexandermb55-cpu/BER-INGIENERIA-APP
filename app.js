

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

// ================================================
// 1. CONEXIONES
// ================================================

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

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

// ================================================
// 2. VARIABLES GENERALES
// ================================================

let currentUser = null;
let currentProfile = null;
let movements = [];
let showingAll = false;
let loadingUid = null;

const $ = id => document.getElementById(id);

const isAdmin = () => currentProfile?.rol === "admin";

const money = value => new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  maximumFractionDigits: 0
}).format(Number(value) || 0);

const safeText = value => String(value ?? "").replace(
  /[&<>"']/g,
  char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]
);

function notify(text) {
  const toast = $("globalToast");

  if (!toast) {
    alert(text);
    return;
  }

  toast.textContent = text;
  toast.classList.remove("hidden");

  clearTimeout(window.berToastTimer);

  window.berToastTimer = setTimeout(() => {
    toast.classList.add("hidden");
  }, 3500);
}

function message(id, text, error = false) {
  const element = $(id);
  if (!element) return;

  element.textContent = text;
  element.classList.remove("hidden", "error", "success");
  element.classList.add(error ? "error" : "success");
}

function setConnection(text, error = false) {
  const element = $("connectionStatus");
  if (!element) return;

  element.textContent = text;
  element.classList.toggle("online", !error);
}

// ================================================
// 3. AUTENTICACIÓN
// ================================================

$("loginForm")?.addEventListener("submit", async event => {
  event.preventDefault();

  const email = $("email").value.trim().toLowerCase();
  const password = $("password").value;
  const button = $("loginBtn");

  if (!email || !password) {
    message("authMessage", "Completa el correo y la contraseña.", true);
    return;
  }

  button.disabled = true;
  button.textContent = "Verificando acceso...";

  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (error) {
    message("authMessage", "No fue posible ingresar: " + error.message, true);
  } finally {
    button.disabled = false;
    button.textContent = "Ingresar →";
  }
});

// Registro de empleados

$("showSignup")?.addEventListener("click", async () => {
  const email = $("email").value.trim().toLowerCase();
  const password = $("password").value;

  if (!email || !password) {
    message("authMessage", "Escribe primero tu correo y contraseña.", true);
    return;
  }

  if (password.length < 6) {
    message("authMessage", "La contraseña debe tener mínimo 6 caracteres.", true);
    return;
  }

  try {
    message("authMessage", "Creando cuenta...");

    await createUserWithEmailAndPassword(
      auth,
      email,
      password
    );

  } catch (error) {
    message("authMessage", error.message, true);
  }
});

// Cerrar sesión

$("logoutBtn")?.addEventListener("click", async () => {
  await signOut(auth);
});

// ================================================
// 4. PERFIL DEL EMPLEADO
// ================================================

async function loadProfile(user) {
  const reference = doc(db, "usuarios", user.uid);
  const snapshot = await getDoc(reference);

  if (!snapshot.exists()) {
    currentProfile = {
      nombre: user.displayName || user.email.split("@")[0],
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
    throw new Error("Tu cuenta está desactivada.");
  }

  $("signedUser").textContent =
    currentProfile.nombre || user.email;

  $("roleLabel").textContent =
    isAdmin() ? "ADMINISTRADOR" : "EMPLEADO";

  $("avatar").textContent =
    (currentProfile.nombre || "B").charAt(0).toUpperCase();

  $("welcomeTitle").textContent =
    `Hola, ${currentProfile.nombre || "bienvenido"}`;

  $("welcomeSubtitle").textContent =
    isAdmin()
      ? "Panel general de gestión de viáticos."
      : "Aquí puedes gestionar tus viáticos y comprobantes.";

  $("adminTools")?.classList.toggle("hidden", !isAdmin());

  $("targetEmployeeWrap")?.classList.toggle("hidden", !isAdmin());

  // El administrador visualiza todos los movimientos.
  showingAll = isAdmin();
}

// ================================================
// 5. MOSTRAR APLICACIÓN
// ================================================

async function loadApp() {
  $("authPanel")?.classList.add("hidden");
  $("appPanel")?.classList.remove("hidden");
  $("logoutBtn")?.classList.remove("hidden");

  setConnection("Actualizando información...");

  await loadMovements();

  setConnection("Conectado");
  $("splash")?.classList.add("hidden");
}

// ================================================
// 6. BUSCAR EMPLEADO
// ================================================

async function findEmployeeByEmail(email) {
  const snapshot = await getDocs(collection(db, "usuarios"));

  const normalized = email.trim().toLowerCase();

  for (const item of snapshot.docs) {
    const profile = item.data();

    if ((profile.email || "").toLowerCase() === normalized) {
      return {
        uid: item.id,
        email: profile.email,
        profile
      };
    }
  }

  return null;
}

// ================================================
// 7. REGISTRAR VIÁTICOS Y GASTOS
// ================================================

$("movementForm")?.addEventListener("submit", async event => {
  event.preventDefault();

  const button = $("saveMovementBtn");
  button.disabled = true;
  button.textContent = "Guardando movimiento...";

  let uploadedPath = null;

  try {
    if (!currentUser || !currentProfile) {
      throw new Error("No existe una sesión activa.");
    }

    const tipo = $("movementType").value;
    const fecha = $("movementDate").value;
    const valor = Number($("amount").value);
    const categoria = $("category").value;
    const descripcion = $("description").value.trim();
    const file = $("receipt").files[0];

    if (!fecha || !Number.isFinite(valor) || valor <= 0) {
      throw new Error("Verifica la fecha y el valor ingresado.");
    }

    if (!descripcion) {
      throw new Error("Escribe una descripción del movimiento.");
    }

    if (tipo === "gasto" && !file) {
      throw new Error("Adjunta la fotografía del comprobante.");
    }

    // Identificar destinatario.
    let recipient = {
      uid: currentUser.uid,
      email: currentUser.email
    };

    let recipientProfile = currentProfile;

    if (isAdmin() && $("targetEmployee").value.trim()) {
      const employee = await findEmployeeByEmail(
        $("targetEmployee").value
      );

      if (!employee) {
        throw new Error("No encontramos al empleado indicado.");
      }

      recipient = employee;
      recipientProfile = employee.profile;
    }

    // Validar archivo.
    let storagePath = null;
    let fileName = null;

    if (file) {
      const extension = file.name.split(".").pop().toLowerCase();

      const allowed = [
        "jpg", "jpeg", "png", "webp", "pdf"
      ];

      if (!allowed.includes(extension)) {
        throw new Error("Formato no permitido. Usa JPG, PNG, WEBP o PDF.");
      }

      if (file.size > 10 * 1024 * 1024) {
        throw new Error("El archivo no puede superar 10 MB.");
      }

      const uniqueName =
        `${Date.now()}_${crypto.randomUUID()}.${extension}`;

      storagePath = `${recipient.uid}/${uniqueName}`;
      fileName = file.name;

      const { error } = await supabase.storage
        .from(RECEIPT_BUCKET)
        .upload(storagePath, file, {
          contentType: file.type,
          upsert: false
        });

      if (error) throw error;

      uploadedPath = storagePath;
    }

    // Guardar información en Firebase.
    await addDoc(collection(db, "movimientos"), {
      uid: recipient.uid,
      emailEmpleado: recipient.email,
      nombreEmpleado:
        recipientProfile.nombre || recipient.email,

      tipo,
      fecha,
      categoria,
      valor,
      descripcion,

      comprobante: storagePath,
      nombreArchivo: fileName,

      estadoContable:
        tipo === "gasto" ? "pendiente" : "por verificar",

      creadoPor: currentUser.uid,
      creadoEn: serverTimestamp()
    });

    $("movementForm").reset();

    message(
      "formMessage",
      tipo === "viatico"
        ? "Viático registrado correctamente."
        : "Gasto y comprobante registrados correctamente."
    );

    showingAll = isAdmin();
    await loadMovements();

  } catch (error) {
    console.error("BER registro:", error);

    if (uploadedPath) {
      try {
        await supabase.storage
          .from(RECEIPT_BUCKET)
          .remove([uploadedPath]);
      } catch (cleanupError) {
        console.error(cleanupError);
      }
    }

    message(
      "formMessage",
      error.message || "No se pudo guardar el movimiento.",
      true
    );

  } finally {
    button.disabled = false;
    button.textContent = "Guardar movimiento →";
  }
});

// ================================================
// 8. CONSULTAR MOVIMIENTOS
// ================================================

async function loadMovements(employeeUid = null) {
  if (!currentUser) return;

  let movementQuery;

  if (employeeUid) {
    movementQuery = query(
      collection(db, "movimientos"),
      where("uid", "==", employeeUid)
    );
  } else if (isAdmin() && showingAll) {
    movementQuery = collection(db, "movimientos");
  } else {
    movementQuery = query(
      collection(db, "movimientos"),
      where("uid", "==", currentUser.uid)
    );
  }

  const snapshot = await getDocs(movementQuery);

  movements = snapshot.docs.map(item => ({
    id: item.id,
    ...item.data()
  }));

  movements.sort((a, b) =>
    String(b.fecha || "").localeCompare(String(a.fecha || ""))
  );

  await renderMovements();
  await renderGallery();
  updateTotals();
}

// ================================================
// 9. MOSTRAR HISTORIAL
// ================================================

async function getReceiptUrl(path) {
  if (!path) return null;

  const { data, error } = await supabase.storage
    .from(RECEIPT_BUCKET)
    .createSignedUrl(path, 3600);

  if (error) {
    console.error("Comprobante:", error);
    return null;
  }

  return data?.signedUrl || null;
}

async function renderMovements() {
  const container = $("movementsList");
  if (!container) return;

  if (!movements.length) {
    container.innerHTML = `
      <div class="empty-state">
        <strong>No hay movimientos registrados</strong>
        <p>Los movimientos aparecerán aquí.</p>
      </div>
    `;
    return;
  }

  const cards = await Promise.all(
    movements.map(async item => {
      const icon = item.tipo === "viatico" ? "↗" : "↙";

      const amountClass =
        item.tipo === "viatico" ? "advance" : "expense";

      const receiptUrl = await getReceiptUrl(item.comprobante);

      const canDelete =
        isAdmin() || item.uid === currentUser.uid;

      return `
        <article class="movement-item">

          <div class="movement-icon">${icon}</div>

          <div class="movement-info">
            <strong>${safeText(item.nombreEmpleado || item.emailEmpleado)}</strong>

            <small>
              ${safeText(item.tipo.toUpperCase())} ·
              ${safeText(item.fecha)}
            </small>

            <small>
              ${safeText(item.categoria || "Sin categoría")}
            </small>

            <small>
              Estado: ${safeText(item.estadoContable || "Pendiente")}
            </small>

            ${item.descripcion
              ? `<small>${safeText(item.descripcion)}</small>`
              : ""}

            ${receiptUrl ? `
              <a class="receipt-link"
                 href="${receiptUrl}"
                 target="_blank"
                 rel="noopener noreferrer">
                 VER COMPROBANTE ↗
              </a>
            ` : ""}

            <div class="movement-actions">

              ${isAdmin() && item.tipo === "gasto" ? `
                <button class="tiny-btn"
                        data-account="${item.id}">
                  Contabilizar
                </button>
              ` : ""}

              ${canDelete ? `
                <button class="tiny-btn"
                        data-delete="${item.id}">
                  Eliminar
                </button>
              ` : ""}

            </div>
          </div>

          <div class="movement-amount ${amountClass}">
            ${money(item.valor)}
          </div>

        </article>
      `;
    })
  );

  container.innerHTML = cards.join("");

  container.querySelectorAll("[data-delete]").forEach(button => {
    button.addEventListener("click", () => {
      deleteMovement(button.dataset.delete);
    });
  });

  container.querySelectorAll("[data-account]").forEach(button => {
    button.addEventListener("click", () => {
      accountMovement(button.dataset.account);
    });
  });
}

// ================================================
// 10. GALERÍA DE COMPROBANTES
// ================================================

async function renderGallery() {
  const gallery = $("receiptsGallery");
  if (!gallery) return;

  const receipts = movements.filter(item => item.comprobante);

  if (!receipts.length) {
    gallery.innerHTML = `
      <div class="empty-state">
        <strong>Galería de comprobantes</strong>
        <p>Aquí aparecerán los documentos registrados.</p>
      </div>
    `;
    return;
  }

  const html = await Promise.all(
    receipts.map(async item => {
      const url = await getReceiptUrl(item.comprobante);

      if (!url) return "";

      const isImage = /\.(jpg|jpeg|png|webp)$/i.test(
        item.nombreArchivo || ""
      );

      return `
        <article class="receipt-card">

          ${isImage ? `
            <a href="${url}" target="_blank" rel="noopener noreferrer">
              <img src="${url}"
                   alt="Comprobante de ${safeText(item.nombreEmpleado)}"
                   loading="lazy">
            </a>
          ` : `
            <a href="${url}" target="_blank" rel="noopener noreferrer">
              <div class="movement-icon">PDF</div>
              Ver documento
            </a>
          `}

          <p><strong>${safeText(item.nombreEmpleado)}</strong></p>
          <p>${safeText(item.categoria)}</p>
          <p>${safeText(item.fecha)}</p>
          <p>${money(item.valor)}</p>

        </article>
      `;
    })
  );

  gallery.innerHTML = html.filter(Boolean).join("");
}

// ================================================
// 11. CONTABILIZAR GASTOS
// ================================================

async function accountMovement(id) {
  if (!isAdmin()) {
    notify("No tienes permisos de administrador.");
    return;
  }

  const item = movements.find(m => m.id === id);
  if (!item) return;

  const proveedor = prompt("Nombre del proveedor:", item.proveedor || "");
  if (proveedor === null) return;

  const nit = prompt("NIT del proveedor:", item.nit || "");
  if (nit === null) return;

  const fecha = prompt("Fecha de la factura:", item.fecha || "");
  if (fecha === null) return;

  const total = Number(
    prompt("Valor de la factura:", String(item.valor))
  );

  if (!Number.isFinite(total) || total <= 0) {
    notify("El valor ingresado no es válido.");
    return;
  }

  try {
    await setDoc(
      doc(db, "movimientos", id),
      {
        proveedor,
        nit,
        fechaContable: fecha,
        valor: total,
        estadoContable: "contabilizado",
        contabilizadoPor: currentUser.uid,
        contabilizadoEn: serverTimestamp()
      },
      { merge: true }
    );

    notify("Gasto contabilizado correctamente.");
    await loadMovements();

  } catch (error) {
    console.error(error);
    notify("Error al contabilizar: " + error.message);
  }
}

// ================================================
// 12. CONTABILIZACIÓN GENERAL
// ================================================

$("accountingBtn")?.addEventListener("click", () => {
  if (!isAdmin()) {
    notify("Esta función es exclusiva del administrador.");
    return;
  }

  const advances = movements
    .filter(item => item.tipo === "viatico")
    .reduce((sum, item) => sum + Number(item.valor || 0), 0);

  const expenses = movements
    .filter(item => item.tipo === "gasto")
    .reduce((sum, item) => sum + Number(item.valor || 0), 0);

  const pending = movements.filter(
    item => item.tipo === "gasto" &&
    item.estadoContable !== "contabilizado"
  ).length;

  const balance = advances - expenses;

  const summary = $("accountingSummary");
  const details = $("accountingDetails");

  summary?.classList.remove("hidden");

  if (details) {
    details.innerHTML = `
      <div class="accounting-summary">

        <div class="accounting-card">
          <div class="label">Viáticos asignados o reportados</div>
          <strong>${money(advances)}</strong>
        </div>

        <div class="accounting-card">
          <div class="label">Gastos reportados</div>
          <strong>${money(expenses)}</strong>
        </div>

        <div class="accounting-card">
          <div class="label">Saldo</div>
          <strong>${money(balance)}</strong>
        </div>

        <div class="accounting-card">
          <div class="label">Comprobantes pendientes</div>
          <strong>${pending}</strong>
        </div>

      </div>

      <p class="small">
        Informe generado con los movimientos actualmente consultados.
        Los viáticos registrados por empleados deben verificarse antes
        de considerarlos como valores aprobados.
      </p>
    `;

    summary.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  }
});

// ================================================
// 13. ELIMINAR MOVIMIENTOS
// ================================================

async function deleteMovement(id) {
  const item = movements.find(m => m.id === id);
  if (!item) return;

  if (!isAdmin() && item.uid !== currentUser.uid) {
    notify("No tienes autorización para eliminar este movimiento.");
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

    notify("Movimiento eliminado correctamente.");

    await loadMovements();

  } catch (error) {
    console.error(error);
    notify("No se pudo eliminar: " + error.message);
  }
}

// ================================================
// 14. RESUMEN FINANCIERO
// ================================================

function updateTotals() {
  const advances = movements
    .filter(item => item.tipo === "viatico")
    .reduce((sum, item) => sum + Number(item.valor || 0), 0);

  const expenses = movements
    .filter(item => item.tipo === "gasto")
    .reduce((sum, item) => sum + Number(item.valor || 0), 0);

  const balance = advances - expenses;

  if ($("totalAdvances")) {
    $("totalAdvances").textContent = money(advances);
  }

  if ($("totalExpenses")) {
    $("totalExpenses").textContent = money(expenses);
  }

  if ($("balance")) {
    $("balance").textContent = money(balance);
  }
}

// ================================================
// 15. CONSULTA DE EMPLEADOS
// ================================================

$("filterEmployeeBtn")?.addEventListener("click", async () => {
  if (!isAdmin()) return;

  const email = $("employeeFilter").value.trim();

  try {
    if (!email) {
      showingAll = true;
      await loadMovements();
      return;
    }

    const employee = await findEmployeeByEmail(email);

    if (!employee) {
      notify("No encontramos ese empleado.");
      return;
    }

    showingAll = false;
    await loadMovements(employee.uid);

    notify("Información del empleado consultada.");

  } catch (error) {
    console.error(error);
    notify("Error al consultar: " + error.message);
  }
});

$("allMovementsBtn")?.addEventListener("click", async () => {
  if (!isAdmin()) return;

  try {
    showingAll = true;
    $("employeeFilter").value = "";
    await loadMovements();
    notify("Mostrando todos los movimientos.");
  } catch (error) {
    console.error(error);
    notify(error.message);
  }
});

// ================================================
// 16. EXPORTAR REPORTE CSV
// ================================================

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
    "Estado"
  ];

  const rows = movements.map(item => [
    item.nombreEmpleado,
    item.emailEmpleado,
    item.tipo,
    item.fecha,
    item.categoria,
    item.proveedor || "",
    item.nit || "",
    item.valor,
    item.estadoContable
  ]);

  const csv = [headers, ...rows]
    .map(row =>
      row.map(value =>
        `"${String(value ?? "").replace(/"/g, '""')}"`
      ).join(";")
    )
    .join("\n");

  const blob = new Blob(
    ["\uFEFF" + csv],
    { type: "text/csv;charset=utf-8;" }
  );

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = "BER_reporte_viaticos.csv";
  link.click();

  URL.revokeObjectURL(url);
});

// ================================================
// 17. ACTUALIZAR INFORMACIÓN
// ================================================

$("refreshBtn")?.addEventListener("click", async () => {
  try {
    await loadMovements();
    setConnection("Conectado");
    notify("Información actualizada.");
  } catch (error) {
    console.error(error);
    notify("No se pudo actualizar la información.");
  }
});

// ================================================
// 18. CONEXIÓN A INTERNET
// ================================================

window.addEventListener("online", () => {
  setConnection("Internet disponible");
});

window.addEventListener("offline", () => {
  setConnection("Sin conexión", true);
});

// ================================================
// 19. INICIO AUTOMÁTICO
// ================================================

onAuthStateChanged(auth, async user => {
  currentUser = user;

  if (!user) {
    currentProfile = null;
    movements = [];
    showingAll = false;
    loadingUid = null;

    $("authPanel")?.classList.remove("hidden");
    $("appPanel")?.classList.add("hidden");
    $("logoutBtn")?.classList.add("hidden");
    $("splash")?.classList.add("hidden");

    setConnection("Sesión cerrada");
    return;
  }

  if (loadingUid === user.uid) return;

  loadingUid = user.uid;

  try {
    setConnection("Conectando...");

    await loadProfile(user);
    await loadApp();

  } catch (error) {
    console.error("Inicio BER:", error);

    message(
      "authMessage",
      "No fue posible iniciar la aplicación: " + error.message,
      true
    );

    $("authPanel")?.classList.remove("hidden");
    $("appPanel")?.classList.add("hidden");
    $("splash")?.classList.add("hidden");

    loadingUid = null;
    setConnection("Error de conexión", true);
  }
});
