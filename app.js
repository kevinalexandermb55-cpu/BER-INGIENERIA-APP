


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

// CONEXIONES
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

// VARIABLES
let currentUser = null;
let currentProfile = null;
let activities = [];
let showingAll = false;
let loadingUid = null;

const $ = id => document.getElementById(id);

const isAdmin = () => currentProfile?.rol === "admin";

function notify(id, text, error = false) {
  const el = $(id);
  if (!el) return;
  el.textContent = text;
  el.classList.remove("hidden", "error", "success");
  el.classList.add(error ? "error" : "success");
}

function connection(text, error = false) {
  const el = $("connectionStatus");
  if (!el) return;
  el.textContent = text;
  el.classList.toggle("online", !error);
}

function safe(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;",
    '"': "&quot;", "'": "&#039;"
  })[c]);
}

// AUTENTICACIÓN
$("loginForm")?.addEventListener("submit", async event => {
  event.preventDefault();

  try {
    notify("authMessage", "Verificando acceso...");
    await signInWithEmailAndPassword(
      auth,
      $("email").value.trim(),
      $("password").value
    );
  } catch (error) {
    notify("authMessage", "No se pudo ingresar: " + error.message, true);
  }
});

$("showSignup")?.addEventListener("click", async () => {
  const email = $("email").value.trim();
  const password = $("password").value;

  if (!email || password.length < 6) {
    notify("authMessage", "Escribe un correo y una contraseña de mínimo 6 caracteres.", true);
    return;
  }

  try {
    notify("authMessage", "Creando cuenta...");
    await createUserWithEmailAndPassword(auth, email, password);
  } catch (error) {
    notify("authMessage", "No se pudo crear la cuenta: " + error.message, true);
  }
});

$("logoutBtn")?.addEventListener("click", () => signOut(auth));

// PERFIL
async function loadProfile(user) {
  const ref = doc(db, "usuarios", user.uid);
  const snap = await getDoc(ref);

  if (!snap.exists()) {
    const profile = {
      nombre: user.displayName || user.email,
      email: user.email,
      rol: "empleado",
      activo: true
    };

    await setDoc(ref, profile);
    currentProfile = profile;
  } else {
    currentProfile = snap.data();
  }

  if (currentProfile.activo === false) {
    await signOut(auth);
    throw new Error("Cuenta desactivada.");
  }

  $("signedUser").textContent =
    currentProfile.nombre || user.email;

  $("roleLabel").textContent =
    isAdmin() ? "ADMINISTRADOR" : "EMPLEADO";

  $("avatar").textContent =
    (currentProfile.nombre || user.email).charAt(0).toUpperCase();

  $("welcomeTitle").textContent =
    isAdmin() ? "Panel de actividades" : "Mis actividades";

  $("welcomeSubtitle").textContent =
    isAdmin()
      ? "Consulta y administra los registros de la empresa."
      : "Registra y consulta tus actividades.";

  $("adminTools").classList.toggle("hidden", !isAdmin());
  $("targetEmployeeWrap").classList.toggle("hidden", !isAdmin());

  showingAll = isAdmin();
}

// BUSCAR EMPLEADO
async function findEmployeeByEmail(email) {
  const snapshot = await getDocs(collection(db, "usuarios"));
  const normalized = email.toLowerCase();

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

// REGISTRAR ACTIVIDAD
$("activityForm")?.addEventListener("submit", async event => {
  event.preventDefault();

  const button = $("saveActivityBtn");
  button.disabled = true;

  const uploaded = [];

  try {
    if (!currentUser || !currentProfile) {
      throw new Error("No hay una sesión activa.");
    }

    const fecha = $("activityDate").value;
    const titulo = $("activityTitle").value.trim();
    const descripcion = $("activityDescription").value.trim();
    const files = Array.from($("evidence").files || []);

    if (!fecha || !titulo || !descripcion) {
      throw new Error("Completa todos los campos obligatorios.");
    }

    if (files.length > 5) {
      throw new Error("Solo puedes adjuntar hasta 5 archivos.");
    }

    let recipient = {
      uid: currentUser.uid,
      email: currentUser.email,
      profile: currentProfile
    };

    if (isAdmin() && $("targetEmployee").value.trim()) {
      const employee = await findEmployeeByEmail(
        $("targetEmployee").value.trim()
      );

      if (!employee) throw new Error("No se encontró el empleado.");

      recipient = employee;

      if (recipient.profile.activo === false) {
        throw new Error("El empleado está desactivado.");
      }
    }

    // Subir evidencias
    for (const file of files) {
      const allowed = [
        "image/jpeg",
        "image/png",
        "image/webp",
        "application/pdf"
      ];

      if (!allowed.includes(file.type)) {
        throw new Error("Solo se permiten imágenes JPG, PNG, WEBP y PDF.");
      }

      if (file.size > 10 * 1024 * 1024) {
        throw new Error("Cada archivo debe pesar máximo 10 MB.");
      }

      const extension = file.name.split(".").pop().toLowerCase();
      const path = `${recipient.uid}/${crypto.randomUUID()}.${extension}`;

      const { error } = await supabase.storage
        .from(RECEIPT_BUCKET)
        .upload(path, file, {
          contentType: file.type,
          upsert: false
        });

      if (error) throw error;

      uploaded.push({
        path,
        name: file.name,
        type: file.type
      });
    }

    await addDoc(collection(db, "actividades"), {
      uid: recipient.uid,
      emailEmpleado: recipient.email,
      nombreEmpleado: recipient.profile.nombre || recipient.email,
      fecha,
      titulo,
      descripcion,
      evidencias: uploaded,
      creadoPor: currentUser.uid,
      creadoEn: serverTimestamp()
    });

    $("activityForm").reset();
    notify("formMessage", "Actividad registrada correctamente.");

    showingAll = isAdmin();
    await loadActivities();

  } catch (error) {
    console.error(error);

    for (const file of uploaded) {
      await supabase.storage
        .from(RECEIPT_BUCKET)
        .remove([file.path])
        .catch(console.error);
    }

    notify("formMessage", error.message, true);

  } finally {
    button.disabled = false;
  }
});

// CONSULTAR ACTIVIDADES
async function loadActivities() {
  if (!currentUser) return;

  let ref;

  if (isAdmin() && showingAll) {
    ref = collection(db, "actividades");
  } else {
    ref = query(
      collection(db, "actividades"),
      where("uid", "==", currentUser.uid)
    );
  }

  const snapshot = await getDocs(ref);

  activities = snapshot.docs.map(item => ({
    id: item.id,
    ...item.data()
  }));

  activities.sort((a, b) =>
    String(b.fecha || "").localeCompare(String(a.fecha || ""))
  );

  await renderActivities();
  updateSummary();
}

// ENLACES SEGUROS A EVIDENCIAS
async function signedUrl(path) {
  const { data, error } = await supabase.storage
    .from(RECEIPT_BUCKET)
    .createSignedUrl(path, 3600);

  if (error) throw error;
  return data.signedUrl;
}

// MOSTRAR HISTORIAL
async function renderActivities() {
  const container = $("movementsList");
  const gallery = $("receiptsGallery");

  if (!activities.length) {
    container.innerHTML =
      '<div class="empty-state"><strong>Sin actividades registradas</strong><p>Cuando registres actividades aparecerán aquí.</p></div>';

    gallery.innerHTML =
      '<div class="empty-state"><strong>Sin evidencias</strong><p>No hay archivos adjuntos.</p></div>';
    return;
  }

  const cards = [];
  const evidenceCards = [];

  for (const item of activities) {
    const canDelete =
      isAdmin() || item.uid === currentUser.uid;

    let links = "";

    for (const file of (item.evidencias || [])) {
      try {
        const url = await signedUrl(file.path);

        links += `
          <a class="receipt-link"
             href="${safe(url)}"
             target="_blank"
             rel="noopener noreferrer">
            VER ${safe(file.name)}
          </a>
        `;

        evidenceCards.push(`
          <article class="receipt-item">
            <strong>${safe(item.nombreEmpleado)}</strong>
            <p>${safe(item.titulo)}</p>
            <a class="receipt-link"
               href="${safe(url)}"
               target="_blank"
               rel="noopener noreferrer">
              ABRIR EVIDENCIA
            </a>
          </article>
        `);
      } catch (error) {
        console.error("Evidencia:", error);
      }
    }

    cards.push(`
      <article class="movement-item activity-card">
        <div class="movement-icon">✓</div>
        <div class="movement-info">
          <strong>${safe(item.titulo)}</strong>
          <small>
            ${safe(item.nombreEmpleado)} · ${safe(item.fecha)}
          </small>
          <p>${safe(item.descripcion)}</p>
          ${links}
          <div class="movement-actions">
            ${canDelete ? `
              <button class="tiny-btn"
                type="button"
                data-delete="${safe(item.id)}">
                Eliminar
              </button>
            ` : ""}
          </div>
        </div>
      </article>
    `);
  }

  container.innerHTML = cards.join("");

  gallery.innerHTML = evidenceCards.length
    ? evidenceCards.join("")
    : '<div class="empty-state"><strong>Sin evidencias</strong><p>No hay archivos adjuntos.</p></div>';

  container.querySelectorAll("[data-delete]").forEach(button => {
    button.addEventListener("click", () =>
      deleteActivity(button.dataset.delete)
    );
  });
}

// ELIMINAR ACTIVIDAD
async function deleteActivity(id) {
  const item = activities.find(activity => activity.id === id);
  if (!item) return;

  if (!isAdmin() && item.uid !== currentUser.uid) {
    alert("No tienes permiso para eliminar este registro.");
    return;
  }

  if (!confirm("¿Deseas eliminar esta actividad y sus evidencias?")) {
    return;
  }

  try {
    for (const file of (item.evidencias || [])) {
      const { error } = await supabase.storage
        .from(RECEIPT_BUCKET)
        .remove([file.path]);

      if (error) throw error;
    }

    await deleteDoc(doc(db, "actividades", id));

    await loadActivities();
    alert("Actividad eliminada correctamente.");

  } catch (error) {
    console.error(error);
    alert("No se pudo eliminar: " + error.message);
  }
}

// RESUMEN
function updateSummary() {
  const today = new Date().toLocaleDateString("en-CA");

  $("totalActivities").textContent = activities.length;

  $("todayActivities").textContent =
    activities.filter(item => item.fecha === today).length;

  $("totalEvidence").textContent =
    activities.reduce(
      (sum, item) => sum + (item.evidencias || []).length,
      0
    );
}

// FILTRO ADMINISTRATIVO
$("allMovementsBtn")?.addEventListener("click", async () => {
  if (!isAdmin()) return;

  showingAll = true;
  await loadActivities();
});

$("filterEmployeeBtn")?.addEventListener("click", async () => {
  if (!isAdmin()) return;

  const email = $("employeeFilter").value.trim();

  try {
    if (!email) {
      showingAll = true;
      await loadActivities();
      return;
    }

    const employee = await findEmployeeByEmail(email);

    if (!employee) {
      alert("No se encontró el empleado.");
      return;
    }

    const snapshot = await getDocs(
      query(
        collection(db, "actividades"),
        where("uid", "==", employee.uid)
      )
    );

    activities = snapshot.docs.map(item => ({
      id: item.id,
      ...item.data()
    }));

    activities.sort((a, b) =>
      String(b.fecha || "").localeCompare(String(a.fecha || ""))
    );

    await renderActivities();
    updateSummary();

  } catch (error) {
    console.error(error);
    alert("No se pudo consultar: " + error.message);
  }
});

// EXPORTAR CSV
$("exportBtn")?.addEventListener("click", () => {
  if (!isAdmin()) return;

  const headers = [
    "Empleado",
    "Correo",
    "Fecha",
    "Actividad",
    "Descripción",
    "Número de evidencias"
  ];

  const rows = activities.map(item => [
    item.nombreEmpleado,
    item.emailEmpleado,
    item.fecha,
    item.titulo,
    item.descripcion,
    (item.evidencias || []).length
  ]);

  const csv = [headers, ...rows]
    .map(row => row.map(value =>
      `"${String(value ?? "").replace(/"/g, '""')}"`
    ).join(";"))
    .join("\n");

  const blob = new Blob(["\uFEFF" + csv], {
    type: "text/csv;charset=utf-8"
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = "reporte_actividades_BER.csv";
  link.click();

  URL.revokeObjectURL(url);
});

// ACTUALIZAR
$("refreshBtn")?.addEventListener("click", async () => {
  try {
    await loadActivities();
    connection("Conectado");
  } catch (error) {
    console.error(error);
    connection("Error de conexión", true);
  }
});

// CONEXIÓN
window.addEventListener("online", () =>
  connection("Internet disponible")
);

window.addEventListener("offline", () =>
  connection("Sin conexión", true)
);

// INICIO AUTOMÁTICO
onAuthStateChanged(auth, async user => {
  currentUser = user;

  if (!user) {
    currentProfile = null;
    activities = [];
    showingAll = false;
    loadingUid = null;

    $("authPanel").classList.remove("hidden");
    $("appPanel").classList.add("hidden");
    $("logoutBtn").classList.add("hidden");

    connection("Sesión cerrada");
    return;
  }

  if (loadingUid === user.uid) return;
  loadingUid = user.uid;

  $("logoutBtn").classList.remove("hidden");
  connection("Conectando...");

  try {
    await loadProfile(user);

    $("authPanel").classList.add("hidden");
    $("appPanel").classList.remove("hidden");

    await loadActivities();

    connection("Conectado");
    $("splash").classList.add("hidden");

  } catch (error) {
    console.error(error);
    notify("authMessage", error.message, true);

    $("authPanel").classList.remove("hidden");
    $("appPanel").classList.add("hidden");

    loadingUid = null;
    connection("Error de acceso", true);
  }
});
