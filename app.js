import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';
import { getFirestore, doc, getDoc, setDoc, updateDoc, addDoc, collection, query, where, getDocs, deleteDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js';
import { getStorage, ref, uploadBytes, getBlob, deleteObject } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-storage.js';
import firebaseConfig from './firebase-config.js';

const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);
const storage = getStorage(firebaseApp);
const $ = id => document.getElementById(id);
const localDateInputValue = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
let currentUser = null;
let currentProfile = null;
let activities = [];
let users = [];
let accountingEntries = [];
let selectedRole = 'ingeniero';
let creatingAccount = false;
let showingAll = false;
let activeFilters = { employee: '', from: '', to: '' };
let editingAccountingId = null;

// Accept the administrator label used by the earlier app as well as the current role value.
const roleIsAdmin = profile => ['admin', 'administrador'].includes(String(profile?.rol || '').trim().toLowerCase());
const isAdmin = () => roleIsAdmin(currentProfile);
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);
const friendlyError = error => ({
  'auth/invalid-credential':'El correo o la contraseña no coinciden. Verifica los datos e inténtalo de nuevo.',
  'auth/invalid-email':'Escribe un correo electrónico válido.',
  'auth/user-disabled':'Esta cuenta de Firebase está deshabilitada. Contacta al administrador.',
  'auth/too-many-requests':'Hubo varios intentos seguidos. Espera un momento y vuelve a intentarlo.',
  'auth/network-request-failed':'No fue posible conectar. Revisa tu conexión a internet.',
  'auth/email-already-in-use':'Ya existe una cuenta con ese correo. Ingresa con tu contraseña actual.',
  'auth/weak-password':'La contraseña debe tener al menos 6 caracteres.',
  'auth/operation-not-allowed':'El acceso por correo y contraseña no está habilitado en Firebase Authentication.',
  'auth/unauthorized-domain':'Firebase no autoriza el dominio de esta página. Revisa los dominios autorizados del proyecto.',
  'permission-denied':'Firebase rechazó esta operación. Revisa las reglas de Firestore y el estado de tu cuenta.',
  'storage/unauthorized':'Firebase Storage no autorizó los archivos. Revisa las reglas y la configuración de Storage.',
  'storage/bucket-not-found':'El almacenamiento de Firebase aún no está habilitado para este proyecto.'
}[error?.code] || 'No fue posible completar la operación. Revisa Firebase y vuelve a intentarlo.');

function showMessage(id, message, error = false) {
  const el = $(id);
  if (!el) return;
  el.textContent = message;
  el.classList.remove('hidden', 'error');
  if (error) el.classList.add('error');
}
function clearMessage(id) { $(id)?.classList.add('hidden'); }
function setConnection(message, online = false) {
  const el = $('connectionStatus');
  el.querySelector('span').textContent = message;
  el.classList.toggle('online', online);
}
function formatDate(date) {
  if (!date) return '—';
  const parsed = new Date(`${date}T12:00:00`);
  return Number.isNaN(parsed.valueOf()) ? escapeHtml(date) : new Intl.DateTimeFormat('es-CO', { day:'2-digit', month:'short', year:'numeric' }).format(parsed);
}
function displayProfileName(profile, email = '') { return profile?.nombre || email || 'Ingeniero'; }

// Keep the splash visible for precisely 2,000 ms from page initialization.
document.addEventListener('DOMContentLoaded', () => {
  $('footerYear').textContent = new Date().getFullYear();
  $('activityDate').value = localDateInputValue();
});

document.querySelectorAll('[data-role]').forEach(button => button.addEventListener('click', () => {
  selectedRole = button.dataset.role;
  document.querySelectorAll('[data-role]').forEach(option => {
    const chosen = option === button;
    option.classList.toggle('selected', chosen);
    option.setAttribute('aria-pressed', String(chosen));
  });
  if (creatingAccount && selectedRole === 'admin') {
    selectedRole = 'ingeniero';
    document.querySelector('[data-role="admin"]').classList.remove('selected');
    document.querySelector('[data-role="admin"]').setAttribute('aria-pressed', 'false');
    document.querySelector('[data-role="ingeniero"]').classList.add('selected');
    document.querySelector('[data-role="ingeniero"]').setAttribute('aria-pressed', 'true');
    showMessage('authMessage', 'Las cuentas nuevas se crean como ingeniero. El acceso de administrador solo puede asignarlo un administrador autorizado.', true);
    return;
  }
  clearMessage('authMessage');
}));

$('toggleSignup').addEventListener('click', () => {
  creatingAccount = !creatingAccount;
  $('authTitle').textContent = creatingAccount ? 'Crear cuenta' : 'Bienvenido';
  $('authSubtitle').textContent = creatingAccount ? 'Registra una cuenta de ingeniero con tu correo corporativo.' : 'Elige tu espacio e ingresa con tu cuenta corporativa.';
  $('submitAuthText').textContent = creatingAccount ? 'Crear cuenta' : 'Ingresar';
  $('toggleSignup').innerHTML = creatingAccount ? '¿Ya tienes cuenta? <b>Ingresar</b>' : '¿Nuevo en BER? <b>Crear cuenta de ingeniero</b>';
  if (creatingAccount && selectedRole === 'admin') document.querySelector('[data-role="ingeniero"]').click();
  clearMessage('authMessage');
});

$('loginForm').addEventListener('submit', async event => {
  event.preventDefault();
  const email = $('email').value.trim().toLowerCase();
  const password = $('password').value;
  const submit = $('submitAuth');
  submit.disabled = true;
  clearMessage('authMessage');
  $('submitAuthText').textContent = creatingAccount ? 'Creando cuenta…' : 'Verificando…';
  try {
    if (!email || !password) throw { code:'auth/invalid-email' };
    if (creatingAccount) {
      if (selectedRole !== 'ingeniero') throw new Error('El registro solo está disponible para ingenieros.');
      await createUserWithEmailAndPassword(auth, email, password);
    } else {
      await signInWithEmailAndPassword(auth, email, password);
    }
  } catch (error) {
    showMessage('authMessage', error.code ? friendlyError(error) : error.message, true);
  } finally {
    submit.disabled = false;
    $('submitAuthText').textContent = creatingAccount ? 'Crear cuenta' : 'Ingresar';
  }
});

$('logoutBtn').addEventListener('click', () => signOut(auth));

async function ensureProfile(user) {
  const profileRef = doc(db, 'Usuarios', user.uid);
  const primarySnapshot = await getDoc(profileRef);
  if (primarySnapshot.exists()) return primarySnapshot.data();

  // Support profiles created by the earlier lowercase version.
  const legacySnapshot = await getDoc(doc(db, 'usuarios', user.uid));
  if (legacySnapshot.exists()) return legacySnapshot.data();

  // A user can provision only their own non-admin profile; Firestore Rules enforce this.
  const profile = { uid:user.uid, email:user.email || '', nombre:user.displayName || (user.email || '').split('@')[0], rol:'ingeniero', activo:true, creadoEn:serverTimestamp() };
  await setDoc(profileRef, profile);
  return { ...profile, creadoEn:undefined };
}

function showLogin(message = '') {
  $('authPanel').classList.remove('hidden');
  $('appPanel').classList.add('hidden');
  $('logoutBtn').classList.add('hidden');
  if (message) showMessage('authMessage', message, true);
}

onAuthStateChanged(auth, async user => {
  currentUser = user;
  if (!user) {
    currentProfile = null;
    activities = [];
    users = [];
    showingAll = false;
    $('authPanel').classList.remove('hidden');
    $('appPanel').classList.add('hidden');
    $('logoutBtn').classList.add('hidden');
    setConnection('Sesión cerrada');
    return;
  }
  setConnection('Verificando acceso…');
  $('logoutBtn').classList.remove('hidden');
  let loadingStage = 'profile';
  let signedInAsAdmin = false;
  try {
    const profile = await ensureProfile(user);
    if (profile.activo === false) {
      await signOut(auth);
      showLogin('Esta cuenta está pausada. Contacta al administrador de BER.');
      return;
    }
    const admin = roleIsAdmin(profile);
    signedInAsAdmin = admin;
    if ((selectedRole === 'admin') !== admin) {
      await signOut(auth);
      showLogin(admin ? 'Esta cuenta tiene acceso de administrador. Selecciona el panel Administrador e inténtalo de nuevo.' : 'Esta cuenta no tiene el rol de administrador. Selecciona el panel Ingeniero.');
      return;
    }
    currentProfile = profile;
    $('authPanel').classList.add('hidden');
    $('appPanel').classList.remove('hidden');
    $('signedUser').textContent = displayProfileName(profile, user.email);
    $('avatar').textContent = displayProfileName(profile, user.email).trim().charAt(0).toUpperCase() || 'B';
    $('roleLabel').textContent = admin ? 'Administrador' : 'Ingeniero';
    $('panelEyebrow').textContent = admin ? 'PANEL DE ADMINISTRACIÓN' : 'ESPACIO DEL INGENIERO';
    $('welcomeTitle').textContent = admin ? 'Actividad de la empresa' : 'Mis actividades';
    $('welcomeSubtitle').textContent = admin ? 'Consulta los registros y administra los accesos del equipo.' : 'Registra tus actividades y consulta tu historial.';
    $('adminTools').classList.toggle('hidden', !admin);
    $('accountingPanel').classList.toggle('hidden', !admin);
    $('usersPanel').classList.toggle('hidden', !admin);
    $('targetEmployeeWrap').classList.toggle('hidden', !admin);
    showingAll = admin;
    loadingStage = 'activities';
    await loadActivities();
    if (admin) {
      loadingStage = 'users';
      await loadUsers();
      loadingStage = 'accounting';
      await loadAccountingEntries();
      renderAccountingQueue();
    }
    setConnection('Conectado', true);
  } catch (error) {
    console.error('No se pudo preparar la sesión BER:', error);
    const permissionMessages = {
      profile:'Firebase aceptó tus credenciales, pero Firestore no permitió leer o crear tu perfil. Verifica la colección Usuarios/usuarios, el UID del documento y las reglas.',
      activities:signedInAsAdmin
        ? 'Firestore bloqueó la carga de actividades del equipo. Verifica que el perfil tenga rol admin y activo true, y que config/berSecurity contenga exactamente los dos UID administradores.'
        : 'Firestore bloqueó la lectura de tus actividades. Verifica que tu perfil esté activo y que las reglas permitan consultar solo tu UID.',
      users:'Firestore bloqueó la lista de usuarios. Verifica que tu UID esté autorizado en config/berSecurity y que las reglas estén publicadas.',
      accounting:'Firestore bloqueó los comprobantes contables. Verifica la autorización de administrador y las reglas de la colección asientos.'
    };
    const message = error.code === 'permission-denied'
      ? permissionMessages[loadingStage]
      : friendlyError(error);
    await signOut(auth).catch(() => {});
    showLogin(message);
    setConnection('Error de acceso');
  }
});

function filteredActivities() {
  const needle = activeFilters.employee.toLowerCase();
  return activities.filter(item => {
    const employee = `${item.nombreEmpleado || ''} ${item.emailEmpleado || ''}`.toLowerCase();
    return (!needle || employee.includes(needle)) && (!activeFilters.from || item.fecha >= activeFilters.from) && (!activeFilters.to || item.fecha <= activeFilters.to);
  });
}

async function loadActivities() {
  if (!currentUser) return;
  const activityRef = collection(db, 'actividades');
  const snapshot = isAdmin() && showingAll
    ? await getDocs(activityRef)
    : await getDocs(query(activityRef, where('uid', '==', currentUser.uid)));
  activities = snapshot.docs.map(item => ({ id:item.id, ...item.data() }));
  activities.sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')) || (b.creadoEn?.seconds || 0) - (a.creadoEn?.seconds || 0));
  await renderActivities();
  updateSummary();
  if (isAdmin()) renderAccountingQueue();
}

function updateSummary() {
  const shown = filteredActivities();
  const today = localDateInputValue();
  $('totalActivities').textContent = shown.length;
  $('todayActivities').textContent = shown.filter(item => item.fecha === today).length;
  $('totalEvidence').textContent = shown.reduce((sum, item) => sum + (item.evidencias || []).length, 0);
}

async function openEvidence(path, name) {
  const newTab = window.open('about:blank', '_blank');
  if (newTab) newTab.opener = null;
  try {
    const fileBlob = await getBlob(ref(storage, path));
    const objectUrl = URL.createObjectURL(fileBlob);
    if (newTab) newTab.location.replace(objectUrl);
    else {
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = name || 'evidencia';
      link.click();
    }
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  } catch (error) {
    newTab?.close();
    alert(friendlyError(error));
  }
}

async function renderActivities() {
  const list = $('movementsList');
  const gallery = $('receiptsGallery');
  const shown = filteredActivities();
  if (!shown.length) {
    list.innerHTML = '<div class="empty-state"><b>Sin actividades para mostrar</b>Los registros aparecerán aquí cuando estén disponibles.</div>';
    gallery.innerHTML = '<div class="empty-state"><b>Sin evidencias</b>Los archivos adjuntos aparecerán aquí.</div>';
    return;
  }
  const evidenceCards = [];
  list.innerHTML = shown.map(item => {
    const parts = (item.fecha || '').split('-');
    const dateHtml = parts.length === 3 ? `<span>${escapeHtml(parts[1])}/${escapeHtml(parts[0])}</span><b>${escapeHtml(parts[2])}</b>` : `<span>${escapeHtml(item.fecha || '—')}</span>`;
    const meta = [item.nombreEmpleado, item.emailEmpleado, item.ubicacion, formatDate(item.fecha)].filter(Boolean).map(escapeHtml).join(' · ');
    const fileButtons = (item.evidencias || []).map((file, index) => {
      evidenceCards.push(`<article class="evidence-item"><span><strong>${escapeHtml(file.nombre || file.name || 'Evidencia')}</strong><small>${escapeHtml(item.titulo)} · ${escapeHtml(item.nombreEmpleado || '')}</small></span><button class="text-link" type="button" data-open-file="${escapeHtml(item.id)}:${index}">ABRIR ↗</button></article>`);
      return `<button class="activity-action" type="button" data-open-file="${escapeHtml(item.id)}:${index}">Ver evidencia · ${escapeHtml(file.nombre || file.name || `Archivo ${index + 1}`)}</button>`;
    }).join('');
    return `<article class="activity-row"><div class="activity-date">${dateHtml}</div><div class="activity-content"><h3>${escapeHtml(item.titulo)}</h3><div class="activity-meta">${meta}</div><p>${escapeHtml(item.descripcion)}</p>${item.ubicacion ? `<div class="activity-meta">Proyecto / ubicación: ${escapeHtml(item.ubicacion)}</div>` : ''}${fileButtons ? `<div class="activity-links">${fileButtons}</div>` : ''}</div><div class="activity-actions">${isAdmin() ? `<button class="activity-action danger" type="button" data-delete="${escapeHtml(item.id)}">Eliminar</button>` : ''}</div></article>`;
  }).join('');
  gallery.innerHTML = evidenceCards.length ? evidenceCards.slice(0, 6).join('') : '<div class="empty-state"><b>Sin evidencias</b>No hay archivos adjuntos en estos registros.</div>';
  list.querySelectorAll('[data-open-file]').forEach(button => button.addEventListener('click', () => openFileFromButton(button)));
  gallery.querySelectorAll('[data-open-file]').forEach(button => button.addEventListener('click', () => openFileFromButton(button)));
  list.querySelectorAll('[data-delete]').forEach(button => button.addEventListener('click', () => deleteActivity(button.dataset.delete)));
}

function openFileFromButton(button) {
  const [activityId, indexText] = button.dataset.openFile.split(':');
  const activity = activities.find(item => item.id === activityId);
  const file = activity?.evidencias?.[Number(indexText)];
  if (file?.path) openEvidence(file.path, file.nombre || file.name);
}

$('activityForm').addEventListener('submit', async event => {
  event.preventDefault();
  if (!currentUser || !currentProfile) return;
  const button = $('saveActivityBtn');
  const uploaded = [];
  button.disabled = true;
  clearMessage('formMessage');
  try {
    const fecha = $('activityDate').value;
    const titulo = $('activityTitle').value.trim();
    const descripcion = $('activityDescription').value.trim();
    const ubicacion = $('activityLocation').value.trim();
    const files = [...($('evidence').files || [])];
    if (!fecha || !titulo || !descripcion) throw new Error('Completa la fecha, el nombre y la descripción de la actividad.');
    if (files.length > 5) throw new Error('Puedes adjuntar hasta 5 archivos por actividad.');
    let owner = { uid:currentUser.uid, email:currentUser.email || '', profile:currentProfile };
    if (isAdmin() && $('targetEmployee').value.trim()) {
      const targetEmail = $('targetEmployee').value.trim().toLowerCase();
      const target = users.find(item => (item.email || '').toLowerCase() === targetEmail && item.activo !== false);
      if (!target) throw new Error('No se encontró un ingeniero activo con ese correo.');
      owner = { uid:target.uid, email:target.email || '', profile:target };
    }
    for (const file of files) {
      if (!['image/jpeg','image/png','image/webp','application/pdf'].includes(file.type)) throw new Error('Adjunta archivos JPG, PNG, WEBP o PDF.');
      if (file.size > 10 * 1024 * 1024) throw new Error('Cada archivo debe pesar máximo 10 MB.');
      const path = `evidencias/${owner.uid}/${crypto.randomUUID()}-${file.name.replace(/[^\p{L}\p{N}._-]/gu, '_')}`;
      await uploadBytes(ref(storage, path), file, { contentType:file.type, customMetadata:{ subidoPor:currentUser.uid } });
      uploaded.push({ path, nombre:file.name, tipo:file.type, tamano:file.size });
    }
    await addDoc(collection(db, 'actividades'), { uid:owner.uid, emailEmpleado:owner.email, nombreEmpleado:displayProfileName(owner.profile, owner.email), fecha, titulo, ubicacion, descripcion, evidencias:uploaded, creadoPor:currentUser.uid, creadoEn:serverTimestamp() });
    $('activityForm').reset();
    $('activityDate').value = localDateInputValue();
    showMessage('formMessage', 'Actividad guardada correctamente.');
    showingAll = isAdmin();
    await loadActivities();
  } catch (error) {
    await Promise.all(uploaded.map(file => deleteObject(ref(storage, file.path)).catch(() => {})));
    showMessage('formMessage', error.code ? friendlyError(error) : error.message, true);
  } finally { button.disabled = false; }
});

async function deleteActivity(id) {
  const activity = activities.find(item => item.id === id);
  if (!activity || !isAdmin()) return;
  if (!confirm(`¿Eliminar la actividad “${activity.titulo}” y sus archivos adjuntos?`)) return;
  try {
    await Promise.all((activity.evidencias || []).map(file => deleteObject(ref(storage, file.path)).catch(error => { if (error.code !== 'storage/object-not-found') throw error; })));
    await deleteDoc(doc(db, 'actividades', id));
    await loadActivities();
  } catch (error) { alert(friendlyError(error)); }
}

$('filterBtn').addEventListener('click', async () => {
  activeFilters = { employee:$('employeeFilter').value.trim(), from:$('dateFrom').value, to:$('dateTo').value };
  await renderActivities();
  updateSummary();
  if (isAdmin()) renderAccountingQueue();
});
$('clearFilterBtn').addEventListener('click', async () => {
  $('employeeFilter').value = ''; $('dateFrom').value = ''; $('dateTo').value = '';
  activeFilters = { employee:'', from:'', to:'' };
  await renderActivities(); updateSummary();
  if (isAdmin()) renderAccountingQueue();
});
$('refreshBtn').addEventListener('click', async () => { try { await loadActivities(); setConnection('Conectado', true); } catch (error) { setConnection('Error al actualizar'); alert(friendlyError(error)); } });

async function loadUsers() {
  if (!isAdmin()) return;
  const [primary, legacy] = await Promise.all([
    getDocs(collection(db, 'Usuarios')),
    getDocs(collection(db, 'usuarios'))
  ]);
  const byUid = new Map();
  legacy.docs.forEach(item => byUid.set(item.id, { uid:item.id, ...item.data(), _collection:'usuarios' }));
  primary.docs.forEach(item => byUid.set(item.id, { uid:item.id, ...item.data(), _collection:'Usuarios' }));
  users = [...byUid.values()].sort((a, b) => displayProfileName(a).localeCompare(displayProfileName(b), 'es'));
  renderUsers();
}
function renderUsers() {
  const container = $('usersList');
  const team = users.filter(user => user.uid !== currentUser?.uid);
  if (!team.length) { container.innerHTML = '<div class="empty-state"><b>Sin cuentas de equipo</b>Las cuentas de ingeniero aparecerán aquí.</div>'; return; }
  container.innerHTML = team.map(user => `<article class="user-row"><span><b>${escapeHtml(displayProfileName(user, user.email))}</b><small>${escapeHtml(user.email || '')}</small></span><span class="user-role">${roleIsAdmin(user) ? 'Administrador' : 'Ingeniero'}</span>${roleIsAdmin(user) ? '<span class="user-protected">Rol protegido</span>' : `<button class="status-toggle ${user.activo === false ? 'inactive' : ''}" type="button" data-toggle-user="${escapeHtml(user.uid)}" data-next-active="${user.activo === false}">${user.activo === false ? 'Reactivar' : 'Pausar acceso'}</button>`}</article>`).join('');
  container.querySelectorAll('[data-toggle-user]').forEach(button => button.addEventListener('click', async () => {
    const user = users.find(item => item.uid === button.dataset.toggleUser);
    if (!user) return;
    const active = button.dataset.nextActive === 'true';
    if (!confirm(`${active ? 'Reactivar' : 'Pausar'} el acceso de ${displayProfileName(user, user.email)}?`)) return;
    button.disabled = true;
    try { await updateDoc(doc(db, user._collection || 'Usuarios', user.uid), { activo:active, actualizadoEn:serverTimestamp() }); await loadUsers(); }
    catch (error) { alert(friendlyError(error)); button.disabled = false; }
  }));
}
$('refreshUsersBtn').addEventListener('click', () => loadUsers().catch(error => alert(friendlyError(error))));

async function loadAccountingEntries() {
  if (!isAdmin()) return;
  const snapshot = await getDocs(collection(db, 'asientos'));
  accountingEntries = snapshot.docs.map(item => ({ id:item.id, ...item.data() }));
  accountingEntries.sort((a, b) => (b.actualizadoEn?.seconds || b.creadoEn?.seconds || 0) - (a.actualizadoEn?.seconds || a.creadoEn?.seconds || 0));
}

function renderAccountingQueue() {
  const queue = $('accountingQueue');
  if (!queue || !isAdmin()) return;
  renderAccountingSummary();
  const visibleActivities = filteredActivities();
  if (!visibleActivities.length) {
    queue.innerHTML = '<div class="empty-state"><b>No hay actividades para revisar</b>Cuando haya registros, podrás preparar sus comprobantes contables.</div>';
    return;
  }
  queue.innerHTML = visibleActivities.map(activity => {
    const entries = accountingEntries.filter(entry => entry.actividadId === activity.id);
    const prepared = entries.filter(entry => entry.estado === 'listo').length;
    const draft = entries.filter(entry => entry.estado === 'borrador').length;
    const status = entries.length
      ? `<span class="accounting-state">${prepared} comprobante(s) registrado(s) · ${draft} borrador(es)</span>`
      : '<span class="accounting-state pending">Sin comprobante preparado</span>';
    const entryList = entries.map(entry => `<div class="accounting-entry-row"><span><b>${escapeHtml(entry.concepto || 'Comprobante sin concepto')}</b><small>${escapeHtml(entry.tipoDocumento || 'Sin tipo')} ${escapeHtml(entry.numeroDocumento || '')} · ${entry.estado === 'listo' ? 'Registrado en BER' : 'Borrador'} · ${escapeHtml(entry.id.slice(0, 8))}</small></span><span class="accounting-entry-total">Débito ${formatMoney(entry.debitoTotal)}<br>Crédito ${formatMoney(entry.creditoTotal)}</span><button class="activity-action" type="button" data-edit-accounting="${escapeHtml(entry.id)}">Editar</button></div>`).join('');
    return `<article class="accounting-activity"><div class="accounting-activity-main"><div><b>${escapeHtml(activity.titulo)}</b><small>${escapeHtml(activity.nombreEmpleado || activity.emailEmpleado || '')} · ${escapeHtml(formatDate(activity.fecha))}${activity.ubicacion ? ` · ${escapeHtml(activity.ubicacion)}` : ''}</small></div><div class="accounting-activity-actions">${status}<button class="button button-quiet" type="button" data-new-accounting="${escapeHtml(activity.id)}">+ Comprobante</button></div></div>${entryList ? `<div class="accounting-entry-list">${entryList}</div>` : ''}</article>`;
  }).join('');
  queue.querySelectorAll('[data-new-accounting]').forEach(button => button.addEventListener('click', () => openAccountingModal(button.dataset.newAccounting)));
  queue.querySelectorAll('[data-edit-accounting]').forEach(button => button.addEventListener('click', () => {
    const entry = accountingEntries.find(item => item.id === button.dataset.editAccounting);
    if (entry) openAccountingModal(entry.actividadId, entry);
  }));
}

function renderAccountingSummary() {
  const inPeriod = accountingEntries.filter(entry => (!activeFilters.from || String(entry.fecha || '') >= activeFilters.from) && (!activeFilters.to || String(entry.fecha || '') <= activeFilters.to));
  const registered = inPeriod.filter(entry => entry.estado === 'listo');
  const drafts = inPeriod.filter(entry => entry.estado === 'borrador');
  const debit = registered.reduce((sum, entry) => sum + (Number(entry.debitoTotal) || 0), 0);
  const credit = registered.reduce((sum, entry) => sum + (Number(entry.creditoTotal) || 0), 0);
  $('accountingRegisteredCount').textContent = registered.length;
  $('accountingDraftCount').textContent = drafts.length;
  $('accountingPeriodDebit').textContent = formatMoney(debit);
  $('accountingPeriodCredit').textContent = formatMoney(credit);

  const accounts = new Map();
  registered.forEach(entry => (entry.lineas || []).forEach(line => {
    const code = String(line.cuentaPUC || '').trim();
    const name = String(line.nombreCuenta || '').trim();
    if (!code || !name) return;
    const key = `${code}\u0000${name}`;
    const account = accounts.get(key) || { code, name, debit:0, credit:0 };
    account.debit += Number(line.debito) || 0;
    account.credit += Number(line.credito) || 0;
    accounts.set(key, account);
  }));
  const summary = $('accountingAccountSummary');
  const rows = [...accounts.values()].sort((a, b) => a.code.localeCompare(b.code, 'es', { numeric:true }));
  summary.innerHTML = rows.length
    ? `<div class="accounting-account-head"><span>Cuenta PUC</span><span>Débito</span><span>Crédito</span><span>Movimiento neto D−C</span></div>${rows.map(account => `<div class="accounting-account-row"><span><b>${escapeHtml(account.code)}</b> · ${escapeHtml(account.name)}</span><span>${formatMoney(account.debit)}</span><span>${formatMoney(account.credit)}</span><strong>${formatMoney(account.debit - account.credit)}</strong></div>`).join('')}`
    : '<div class="empty-state"><b>Sin movimientos registrados</b>Los comprobantes guardados como borrador no aparecen en este resumen.</div>';
}

function makeAccountingLine(line = {}) {
  const row = document.createElement('div');
  row.className = 'accounting-line';
  row.innerHTML = '<label><span class="visually-hidden">Cuenta PUC</span><input class="line-account-code" type="text" maxlength="20" placeholder="Código PUC"></label><label><span class="visually-hidden">Nombre de cuenta</span><input class="line-account-name" type="text" maxlength="120" placeholder="Nombre de cuenta"></label><label><span class="visually-hidden">Débito</span><input class="line-debit" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0.00"></label><label><span class="visually-hidden">Crédito</span><input class="line-credit" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0.00"></label><button class="line-remove" type="button" aria-label="Quitar línea">×</button>';
  row.querySelector('.line-account-code').value = line.cuentaPUC || '';
  row.querySelector('.line-account-name').value = line.nombreCuenta || '';
  row.querySelector('.line-debit').value = line.debito || '';
  row.querySelector('.line-credit').value = line.credito || '';
  row.querySelectorAll('input').forEach(input => input.addEventListener('input', updateAccountingTotals));
  row.querySelector('.line-remove').addEventListener('click', () => {
    if ($('accountingLines').children.length <= 2) {
      showMessage('accountingMessage', 'Un comprobante requiere al menos dos líneas.', true);
      return;
    }
    row.remove();
    clearMessage('accountingMessage');
    updateAccountingTotals();
  });
  return row;
}

function accountingLineValues() {
  return [...$('accountingLines').querySelectorAll('.accounting-line')].map(row => ({
    cuentaPUC:row.querySelector('.line-account-code').value.trim(),
    nombreCuenta:row.querySelector('.line-account-name').value.trim(),
    debito:Number(row.querySelector('.line-debit').value || 0),
    credito:Number(row.querySelector('.line-credit').value || 0)
  }));
}

function updateAccountingTotals() {
  const lines = accountingLineValues();
  const debit = Math.round((lines.reduce((sum, line) => sum + line.debito, 0) + Number.EPSILON) * 100) / 100;
  const credit = Math.round((lines.reduce((sum, line) => sum + line.credito, 0) + Number.EPSILON) * 100) / 100;
  $('accountingDebitTotal').textContent = formatMoney(debit);
  $('accountingCreditTotal').textContent = formatMoney(credit);
  const balanced = lines.filter(line => line.cuentaPUC && line.nombreCuenta && (line.debito > 0 || line.credito > 0)).length >= 2 && debit === credit;
  const status = $('accountingBalanceStatus');
  status.textContent = balanced ? 'Cuadre matemático: sí' : 'Pendiente de completar o cuadrar';
  status.classList.toggle('balanced', balanced);
  status.classList.toggle('unbalanced', !balanced);
  return { lines, debit, credit, balanced };
}

function formatMoney(value) {
  return new Intl.NumberFormat('es-CO', { style:'currency', currency:'COP', maximumFractionDigits:2 }).format(Number(value) || 0);
}

function openAccountingModal(activityId, entry = null) {
  if (!isAdmin()) return;
  const activity = activities.find(item => item.id === activityId);
  if (!activity) return;
  editingAccountingId = entry?.id || null;
  $('accountingActivityId').value = activityId;
  $('accountingActivitySummary').textContent = `${activity.titulo} · ${activity.nombreEmpleado || activity.emailEmpleado || ''} · ${formatDate(activity.fecha)}${activity.ubicacion ? ` · ${activity.ubicacion}` : ''}`;
  $('accountingDate').value = entry?.fecha || activity.fecha || localDateInputValue();
  $('accountingDocType').value = entry?.tipoDocumento || '';
  $('accountingDocName').value = entry?.nombreDocumento || '';
  $('accountingDocNumber').value = entry?.numeroDocumento || '';
  $('accountingBeneficiary').value = entry?.beneficiario || '';
  $('accountingThirdPartyId').value = entry?.identificacion || '';
  $('accountingConcept').value = entry?.concepto || activity.titulo || '';
  $('accountingLines').replaceChildren();
  const lines = entry?.lineas?.length ? entry.lineas : [{}, {}];
  lines.forEach(line => $('accountingLines').append(makeAccountingLine(line)));
  $('prepareAccounting').textContent = entry?.estado === 'listo' ? 'Actualizar comprobante' : 'Registrar comprobante';
  clearMessage('accountingMessage');
  $('accountingModal').classList.remove('hidden');
  updateAccountingTotals();
}

function closeAccountingModal() {
  $('accountingModal').classList.add('hidden');
  editingAccountingId = null;
}

$('closeAccountingModal').addEventListener('click', closeAccountingModal);
$('accountingModal').addEventListener('click', event => { if (event.target === $('accountingModal')) closeAccountingModal(); });
window.addEventListener('keydown', event => { if (event.key === 'Escape' && !$('accountingModal').classList.contains('hidden')) closeAccountingModal(); });
$('addAccountingLine').addEventListener('click', () => $('accountingLines').append(makeAccountingLine()));
$('accountingLines').addEventListener('input', updateAccountingTotals);

async function saveAccountingRecord(state) {
  const activityId = $('accountingActivityId').value;
  const totals = updateAccountingTotals();
  if (!isAdmin() || !activityId) return;
  const existingEntry = editingAccountingId
    ? accountingEntries.find(entry => entry.id === editingAccountingId)
    : null;
  if (state === 'listo') {
    const required = ['accountingDate','accountingDocType','accountingDocName','accountingDocNumber','accountingBeneficiary','accountingThirdPartyId','accountingConcept'];
    if (required.some(id => !$(id).value.trim())) {
      showMessage('accountingMessage', 'Completa fecha, tipo y número de soporte, tercero e identificación, y concepto.', true);
      return;
    }
    if (totals.lines.length < 2 || totals.lines.some(line => !line.cuentaPUC || !line.nombreCuenta || line.debito < 0 || line.credito < 0 || (line.debito > 0) === (line.credito > 0)) || !totals.balanced) {
      showMessage('accountingMessage', 'Cada línea debe tener cuenta y un solo valor (débito o crédito); el total débito/crédito debe cuadrar para registrar el comprobante.', true);
      return;
    }
  }
  const submit = state === 'listo' ? $('prepareAccounting') : $('saveAccountingDraft');
  submit.disabled = true;
  try {
    const payload = {
      actividadId:activityId,
      fecha:$('accountingDate').value,
      tipoDocumento:$('accountingDocType').value.trim(),
      nombreDocumento:$('accountingDocName').value.trim(),
      numeroDocumento:$('accountingDocNumber').value.trim(),
      beneficiario:$('accountingBeneficiary').value.trim(),
      identificacion:$('accountingThirdPartyId').value.trim(),
      concepto:$('accountingConcept').value.trim(),
      lineas:totals.lines.filter(line => line.cuentaPUC || line.nombreCuenta || line.debito || line.credito),
      debitoTotal:totals.debit,
      creditoTotal:totals.credit,
      estado:state,
      creadoPor:existingEntry?.creadoPor || currentUser.uid,
      actualizadoEn:serverTimestamp()
    };
    if (editingAccountingId) await updateDoc(doc(db, 'asientos', editingAccountingId), payload);
    else await addDoc(collection(db, 'asientos'), { ...payload, creadoEn:serverTimestamp() });
    await loadAccountingEntries();
    renderAccountingQueue();
    closeAccountingModal();
  } catch (error) {
    showMessage('accountingMessage', error.code ? friendlyError(error) : error.message, true);
  } finally { submit.disabled = false; }
}

$('saveAccountingDraft').addEventListener('click', () => saveAccountingRecord('borrador'));
$('accountingForm').addEventListener('submit', event => { event.preventDefault(); saveAccountingRecord('listo'); });

$('exportBtn').addEventListener('click', () => {
  if (!isAdmin()) return;
  const rows = [['Ingeniero','Correo','Fecha','Actividad','Ubicación','Descripción','Evidencias'], ...filteredActivities().map(item => [item.nombreEmpleado,item.emailEmpleado,item.fecha,item.titulo,item.ubicacion,item.descripcion,(item.evidencias || []).length])];
  const csv = '\uFEFF' + rows.map(row => row.map(value => `"${String(value ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type:'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'BER-actividades.csv'; anchor.click(); URL.revokeObjectURL(url);
});

window.addEventListener('online', () => setConnection('Conectado', true));
window.addEventListener('offline', () => setConnection('Sin conexión'));
