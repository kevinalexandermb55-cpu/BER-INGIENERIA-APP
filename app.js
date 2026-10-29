import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, signOut
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, addDoc, collection, query,
  where, getDocs, deleteDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import firebaseConfig from "./firebase-config.js";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, RECEIPT_BUCKET } from "./supabase-config.js";

const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);
const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  accessToken: async () => auth.currentUser ? await auth.currentUser.getIdToken() : null
});
const $ = id => document.getElementById(id);
let currentUser = null, currentProfile = null, cachedMovements = [];
let showingAll = false, employeeUidFilter = null, busy = false;

function money(value) {
  return new Intl.NumberFormat("es-CO", {style:"currency",currency:"COP",maximumFractionDigits:0}).format(Number(value)||0);
}
function dateText(value) {
  if (!value) return "Sin fecha";
  const d = new Date(`${value}T12:00:00`);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString("es-CO",{day:"2-digit",month:"short",year:"numeric"});
}
function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
}
function notice(target, text, type="") {
  const el = $(target); if (!el) return;
  el.textContent = text; el.className = `notice ${type}`.trim(); el.classList.remove("hidden");
}
function toast(text) {
  const el = $("globalToast"); el.textContent = text; el.classList.remove("hidden");
  setTimeout(()=>el.classList.add("hidden"),4000);
}
function setBusy(button, value, label) {
  if (!button) return;
  button.disabled = value;
  if (value) { button.dataset.original = button.innerHTML; button.textContent = label || "Procesando…"; }
  else if (button.dataset.original) { button.innerHTML = button.dataset.original; delete button.dataset.original; }
}
function friendlyError(error) {
  const code = error?.code || "";
  if (code.includes("auth/invalid-credential") || code.includes("auth/wrong-password") || code.includes("auth/user-not-found")) return "Correo o contraseña incorrectos.";
  if (code.includes("auth/email-already-in-use")) return "Ese correo ya tiene una cuenta. Inicia sesión.";
  if (code.includes("auth/weak-password")) return "Usa una contraseña de al menos 6 caracteres.";
  if (code.includes("permission-denied")) return "Firebase bloqueó la operación. Revisa el perfil y las reglas de Firestore.";
  if (code.includes("failed-precondition")) return "La consulta de Firestore requiere atención. Abre la consola del navegador para ver el detalle.";
  if (/storage|row-level security|JWT|not authorized/i.test(error?.message||"")) return "No se pudo subir el comprobante. Verifica la integración Firebase Auth–Supabase y las políticas del bucket.";
  return error?.message || "Ocurrió un error. Intenta nuevamente.";
}
function toggleAuthMode(signup) {
  $("authTitle").textContent = signup ? "Crear cuenta" : "Bienvenido";
  $("authDescription").textContent = signup ? "Crea tu acceso de empleado." : "Ingresa con tu cuenta corporativa.";
  $("loginBtn").innerHTML = signup ? 'Crear cuenta <span>→</span>' : 'Ingresar <span>→</span>';
  $("showSignup").textContent = signup ? "Ya tengo una cuenta. Volver al ingreso" : "¿Primera vez? Crear cuenta de empleado";
  $("loginForm").dataset.mode = signup ? "signup" : "login";
  $("password").autocomplete = signup ? "new-password" : "current-password";
  $("authMessage").classList.add("hidden");
}
$("showSignup").addEventListener("click",()=>toggleAuthMode($("loginForm").dataset.mode !== "signup"));

$("loginForm").addEventListener("submit", async event => {
  event.preventDefault(); if (busy) return;
  const button = $("loginBtn"); busy = true; setBusy(button,true,"Validando acceso…");
  try {
    const email = $("email").value.trim().toLowerCase(), password = $("password").value;
    if ($("loginForm").dataset.mode === "signup") {
      const credential = await createUserWithEmailAndPassword(auth,email,password);
      await setDoc(doc(db,"usuarios",credential.user.uid),{
        uid:credential.user.uid,email:credential.user.email,nombre:email.split("@")[0],
        rol:"empleado",activo:true,creadoEn:serverTimestamp()
      });
      notice("authMessage","Cuenta creada. Ya puedes registrar movimientos.","success");
    } else {
      await signInWithEmailAndPassword(auth,email,password);
    }
  } catch (error) { notice("authMessage",friendlyError(error),"error"); }
  finally { busy = false; setBusy(button,false); }
});
$("logoutBtn").addEventListener("click",()=>signOut(auth).catch(e=>toast(friendlyError(e))));
$("movementDate").value = new Date().toLocaleDateString("en-CA");

$("movementType").addEventListener("change",()=>{
  const isAdvance = $("movementType").value === "viatico";
  if (isAdvance) $("category").value = "Viático asignado";
  else if ($("category").value === "Viático asignado") $("category").value = "Alimentación";
  $("targetEmployeeWrap").classList.toggle("hidden", !(currentProfile?.rol === "admin"));
});
$("category").addEventListener("change",()=>{
  if ($("category").value === "Viático asignado") $("movementType").value = "viatico";
});

async function loadProfile(user) {
  const ref = doc(db,"usuarios",user.uid), snap = await getDoc(ref);
  if (snap.exists()) return snap.data();
  const profile = {uid:user.uid,email:user.email||"",nombre:(user.email||"empleado").split("@")[0],rol:"empleado",activo:true,creadoEn:serverTimestamp()};
  await setDoc(ref,profile); return profile;
}
async function loadApp() {
  currentProfile = await loadProfile(currentUser);
  if (currentProfile.activo !== true) {
    await signOut(auth);
    throw new Error("Tu cuenta está desactivada. Contacta al administrador de BER Ingeniería.");
  }
  const isAdmin = currentProfile.rol === "admin";
  $("authPanel").classList.add("hidden"); $("appPanel").classList.remove("hidden"); $("logoutBtn").classList.remove("hidden");
  $("signedUser").textContent = currentProfile.nombre || currentUser.email;
  $("roleLabel").textContent = isAdmin ? "Administrador" : "Empleado";
  $("avatar").textContent = (currentProfile.nombre || currentUser.email || "B").trim().charAt(0).toUpperCase();
  $("welcomeTitle").textContent = isAdmin ? "Resumen de la empresa" : `Hola, ${currentProfile.nombre || "bienvenido"}`;
  $("welcomeSubtitle").textContent = isAdmin ? "Consulta y supervisa los movimientos registrados." : "Consulta tus viáticos, gastos y saldo disponible.";
  $("adminTools").classList.toggle("hidden",!isAdmin);
  $("targetEmployeeWrap").classList.toggle("hidden",!isAdmin);
  // El empleado no puede autoasignarse un viático desde la interfaz.
  if (!isAdmin) {
    const typeSelect = $("movementType");
    typeSelect.innerHTML = '<option value="gasto">Reportar un gasto</option>';
    typeSelect.value = "gasto"; $("category").value = "Alimentación";
  } else {
    $("movementType").innerHTML = '<option value="gasto">Registrar un gasto</option><option value="viatico">Asignar viático</option>';
  }
  $("connectionStatus").textContent = "Sesión activa"; $("connectionStatus").classList.add("online");
  await loadMovements();
}
function sortMovements(arr) {
  return arr.sort((a,b)=>{
    const at = a.creadoEn?.toMillis ? a.creadoEn.toMillis() : new Date(`${a.fecha||"1970-01-01"}T12:00:00`).getTime();
    const bt = b.creadoEn?.toMillis ? b.creadoEn.toMillis() : new Date(`${b.fecha||"1970-01-01"}T12:00:00`).getTime();
    return bt-at;
  });
}
async function loadMovements() {
  if (!currentUser || !currentProfile) return;
  const isAdmin = currentProfile.rol === "admin";
  let snap;
  if (isAdmin && showingAll && !employeeUidFilter) {
    snap = await getDocs(collection(db,"movimientos"));
  } else {
    const uid = isAdmin && employeeUidFilter ? employeeUidFilter : currentUser.uid;
    snap = await getDocs(query(collection(db,"movimientos"),where("uid","==",uid)));
  }
  cachedMovements = sortMovements(snap.docs.map(d=>({id:d.id,...d.data()})));
  renderMovements();
}
function renderMovements() {
  const list = $("movementsList"), movements = cachedMovements;
  const advances = movements.filter(m=>m.tipo==="viatico").reduce((s,m)=>s+Number(m.valor||0),0);
  const expenses = movements.filter(m=>m.tipo==="gasto").reduce((s,m)=>s+Number(m.valor||0),0);
  $("totalAdvances").textContent=money(advances); $("totalExpenses").textContent=money(expenses); $("balance").textContent=money(advances-expenses);
  if (!movements.length) {
    list.innerHTML='<div class="empty-state"><span>◇</span><strong>Aún no hay movimientos</strong><p>Cuando registres un viático o gasto, aparecerá aquí.</p></div>'; return;
  }
  list.innerHTML = movements.map(m=>{
    const advance=m.tipo==="viatico";
    const icons={"Alimentación":"☕","Transporte":"↗","Hotel":"⌂","Combustible":"⛽","Peajes y parqueaderos":"⌁","Materiales":"▦"};
    const attachment=m.comprobante?`<a href="#" data-receipt="${escapeHTML(m.comprobante)}" class="receipt-link">Ver comprobante ↗</a>`:"";
    const adminDelete=currentProfile.rol==="admin"?`<div class="movement-actions"><button class="tiny-btn" data-delete="${escapeHTML(m.id)}" type="button">Eliminar</button></div>`:"";
    const who=currentProfile.rol==="admin"?`<small>Empleado: ${escapeHTML(m.emailEmpleado||"sin correo")}</small>`:"";
    return `<article class="movement-item"><div class="movement-icon">${advance?"↙":(icons[m.categoria]||"↗")}</div><div class="movement-info"><strong>${escapeHTML(m.categoria||(advance?"Viático":"Gasto"))}</strong><small>${dateText(m.fecha)} · ${escapeHTML(m.descripcion||"Sin descripción")}</small>${who}${attachment}${adminDelete}</div><div class="movement-amount ${advance?"advance":"expense"}">${advance?"+":"−"} ${money(m.valor)}</div></article>`;
  }).join("");
  list.querySelectorAll("[data-delete]").forEach(btn=>btn.addEventListener("click",async()=>{
    if(!confirm("¿Eliminar este movimiento? Esta acción no se puede deshacer.")) return;
    try { await deleteDoc(doc(db,"movimientos",btn.dataset.delete)); toast("Movimiento eliminado."); await loadMovements(); }
    catch(e){toast(friendlyError(e));}
  }));
  list.querySelectorAll("[data-receipt]").forEach(link=>link.addEventListener("click",async e=>{
    e.preventDefault();
    try {
      const {data,error}=await supabase.storage.from(RECEIPT_BUCKET).createSignedUrl(link.dataset.receipt,60);
      if(error) throw error;
      window.open(data.signedUrl,"_blank","noopener,noreferrer");
    } catch(err) { console.error(err); toast("No se pudo abrir el comprobante. Revisa las políticas de Storage en Supabase."); }
  }));
}
async function findEmployeeByEmail(email) {
  const snap=await getDocs(query(collection(db,"usuarios"),where("email","==",email)));
  if(snap.empty) return null;
  const d=snap.docs[0]; return {uid:d.id,...d.data()};
}
$("movementForm").addEventListener("submit",async event=>{
  event.preventDefault(); if(!currentUser||!currentProfile||busy) return;
  const isAdmin=currentProfile.rol==="admin", tipo=$("movementType").value, amount=Number($("amount").value);
  if(!Number.isFinite(amount)||amount<=0) return notice("formMessage","Escribe un valor mayor que cero.","error");
  if(!isAdmin && tipo!=="gasto") return notice("formMessage","Solo un administrador puede asignar viáticos.","error");
  let recipient={uid:currentUser.uid,email:currentUser.email||"",nombre:currentProfile.nombre||""};
  if(isAdmin){
    const targetEmail=$("targetEmployee").value.trim().toLowerCase();
    if(!targetEmail) return notice("formMessage","Escribe el correo del empleado destinatario.","error");
    try { const found=await findEmployeeByEmail(targetEmail); if(!found) return notice("formMessage","No existe un perfil de empleado con ese correo. Pídele que cree su cuenta primero.","error"); recipient={uid:found.uid,email:found.email||targetEmail,nombre:found.nombre||""}; }
    catch(e){return notice("formMessage",friendlyError(e),"error");}
  }
  const file=$("receipt").files[0];
  if(file&&file.size>10*1024*1024) return notice("formMessage","El comprobante supera 10 MB.","error");
  if(file&&!(file.type.startsWith("image/")||file.type==="application/pdf")) return notice("formMessage","Solo se permiten imágenes o PDF.","error");
  busy=true;setBusy($("saveMovementBtn"),true,"Guardando movimiento…");
  let receiptPath="";
  try {
    if(file){
      // Storage debe aceptar el token Firebase mediante la integración configurada en Supabase.
      const safeName=file.name.replace(/[^a-zA-Z0-9._-]/g,"_");
      receiptPath=`${recipient.uid}/${Date.now()}_${safeName}`;
      const {error:uploadError}=await supabase.storage.from(RECEIPT_BUCKET).upload(receiptPath,file,{upsert:false,contentType:file.type});
      if(uploadError) throw uploadError;
    }
    await addDoc(collection(db,"movimientos"),{
      uid:recipient.uid,emailEmpleado:recipient.email,nombreEmpleado:recipient.nombre,
      tipo,fecha:$("movementDate").value,
      categoria:tipo==="viatico"?"Viático asignado":$("category").value,
      valor:amount,descripcion:$("description").value.trim(),
      comprobante:receiptPath,nombreArchivo:file?file.name:"",
      creadoPor:currentUser.uid,creadoEn:serverTimestamp()
    });
    $("movementForm").reset();$("movementDate").value=new Date().toLocaleDateString("en-CA");
    $("movementType").value=currentProfile.rol==="admin"?"gasto":"gasto";$("category").value="Alimentación";
    if(currentProfile.rol==="admin") $("targetEmployee").value="";
    notice("formMessage","Movimiento guardado correctamente.","success");
    showingAll=currentProfile.rol==="admin";employeeUidFilter=currentProfile.rol==="admin"?recipient.uid:null;
    if(currentProfile.rol==="admin") $("employeeFilter").value=recipient.email;
    await loadMovements();
  } catch(error){
    console.error("No se pudo guardar el movimiento:",error);
    notice("formMessage",friendlyError(error),"error");
  } finally {busy=false;setBusy($("saveMovementBtn"),false);}
});
$("refreshBtn").addEventListener("click",()=>loadMovements().catch(e=>toast(friendlyError(e))));
$("allMovementsBtn").addEventListener("click",()=>{showingAll=true;employeeUidFilter=null;$("employeeFilter").value="";loadMovements().catch(e=>toast(friendlyError(e)));});
$("filterEmployeeBtn").addEventListener("click",async()=>{
  const email=$("employeeFilter").value.trim().toLowerCase(); if(!email) return toast("Escribe el correo del empleado.");
  try {const employee=await findEmployeeByEmail(email);if(!employee) return toast("No se encontró un perfil con ese correo.");employeeUidFilter=employee.uid;showingAll=false;await loadMovements();}
  catch(e){toast(friendlyError(e));}
});
$("exportBtn").addEventListener("click",()=>{
  if(!cachedMovements.length) return toast("No hay movimientos para exportar.");
  const cols=["fecha","emailEmpleado","tipo","categoria","valor","descripcion","nombreArchivo"];
  const csv=[cols.join(","),...cachedMovements.map(m=>cols.map(k=>`"${String(m[k]??"").replace(/"/g,'""')}"`).join(","))].join("\r\n");
  const blob=new Blob(["\ufeff"+csv],{type:"text/csv;charset=utf-8;"}),url=URL.createObjectURL(blob);
  const a=document.createElement("a");a.href=url;a.download="BER_viaticos.csv";a.click();URL.revokeObjectURL(url);
});

onAuthStateChanged(auth,async user=>{
  currentUser=user;
  if(!user){currentProfile=null;cachedMovements=[];showingAll=false;employeeUidFilter=null;
    $("authPanel").classList.remove("hidden");$("appPanel").classList.add("hidden");$("logoutBtn").classList.add("hidden");
    $("connectionStatus").textContent="Sin sesión";$("connectionStatus").classList.remove("online");return;}
  $("connectionStatus").textContent="Cargando datos…";
  try{await loadApp();}
  catch(error){console.error("BER Viáticos:",error);$("connectionStatus").textContent="Revisar conexión";toast(friendlyError(error));}
});
window.addEventListener("online",()=>{$("connectionStatus").textContent="Conectado";$("connectionStatus").classList.add("online");});
window.addEventListener("offline",()=>{$("connectionStatus").textContent="Sin internet";$("connectionStatus").classList.remove("online");});
if("serviceWorker" in navigator) window.addEventListener("load",()=>navigator.serviceWorker.register("./sw.js").catch(e=>console.warn("Service worker:",e)));
