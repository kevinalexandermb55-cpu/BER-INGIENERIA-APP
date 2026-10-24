(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const STORE = "ber_viaticos_profesional_v1";
  let state = loadState();
  let activeEmployee = null;
  let deferredPrompt = null;

  function loadState() {
    try { return JSON.parse(localStorage.getItem(STORE)) || {employees: []}; }
    catch { return {employees: []}; }
  }
  function saveState() {
    try { localStorage.setItem(STORE, JSON.stringify(state)); return true; }
    catch { toast("No hay espacio disponible. Prueba con un soporte más pequeño."); return false; }
  }
  function money(n) {
    return new Intl.NumberFormat("es-CO", {style:"currency",currency:"COP",maximumFractionDigits:0}).format(Number(n)||0);
  }
  function today() { return new Date().toLocaleDateString("en-CA"); }
  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  }
  let toastTimer;
  function toast(message) {
    const el = $("toast"); el.textContent = message; el.classList.add("show");
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove("show"), 2800);
  }
  function getEmployee() { return state.employees.find(e => e.id === activeEmployee); }
  function renderProfiles() {
    const select = $("employeeSelect");
    select.innerHTML = '<option value="">Selecciona tu nombre</option>' +
      state.employees.map(e => `<option value="${e.id}">${escapeHtml(e.name)}</option>`).join("");
  }
  function openDashboard(id) {
    const employee = state.employees.find(e => e.id === id);
    if (!employee) { toast("Selecciona o crea un perfil primero."); return; }
    activeEmployee = id;
    $("profilePanel").classList.add("hidden");
    $("dashboard").classList.remove("hidden");
    $("employeeGreeting").textContent = employee.name.split(/\s+/)[0];
    renderDashboard();
    window.scrollTo({top:0,behavior:"smooth"});
  }
  function renderDashboard() {
    const employee = getEmployee(); if (!employee) return;
    const advances = employee.movements.filter(m=>m.type==="advance").reduce((s,m)=>s+m.amount,0);
    const expenses = employee.movements.filter(m=>m.type==="expense").reduce((s,m)=>s+m.amount,0);
    $("balanceValue").textContent = money(advances-expenses);
    $("advancesValue").textContent = money(advances);
    $("expensesValue").textContent = money(expenses);
    $("balanceCaption").textContent = advances-expenses < 0 ? "Gastos superiores a los anticipos" : "Anticipos menos gastos";
    $("movementCount").textContent = employee.movements.length;
    const list = $("historyList");
    if (!employee.movements.length) {
      list.innerHTML = '<div class="empty-state"><span class="empty-icon">↗</span><strong>Aún no hay movimientos</strong><p>Cuando registres un viático o gasto, aparecerá aquí.</p></div>';
      return;
    }
    const sorted = [...employee.movements].sort((a,b)=>(b.date||"").localeCompare(a.date||"") || b.createdAt-a.createdAt);
    list.innerHTML = sorted.map(m => {
      const isAdvance = m.type === "advance";
      const label = isAdvance ? (m.purpose || "Viático recibido") : (m.description || m.category || "Gasto");
      const date = m.date ? new Date(m.date+"T12:00:00").toLocaleDateString("es-CO",{day:"2-digit",month:"short",year:"numeric"}) : "";
      const receipt = m.receipt ? `<a class="receipt-link" href="${m.receipt.data}" download="${escapeHtml(m.receipt.name)}" target="_blank" rel="noopener">Ver soporte · ${escapeHtml(m.receipt.name)}</a>` : "";
      return `<article class="movement"><span class="movement-icon ${isAdvance?"advance":"expense"}">${isAdvance?"＋":"↘"}</span><div class="movement-info"><strong>${escapeHtml(label)}</strong><small>${escapeHtml(date)}${!isAdvance && m.category ? " · "+escapeHtml(m.category):""}</small>${receipt}</div><div class="movement-amount ${isAdvance?"positive":"negative"}">${isAdvance?"+":"−"}${money(m.amount)}</div></article>`;
    }).join("");
  }
  function showPanel(id) {
    ["advancePanel","expensePanel"].forEach(p=>$(p).classList.add("hidden"));
    $(id).classList.remove("hidden"); $(id).scrollIntoView({behavior:"smooth",block:"start"});
  }
  function hidePanel(id) { $(id).classList.add("hidden"); }
  $("employeeForm").addEventListener("submit", e => {
    e.preventDefault();
    const name = $("employeeName").value.trim();
    if (!name) return;
    if (state.employees.some(emp=>emp.name.toLocaleLowerCase()===name.toLocaleLowerCase())) { toast("Ya existe un perfil con ese nombre."); return; }
    const employee = {id: (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())), name, movements:[]};
    state.employees.push(employee);
    if (!saveState()) { state.employees.pop(); return; }
    $("employeeName").value = ""; renderProfiles(); $("employeeSelect").value = employee.id;
    toast("Perfil creado. Ya puedes entrar."); openDashboard(employee.id);
  });
  $("enterBtn").addEventListener("click",()=>openDashboard($("employeeSelect").value));
  $("changeProfileBtn").addEventListener("click",()=>{
    activeEmployee=null; $("dashboard").classList.add("hidden"); $("profilePanel").classList.remove("hidden");
    $("employeeSelect").value=""; window.scrollTo({top:0,behavior:"smooth"});
  });
  $("showAdvanceBtn").addEventListener("click",()=>{ $("advanceDate").value=today(); showPanel("advancePanel"); });
  $("showExpenseBtn").addEventListener("click",()=>{ $("expenseDate").value=today(); showPanel("expensePanel"); });
  document.querySelectorAll("[data-close]").forEach(b=>b.addEventListener("click",()=>hidePanel(b.dataset.close)));
  $("advanceForm").addEventListener("submit",e=>{
    e.preventDefault(); const employee=getEmployee(); if(!employee)return;
    const amount=Number($("advanceAmount").value);
    if(!Number.isFinite(amount)||amount<=0){toast("Escribe un valor válido.");return;}
    employee.movements.push({id:Date.now(),type:"advance",amount,date:$("advanceDate").value,purpose:$("advancePurpose").value.trim(),createdAt:Date.now()});
    if(saveState()){e.target.reset();hidePanel("advancePanel");renderDashboard();toast("Viático guardado correctamente.");}
  });
  $("expenseForm").addEventListener("submit",async e=>{
    e.preventDefault(); const employee=getEmployee(); if(!employee)return;
    const amount=Number($("expenseAmount").value);
    if(!Number.isFinite(amount)||amount<=0){toast("Escribe un valor válido.");return;}
    const file=$("expenseReceipt").files[0]; let receipt=null;
    if(file){
      if(file.size>1.5*1024*1024){toast("El soporte supera 1,5 MB. Elige una imagen o PDF más pequeño.");return;}
      try { receipt={name:file.name,type:file.type,data:await readFile(file)}; }
      catch { toast("No se pudo leer el soporte."); return; }
    }
    employee.movements.push({id:Date.now(),type:"expense",amount,date:$("expenseDate").value,category:$("expenseCategory").value,description:$("expenseDescription").value.trim(),receipt,createdAt:Date.now()});
    if(saveState()){e.target.reset();hidePanel("expensePanel");renderDashboard();toast("Gasto guardado correctamente.");}
  });
  function readFile(file){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(file);});}
  $("exportBtn").addEventListener("click",()=>{
    const employee=getEmployee(); if(!employee)return;
    const rows=[["Empleado","Tipo","Fecha","Categoría","Descripción","Valor COP","Soporte"]];
    employee.movements.forEach(m=>rows.push([employee.name,m.type==="advance"?"Viático recibido":"Gasto",m.date||"",m.category||"",m.purpose||m.description||"",m.amount,m.receipt?.name||""]));
    const csv="\uFEFF"+rows.map(row=>row.map(v=>'"'+String(v??"").replace(/"/g,'""')+'"').join(";")).join("\r\n");
    const url=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8;"}));
    const a=document.createElement("a");a.href=url;a.download="BER_resumen_"+employee.name.trim().replace(/\s+/g,"_")+".csv";document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);
    toast("Resumen CSV exportado.");
  });
  window.addEventListener("beforeinstallprompt",e=>{e.preventDefault();deferredPrompt=e;$("installBtn").classList.remove("hidden");});
  $("installBtn").addEventListener("click",async()=>{if(!deferredPrompt)return;deferredPrompt.prompt();await deferredPrompt.userChoice;deferredPrompt=null;$("installBtn").classList.add("hidden");});
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    window.addEventListener("load",()=>navigator.serviceWorker.register("./sw.js").catch(()=>{}));
  }
  renderProfiles();
  $("advanceDate").value=today(); $("expenseDate").value=today();
  setTimeout(()=>{$("splash").classList.add("out");$("app").classList.remove("hidden");},1900);
})();