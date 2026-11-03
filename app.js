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

// ==================================================
// 1. CONEXIONES
// ==================================================

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

// ==================================================
// 2. VARIABLES Y UTILIDADES
// ==================================================

let currentUser = null;
let currentProfile = null;
let movements = [];
let showingAll = false;

const $ = id => document.getElementById(id);

const isAdmin = () => currentProfile?.rol === "admin";

const allowedTypes = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf"
];

const money = value =>
  new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0
  }).format(Number(value) || 0);

function safeText(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}

function message(id, text, error = false) {
  const element = $(id);
  if (!element) return;

  element.textContent = text;
  element.classList.remove("hidden");
  element.style.color = error ? "#ff7777" : "#d9a62e";
}

function hideMessage(id) {
  $(id)?.classList.add("hidden");
}

function hideSplash() {
  $("splash")?.classList.add("splash-dismiss");
  setTimeout(() => $("splash")?.classList.add("hidden"), 520);
}

function setButtonLoading(id, loading, text = "Procesando...") {
  const button = $(id);
  if (!button) return;

  if (loading) {
    button.dataset.originalText = button.textContent;
    button.disabled = true;
    button.textContent = text;
  } else {
    button.disabled = false;
    if (button.dataset.originalText) {
      button.textContent = button.dataset.originalText;
    }
  }
}

// ==================================================
// 3. AUTENTICACIÓN
// ==================================================

$("loginForm")?.addEventListener("submit", async event => {
  event.preventDefault();

  hideMessage("authMessage");
  message("authMessage", "Ingresando...");

  setButtonLoading("loginBtn", true, "Ingresando...");

  try {
    await signInWithEmailAndPassword(
      auth,
      $("email").value.trim(),
      $("password").value
    );
  } catch (error) {
    console.error(error);
    message("authMessage", "Error de acceso: " + error.message, true);
  } finally {
    setButtonLoading("loginBtn", false);
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
    message("authMessage", "La contraseña debe tener mínimo 6 caracteres.", true);
    return;
  }

  try {
    message("authMessage", "Creando cuenta...");

    await createUserWithEmailAndPassword(auth, email, password);

    message("authMessage", "Cuenta creada correctamente.");
  } catch (error) {
    console.error(error);
    message("authMessage", "No se pudo crear la cuenta: " + error.message, true);
  }
});

$("logoutBtn")?.addEventListener("click", async () => {
  await signOut(auth);
});

// ==================================================
// 4. PERFIL Y PERMISOS
// ==================================================

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

  $("signedUser").textContent = user.email;

  $("roleLabel").textContent =
    isAdmin() ? "ADMINISTRADOR" : "EMPLEADO";

  $("welcomeTitle").textContent =
    `Bienvenido, ${currentProfile.nombre || "usuario"}`;

  $("avatar").textContent =
    (currentProfile.nombre || user.email || "B").charAt(0).toUpperCase();

  $("adminTools")?.classList.toggle("hidden", !isAdmin());

  $("targetEmployeeWrap")?.classList.toggle("hidden", !isAdmin());

  $("logoutBtn")?.classList.remove("hidden");

  // Los administradores pueden consultar todos los movimientos.
  showingAll = isAdmin();
}

// ==================================================
// 5. INICIO DE LA APLICACIÓN
// ==================================================

async function loadApp() {
  $("authPanel")?.classList.add("hidden");
  $("appPanel")?.classList.remove("hidden");

  await loadMovements();
  updateConnection();
  hideSplash();
}

// ==================================================
// 6. BUSCAR EMPLEADO
// ==================================================

async function findEmployeeByEmail(email) {
  const snapshot = await getDocs(collection(db, "usuarios"));

  const found = snapshot.docs.find(item =>
    (item.data().email || "").toLowerCase() === email.toLowerCase()
  );

  if (!found) return null;

  return {
    user: {
      uid: found.id,
      email: found.data().email
    },
    profile: found.data()
  };
}

// ==================================================
// 7. SUBIR COMPROBANTE A SUPABASE
// ==================================================

async function uploadReceipt(file, uid) {
  if (!allowedTypes.includes(file.type)) {
    throw new Error("Formato no permitido. Usa JPG, PNG, WEBP o PDF.");
  }

  if (file.size > 10 * 1024 * 1024) {
    throw new Error("El archivo supera el límite de 10 MB.");
  }

  const extension = file.name.split(".").pop().toLowerCase();

  const uniqueName =
    `${Date.now()}_${crypto.randomUUID()}.${extension}`;

  const path = `${uid}/${uniqueName}`;

  const { error } = await supabase.storage
    .from(RECEIPT_BUCKET)
    .upload(path, file, {
      contentType: file.type,
      upsert: false
    });

  if (error) throw error;

  return path;
}

// ==================================================
// 8. REGISTRAR MOVIMIENTO
// ==================================================

$("movementForm")?.addEventListener("submit", async event => {
  event.preventDefault();

  hideMessage("formMessage");
  setButtonLoading("saveMovementBtn", true, "Guardando...");

  let uploadedPath = null;

  try {
    const tipo = $("movementType").value;
    const fecha = $("movementDate").value;
    const valor = Number($("amount").value);
    const categoria = $("category").value;
    const descripcion = $("description").value.trim();
    const file = $("receipt").files?.[0];

    if (!tipo || !fecha || !Number.isFinite(valor) || valor <= 0) {
      throw new Error("Completa el tipo, fecha y valor.");
    }

    if (tipo === "gasto" && !file) {
      throw new Error("Selecciona el comprobante del gasto.");
    }

    let recipient = currentUser;
    let recipientProfile = currentProfile;

    if (isAdmin() && tipo === "viatico") {
      const email = $("targetEmployee")?.value.trim();

      if (email) {
        const employee = await findEmployeeByEmail(email);

        if (!employee) {
          throw new Error("No se encontró ese empleado.");
        }

        recipient = employee.user;
        recipientProfile = employee.profile;
      }
    }

    if (file) {
      uploadedPath = await uploadReceipt(file, recipient.uid);
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
      comprobante: uploadedPath,
      nombreArchivo: file?.name || null,
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

    // Evita dejar archivos huérfanos si falla el registro en Firestore.
    if (uploadedPath) {
      await supabase.storage
        .from(RECEIPT_BUCKET)
        .remove([uploadedPath])
        .catch(console.error);
    }

    message("formMessage", error.message || "No se pudo guardar.", true);
  } finally {
    setButtonLoading("saveMovementBtn", false);
  }
});

// ==================================================
// 9. CARGAR MOVIMIENTOS
// ==================================================

async function loadMovements() {
  if (!currentUser) return;

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

  movements = snapshot.docs.map(item => ({
    id: item.id,
    ...item.data()
  }));

  movements.sort((a, b) =>
    String(b.fecha || "").localeCompare(String(a.fecha || ""))
  );

  await renderMovements();
  updateTotals();
  renderAccountingSummary();
}

// ==================================================
// 10. URL SEGURA DE COMPROBANTES
// ==================================================

async function getReceiptUrl(path) {
  if (!path) return null;

  const { data, error } = await supabase.storage
    .from(RECEIPT_BUCKET)
    .createSignedUrl(path, 3600);

  if (error) {
    console.error("Error al obtener comprobante:", error);
    return null;
  }

  return data?.signedUrl || null;
}

// ==================================================
// 11. HISTORIAL Y GALERÍA
// ==================================================

async function renderMovements() {
  const container = $("movementsList");
  const gallery = $("receiptsGallery");

  if (!container) return;

  if (!movements.length) {
    container.innerHTML =
      '<p class="empty-state">No hay movimientos registrados.</p>';

    if (gallery) {
      gallery.innerHTML =
        '<p class="empty-state">Todavía no hay comprobantes.</p>';
    }

    return;
  }

  const galleryItems = [];

  const cards = await Promise.all(movements.map(async item => {
    let receiptUrl = null;

    if (item.comprobante) {
      receiptUrl = await getReceiptUrl(item.comprobante);

      if (receiptUrl) {
        galleryItems.push({
          item,
          url: receiptUrl
        });
      }
    }

    const canDelete =
      isAdmin() || item.uid === currentUser.uid;

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

        ${isAdmin() && item.tipo === "gasto" &&
          item.estadoContable !== "contabilizado" ? `
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

  if (gallery) {
    gallery.innerHTML = galleryItems.length
      ? galleryItems.map(({ item, url }) => `
          <article class="movement-card">
            <strong>${safeText(item.nombreEmpleado || item.emailEmpleado)}</strong>
            <p>${safeText(item.nombreArchivo || "Comprobante")}</p>
            <p>${safeText(item.fecha || "")}</p>
            <a href="${url}" target="_blank" rel="noopener">
              ABRIR DOCUMENTO →
            </a>
          </article>
        `).join("")
      : '<p class="empty-state">No hay comprobantes disponibles.</p>';
  }

  container.querySelectorAll("[data-delete]").forEach(button => {
    button.addEventListener("click", () =>
      deleteMovement(button.dataset.delete)
    );
  });

  container.querySelectorAll("[data-account]").forEach(button => {
    button.addEventListener("click", () =>
      accountMovement(button.dataset.account)
    );
  });
}

// ==================================================
// 12. CONTABILIZACIÓN
// ==================================================

async function accountMovement(id) {
  if (!isAdmin()) {
    alert("Solo el administrador puede contabilizar movimientos.");
    return;
  }

  const item = movements.find(movement => movement.id === id);
  if (!item) return;

  const fecha = prompt("Fecha de la factura:", item.fecha || "");
  if (fecha === null) return;

  const proveedor = prompt("Nombre del proveedor:", "");
  if (proveedor === null) return;

  const nit = prompt("NIT del proveedor:", "");
  if (nit === null) return;

  const categoria = prompt("Categoría:", item.categoria || "Otros");
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

    alert("Comprobante contabilizado correctamente.");

    await loadMovements();

  } catch (error) {
    console.error(error);
    alert("Error al contabilizar: " + error.message);
  }
}

function renderAccountingSummary() {
  const summary = $("accountingSummary");
  const details = $("accountingDetails");

  if (!summary || !details) return;

  const pending = movements.filter(item =>
    item.tipo === "gasto" && item.estadoContable !== "contabilizado"
  );

  const completed = movements.filter(item =>
    item.tipo === "gasto" && item.estadoContable === "contabilizado"
  );

  details.innerHTML = `
    <p>Comprobantes pendientes: <strong>${pending.length}</strong></p>
    <p>Comprobantes contabilizados: <strong>${completed.length}</strong></p>
    <p>Total pendiente: <strong>${money(
      pending.reduce((sum, item) => sum + Number(item.valor || 0), 0)
    )}</strong></p>
    <p>Total contabilizado: <strong>${money(
      completed.reduce((sum, item) => sum + Number(item.valor || 0), 0)
    )}</strong></p>
  `;

  summary.classList.remove("hidden");
}

$("accountingBtn")?.addEventListener("click", () => {
  if (!isAdmin()) {
    message("accountingMessage", "Esta función es exclusiva del administrador.", true);
    return;
  }

  renderAccountingSummary();
  $("accountingSummary")?.scrollIntoView({ behavior: "smooth" });
});

// ==================================================
// 13. ELIMINAR MOVIMIENTO Y ARCHIVO
// ==================================================

async function deleteMovement(id) {
  const item = movements.find(movement => movement.id === id);
  if (!item) return;

  if (!isAdmin() && item.uid !== currentUser.uid) {
    alert("No tienes permiso para eliminar este documento.");
    return;
  }

  if (!confirm("¿Eliminar este movimiento y su comprobante?")) return;

  try {
    if (item.comprobante) {
      const { error } = await supabase.storage
        .from(RECEIPT_BUCKET)
        .remove([item.comprobante]);

      if (error) throw error;
    }

    await deleteDoc(doc(db, "movimientos", id));

    alert("Movimiento eliminado correctamente.");

    await loadMovements();

  } catch (error) {
    console.error(error);
    alert("No se pudo eliminar: " + error.message);
  }
}

// ==================================================
// 14. TOTALES
// ==================================================

function updateTotals() {
  const advances = movements
    .filter(item => item.tipo === "viatico")
    .reduce((sum, item) => sum + Number(item.valor || 0), 0);

  const expenses = movements
    .filter(item => item.tipo === "gasto")
    .reduce((sum, item) => sum + Number(item.valor || 0), 0);

  $("totalAdvances").textContent = money(advances);
  $("totalExpenses").textContent = money(expenses);
  $("balance").textContent = money(advances - expenses);
}

// ==================================================
// 15. CONSULTAS ADMINISTRATIVAS
// ==================================================

$("allMovementsBtn")?.addEventListener("click", async () => {
  if (!isAdmin()) return;

  try {
    showingAll = true;
    await loadMovements();
  } catch (error) {
    console.error(error);
    alert("No se pudieron consultar los movimientos: " + error.message);
  }
});

$("filterEmployeeBtn")?.addEventListener("click", async () => {
  if (!isAdmin()) return;

  const email = $("employeeFilter")?.value.trim();

  if (!email) {
    showingAll = true;
    await loadMovements();
    return;
  }

  try {
    const employee = await findEmployeeByEmail(email);

    if (!employee) {
      alert("No se encontró ese empleado.");
      return;
    }

    const snapshot = await getDocs(
      query(
        collection(db, "movimientos"),
        where("uid", "==", employee.user.uid)
      )
    );

    movements = snapshot.docs.map(item => ({
      id: item.id,
      ...item.data()
    }));

    movements.sort((a, b) =>
      String(b.fecha || "").localeCompare(String(a.fecha || ""))
    );

    await renderMovements();
    updateTotals();
    renderAccountingSummary();

  } catch (error) {
    console.error(error);
    alert("Error al consultar empleado: " + error.message);
  }
});

// ==================================================
// 16. EXPORTAR CSV
// ==================================================

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

  const rows = movements.map(item => [
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
    .map(row =>
      row.map(value =>
        `"${String(value ?? "").replace(/"/g, '""')}"`
      ).join(";")
    ).join("\n");

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

// ==================================================
// 17. ACTUALIZAR Y CONEXIÓN
// ==================================================

$("refreshBtn")?.addEventListener("click", async () => {
  try {
    await loadMovements();
    message("formMessage", "Información actualizada.");
  } catch (error) {
    console.error(error);
    message("formMessage", "Error al actualizar: " + error.message, true);
  }
});

function updateConnection() {
  const status = $("connectionStatus");
  if (!status) return;

  status.textContent = navigator.onLine ? "Conectado" : "Sin conexión";
  status.classList.toggle("offline", !navigator.onLine);
}

window.addEventListener("online", updateConnection);
window.addEventListener("offline", updateConnection);

// ==================================================
// 18. INICIO DE SESIÓN
// ==================================================

onAuthStateChanged(auth, async user => {
  currentUser = user;

  if (!user) {
    currentProfile = null;
    movements = [];

    $("authPanel")?.classList.remove("hidden");
    $("appPanel")?.classList.add("hidden");
    $("logoutBtn")?.classList.add("hidden");

    hideSplash();
    return;
  }

  try {
    await loadProfile(user);
    await loadApp();
  } catch (error) {
    console.error("Error de inicialización:", error);

    message("authMessage", error.message || "Error al cargar la aplicación.", true);

    $("authPanel")?.classList.remove("hidden");
    $("appPanel")?.classList.add("hidden");

    hideSplash();
  }
});