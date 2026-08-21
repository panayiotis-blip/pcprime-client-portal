const MONTHS=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const LS="greson_rentals_v2";
let DATA=load(), user=null, activeTab="overview", schedYear="2026", stmtTenant=null, pdfTargetId=null;
let chart=null;
const VIEWED=new Date();

// Statement has no tab of its own — it is a report, opened per tenant from the
// Rent Schedule's Reports menu or from the invoice list. The view still exists
// and goTab("statement") still reaches it; it just isn't a top-level place.
function TABS(){ const t=[["overview","Overview"],["properties","Properties"],["tenants","Tenants & Contracts"],["schedule","Rent Schedule"],["receipts","Receipts"],["arrears","Arrears"],["deposits","Deposits"],["invoice","Invoices"]]; return t; }
function load(){ return norm({meta:{},tenants:[],properties:[],users:[],audit:[]}); }
function norm(d){ if(!d.meta)d.meta={}; if(!d.tenants)d.tenants=[]; if(!d.properties)d.properties=[]; if(!d.users)d.users=[]; if(!d.audit)d.audit=[];
  // Charges billed alongside rent. The list is the firm's own — edit it in
  // Settings. kind: "monthly" recurs every month; "annual" is billed once, in
  // the month it is entered; "oneoff" is ad-hoc. Seeded on first run only, so
  // an existing book keeps whatever list it already has (including none).
  if(!d.chargeTypes)d.chargeTypes=[{id:1,name:"Common fees",kind:"monthly"},{id:2,name:"Electricity",kind:"monthly"},{id:3,name:"Water",kind:"monthly"},{id:4,name:"Refuse",kind:"annual"}];
  // VAT. Commercial tenants who are registered are charged VAT; residential
  // ones are not. Two switches have to agree before any VAT is added: the
  // TENANT is marked vatable, and the thing being billed is vatable (rent has
  // its own flag, each charge type carries one). Every stored figure stays NET
  // — VAT is derived, never written into an amount — so nothing already
  // entered changes meaning, and turning the flag off restores the old totals
  // exactly. Existing books default to no VAT anywhere, which is what they
  // have been doing all along.
  if(!d.meta)d.meta={};
  if(d.meta.vatRate===undefined)d.meta.vatRate=19;   // Cyprus standard rate
  if(d.meta.vatOnRent===undefined)d.meta.vatOnRent=false;
  d.tenants.forEach(t=>{ if(!t.pay)t.pay={}; if(!t.leases)t.leases=[{start:t.start||"",renewal:t.renewal||"",end:t.end||""}];
    if(!t.contact1)t.contact1={name:t.contact||"",phone:""}; if(!t.contact2)t.contact2={name:"",phone:""}; if(!t.depositMoves)t.depositMoves=[];
    if(!t.agreements)t.agreements=(t.agreement?[t.agreement]:[]); delete t.agreement;
    // Standing charges: what this tenant pays every month on top of rent.
    if(!t.charges)t.charges=[];
    Object.keys(t.pay).forEach(y=>{ t.pay[y].forEach(mo=>{ if(!mo.receipts)mo.receipts=(mo.a?[{date:mo.d||"",ref:"",amount:mo.a}]:[]); }); }); });
  return d; }

/* ---- Charges (billed with the rent) --------------------------------------
   A month's charges are NOT written until someone edits that month: an
   untouched month simply shows the tenant's standing charges, so changing a
   standing charge fixes every month that has not been dealt with by hand,
   while months already adjusted keep exactly what was entered. */
function chargeTypes(){ return (DATA.chargeTypes||[]).filter(c=>c.active!==false); }
function ctById(id){ return (DATA.chargeTypes||[]).find(c=>c.id===+id)||null; }
function ctName(id){ const c=ctById(id); return c?c.name:"Charge"; }
function nextCtId(){ return (DATA.chargeTypes||[]).reduce((m,c)=>Math.max(m,c.id),0)+1; }
// Standing charges that recur — annual/one-off ones are added to a month by hand.
function standingCharges(t){ return (t.charges||[]).filter(c=>{ const ct=ctById(c.typeId); return ct && ct.active!==false && ct.kind==="monthly"; }); }
// What this tenant is charged for this month, beyond rent.
function monthCharges(t,y,m){
  const mo=(t.pay&&t.pay[y]&&t.pay[y][m])||null;
  if(mo&&Array.isArray(mo.charges))return mo.charges.filter(c=>ctById(c.typeId));
  return standingCharges(t).map(c=>({typeId:c.typeId,amount:num(c.amount)}));
}
function chargesTotal(t,y,m){ return monthCharges(t,y,m).reduce((s,c)=>s+num(c.amount),0); }

/* ---- VAT ----
   Two switches must agree before anything is added: the tenant is registered
   AND the thing billed is vatable (rent has its own flag, each charge type
   carries one). Stored amounts stay NET; VAT is derived every time, so turning
   a flag off restores the previous totals exactly.
   Rounded PER LINE, as an invoice shows it — rounding the month's total
   instead produces invoices whose lines do not add up to the total. */
function r2(n){ return Math.round(n*100)/100; }
function vatRate(){ var v=DATA.meta&&DATA.meta.vatRate; return v===undefined||v===null||v===""?19:num(v); }
function tenantVatable(t){ return !!(t&&t.vatable); }
function rentVatable(){ return !!(DATA.meta&&DATA.meta.vatOnRent); }
function ctVatable(typeId){ var ct=ctById(typeId); return !!(ct&&ct.vatable); }
function rentVat(t,y,m){ return (tenantVatable(t)&&rentVatable())?r2(rentOf(t,y,m)*vatRate()/100):0; }
function chargeVat(t,c){ return (tenantVatable(t)&&ctVatable(c.typeId))?r2(num(c.amount)*vatRate()/100):0; }
function vatTotal(t,y,m){ return r2(rentVat(t,y,m)+monthCharges(t,y,m).reduce(function(s,c){return s+chargeVat(t,c);},0)); }
// Gross — what the tenant actually owes, and what a receipt settles.
function rentGross(t,y,m){ return r2(rentOf(t,y,m)+rentVat(t,y,m)); }
function chargeGross(t,c){ return r2(num(c.amount)+chargeVat(t,c)); }
// Does anything in this book charge VAT? Used to keep the UI quiet for books
// that do not — no VAT columns, no VAT lines, nothing to explain.
function vatInUse(){ return (DATA.tenants||[]).some(tenantVatable) && (rentVatable() || (DATA.chargeTypes||[]).some(function(c){return c.vatable;})); }

// The actual amount owed for the month: rent plus its charges, plus VAT.
function dueTotal(t,y,m){ return r2(rentOf(t,y,m)+chargesTotal(t,y,m)+vatTotal(t,y,m)); }
// Received TOWARDS what the month bills: rent, plus the charges actually
// raised for it. Money allocated to anything else (an "Other" reimbursement, a
// charge that was never billed) is income but settles nothing, so it must not
// quietly cancel out arrears. With no charges billed this is rent receipts
// alone — exactly the behaviour before charges existed.
function paidAll(t,y,m){
  const billed=monthCharges(t,y,m).map(c=>ctName(c.typeId));
  return ensureYear(t,y)[m].receipts.reduce((s,r)=>{ const c=catOf(r); return s+((c==="Rent"||billed.indexOf(c)>=0)?num(r.amount):0); },0);
}
// Received against one charge type (receipts are allocated by name, so older
// receipts labelled "Electricity"/"Other" keep counting without conversion).
function paidCat(t,y,m,name){ return ensureYear(t,y)[m].receipts.reduce((s,r)=>s+(catOf(r)===name?num(r.amount):0),0); }
// The allocation list offered on a receipt: rent, every charge type, then Other.
function catList(){ return ["Rent"].concat(chargeTypes().map(c=>c.name)).concat(["Other"]); }
function catOptions(sel){ return catList().map(c=>'<option'+((sel||"Rent")===c?" selected":"")+'>'+esc(c)+'</option>').join(""); }
function persist(action){ DATA.meta.updated=stamp(new Date()); if(action){ if(!DATA.audit)DATA.audit=[]; DATA.audit.push({ts:DATA.meta.updated,user:(user?user.username:"system"),action:action}); if(DATA.audit.length>3000)DATA.audit=DATA.audit.slice(-3000); } postSave(); refreshStamps(); }
function stamp(d){ return d.getFullYear()+"-"+p2(d.getMonth()+1)+"-"+p2(d.getDate())+" "+p2(d.getHours())+":"+p2(d.getMinutes()); }
function p2(x){ return (x<10?"0":"")+x; }
// Local calendar date. toISOString() would report yesterday for anyone east of
// Greenwich late in the evening, and a receipt must carry the day it was taken.
function todayIso(){ var d=new Date(); return d.getFullYear()+"-"+p2(d.getMonth()+1)+"-"+p2(d.getDate()); }
function money(v){ if(v===null||v===undefined||v==="")return "—"; return "€"+Math.round(v).toLocaleString(); }
function num(v){ v=parseFloat(v); return isFinite(v)?v:0; }
function esc(s){ return (s==null?"":String(s)).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
function flash(m){ const f=document.getElementById("flash"); f.textContent=m; f.classList.add("show"); setTimeout(()=>f.classList.remove("show"),2600); }
function canEdit(){ return user && user.role!=="viewer"; }
function isAdmin(){ return user && user.role==="admin"; }

/* ---- auth ---- */
function hashPw(s){ let h=5381; for(let i=0;i<s.length;i++){ h=((h<<5)+h)+s.charCodeAt(i); h=h&0xffffffff; } return (h>>>0).toString(16); }
function ensureUsers(){ if(!DATA.users.length){ DATA.users=[{username:"admin",hash:hashPw("greson2026"),role:"admin",name:"Administrator"}]; persist(); } }
function showLogin(msg){
  document.getElementById("loginHost").innerHTML=
    '<div class="login"><div class="box"><h2>Property Rentals</h2><p>Please sign in.</p>'+
    '<div class="err" id="lerr">'+(msg||"")+'</div>'+
    '<input id="lu" placeholder="Username" autocomplete="username">'+
    '<input id="lp" type="password" placeholder="Password" autocomplete="current-password">'+
    '<button class="primary" data-h="doLogin()">Sign in</button>'+
    '<p style="margin-top:14px">First time? Default login is <b>admin</b> / <b>greson2026</b> — change it in the Users tab.</p></div></div>';
  document.getElementById("app").classList.add("hidden");
  const lp=document.getElementById("lp"); lp.onkeydown=e=>{ if(e.key==="Enter")doLogin(); };
}
window.doLogin=function(){ const u=document.getElementById("lu").value.trim(), p=document.getElementById("lp").value;
  const found=DATA.users.find(x=>x.username.toLowerCase()===u.toLowerCase() && x.hash===hashPw(p));
  if(!found){ document.getElementById("lerr").textContent="Invalid username or password."; return; }
  user=found; document.getElementById("loginHost").innerHTML=""; document.getElementById("app").classList.remove("hidden");
  initShell(); render(); };
window.logout=function(){ if(window.parent!==window) window.parent.postMessage({type:"logout"},"*"); };

/* ---- helpers on data ---- */
function ensureYear(t,y){ if(!t.pay[y])t.pay[y]=Array.from({length:12},()=>({receipts:[]})); return t.pay[y]; }
function propById(id){ return DATA.properties.find(p=>p.id===id); }
function mIdx(iso){ if(!iso)return null; const d=new Date(iso); return isNaN(d)?null:d.getFullYear()*12+d.getMonth(); }
function curLease(t){ return t.leases[t.leases.length-1]||{start:"",renewal:"",end:""}; }
function due(t,y,m){ const cur=(+y)*12+m; const L=curLease(t); const s=mIdx(L.start), e=mIdx(L.end);
  const anyStart = t.leases.map(x=>mIdx(x.start)).filter(v=>v!=null).sort((a,b)=>a-b)[0];
  if(anyStart!=null && cur<anyStart) return false; if(e!==null && cur>e) return false;
  const vf=mIdx(t.vacantFrom); if(vf!=null && cur>=vf) return false; return (t.rent||0)>0; }
function catOf(r){ return r.cat||"Rent"; }
function paid(t,y,m){ return ensureYear(t,y)[m].receipts.reduce((s,r)=>s+(catOf(r)==="Rent"?num(r.amount):0),0); }
function otherPaid(t,y,m){ return ensureYear(t,y)[m].receipts.reduce((s,r)=>s+(catOf(r)!=="Rent"?num(r.amount):0),0); }
function rentOf(t,y,m){ const p=t.pay&&t.pay[y]&&t.pay[y][m]; if(p&&p.rent!==undefined&&p.rent!==null&&p.rent!=="")return num(p.rent); return t.rent||0; }
function capM(y){ const d=new Date(); if(+y<d.getFullYear())return 11; if(+y>d.getFullYear())return -1; return d.getMonth(); }
// A month counts as settled only when rent AND its charges are covered, so
// pa/r below are the totals rather than rent alone.
function statusOf(t,y,m){ const pa=paidAll(t,y,m),r=dueTotal(t,y,m);
  const vf=mIdx(t.vacantFrom); if(vf!=null && ((+y)*12+m)>=vf) return pa>0?"PAID":"VACANT";
  if(r<=0)return pa>0?"PAID":"NA";
  if(!due(t,y,m))return pa>0?(pa>=r?"PAID":"PARTIAL"):"NA";
  if(m>capM(y))return pa>0?(pa>=r?"PAID":"PARTIAL"):"UPCOMING";
  if(pa>=r)return "PAID"; if(pa>0)return "PARTIAL"; return "UNPAID"; }
// Outstanding for the month = rent AND its charges, against everything paid.
function owed(t,y,m){ if(!due(t,y,m)||m>capM(y))return 0; const b=dueTotal(t,y,m)-paidAll(t,y,m); return b>0?b:0; }

/* ---- shell ---- */
function initShell(){
  refreshStamps();
  applyHeaderLogo();
  applyHeaderTitle();
  document.getElementById("whoami").textContent=user? (user.name+" · "+user.role) : "";
  const tb=document.getElementById("tabs"); tb.innerHTML="";
  TABS().forEach(([id,l])=>{const d=document.createElement("div");d.className="tab"+(id===activeTab?" active":"");d.textContent=l;d.onclick=()=>{activeTab=id;render();};tb.appendChild(d);});
  const sy=document.getElementById("selYear"); const cur=sy.value||schedYear; sy.innerHTML="";
  yearList().forEach(y=>{const o=document.createElement("option");o.value=y;o.textContent=y;sy.appendChild(o);});
  sy.value=cur; sy.onchange=()=>{schedYear=sy.value;render();};
  document.getElementById("btnAdd").onclick=()=>editTenant(null);
  document.getElementById("btnAdd").style.display=canEdit()?"":"none";
  document.getElementById("btnImport").onclick=openImport;
  document.getElementById("btnImport").style.display=canEdit()?"":"none";
  document.getElementById("btnPrint").onclick=function(){ window.print(); };
  document.getElementById("btnSave").onclick=function(){ persist(); flash("Saved."); };
  document.getElementById("btnSave").style.display=canEdit()?"":"none";
  document.getElementById("btnLogout").onclick=logout;
  document.getElementById("pdfInput").onchange=onPdfPicked;
  // User dropdown menu (name → Settings / Users / Privacy / Log out).
  var umBtn=document.getElementById("userMenuBtn"), um=document.getElementById("userMenu");
  umBtn.onclick=function(e){ e.stopPropagation(); um.classList.toggle("hidden"); };
  document.getElementById("menuUsers").style.display=isAdmin()?"":"none";
  if(!window.__umClose){ window.__umClose=true; document.addEventListener("click",function(){ var m=document.getElementById("userMenu"); if(m)m.classList.add("hidden"); }); }
}
function refreshStamps(){ document.getElementById("stamps").innerHTML="Viewed: "+stamp(VIEWED)+" · Updated: "+(DATA.meta.updated||"—"); }
function applyHeaderLogo(){ var hl=document.getElementById("hdrLogo"); if(!hl)return; var lg=(DATA.settings&&DATA.settings.logo)||""; if(lg){ hl.src=lg; hl.style.display=""; } else { hl.style.display="none"; } }
// Header title = this client's own company name (set in Settings), else a
// generic label — so the same app on any client shows THEIR name, not Greson.
function companyName(){ var s=DATA.settings||{}; return (s.companyName||(DATA.meta&&DATA.meta.client)||"").trim(); }
function applyHeaderTitle(){ var t=document.getElementById("hdrTitle"); if(!t)return; var cn=companyName(); var txt=cn?(cn+" — Property Rentals"):"Property Rentals"; t.textContent=txt; try{document.title=txt;}catch(e){} }
function fileBase(){ var cn=companyName()||"Property Rentals"; return cn.replace(/[^\w]+/g,"_").replace(/^_+|_+$/g,"")||"Property_Rentals"; }

/* ---- user menu: settings / privacy / users ---- */
window.openPrivacy=function(){ try{ window.open("/privacy","_blank","noopener"); }catch(e){ flash("Could not open privacy policy."); } };

window.openSettings=function(){
  var s=DATA.settings||{}; var cn=s.companyName||(DATA.meta&&DATA.meta.client)||"";
  window._logoData=undefined;
  document.getElementById("modalHost").innerHTML='<div class="modal"><div class="box"><h3>Company settings</h3>'+
    '<p class="hint">Printed on statements and documents.</p>'+
    '<div class="frow"><label>Company name<input id="st_cn" value="'+esc(cn)+'"></label></div>'+
    '<div class="frow"><label>Registration no.<input id="st_reg" value="'+esc(s.regNo||"")+'"></label><label>VAT no.<input id="st_vat" value="'+esc(s.vatNo||"")+'"></label></div>'+
    '<div class="frow"><label>Address<textarea id="st_addr" rows="2">'+esc(s.address||"")+'</textarea></label></div>'+
    '<div class="frow"><label>Phone<input id="st_ph" value="'+esc(s.phone||"")+'"></label><label>Email<input id="st_em" value="'+esc(s.email||"")+'"></label></div>'+
    '<div class="frow"><label>Invoice number prefix<input id="st_inv" value="'+esc(s.invoicePrefix||"INV")+'" placeholder="INV"></label><label>Bank / payment details (shown on invoices)<input id="st_bank" value="'+esc(s.bank||"")+'"></label></div>'+
    '<div class="frow"><label>Logo (PNG/JPG, under 1.5&nbsp;MB)<input id="st_logo" type="file" accept="image/*"></label></div>'+
    '<div id="st_logoPrev">'+(s.logo?'<img src="'+esc(s.logo)+'" style="max-height:64px;margin-top:4px">':'')+'</div>'+
    '<div style="border-top:1px solid #e2e8f0;margin:14px 0 8px;padding-top:12px"><b style="font-size:13px">VAT</b>'+
      '<p class="hint" style="margin:2px 0 8px">VAT is added to a tenant\'s bill only when that tenant is marked <b>VAT registered</b> on their own file <i>and</i> the line is vatable. Every amount you enter anywhere stays <b>net</b> — VAT is added on top, never taken out of the figure you typed.</p>'+
      '<div class="frow"><label>Rate (%)<input id="st_vatrate" type="number" step="0.01" min="0" style="width:90px" value="'+esc(String((DATA.meta&&DATA.meta.vatRate!==undefined)?DATA.meta.vatRate:19))+'"></label>'+
      '<label style="align-self:flex-end">Charge VAT on rent<input id="st_vatrent" type="checkbox"'+(rentVatable()?" checked":"")+'></label></div>'+
      '<p class="hint" style="margin:2px 0 0">Each charge type has its own VAT box below.</p></div>'+
    '<div style="border-top:1px solid #e2e8f0;margin:14px 0 8px;padding-top:12px"><b style="font-size:13px">Charge types</b>'+
      '<p class="hint" style="margin:2px 0 8px">Billed alongside rent — common fees, utilities, refuse. <b>Monthly</b> ones can be set as a tenant\'s standing charge and appear on every month; <b>annual</b> and <b>one-off</b> ones you add to the month they fall in. Removing a type here leaves past months and receipts untouched.</p>'+
      '<div id="ctBox"></div><div class="frow"><button class="ghost" data-h="addChargeType()">+ Add charge type</button></div></div>'+
    '<div class="frow" style="justify-content:flex-end;margin-top:8px"><button class="ghost" data-h="closeModal()">Cancel</button> <button class="primary" data-h="saveSettings()">Save</button></div></div></div>';
  var li=document.getElementById("st_logo");
  li.onchange=function(e){ var f=e.target.files[0]; if(!f)return; if(f.size>1500000){alert("Logo must be under 1.5 MB.");return;} var r=new FileReader(); r.onload=function(){ window._logoData=r.result; document.getElementById("st_logoPrev").innerHTML='<img src="'+r.result+'" style="max-height:64px;margin-top:4px">'; }; r.readAsDataURL(f); };
  window._cts=(DATA.chargeTypes||[]).map(function(c){return {id:c.id,name:c.name,kind:c.kind||"monthly",vatable:!!c.vatable};});
  renderChargeTypes();
};

var KINDS=[["monthly","Monthly"],["annual","Annual"],["oneoff","One-off"]];
function renderChargeTypes(){
  var box=document.getElementById("ctBox"); if(!box)return;
  var L=window._cts||[];
  box.innerHTML = L.length ? L.map(function(c,i){
    return '<div class="frow" style="align-items:flex-end"><label style="flex:1">Name<input class="ctz" data-i="'+i+'" data-k="name" value="'+esc(c.name)+'"></label>'+
      '<label>Billed<select class="ctz" data-i="'+i+'" data-k="kind">'+KINDS.map(function(k){return '<option value="'+k[0]+'"'+(c.kind===k[0]?" selected":"")+'>'+k[1]+'</option>';}).join("")+'</select></label>'+
      '<label title="Charge VAT on this, for tenants marked VAT registered">VAT<input class="ctz" data-i="'+i+'" data-k="vatable" type="checkbox"'+(c.vatable?" checked":"")+'></label>'+
      '<button class="iconbtn" data-h="rmChargeType('+i+')" title="Remove">🗑</button></div>';
  }).join("") : '<div class="hint">No charge types — rent only.</div>';
}
function collectChargeTypes(){ document.querySelectorAll(".ctz").forEach(function(inp){ var i=+inp.dataset.i,k=inp.dataset.k; if(window._cts[i])window._cts[i][k]=(inp.type==="checkbox")?inp.checked:inp.value; }); }
window.addChargeType=function(){ collectChargeTypes(); window._cts.push({id:0,name:"",kind:"monthly",vatable:false}); renderChargeTypes(); };
window.rmChargeType=function(i){
  collectChargeTypes();
  var c=window._cts[i];
  // Tenants may be standing-charged for it; say so rather than silently unpick.
  var used=DATA.tenants.filter(function(t){return (t.charges||[]).some(function(x){return +x.typeId===+c.id;});}).length;
  if(c.id && used && !confirm('"'+c.name+'" is a standing charge on '+used+' tenant'+(used===1?"":"s")+'. Remove it? Past months and receipts already entered are not changed.'))return;
  window._cts.splice(i,1); renderChargeTypes();
};
window.saveSettings=function(){ if(!canEdit()){alert("Read-only access.");return;}
  var g=function(id){ return document.getElementById(id).value.trim(); };
  DATA.settings=Object.assign({}, DATA.settings, { companyName:g("st_cn"), regNo:g("st_reg"), vatNo:g("st_vat"), address:g("st_addr"), phone:g("st_ph"), email:g("st_em"), invoicePrefix:g("st_inv")||"INV", bank:g("st_bank") });
  if(window._logoData!==undefined) DATA.settings.logo=window._logoData;
  if(!DATA.meta)DATA.meta={};
  var vr=document.getElementById("st_vatrate"), vo=document.getElementById("st_vatrent");
  if(vr)DATA.meta.vatRate=(String(vr.value).trim()===""?19:num(vr.value));
  if(vo)DATA.meta.vatOnRent=!!vo.checked;
  if(window._cts){
    collectChargeTypes();
    var next=nextCtId();
    // New rows get an id here; existing ones keep theirs, so tenants' standing
    // charges and every month already entered still point at the same charge.
    DATA.chargeTypes=window._cts.filter(function(c){return String(c.name||"").trim();})
      .map(function(c){ return {id:c.id||next++, name:String(c.name).trim(), kind:c.kind||"monthly", vatable:!!c.vatable}; });
    var live={}; DATA.chargeTypes.forEach(function(c){live[c.id]=1;});
    DATA.tenants.forEach(function(t){ if(t.charges)t.charges=t.charges.filter(function(x){return live[x.typeId];}); });
    window._cts=null;
  }
  persist("Updated company settings"); closeModal(); applyHeaderLogo(); applyHeaderTitle(); render(); flash("Settings saved."); };

/* ---- Users & access (talks to the host over postMessage → secure backend) ---- */
var __userReqId=0, __userReqs={};
window.addEventListener("message", function(e){ var m=e.data||{}; if(m.type==="users:reply" && __userReqs[m.reqId]){ __userReqs[m.reqId](m); delete __userReqs[m.reqId]; } });
function usersRequest(op, extra){ return new Promise(function(resolve){
  if(window.parent===window){ resolve({ok:false,error:"Not available here."}); return; }
  var id=++__userReqId; __userReqs[id]=resolve;
  window.parent.postMessage(Object.assign({type:"users",op:op,reqId:id}, extra||{}), "*");
  setTimeout(function(){ if(__userReqs[id]){ __userReqs[id]({ok:false,error:"Timed out."}); delete __userReqs[id]; } }, 15000);
}); }

/* ---- Files (agreements) — same bridge, different door ----
   Attachments used to be base64 dataUrls kept inside this document. Fifteen
   contracts took it to 23 MB and the save stopped working altogether: the whole
   document is re-posted on every change, and the REST layer could not carry it.
   Files now live in Storage; the document keeps only { name, path, size }.
   The frame is sandboxed and holds no credentials, so the host brokers it —
   exactly as it does for users. Longer timeout: this one carries a file. */
var __fileReqId=0, __fileReqs={};
window.addEventListener("message", function(e){ var m=e.data||{}; if(m.type==="files:reply" && __fileReqs[m.reqId]){ __fileReqs[m.reqId](m); delete __fileReqs[m.reqId]; } });
function filesRequest(op, extra){ return new Promise(function(resolve){
  if(window.parent===window){ resolve({ok:false,error:"File storage is not available in this window."}); return; }
  var id=++__fileReqId; __fileReqs[id]=resolve;
  window.parent.postMessage(Object.assign({type:"files",op:op,reqId:id}, extra||{}), "*");
  setTimeout(function(){ if(__fileReqs[id]){ __fileReqs[id]({ok:false,error:"Timed out."}); delete __fileReqs[id]; } }, 60000);
}); }

window.openUsers=function(){ if(!isAdmin()){alert("Admins only.");return;}
  document.getElementById("modalHost").innerHTML='<div class="modal"><div class="box" style="width:min(780px,97vw)"><h3>Users &amp; access</h3>'+
    '<p class="hint"><b>admin</b> — full access incl. managing users · <b>editor</b> — add/edit data · <b>viewer</b> — read-only.</p>'+
    '<div id="usr_list">Loading…</div>'+
    '<div style="border-top:1px solid var(--line);margin:14px 0;padding-top:12px"><div style="font-weight:600;margin-bottom:8px">Add user</div>'+
    '<div class="frow" style="align-items:flex-end">'+
      '<label>Username<input id="usr_un" placeholder="e.g. jsmith"></label>'+
      '<label>Name<input id="usr_nm"></label>'+
      '<label>Role<select id="usr_role"><option value="admin">admin</option><option value="editor" selected>editor</option><option value="viewer">viewer</option></select></label>'+
      '<label>Password<input id="usr_pw" type="text" placeholder="min 6"></label>'+
      '<button class="primary" data-h="addAppUser()">Add</button></div></div>'+
    '<div class="frow" style="justify-content:flex-end"><button class="ghost" data-h="closeModal()">Close</button></div></div></div>';
  refreshUserList();
};
function refreshUserList(){ var host=document.getElementById("usr_list"); if(!host)return; host.textContent="Loading…";
  usersRequest("list").then(function(r){ if(!document.getElementById("usr_list"))return;
    if(!r.ok){ host.innerHTML='<div class="hint" style="color:#ef4444">'+esc(r.error||"Failed to load users.")+'</div>'; return; }
    var us=r.data||[];
    host.innerHTML='<div class="tblwrap"><table><thead><tr><th>Username</th><th>Name</th><th>Role</th><th>Status</th><th class="actions"></th></tr></thead><tbody>'+
      (us.length?us.map(function(u){ return '<tr><td><b>'+esc(u.username)+'</b></td><td>'+esc(u.name||"—")+'</td>'+
        '<td><select class="usr-role" data-uid="'+u.id+'">'+["admin","editor","viewer"].map(function(x){return '<option'+(x===u.role?" selected":"")+'>'+x+'</option>';}).join("")+'</select></td>'+
        '<td>'+(u.active?"Active":'<span style="color:#94a3b8">Disabled</span>')+'</td>'+
        '<td class="actions"><button class="iconbtn" data-h="resetAppUser('+u.id+')" title="Reset password">&#128273;</button>'+
        '<button class="iconbtn" data-h="toggleAppUser('+u.id+','+(u.active?0:1)+')" title="'+(u.active?"Disable":"Enable")+'">'+(u.active?"&#8856;":"&#10003;")+'</button>'+
        '<button class="iconbtn" data-h="delAppUser('+u.id+')" title="Delete" style="color:#ef4444">&#128465;</button></td></tr>'; }).join("")
        :'<tr><td colspan="5" class="hint">No users yet.</td></tr>')+'</tbody></table></div>';
    Array.prototype.forEach.call(host.querySelectorAll(".usr-role"), function(sel){ sel.onchange=function(){ usersRequest("update",{id:+sel.getAttribute("data-uid"),payload:{role:sel.value}}).then(function(r2){ if(!r2.ok)alert(r2.error||"Failed"); refreshUserList(); }); }; });
  }); }
window.addAppUser=function(){ var un=document.getElementById("usr_un").value.trim(), nm=document.getElementById("usr_nm").value.trim(), role=document.getElementById("usr_role").value, pw=document.getElementById("usr_pw").value;
  if(!un||pw.length<6){ alert("Username and a 6+ character password are required."); return; }
  usersRequest("create",{payload:{username:un,name:nm,role:role,password:pw}}).then(function(r){ if(!r.ok){ alert(r.error||"Failed"); return; } document.getElementById("usr_un").value="";document.getElementById("usr_nm").value="";document.getElementById("usr_pw").value=""; refreshUserList(); flash("User added."); }); };
window.resetAppUser=function(id){ var pw=prompt("New password (min 6 characters):"); if(!pw)return; if(pw.length<6){alert("Too short.");return;} usersRequest("reset",{id:id,payload:{password:pw}}).then(function(r){ alert(r.ok?"Password updated.":(r.error||"Failed")); }); };
window.toggleAppUser=function(id,active){ usersRequest("update",{id:id,payload:{active:!!active}}).then(function(r){ if(!r.ok)alert(r.error||"Failed"); refreshUserList(); }); };
window.delAppUser=function(id){ if(!confirm("Delete this user's login?"))return; usersRequest("delete",{id:id}).then(function(r){ if(!r.ok)alert(r.error||"Failed"); refreshUserList(); }); };

/* ---- CSV import (receipts / monthly rent) ---- */
window.openImport=function(){ if(!canEdit()){alert("Read-only access.");return;}
  document.getElementById("modalHost").innerHTML='<div class="modal"><div class="box" style="width:min(680px,96vw)"><h3>Import from CSV</h3>'+
    '<div class="frow"><label>What are you importing?<select id="imp_type">'+
      '<option value="receipts">Receipts (rent received)</option>'+
      '<option value="rent">Monthly rent (per tenant)</option>'+
    '</select></label></div>'+
    '<div id="imp_hint" class="hint"></div>'+
    '<div class="frow"><label>Paste CSV, or choose a file below<textarea id="imp_csv" rows="8"></textarea></label></div>'+
    '<div class="frow" style="align-items:center"><label class="filebtn">⭱ Choose CSV file<input id="imp_file" type="file" accept=".csv,text/csv" class="hidden"></label><div style="flex:1"></div><button class="ghost" data-h="closeModal()">Cancel</button> <button class="primary" data-h="runImport()">Import</button></div>'+
    '</div></div>';
  var hint=function(){ var t=document.getElementById("imp_type").value;
    document.getElementById("imp_hint").innerHTML = t==="receipts"
      ? "Columns: <b>Tenant, Date (YYYY-MM-DD), Reference, Amount</b> — one receipt per line. Tenant name must match an existing tenant."
      : "Columns: <b>Tenant, Monthly rent</b> — sets each tenant's monthly rent.";
    document.getElementById("imp_csv").placeholder = t==="receipts" ? "John Doe,2026-03-05,REC001,500" : "John Doe,500"; };
  document.getElementById("imp_type").onchange=hint; hint();
  document.getElementById("imp_file").onchange=function(e){ var f=e.target.files[0]; if(!f)return; var r=new FileReader(); r.onload=function(){ document.getElementById("imp_csv").value=r.result; }; r.readAsText(f); };
};
window.runImport=function(){ if(!canEdit()){alert("Read-only access.");return;}
  var type=document.getElementById("imp_type").value;
  var txt=document.getElementById("imp_csv").value.trim(); if(!txt){alert("Paste or choose a CSV first.");return;}
  var lines=txt.split(/\r?\n/).map(function(l){return l.trim();}).filter(Boolean);
  if(lines.length && /tenant/i.test(lines[0].split(/[,;\t]/)[0])) lines.shift(); // skip header
  var byName={}; DATA.tenants.forEach(function(t){ byName[(t.name||"").trim().toLowerCase()]=t; });
  var applied=0, skipped=0;
  lines.forEach(function(l){ var c=l.split(/[,;\t]/).map(function(x){return x.trim();});
    var t=byName[(c[0]||"").toLowerCase()]; if(!t){ skipped++; return; }
    if(type==="receipts"){ var date=c[1]||""; var y=date.slice(0,4); var m=parseInt(date.slice(5,7),10)-1;
      if(!(m>=0&&m<12)||!/^\d{4}$/.test(y)){ skipped++; return; }
      ensureYear(t,y)[m].receipts.push({date:date,ref:c[2]||"",amount:num(c[3]),cat:"Rent"}); applied++; }
    else { t.rent=num(c[1]); applied++; }
  });
  persist("Imported "+applied+" "+(type==="receipts"?"receipt(s)":"rent value(s)")+" from CSV");
  closeModal(); render();
  flash(applied+" imported"+(skipped?" · "+skipped+" skipped (tenant not matched / bad row)":""));
};

/* ---- Rent invoice ---- */
var invTenant=null, invYear=null, invMonth=null;
var stmtFrom=null, stmtTo=null;
function ymKey(iso){ var y=parseInt((iso||"").slice(0,4),10), m=parseInt((iso||"").slice(5,7),10)-1; return (y||0)*12+(m||0); }
/* ---- Invoices: the year's bills, one row each -----------------------------
   Every month a tenant is charged for is an invoice: rent plus that month's
   charges. The list shows what was billed, what came in against it and what is
   left, so you can see the whole year at a glance and open, print or send any
   one of them. invView holds which single invoice is open, if any. */
var invView=null, invFilter="ALL";

function vInvoice(){
  if(invView==="doc")return vInvoiceDoc();
  var y=yr(), cap=capM(y);
  var opts='<option value="ALL">All tenants</option>'+DATA.tenants.filter(function(t){return t.name&&t.name!=="NO TENANT";})
    .sort(function(a,b){return (a.name||"").localeCompare(b.name||"");})
    .map(function(t){return '<option value="'+t.id+'"'+(String(t.id)===String(invFilter)?" selected":"")+'>'+esc(t.name)+'</option>';}).join("");

  var rows=[], billed=0, recvd=0;
  sortedTenants().forEach(function(t){
    if(invFilter!=="ALL"&&String(t.id)!==String(invFilter))return;
    if(!t.name||t.name==="NO TENANT")return;
    for(var m=0;m<=Math.min(cap,11);m++){
      if(!due(t,y,m))continue;
      var tot=dueTotal(t,y,m); if(tot<=0)continue;
      var pa=paidAll(t,y,m), bal=tot-pa;
      billed+=tot; recvd+=pa;
      rows.push({t:t,m:m,tot:tot,pa:pa,bal:bal,ch:chargesTotal(t,y,m)});
    }
  });
  rows.sort(function(a,b){ return b.m-a.m || (a.t.name||"").localeCompare(b.t.name||""); });

  var s1=(DATA.settings||{}); var pref=s1.invoicePrefix||"INV";
  var h='<div class="cards">'+
    card("Invoices",String(rows.length),"Jan\u2013"+(cap<0?"\u2014":MONTHS[cap])+" "+y)+
    card("Billed",money(billed),"rent + charges")+
    card("Received",money(recvd),"against these invoices")+
    card("Outstanding",money(billed-recvd),(billed-recvd>0?"still owed":"all settled"))+
    '</div>';
  h+='<div class="panel"><div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">'+
    '<h3 style="margin:0">Invoices '+y+'</h3>'+
    '<span style="flex:1"></span>'+
    '<span style="font-size:12px;color:#64748b">Tenant <select id="invFilter">'+opts+'</select></span></div>'+
    '<div class="hint">One invoice per tenant per month \u2014 rent plus that month\u2019s charges. Open one to print or email it.</div>'+
    '<div class="tblwrap freeze"><table><thead><tr><th>Invoice</th><th>Tenant</th><th>Month</th><th class="num">Rent + charges</th><th class="num">Received</th><th class="num">Balance</th><th></th></tr></thead><tbody>';
  if(!rows.length)h+='<tr><td colspan="7" class="hint">Nothing billed yet for '+y+'.</td></tr>';
  rows.forEach(function(r){
    var no=pref+"-"+y+p2(r.m+1)+"-"+r.t.id;
    h+='<tr><td style="font-weight:600">'+esc(no)+'</td>'+
      '<td>'+esc(r.t.name)+'<div style="font-size:11px;color:#94a3b8">'+esc(r.t.unit)+'</div></td>'+
      '<td>'+MONTHS[r.m]+' '+y+'</td>'+
      '<td class="num">'+money(r.tot)+(r.ch?'<div style="font-size:10px;color:#b45309">incl. '+money(r.ch)+' charges</div>':'')+'</td>'+
      '<td class="num">'+(r.pa?money(r.pa):"\u2014")+'</td>'+
      '<td class="num'+(r.bal>0.005?" warn":"")+'">'+(r.bal>0.005?money(r.bal):"paid")+'</td>'+
      '<td class="actions"><button class="ghost" data-h="openInvoice('+r.t.id+',&#39;'+y+'&#39;,'+r.m+')">Open</button></td></tr>';
  });
  h+='</tbody></table></div></div>';
  document.getElementById("view").innerHTML=h;
  var f=document.getElementById("invFilter"); if(f)f.onchange=function(e){ invFilter=e.target.value; render(); };
}
window.openInvoice=function(tid,y,m){ invTenant=+tid; invYear=String(y); invMonth=+m; invView="doc"; activeTab="invoice"; render(); };
// The same invoice, over the top of whatever you were looking at.
window.popInvoice=function(tid,y,m){
  var t=DATA.tenants.find(function(x){return x.id===+tid;});
  if(!t)return;
  invTenant=+tid; invYear=String(y); invMonth=+m;
  document.body.classList.add("doc-window");
  document.getElementById("modalHost").innerHTML='<div class="modal"><div class="box" style="width:min(940px,97vw);max-height:92vh;overflow:auto">'+
    '<div class="frow noprint" style="align-items:center;margin-bottom:10px">'+
      '<b style="font-size:14px;color:#1e2a78">Invoice \u2014 '+esc(t.name)+' \u00B7 '+MONTHS[+m]+' '+y+'</b>'+
      '<div style="flex:1"></div>'+
      '<button class="btn" data-h="window.print()">\u{1F5A8} Print</button> '+
      '<button class="btn ghost" data-h="pdfInvoice()">\u2193 PDF</button> '+
      '<button class="btn ghost" data-h="openSendDoc(&#39;invoice&#39;)">\u2709 Email</button> '+
      '<button class="btn ghost" data-h="closeModal()">Close</button>'+
    '</div>'+ invoiceDocHtml(t,String(y),+m) + '</div></div>';
};
window.pdfInvoice=function(){
  var t=DATA.tenants.find(function(x){return x.id===invTenant;});
  var who=String(t&&t.name||"tenant").replace(/[^\w]+/g,"_").replace(/^_+|_+$/g,"");
  savePdf("invoice-doc", who+"-invoice-"+invYear+p2(invMonth+1)+".pdf");
};
window.closeInvoice=function(){ invView=null; render(); };


/* The invoice for one tenant and one month: rent, every charge billed that
   month, what has been received against it and what is left. Built as a string
   so the same document serves the page and the pop-up window. */
function invoiceDocHtml(t, y, m){
  var p=propById(t.propertyId);
  var rent=rentOf(t,y,m);
  var invCharges=monthCharges(t,y,m).filter(function(c){return num(c.amount)!==0;});
  var totalDue=dueTotal(t,y,m), paidAmt=paidAll(t,y,m);
  var vatAmt=vatTotal(t,y,m);   // 0 unless this tenant and these lines are vatable
  var s=DATA.settings||{}, cn=s.companyName||(DATA.meta&&DATA.meta.client)||"";
  var invNo=(s.invoicePrefix||"INV")+"-"+y+p2(m+1)+"-"+t.id;
  var now=new Date();
  var issue=stamp(now).slice(0,10), due=y+"-"+p2(m+1)+"-01";
  var invYear=y, invMonth=m;   // the markup below reads these names
  return '<div class="panel invoice-doc">'+""+
'<div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:16px">'+
        '<div style="display:flex;align-items:center;gap:14px">'+(s.logo?'<img src="'+esc(s.logo)+'" style="max-height:60px;width:auto">':'')+
          '<div><div style="font-size:18px;font-weight:700">'+esc(cn)+'</div>'+
          (s.address?'<div class="hint" style="white-space:pre-line;margin-top:2px">'+esc(s.address)+'</div>':'')+
          ((s.regNo||s.vatNo)?'<div class="hint">'+[s.regNo?"Reg. "+esc(s.regNo):"",s.vatNo?"VAT "+esc(s.vatNo):""].filter(Boolean).join(" · ")+'</div>':'')+'</div></div>'+
        '<div style="text-align:right"><div style="font-size:22px;font-weight:800;color:var(--brand)">INVOICE</div>'+
          '<div class="hint">No. '+esc(invNo)+'</div><div class="hint">Issued: '+issue+'</div><div class="hint">Due: '+due+'</div></div>'+
      '</div>'+
      '<div style="margin-top:16px"><div class="hint" style="text-transform:uppercase;letter-spacing:.05em">Bill to</div>'+
        '<div style="font-weight:700">'+esc(t.name)+'</div>'+
        '<div class="hint">'+esc(p?p.name:"")+' · '+esc(t.unit)+
          ((t.contact1&&t.contact1.name)?'<br>'+esc(t.contact1.name)+" "+esc(t.contact1.phone||""):"")+
          (t.email?'<br>'+esc(t.email):"")+
          // A VAT invoice has to carry the customer's VAT number.
          (tenantVatable(t)&&t.vatNo?'<br>VAT '+esc(t.vatNo):"")+'</div></div>'+
      '<div class="tblwrap" style="margin-top:14px"><table><thead><tr><th>Description</th><th class="num">Amount</th></tr></thead><tbody>'+
        '<tr><td>Rent — '+MONTHS[invMonth]+' '+invYear+' · '+esc(t.unit)+(rentVat(t,y,m)>0?' <span style="color:#94a3b8">+VAT</span>':"")+'</td><td class="num">'+money(rent)+'</td></tr>'+
        // One line per charge, so the tenant sees exactly what makes up the month.
        invCharges.map(function(c){return '<tr><td>'+esc(ctName(c.typeId))+' — '+MONTHS[invMonth]+' '+invYear+(chargeVat(t,c)>0?' <span style="color:#94a3b8">+VAT</span>':"")+'</td><td class="num">'+money(num(c.amount))+'</td></tr>';}).join("")+
        // Net subtotal and VAT appear only when there is VAT to show, so a
        // residential invoice looks exactly as it always has.
        (vatAmt>0?'<tr><td>Subtotal (net)</td><td class="num">'+money(r2(totalDue-vatAmt))+'</td></tr>'+
                  '<tr><td>VAT @ '+esc(String(vatRate()))+'%</td><td class="num">'+money(vatAmt)+'</td></tr>':"")+
        '<tr class="total"><td>Total due</td><td class="num">'+money(totalDue)+'</td></tr>'+
        (paidAmt>0?'<tr><td>Received to date</td><td class="num">'+money(paidAmt)+'</td></tr><tr class="total"><td>Balance outstanding</td><td class="num'+((totalDue-paidAmt)>0?" warn":"")+'">'+money(totalDue-paidAmt)+'</td></tr>':'')+
      '</tbody></table></div>'+
      (s.bank?'<div class="hint" style="margin-top:14px"><b>Payment:</b> '+esc(s.bank)+'</div>':'')+
      ((s.phone||s.email)?'<div class="hint" style="margin-top:6px">Enquiries: '+[esc(s.phone||""),esc(s.email||"")].filter(Boolean).join(" · ")+'</div>':'')+
      '</div>';
}
function vInvoiceDoc(){
  if(invTenant==null && DATA.tenants.length)invTenant=DATA.tenants[0].id;
  var now=new Date(); if(invYear==null)invYear=String(now.getFullYear()); if(invMonth==null)invMonth=now.getMonth();
  var ys=yearList();
  var topts=DATA.tenants.map(function(t){return '<option value="'+t.id+'"'+(t.id===invTenant?" selected":"")+'>'+esc(t.name)+' — '+esc(t.unit)+'</option>';}).join("");
  var yopts=ys.map(function(y){return '<option'+(y===invYear?" selected":"")+'>'+y+'</option>';}).join("");
  var mopts=MONTHS.map(function(mn,i){return '<option value="'+i+'"'+(i===invMonth?" selected":"")+'>'+mn+'</option>';}).join("");
  var h='<div class="panel noprint"><h3>Rent invoice</h3><div class="frow">'+
    '<label>Tenant<select id="invSel">'+topts+'</select></label>'+
    '<label>Year<select id="invY">'+yopts+'</select></label>'+
    '<label>Month<select id="invM">'+mopts+'</select></label>'+
    '<label>&nbsp;<button class="ghost" data-h="window.print()">🖨 Print / PDF</button></label>'+
    '<label>&nbsp;<button class="ghost" data-h="openSendDoc(&#39;invoice&#39;)">✉ Email</button></label>'+
    '<label>&nbsp;<button class="ghost" data-h="closeInvoice()">← All invoices</button></label></div></div>';
  var t=DATA.tenants.find(function(x){return x.id===invTenant;});
  if(t){ var p=propById(t.propertyId); var rent=rentOf(t,invYear,invMonth);
    // The invoice bills the month in full — rent plus its charges — and credits
    // everything received against it, however each receipt was allocated.
    var invCharges=monthCharges(t,invYear,invMonth).filter(function(c){return num(c.amount)!==0;});
    var totalDue=dueTotal(t,invYear,invMonth); var paidAmt=paidAll(t,invYear,invMonth);
    var s=DATA.settings||{}; var cn=s.companyName||(DATA.meta&&DATA.meta.client)||"";
    var invNo=(s.invoicePrefix||"INV")+"-"+invYear+p2(invMonth+1)+"-"+t.id;
    var issue=stamp(now).slice(0,10); var due=invYear+"-"+p2(invMonth+1)+"-01";
    h+=invoiceDocHtml(t,invYear,invMonth);
  } else { h+='<div class="panel">No tenants yet.</div>'; }
  document.getElementById("view").innerHTML=h;
  var sel=document.getElementById("invSel"); if(sel)sel.onchange=function(e){invTenant=+e.target.value;render();};
  var yy=document.getElementById("invY"); if(yy)yy.onchange=function(e){invYear=e.target.value;render();};
  var mm=document.getElementById("invM"); if(mm)mm.onchange=function(e){invMonth=+e.target.value;render();};
}

// Company letterhead for printed statements (from Settings).
function letterheadHtml(){ var s=DATA.settings||{}; var cn=s.companyName||(DATA.meta&&DATA.meta.client)||"";
  if(!cn && !s.address && !s.logo) return "";
  var line=[s.regNo?"Reg. "+s.regNo:"", s.vatNo?"VAT "+s.vatNo:"", s.phone||"", s.email||""].filter(Boolean).map(esc).join(" · ");
  return '<div class="panel" style="display:flex;align-items:center;gap:16px">'+
    (s.logo?'<img src="'+esc(s.logo)+'" style="max-height:64px;width:auto">':'')+
    '<div style="flex:1"><div style="font-size:18px;font-weight:700">'+esc(cn)+'</div>'+
    (s.address?'<div class="hint" style="margin:3px 0 0;white-space:pre-line">'+esc(s.address)+'</div>':'')+
    (line?'<div class="hint" style="margin:3px 0 0">'+line+'</div>':'')+
    '</div></div>'; }
function yearList(){
  const ys=new Set(["2024","2025","2026"]);
  DATA.tenants.forEach(t=>Object.keys(t.pay||{}).forEach(y=>ys.add(y)));
  // Rent for January is commonly taken in the December before it, so the year
  // after the latest one with data has to be offered before it holds anything.
  ys.add(String(VIEWED.getFullYear()+1));
  const latest=Math.max.apply(null,[...ys].map(Number));
  ys.add(String(latest+1));
  return [...ys].sort();
}
function yr(){ return document.getElementById("selYear").value||"2026"; }
function render(){
  document.querySelectorAll("#tabs .tab").forEach((t,i)=>t.classList.toggle("active",TABS()[i]&&TABS()[i][0]===activeTab));
  if(chart){try{chart.destroy();}catch(e){}chart=null;}
  const map={overview:vOverview,properties:vProperties,tenants:vTenants,schedule:vSchedule,receipts:vReceipts,arrears:vArrears,deposits:vDeposits,statement:vStatement,invoice:vInvoice,tenant:vTenantLedger,users:vUsers};
  (map[activeTab]||vOverview)();
  fitFreeze();
  restoreSchedScroll();
}

/* Give a frozen grid exactly the room left beneath it, so the grid itself is
   the only thing that scrolls and its heading row genuinely stays put. Doing
   this by measurement rather than a vh guess is what makes it work embedded:
   the app sits in an iframe whose height the portal sets, and if anything is
   left over the iframe's own document scrolls and takes the heading with it. */
// The schedule is long; leaving it to edit a tenant and coming back to the top
// means hunting for that tenant again. Remember the scroll and put it back.
var __schedScroll=0;
function rememberSchedScroll(){
  var w=document.querySelector(".tblwrap.freeze");
  if(w && activeTab==="schedule")__schedScroll=w.scrollTop;
}
function restoreSchedScroll(){
  if(activeTab!=="schedule")return;
  var w=document.querySelector(".tblwrap.freeze");
  if(w && __schedScroll)w.scrollTop=__schedScroll;
}
function fitFreeze(){
  document.querySelectorAll(".tblwrap.freeze").forEach(function(w){
    // A grid inside a modal sets its own max-height and sits above a row of
    // buttons. Sizing it to the bottom of the viewport, as a page grid wants,
    // would push Save out of sight.
    if(w.closest(".modal"))return;
    var top=w.getBoundingClientRect().top;
    var avail=Math.max(220, window.innerHeight-top-14);
    w.style.maxHeight=avail+"px";
    // Then take back whatever still overflows (body padding, margins), so the
    // page itself does not scroll at all and the grid is the only scroller —
    // otherwise a scroll anywhere but over the table carries the heading off.
    var over=document.documentElement.scrollHeight-window.innerHeight;
    if(over>0)w.style.maxHeight=Math.max(220,avail-over)+"px";
  });
}
var __fitT=null;
window.addEventListener("resize",function(){ clearTimeout(__fitT); __fitT=setTimeout(fitFreeze,120); });

/* ---- Overview ---- */
function vOverview(){
  const y=yr(), cap=capM(y);
  let roll=0,colYTD=0,dueYTD=0,occ=0,arr=0,dep=0,oth=0,chDue=0; const colByM=Array(12).fill(0), chByM=Array(12).fill(0);
  const units=DATA.properties.reduce((s,p)=>s+(p.units||0),0)||DATA.tenants.length;
  DATA.tenants.forEach(t=>{ dep+=netDeposit(t); let a=false; const real=t.name&&t.name!=="NO TENANT";
    // colByM = rent received, chByM = everything else received (the charges).
    for(let m=0;m<12;m++){ colByM[m]+=paid(t,y,m); chByM[m]+=otherPaid(t,y,m); if(m<=cap)oth+=otherPaid(t,y,m);
      if(due(t,y,m)&&m<=cap){ dueYTD+=dueTotal(t,y,m); colYTD+=paidAll(t,y,m); chDue+=chargesTotal(t,y,m); if(owed(t,y,m)>0)a=true; } }
    const nm=cap<0?0:cap; if(real&&due(t,y,nm)){ roll+=rentOf(t,y,nm); occ++; } if(a)arr++; });
  let h='<div class="cards">';
  h+=card("Monthly rent roll",money(roll),(cap<0?"—":MONTHS[cap])+" "+y);
  h+=card("Collected YTD",money(colYTD),"rent + charges, to "+(cap<0?"—":MONTHS[cap]));
  h+=card("Outstanding YTD",money(dueYTD-colYTD),(dueYTD-colYTD>0?"owed (incl. charges)":"up to date"));
  h+=card("Charges billed YTD",money(chDue),"common fees, utilities, refuse");
  h+=card("Occupancy",occ+" / "+units,"units let");
  h+=cardLink("In arrears",String(arr),"view outstanding","arrears");
  h+=cardLink("Deposits held",money(dep),"view register","deposits");
  h+=card("Charges collected YTD",money(oth),"received against charges");
  h+='</div><div class="panel"><h3>Collected — '+y+'</h3><div class="hint">What came in each month, rent and charges stacked. Hover a bar for the total.</div><canvas id="cRent"></canvas></div>';
  document.getElementById("view").innerHTML=h;
  // Same monthly bars, split into rent and charges so both are visible at once.
  chart=new Chart(document.getElementById("cRent"),{type:"bar",data:{labels:MONTHS,datasets:[
      {label:"Rent",data:colByM,backgroundColor:"#1e2a78"},
      {label:"Charges",data:chByM,backgroundColor:"#f59e0b"}]},
    options:{responsive:true,plugins:{legend:{display:true,position:"bottom"},tooltip:{callbacks:{footer:function(items){var s=items.reduce(function(a,i){return a+i.parsed.y;},0);return "Total €"+Math.round(s).toLocaleString();}}}},
      scales:{x:{stacked:true},y:{stacked:true,ticks:{callback:v=>"€"+v.toLocaleString()}}}}});
}
function card(k,v,d){ return '<div class="card"><div class="k">'+k+'</div><div class="v">'+v+'</div><div class="d">'+(d||"")+'</div></div>'; }
function cardLink(k,v,d,tab){ return '<div class="card click" data-h="goTab(\''+tab+'\')"><div class="k">'+k+'</div><div class="v">'+v+'</div><div class="d">'+(d||"")+' ›</div></div>'; }
window.goTab=function(t){ activeTab=t; render(); };
function netDeposit(t){ return num(t.deposit) - (t.depositMoves||[]).reduce((s,mv)=>s+num(mv.amount),0); }

/* ---- Properties ---- */
function vProperties(){
  const y=yr(), cap=capM(y);
  let h='<div class="panel"><div style="display:flex;gap:10px;align-items:center;"><h3 style="margin:0;">Properties</h3>'+
    (canEdit()?'<button class="ghost" data-h="editProperty(null)">+ Add property</button>':'')+
    '</div><div class="hint">Group of units in a location. Revenue = rent collected from that property\'s tenants ('+y+').</div>'+
    '<div class="tblwrap"><table><thead><tr><th>Property</th><th>Location</th><th class="num">Units</th><th class="num">Tenants</th><th class="num">Occupied</th><th class="num">Monthly roll</th><th class="num">Collected '+y+'</th><th class="num">Outstanding</th><th class="actions"></th></tr></thead><tbody>';
  DATA.properties.forEach(p=>{
    const ts=DATA.tenants.filter(t=>t.propertyId===p.id);
    const real=ts.filter(t=>t.name&&t.name!=="NO TENANT");
    let roll=0,col=0,duev=0,occ=0; const nm=cap<0?0:cap;
    ts.forEach(t=>{ const isReal=t.name&&t.name!=="NO TENANT"; if(isReal&&due(t,y,nm)){roll+=rentOf(t,y,nm); occ++;}
      for(let m=0;m<12;m++){ col+=paid(t,y,m); if(due(t,y,m)&&m<=cap)duev+=rentOf(t,y,m);} });
    const unitsN=(p.units||ts.length);
    h+='<tr><td><b>'+esc(p.name)+'</b></td><td>'+esc(p.location)+'</td><td class="num">'+unitsN+'</td><td class="num">'+real.length+'</td><td class="num">'+occ+' / '+unitsN+'</td><td class="num">'+money(roll)+'</td><td class="num">'+money(col)+'</td><td class="num'+(duev-col>0?' warn':'')+'">'+money(duev-col)+'</td>'+
      '<td class="actions">'+(canEdit()?'<button class="iconbtn" data-h="editProperty('+p.id+')">✎</button>':'')+'</td></tr>';
  });
  h+='</tbody></table></div></div>';
  h+='<div class="panel"><h3>Revenue by property — '+y+'</h3><canvas id="cProp"></canvas></div>';
  document.getElementById("view").innerHTML=h;
  const labels=DATA.properties.map(p=>p.name), vals=DATA.properties.map(p=>{ let c=0; DATA.tenants.filter(t=>t.propertyId===p.id).forEach(t=>{for(let m=0;m<12;m++)c+=paid(t,y,m);}); return c; });
  chart=new Chart(document.getElementById("cProp"),{type:"bar",data:{labels,datasets:[{label:"Collected",data:vals,backgroundColor:"#f04e23"}]},options:{indexAxis:"y",responsive:true,plugins:{legend:{display:false}},scales:{x:{ticks:{callback:v=>"€"+v.toLocaleString()}}}}});
}
window.editProperty=function(id){ if(!canEdit())return;
  const p=id==null?{id:nextPid(),name:"",location:"",units:0,notes:""}:propById(id);
  document.getElementById("modalHost").innerHTML='<div class="modal"><div class="box"><h3>'+(id==null?"Add property":"Edit property")+'</h3>'+
   '<div class="frow"><label>Name<input id="p_name" value="'+esc(p.name)+'"></label></div>'+
   '<div class="frow"><label>Location<input id="p_location" value="'+esc(p.location)+'"></label><label>No. of units (auto from list below)<input id="p_units" type="number" value="'+(p.units||0)+'"></label></div>'+
   '<div class="frow"><label>Unit names / numbers — one per line (these become the tenant\'s Unit dropdown, e.g. "Flat 201, Dali")<textarea id="p_unitnames" rows="6" style="width:100%;font-family:inherit;font-size:13px;padding:6px">'+esc((p.unitNames||[]).join("\n"))+'</textarea></label></div>'+
   '<div class="frow"><label>Notes<input id="p_notes" value="'+esc(p.notes)+'"></label></div>'+
   '<div class="frow" style="justify-content:flex-end">'+(id!=null&&isAdmin()?'<button class="ghost" data-h="delProperty('+id+')" style="color:#ef4444">Delete</button>':'')+'<button class="ghost" data-h="closeModal()">Cancel</button> <button class="primary" data-h="saveProperty('+(id==null?"null":id)+')">Save</button></div></div></div>'; };
window.saveProperty=function(id){ const g=k=>document.getElementById("p_"+k).value;
  const un=(g("unitnames")||"").split(/\n/).map(s=>s.trim()).filter(Boolean);
  const o={name:g("name").trim(),location:g("location").trim(),unitNames:un,units:un.length||num(g("units")),notes:g("notes").trim()};
  if(id==null){const p={id:nextPid()};Object.assign(p,o);DATA.properties.push(p);} else Object.assign(propById(id),o);
  persist("Saved property — "+o.name);closeModal();render();flash("Property saved."); };
window.delProperty=function(id){ if(!isAdmin()){alert("Only admins can delete.");return;} if(!confirm("Delete this property? Tenants keep their unit text but lose the link."))return; DATA.properties=DATA.properties.filter(p=>p.id!==id); persist("Deleted property");closeModal();render(); };
function nextPid(){ return DATA.properties.reduce((m,p)=>Math.max(m,p.id||0),0)+1; }

/* ---- Tenants & Contracts ---- */
function vTenants(){
  let h='<div class="panel"><h3>Tenants & Contracts ('+DATA.tenants.length+')</h3><div class="hint">Edit ✎ · Attach agreement 📎 (multiple allowed) · Delete 🗑 (admin only). Electricity = tenant pays own electricity.</div>'+
    '<div class="tblwrap"><table><thead><tr><th>#</th><th>Property</th><th>Unit</th><th>Tenant</th><th class="num">Rent</th><th>Current lease</th><th class="num">Deposit</th><th>Elec.</th><th>Contact</th><th>Agreement</th><th class="actions">Actions</th></tr></thead><tbody>';
  DATA.tenants.forEach((t,i)=>{ const p=propById(t.propertyId), L=curLease(t);
    h+='<tr><td>'+(i+1)+'</td><td>'+esc(p?p.name:"")+'</td><td>'+esc(t.unit)+'</td><td>'+esc(t.name)+'</td><td class="num">'+money(t.rent)+'</td>'+
      '<td>'+esc(L.start||"?")+' → '+esc(L.end||"?")+(t.leases.length>1?' <span class="chip">+'+(t.leases.length-1)+' prev</span>':'')+'</td>'+
      '<td class="num">'+money(t.deposit)+'</td><td>'+(t.electricity==null?"—":(t.electricity?"Yes":"No"))+'</td>'+
      '<td>'+esc(t.contact1.name)+(t.contact1.phone?" "+esc(t.contact1.phone):"")+'</td>'+
      '<td>'+((t.agreements&&t.agreements.length)?t.agreements.map((ag,ix)=>'<div style="margin:1px 0"><a href="#" data-h="viewAgreement('+t.id+','+ix+');return false;">📄 '+esc(ag.name.slice(0,16))+'</a>'+(isAdmin()?' <a href="#" title="Remove agreement" data-h="removeAgreement('+t.id+','+ix+');return false;" style="color:#ef4444;text-decoration:none">✖</a>':'')+'</div>').join(""):'<span style="color:#cbd5e1">none</span>')+'</td>'+
      '<td class="actions">'+(canEdit()?'<button class="iconbtn" title="Edit" data-h="editTenant('+t.id+')">✎</button><button class="iconbtn" title="Attach agreement" data-h="attachPdf('+t.id+')">📎</button>':'')+(isAdmin()?'<button class="iconbtn" title="Delete (admin)" data-h="delTenant('+t.id+')">🗑</button>':'')+'</td></tr>';
  });
  h+='</tbody></table></div></div>';
  document.getElementById("view").innerHTML=h;
}
window.editTenant=function(id){ if(!canEdit())return;
  const t=id==null?{id:nextTid(),propertyId:(DATA.properties[0]||{}).id,name:"",unit:"",rent:0,deposit:0,electricity:null,leases:[{start:"",renewal:"",end:""}],contact1:{name:"",phone:""},contact2:{name:"",phone:""},email:"",agreements:[],pay:{}}:DATA.tenants.find(x=>x.id===id);
  const popt=DATA.properties.map(p=>'<option value="'+p.id+'"'+(p.id===t.propertyId?" selected":"")+'>'+esc(p.name)+'</option>').join("");
  let leaseRows=t.leases.map((L,i)=>'<div class="frow" data-lease="'+i+'"><label>'+(i===t.leases.length-1?"Current — start":"Prev start")+'<input class="lz" data-k="start" data-i="'+i+'" type="date" value="'+esc(L.start)+'"></label>'+
    '<label>Renewal<input class="lz" data-k="renewal" data-i="'+i+'" type="date" value="'+esc(L.renewal)+'"></label>'+
    '<label>End<input class="lz" data-k="end" data-i="'+i+'" type="date" value="'+esc(L.end)+'"></label></div>').join("");
  document.getElementById("modalHost").innerHTML='<div class="modal"><div class="box"><h3>'+(id==null?"Add tenant":"Edit tenant")+'</h3>'+
   '<div class="frow"><label>Property<select id="t_prop" data-hc="rebuildUnitOptions()">'+popt+'</select></label><label>Unit<select id="t_unit">'+unitOptions(t.propertyId,t.unit)+'</select></label></div>'+
   '<div class="frow"><label>Tenant name<input id="t_name" value="'+esc(t.name)+'"></label></div>'+
   '<div class="frow"><label>Monthly rent (€)<input id="t_rent" type="number" value="'+(t.rent||0)+'"></label><label>Deposit (€)<input id="t_deposit" type="number" value="'+(t.deposit||0)+'"></label>'+
   '<label>Electricity<select id="t_elec"><option value="">—</option><option value="1">Tenant pays</option><option value="0">Included</option></select></label>'+
   '<label>Vacant from (blank = occupied)<input id="t_vacant" type="date" value="'+esc(t.vacantFrom||"")+'"></label></div>'+
   // Commercial tenants who are registered get VAT on top of the vatable
   // lines. Residential tenants do not, which is why this is off by default.
   '<div class="frow"><label style="align-self:flex-end" title="Adds VAT to this tenant\'s vatable lines">VAT registered<input id="t_vatable" type="checkbox"'+(t.vatable?" checked":"")+'></label>'+
   '<label>VAT no.<input id="t_vatno" value="'+esc(t.vatNo||"")+'" placeholder="CY…"></label>'+
   '<span class="hint" style="align-self:flex-end;flex:1;margin:0">Rent and charges are entered net; VAT is added on top at '+esc(String(vatRate()))+'%.</span></div>'+
   '<div style="font-size:12px;font-weight:700;color:#1e2a78;margin:6px 0">Standing charges <span style="font-weight:400;color:#94a3b8">— billed with the rent every month</span></div>'+
   '<div class="hint" style="margin:0 0 4px">Tick what this tenant pays on top of rent and set the usual amount. Every month starts from these; adjust a month\'s figure when the actual bill arrives. Annual and one-off charges are added to the month they fall in, not here.</div>'+
   '<div id="tchBox">'+chargePickerHtml(t)+'</div>'+
   '<div style="font-size:12px;font-weight:700;color:#1e2a78;margin:6px 0">Lease dates (history)</div><div id="leaseBox">'+leaseRows+'</div>'+
   '<div class="frow"><button class="ghost" data-h="addLeaseRow()">+ Add renewal period</button></div>'+
   '<div style="font-size:12px;font-weight:700;color:#1e2a78;margin:6px 0">Contacts</div>'+
   '<div class="frow"><label>Contact 1 name<input id="t_c1n" value="'+esc(t.contact1.name)+'"></label><label>Contact 1 phone<input id="t_c1p" value="'+esc(t.contact1.phone)+'"></label></div>'+
   '<div class="frow"><label>Contact 2 name<input id="t_c2n" value="'+esc(t.contact2.name)+'"></label><label>Contact 2 phone<input id="t_c2p" value="'+esc(t.contact2.phone)+'"></label></div>'+
   '<div class="frow"><label>Email<input id="t_email" value="'+esc(t.email)+'"></label></div>'+
   '<div class="frow" style="justify-content:flex-end;margin-top:8px"><button class="ghost" data-h="closeModal()">Cancel</button> <button class="primary" data-h="saveTenant('+(id==null?"null":id)+')">Save</button></div></div></div>';
  document.getElementById("t_elec").value=t.electricity==null?"":(t.electricity?"1":"0");
  window._leaseDraft=JSON.parse(JSON.stringify(t.leases));
};
window.addLeaseRow=function(){ collectLeases(); window._leaseDraft.push({start:"",renewal:"",end:""}); const box=document.getElementById("leaseBox");
  const i=window._leaseDraft.length-1; const div=document.createElement("div"); div.className="frow";
  div.innerHTML='<label>Prev/new start<input class="lz" data-k="start" data-i="'+i+'" type="date"></label><label>Renewal<input class="lz" data-k="renewal" data-i="'+i+'" type="date"></label><label>End<input class="lz" data-k="end" data-i="'+i+'" type="date"></label>';
  box.appendChild(div); };
/* Standing-charge picker on the tenant form: every monthly charge type with a
   tick and an amount, plus select-all. Annual/one-off types are deliberately
   absent — they belong to a month, not to every month. */
function chargePickerHtml(t){
  const types=chargeTypes().filter(c=>c.kind==="monthly");
  if(!types.length)return '<div class="hint">No monthly charge types yet — add them in Settings → Charge types.</div>';
  const has=(id)=>(t.charges||[]).find(c=>+c.typeId===+id);
  return '<div class="frow" style="gap:6px;margin-bottom:2px"><button class="ghost" type="button" data-h="tchAll(1)">Select all</button> <button class="ghost" type="button" data-h="tchAll(0)">Clear all</button></div>'+
    types.map(ct=>{ const cur=has(ct.id);
      return '<div class="frow" style="align-items:flex-end"><label style="flex:1;flex-direction:row;align-items:center;gap:8px">'+
        '<input type="checkbox" class="tch" data-id="'+ct.id+'"'+(cur?" checked":"")+'> '+esc(ct.name)+'</label>'+
        '<label>Amount (€)<input class="tcha" data-id="'+ct.id+'" type="number" step="0.01" value="'+esc(cur?cur.amount:"")+'"></label></div>';
    }).join("");
}
window.tchAll=function(on){ document.querySelectorAll(".tch").forEach(cb=>{ cb.checked=!!on; }); };
function collectTenantCharges(){
  const out=[];
  document.querySelectorAll(".tch").forEach(cb=>{
    if(!cb.checked)return;
    const id=+cb.dataset.id;
    const amt=document.querySelector('.tcha[data-id="'+id+'"]');
    out.push({typeId:id,amount:num(amt?amt.value:0)});
  });
  return out;
}
function collectLeases(){ const arr=window._leaseDraft.map(x=>({start:x.start,renewal:x.renewal,end:x.end}));
  document.querySelectorAll(".lz").forEach(inp=>{ const i=+inp.dataset.i,k=inp.dataset.k; if(!arr[i])arr[i]={start:"",renewal:"",end:""}; arr[i][k]=inp.value; });
  window._leaseDraft=arr; return arr; }
window.saveTenant=function(id){ const g=k=>document.getElementById(k).value; const leases=collectLeases().filter(L=>L.start||L.end||L.renewal); if(!leases.length)leases.push({start:"",renewal:"",end:""});
  const o={propertyId:num(g("t_prop")),unit:g("t_unit").trim(),name:g("t_name").trim(),rent:num(g("t_rent")),deposit:num(g("t_deposit")),
    electricity:(g("t_elec")===""?null:g("t_elec")==="1"),vacantFrom:g("t_vacant"),leases:leases,charges:collectTenantCharges(),contact1:{name:g("t_c1n").trim(),phone:g("t_c1p").trim()},contact2:{name:g("t_c2n").trim(),phone:g("t_c2p").trim()},email:g("t_email").trim(),
    vatable:!!(document.getElementById("t_vatable")||{}).checked, vatNo:g("t_vatno")};
  const clash=DATA.tenants.find(x=>x.id!==id && x.propertyId===o.propertyId && (x.unit||"")===o.unit && o.unit && x.name && x.name!=="NO TENANT");
  if(clash && !confirm("Unit “"+o.unit+"” is already assigned to "+clash.name+". Assign it here anyway?")) return;
  if(id==null){const t={id:nextTid(),agreements:[],pay:{}};Object.assign(t,o);ensureYear(t,"2026");DATA.tenants.push(t);} else Object.assign(DATA.tenants.find(x=>x.id===id),o);
  persist((id==null?"Added":"Edited")+" tenant — "+o.name); closeModal();render();flash("Tenant saved."); };
window.delTenant=function(id){ if(!isAdmin()){alert("Only admins can delete tenants.");return;} const t=DATA.tenants.find(x=>x.id===id); if(!confirm("Delete "+(t.name||"tenant")+"?"))return; DATA.tenants=DATA.tenants.filter(x=>x.id!==id); persist("Deleted tenant — "+t.name);render();flash("Deleted."); };
window.closeModal=function(){ document.body.classList.remove("doc-window"); document.getElementById("modalHost").innerHTML=""; };
function nextTid(){ return DATA.tenants.reduce((m,t)=>Math.max(m,t.id||0),0)+1; }
function unitTaken(propId,unit,exceptId){ return DATA.tenants.some(x=>x.id!==exceptId && x.propertyId===propId && (x.unit||"")===unit && x.name && x.name!=="NO TENANT"); }
function unitOptions(propId,current){ const p=propById(propId); const set=[]; if(p&&p.unitNames)p.unitNames.forEach(u=>{ if(u&&set.indexOf(u)<0)set.push(u); }); if(current&&set.indexOf(current)<0)set.push(current);
  return '<option value=""></option>'+set.map(u=>{ const taken=unitTaken(propId,u,current&&u===current?-999:0)&&u!==current; return '<option value="'+esc(u)+'"'+(u===current?' selected':'')+'>'+esc(u)+(taken?' — (occupied)':'')+'</option>'; }).join(""); }
window.rebuildUnitOptions=function(){ const pid=num(document.getElementById("t_prop").value); const sel=document.getElementById("t_unit"); sel.innerHTML=unitOptions(pid,""); };

/* ---- PDF agreement ---- */
window.attachPdf=function(id){ pdfTargetId=id; document.getElementById("pdfInput").click(); };
function onPdfPicked(e){ const f=e.target.files[0]; if(!f||pdfTargetId==null)return; const rd=new FileReader();
  rd.onload=ev=>{ const t=DATA.tenants.find(x=>x.id===pdfTargetId); if(!t)return;
    flash("Uploading "+f.name+"…");
    filesRequest("upload",{name:f.name,mime:f.type||"application/pdf",data:ev.target.result}).then(function(r){
      if(!r||!r.ok){ alert("That agreement was not saved.\n\n"+((r&&r.error)||"Upload failed.")); return; }
      if(!t.agreements)t.agreements=[];
      // Only a reference is kept — the file itself is in Storage now.
      t.agreements.push({name:r.file.name,path:r.file.path,size:r.file.size,mime:r.file.mime,uploaded:stamp(new Date())});
      persist("Attached agreement — "+t.name); render(); flash("Agreement attached: "+f.name);
    });
    e.target.value=""; };
  rd.readAsDataURL(f); }
window.viewAgreement=function(id,idx){ const t=DATA.tenants.find(x=>x.id===id); const ag=(t.agreements||[])[idx||0]; if(!ag){alert("No agreement attached.");return;}
  // Stored file: ask the host for a short-lived signed link. A window opened
  // inside the .then() would be caught by the pop-up blocker (no longer a user
  // gesture by then), so it is opened now and pointed at the URL when it lands.
  if(ag.path){ const w=window.open("","_blank");
    filesRequest("sign",{path:ag.path}).then(function(r){
      if(r&&r.ok&&r.url){ if(w)w.location.href=r.url; else window.open(r.url,"_blank"); }
      else { if(w)w.close(); alert("That agreement could not be opened.\n\n"+((r&&r.error)||"Not found.")); }
    });
    return; }
  // Legacy: agreements embedded before the move to Storage.
  if(!ag.dataUrl){ alert("No file is attached to this agreement."); return; }
  try{ const parts=ag.dataUrl.split(","); const bin=atob(parts[1]); const arr=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++)arr[i]=bin.charCodeAt(i);
    const blob=new Blob([arr],{type:"application/pdf"}); const url=URL.createObjectURL(blob); window.open(url,"_blank"); }
  catch(err){ window.open(ag.dataUrl,"_blank"); } };
window.removeAgreement=function(id,idx){ if(!isAdmin()){alert("Only admins can remove agreements.");return;} const t=DATA.tenants.find(x=>x.id===id); const ag=(t.agreements||[])[idx]; if(!ag)return; if(!confirm("Remove agreement '"+ag.name+"'?"))return;
  const path=ag.path; t.agreements.splice(idx,1); persist("Removed agreement — "+t.name); render(); flash("Agreement removed.");
  // The document is saved first, then the object dropped. The other order risks
  // a reference pointing at a file that is already gone; this way the worst case
  // is an unreferenced object, which costs a little space and nothing else.
  if(path)filesRequest("remove",{path:path}); };

/* ---- Rent Schedule (multi-receipt) ---- */
var schedSort="tenant";
function sortedTenants(){ const arr=DATA.tenants.slice();
  if(schedSort==="property") arr.sort((a,b)=>{ const pa=(propById(a.propertyId)||{}).name||"zzz", pb=(propById(b.propertyId)||{}).name||"zzz"; return pa.localeCompare(pb)||(a.unit||"").localeCompare(b.unit||"",undefined,{numeric:true})||(a.name||"").localeCompare(b.name||""); });
  else if(schedSort==="rent") arr.sort((a,b)=>(b.rent||0)-(a.rent||0)||(a.name||"").localeCompare(b.name||""));
  else arr.sort((a,b)=>(a.name||"").localeCompare(b.name||""));
  return arr; }
function vSchedule(){
  const y=yr(), cap=capM(y);
  // Three actions: take money in (Receipts), bill it out (Invoice), print or
  // send it (Reports). Sorting sits with them rather than on its own line.
  let h='<div class="panel">'+
    '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><h3 style="margin:0">Rent Schedule '+y+'</h3>'+
    (canEdit()?'<button class="ghost" data-h="openReceipt()">💶 Receipts</button>'+
      '<span class="menuwrap"><button class="ghost" data-h="toggleMenu(&#39;mInv&#39;)">🧾 Invoice ▾</button>'+
        '<div class="menu" id="mInv">'+
          '<button data-h="openRentEditor()">Enter / adjust rents</button>'+
          '<button data-h="openPeriods()">Close / reopen a period</button>'+
          chargeTypes().map(function(c){return '<button data-h="openChargeEditor('+c.id+')">Enter / adjust '+esc(c.name.toLowerCase())+'</button>';}).join('')+
        '</div></span>'+
      '<span class="menuwrap"><button class="ghost" data-h="toggleMenu(&#39;mRep&#39;)">📄 Reports ▾</button>'+
        '<div class="menu" id="mRep">'+
          '<button data-h="goTab(&#39;invoice&#39;)">Tenant invoices</button>'+
          '<button data-h="goTab(&#39;statement&#39;)">Tenant statements</button>'+
          '<button data-h="openSendDoc(&#39;invoice&#39;)">Email an invoice</button>'+
          '<button data-h="openSendDoc(&#39;statement&#39;)">Email a statement</button>'+
        '</div></span>':'')+
    '<span style="flex:1"></span>'+
    '<span style="font-size:12px;color:#64748b">Sort by <select id="schSort"><option value="tenant"'+(schedSort==="tenant"?" selected":"")+'>Tenant name</option><option value="property"'+(schedSort==="property"?" selected":"")+'>Property</option><option value="rent"'+(schedSort==="rent"?" selected":"")+'>Rent (high to low)</option></select></span>'+
    '</div>'+
    '<div class="hint">'+(canEdit()?"Click a month to set that tenant’s rent, charges and receipts. ":"")+'“due” is rent plus that month’s charges — hover it for the split. Only due months up to the current period are shown; future rent is not flagged as unpaid.</div>'+
    '<div class="tblwrap freeze"><table><thead><tr><th>Tenant</th><th class="num">Rent</th>'+MONTHS.map((m,i)=>'<th class="num" title="'+(isClosed(y,i)?"Period closed":"")+'">'+m+(isClosed(y,i)?' \u{1F512}':'')+'</th>').join("")+'</tr></thead><tbody>';
  sortedTenants().forEach(t=>{ const _p=propById(t.propertyId); h+='<tr><td><button class="linkish" data-h="openTenant('+t.id+')" title="Open this tenant\u2019s year">'+esc(t.name)+'</button><div style="font-size:11px;color:#94a3b8">'+esc(t.unit)+(_p?' · '+esc(_p.name):'')+'</div></td><td class="num">'+money(t.rent)+'</td>';
    for(let m=0;m<12;m++){ const st=statusOf(t,y,m); const pa=paidAll(t,y,m); const rd=dueTotal(t,y,m); const ch=chargesTotal(t,y,m);
      let disp;
      if(st==="NA"){ disp='<span class="st NA">—</span>'; }
      else if(st==="VACANT"){ disp='<span class="st NA">vacant</span>'; }
      else { // Just the month's bill and how it stands. The breakdown — rent,
        // each charge, every receipt — is on the tenant's own screen.
        const amt='<div style="font-weight:600;line-height:1.3" title="'+(ch?'Rent '+money(rentOf(t,y,m))+' + charges '+money(ch):'Rent only')+'">'+money(rd)+'</div>';
        const pill=(st==="UPCOMING")?'<span class="st UPCOMING">upcoming</span>':'<span class="st '+st+'">'+st.toLowerCase()+'</span>';
        disp=amt+pill; }
      const clk=canEdit()?' style="cursor:pointer" data-h="openReceipts('+t.id+','+m+')"':'';
      h+='<td class="num" style="vertical-align:top"'+clk+'>'+disp+'</td>'; }
    h+='</tr>'; });
  h+='<tr class="total"><td>Collected</td><td></td>';
  for(let m=0;m<12;m++){ let c=0; DATA.tenants.forEach(t=>c+=paid(t,y,m)); h+='<td class="num">'+money(c)+'</td>'; }
  h+='</tr></tbody></table></div></div>';
  document.getElementById("view").innerHTML=h;
  const ss=document.getElementById("schSort"); if(ss)ss.onchange=e=>{schedSort=e.target.value;render();};
}
window.openReceipts=function(id,m){ if(!canEdit())return; if(!assertOpen(yr(),m))return; const y=yr(); const t=DATA.tenants.find(x=>x.id===id); const recs=ensureYear(t,y)[m].receipts;
  // "Applies to" is the month the receipt SETTLES, which is not always the
  // month it arrived in — February's rent paid in March belongs against
  // February. Changing it moves the receipt to that month on save.
  const moveOpts=(sel)=>MONTHS.map((mn,mi)=>'<option value="'+mi+'"'+(mi===sel?" selected":"")+'>'+mn+'</option>').join("");
  const yearOpts=(sel)=>yearList().map(yy=>'<option value="'+yy+'"'+(String(yy)===String(sel)?" selected":"")+'>'+yy+'</option>').join("");
  let rows=recs.map((r,i)=>'<div class="frow" data-r="'+i+'"><label>Date<input class="rz" data-k="date" data-i="'+i+'" type="date" value="'+esc(r.date)+'"></label><label>Reference<input class="rz" data-k="ref" data-i="'+i+'" value="'+esc(r.ref)+'"></label><label>Amount (€)<input class="rz" data-k="amount" data-i="'+i+'" type="number" value="'+esc(r.amount)+'"></label><label>Type<select class="rz" data-k="cat" data-i="'+i+'">'+catOptions(r.cat)+'</select></label><label>Applies to<select class="rz" data-k="mv" data-i="'+i+'">'+moveOpts(m)+'</select></label><label>Year<select class="rz" data-k="mvy" data-i="'+i+'">'+yearOpts(y)+'</select></label><button class="iconbtn" data-h="rmReceipt('+id+','+m+','+i+')">🗑</button></div>').join("");
  window._mcharges=monthCharges(t,y,m).map(c=>({typeId:c.typeId,amount:c.amount}));
  window._mchTenant=t;
  document.getElementById("modalHost").innerHTML='<div class="modal"><div class="box" style="width:min(760px,96vw)"><h3>'+esc(t.name)+' · '+MONTHS[m]+' '+y+'</h3>'+
    '<div class="frow"><label>Rent charged this month<input id="rentOv" type="number" value="'+esc(rentOf(t,y,m))+'"></label><label>&nbsp;<span class="hint" style="margin:0">Agreement rent: '+money(t.rent)+'. Change here to override just this month.</span></label></div>'+
    '<div style="border-top:1px solid #e2e8f0;margin:10px 0 8px;padding-top:10px"><b style="font-size:13px">Charges for this month</b>'+
      '<div class="hint">Starts from the tenant\'s standing charges — change an amount, or add the ones that vary (electricity, water) when the bill arrives. Together with the rent this is what the tenant owes for '+MONTHS[m]+'.</div>'+
      '<div id="chBox"></div><div id="chAdd"></div></div>'+
    '<div class="hint">Receipts below — edit them or add extra lines. Allocate each one to rent or to a charge.</div><div id="recBox">'+(rows||'<div class="hint">No receipts yet.</div>')+'</div>'+
    '<div class="frow"><button class="ghost" data-h="addReceiptRow('+id+','+m+')">+ Add receipt line</button></div>'+
    '<div class="frow" style="justify-content:flex-end;margin-top:6px"><button class="ghost" data-h="closeModal()">Cancel</button> <button class="primary" data-h="saveReceipts('+id+','+m+')">Save</button></div></div></div>';
  renderMCharges();
};

/* The month's charge lines, plus the picker for adding more. Kept in
   window._mcharges while the modal is open so amounts survive a re-render. */
function renderMCharges(){
  const L=window._mcharges||[];
  const box=document.getElementById("chBox"); if(!box)return;
  box.innerHTML = L.length
    ? L.map((c,i)=>'<div class="frow" style="align-items:flex-end"><label style="flex:1">'+esc(ctName(c.typeId))+
        '<input class="chz" data-i="'+i+'" type="number" step="0.01" value="'+esc(c.amount)+'"></label>'+
        '<button class="iconbtn" data-h="rmMCharge('+i+')" title="Remove this charge">🗑</button></div>').join("")
    : '<div class="hint">No charges this month — rent only.</div>';
  const avail=chargeTypes().filter(ct=>!L.some(c=>+c.typeId===+ct.id));
  const add=document.getElementById("chAdd");
  add.innerHTML = avail.length
    ? '<div class="frow" style="align-items:flex-end"><label style="flex:1">Add a charge<select id="chPick">'+
        avail.map(ct=>'<option value="'+ct.id+'">'+esc(ct.name)+(ct.kind==="annual"?" (annual)":"")+'</option>').join("")+
        '</select></label><button class="ghost" data-h="addMCharge()">+ Add</button> <button class="ghost" data-h="addMCharge(\'all\')">Add all</button></div>'
    : '<div class="hint">Every charge type is already on this month. Add more types in Settings → Charge types.</div>';
}
// Amounts live in the inputs until something re-renders the list.
function collectMCharges(){ document.querySelectorAll(".chz").forEach(inp=>{ const i=+inp.dataset.i; if(window._mcharges[i])window._mcharges[i].amount=inp.value; }); }
window.addMCharge=function(which){
  collectMCharges();
  const L=window._mcharges;
  // A standing charge carries its agreed amount over; anything else starts blank.
  const amountFor=(id)=>{ const t=window._mchTenant; const st=t&&(t.charges||[]).find(c=>+c.typeId===+id); return st?num(st.amount):""; };
  if(which==="all"){ chargeTypes().forEach(ct=>{ if(!L.some(c=>+c.typeId===+ct.id))L.push({typeId:ct.id,amount:amountFor(ct.id)}); }); }
  else { const p=document.getElementById("chPick"); if(!p)return; const id=+p.value; if(!L.some(c=>+c.typeId===id))L.push({typeId:id,amount:amountFor(id)}); }
  renderMCharges();
};
window.rmMCharge=function(i){ collectMCharges(); window._mcharges.splice(i,1); renderMCharges(); };
window.addReceiptRow=function(id,m){ saveReceiptsDraft(id,m); const y=yr(); ensureYear(DATA.tenants.find(x=>x.id===id),y)[m].receipts.push({date:"",ref:"",amount:""}); openReceipts(id,m); };
window.rmReceipt=function(id,m,i){ const y=yr(); ensureYear(DATA.tenants.find(x=>x.id===id),y)[m].receipts.splice(i,1); openReceipts(id,m); };
function saveReceiptsDraft(id,m){ const y=yr(); const recs=ensureYear(DATA.tenants.find(x=>x.id===id),y)[m].receipts;
  document.querySelectorAll(".rz").forEach(inp=>{ const i=+inp.dataset.i,k=inp.dataset.k; if(recs[i])recs[i][k]=(k==="amount"?inp.value:inp.value); }); }
/* Work out what a save does to a month's receipts: which stay, which are
   re-allocated to another month, and which cannot move because the month they
   point at is closed. Blank lines are dropped. Pure — no DOM, no writes — so
   the rule can be checked directly. */
function planReceiptMoves(list, y, m){
  var keep=[], moved=[], blocked=[];
  var years=yearList().map(String);
  (list||[]).forEach(function(r){
    var rec={date:r.date,ref:r.ref,amount:num(r.amount),cat:r.cat||"Rent"};
    if(rec.amount===0 && !rec.date && !rec.ref) return;
    var to=(r.mv===undefined||r.mv===null||r.mv==="")?m:+r.mv;
    if(!(to>=0&&to<=11)) to=m;
    // The year it settles need not be the year it arrived in: a receipt taken
    // on 28 December can be rent for the January that follows.
    var toY=(r.mvy===undefined||r.mvy===null||r.mvy==="")?String(y):String(r.mvy);
    if(years.indexOf(toY)<0) toY=String(y);
    if(to===m && toY===String(y)){ keep.push(rec); return; }
    if(isClosed(toY,to)){ blocked.push(MONTHS[to]+" "+toY); keep.push(rec); return; }
    moved.push({to:to,toY:toY,rec:rec});
  });
  return {keep:keep, moved:moved, blocked:blocked};
}
window.saveReceipts=function(id,m){ saveReceiptsDraft(id,m); const y=yr(); const t=DATA.tenants.find(x=>x.id===id);
  // Split the lines into the ones staying here and the ones re-allocated to
  // another month. A closed month is not a valid destination — it has been
  // reported — so those stay put and are reported back.
  var plan=planReceiptMoves(t.pay[y][m].receipts,y,m);
  var keep=plan.keep, moved=plan.moved, blocked=plan.blocked;
  t.pay[y][m].receipts=keep;
  moved.forEach(function(x){ ensureYear(t,x.toY||y)[x.to].receipts.push(x.rec); });
  const ov=document.getElementById("rentOv"); if(ov){ const v=ov.value.trim(); if(v===""||num(v)===(t.rent||0)) delete t.pay[y][m].rent; else t.pay[y][m].rent=num(v); }
  // Charges are written on the month once it has been edited, so this month
  // stops following later changes to the tenant's standing charges. Matching
  // the standing set exactly means there is nothing to pin — leave it
  // following, so a change to the agreement still flows through.
  if(document.getElementById("chBox")){
    collectMCharges();
    const L=(window._mcharges||[]).map(c=>({typeId:+c.typeId,amount:num(c.amount)})).filter(c=>ctById(c.typeId));
    const std=standingCharges(t).map(c=>({typeId:+c.typeId,amount:num(c.amount)}));
    const same=L.length===std.length && L.every(c=>std.some(s=>s.typeId===c.typeId&&s.amount===c.amount));
    if(same) delete t.pay[y][m].charges; else t.pay[y][m].charges=L;
  }
  window._mcharges=null; window._mchTenant=null;
  persist("Edited month — "+t.name+" · "+MONTHS[m]+" "+y); closeModal(); render();
  flash(moved.length
    ? moved.length+" receipt(s) moved to "+[...new Set(moved.map(function(x){return MONTHS[x.to]+" "+(x.toY||y);}))].join(", ")
      +(blocked.length?" · "+[...new Set(blocked)].join(", ")+" is closed, left as it was":"")
    : (blocked.length?"Saved · "+[...new Set(blocked)].join(", ")+" is closed, that receipt was left as it was":"Saved.")); };

/* ---- Sending an invoice or statement ---------------------------------------
   The app does not send mail itself: it saves the document as a PDF and opens
   a message in whatever mail program this machine uses, addressed to the
   tenant with the subject and covering note filled in. You attach the PDF that
   just downloaded and press send, so nothing leaves without you seeing it, and
   the mail comes from your own address rather than the portal's. */

// Snapshot a rendered document node into an A4 PDF and save it.
function savePdf(nodeId, filename, done){
  var node=document.getElementById(nodeId)||document.querySelector("."+nodeId);
  if(!node){ alert("Open the document first, then send it."); return; }
  var jsPDFctor=(window.jspdf&&window.jspdf.jsPDF)||window.jsPDF;
  if(!window.html2canvas||!jsPDFctor){ alert("PDF support did not load - use Print / PDF instead."); return; }
  window.html2canvas(node,{scale:2,backgroundColor:"#ffffff",useCORS:true}).then(function(canvas){
    var pdf=new jsPDFctor({unit:"mm",format:"a4",orientation:"portrait"});
    var pw=pdf.internal.pageSize.getWidth(), ph=pdf.internal.pageSize.getHeight();
    var margin=10, iw=pw-margin*2;
    var ih=canvas.height*iw/canvas.width;
    var img=canvas.toDataURL("image/jpeg",0.92);
    if(ih<=ph-margin*2){ pdf.addImage(img,"JPEG",margin,margin,iw,ih); }
    else {
      // Taller than a page: walk down the image a page at a time.
      var pageH=ph-margin*2, drawn=0;
      while(drawn<ih){
        pdf.addImage(img,"JPEG",margin,margin-drawn,iw,ih);
        drawn+=pageH;
        if(drawn<ih)pdf.addPage();
      }
    }
    pdf.save(filename);
    if(done)done();
  }).catch(function(e){ alert("Could not build the PDF: "+(e&&e.message?e.message:e)); });
}

// Pick who and what, then hand off to the mail program.
window.openSendDoc=function(kind){
  if(!DATA.tenants.length){ alert("No tenants yet."); return; }
  var isInv=(kind==="invoice");
  var ys=yearList(), now=new Date();
  var tid=(isInv?invTenant:stmtTenant)||DATA.tenants[0].id;
  document.getElementById("modalHost").innerHTML='<div class="modal"><div class="box" style="width:min(620px,96vw)"><h3>Email '+(isInv?"an invoice":"a statement")+'</h3>'+
    '<div class="hint">The document is saved as a PDF and a message opens in your mail program, addressed to the tenant. Attach the PDF that just downloaded, then send.</div>'+
    '<div class="frow"><label>Tenant<select id="sd_t" style="min-width:260px">'+tenantOpts(tid)+'</select></label></div>'+
    (isInv?'<div class="frow"><label>Year<select id="sd_y">'+ys.map(function(y){return '<option'+(y===String(now.getFullYear())?" selected":"")+'>'+y+'</option>';}).join("")+'</select></label>'+
      '<label>Month<select id="sd_m">'+MONTHS.map(function(mn,i){return '<option value="'+i+'"'+(i===now.getMonth()?" selected":"")+'>'+mn+'</option>';}).join("")+'</select></label></div>':'')+
    '<div class="frow" style="justify-content:flex-end;margin-top:8px"><button class="ghost" data-h="closeModal()">Cancel</button> <button class="primary" data-h="sendDoc(&#39;'+kind+'&#39;)">Prepare email</button></div>'+
    '</div></div>';
};
window.sendDoc=function(kind){
  var isInv=(kind==="invoice");
  var tid=+document.getElementById("sd_t").value;
  var t=DATA.tenants.find(function(x){return x.id===tid;});
  if(!t){ alert("Pick a tenant."); return; }
  if(isInv){ invTenant=tid; invYear=document.getElementById("sd_y").value; invMonth=+document.getElementById("sd_m").value; activeTab="invoice"; }
  else { stmtTenant=tid; activeTab="statement"; }
  closeModal(); render();
  // Let the document paint before it is captured.
  setTimeout(function(){
    var s=DATA.settings||{}, cn=s.companyName||(DATA.meta&&DATA.meta.client)||"";
    var period=isInv?(MONTHS[invMonth]+" "+invYear):((stmtFrom||"")+" to "+(stmtTo||""));
    var who=String(t.name||"tenant").replace(/[^\w]+/g,"_").replace(/^_+|_+$/g,"");
    var file=who+"-"+(isInv?"invoice-"+invYear+p2(invMonth+1):"statement")+".pdf";
    savePdf(isInv?"invoice-doc":"stmt-doc", file, function(){
      var subject=(isInv?"Invoice":"Statement")+" - "+period+(cn?" - "+cn:"");
      var body="Dear "+(t.contact1&&t.contact1.name?t.contact1.name:t.name)+","+
        "\n\nPlease find attached your "+(isInv?"invoice":"statement")+" for "+period+"."+
        (isInv?"\n\nAmount due: "+money(dueTotal(t,invYear,invMonth)):"")+
        (s.bank?"\n\nPayment details: "+s.bank:"")+
        "\n\nKind regards,\n"+cn;
      var href="mailto:"+encodeURIComponent(t.email||"")+"?subject="+encodeURIComponent(subject)+"&body="+encodeURIComponent(body);
      // The frame is sandboxed, so the parent opens the mail program.
      if(window.parent!==window){ try{ window.parent.postMessage({type:"mailto",href:href},"*"); }catch(e){} }
      else { window.location.href=href; }
      flash(t.email?"PDF saved - attach it to the message that just opened.":"PDF saved - no email address on file for this tenant, add one on their record.");
    });
  }, 400);
};

/* ---- Receipts: one screen to enter a payment ------------------------------
   Entering and splitting are the same job, so they are the same screen: put in
   what arrived, and allocate it across whatever it settles - several months,
   several tenants, rent or charges, in any combination.

   A receipt can settle a month in another YEAR — December's payment is often
   January's rent — so both the month and the year are chosen per line.

   Allocation follows the matching principle: money is applied to the OLDEST
   outstanding month first, rent before charges, so a payment clears the debt
   it was actually for rather than the month it happened to arrive in. The
   proposal is editable - nothing is written until you save. */

// Every unsettled (month, category) for a tenant, oldest first.
function outstandingLines(t){
  var out=[]; var ys=yearList();
  ys.forEach(function(y){
    var cap=capM(y);
    for(var m=0;m<=Math.min(cap,11);m++){
      if(!due(t,y,m))continue;
      if(isClosed(y,m))continue; // settled and locked
      // Gross, not net: money received settles what was actually billed, so a
      // vatable line is only clear once the VAT on it has been paid too.
      var rentBal=rentGross(t,y,m)-paidCat(t,y,m,"Rent");
      if(rentBal>0.005)out.push({y:y,m:m,cat:"Rent",bal:rentBal});
      monthCharges(t,y,m).forEach(function(c){
        var nm=ctName(c.typeId);
        var bal=chargeGross(t,c)-paidCat(t,y,m,nm);
        if(bal>0.005)out.push({y:y,m:m,cat:nm,bal:bal});
      });
    }
  });
  return out;
}
// Spread an amount over a tenant's arrears, oldest first.
function proposeAllocation(tid,amount){
  var t=DATA.tenants.find(function(x){return x.id==tid;});
  if(!t)return [];
  var left=num(amount), lines=[];
  outstandingLines(t).forEach(function(o){
    if(left<=0.005)return;
    var take=Math.min(left,o.bal); left-=take;
    lines.push({tid:tid,y:o.y,m:o.m,cat:o.cat,amount:Math.round(take*100)/100});
  });
  // Anything above what is owed still has to land somewhere: the current month.
  if(left>0.005){
    // Land the surplus on the newest month that is still open.
    var y=yr(), m=Math.max(0,capM(y));
    while(m>0&&isClosed(y,m))m--;
    if(!isClosed(y,m))lines.push({tid:tid,y:y,m:m,cat:"Rent",amount:Math.round(left*100)/100});
  }
  return lines;
}

window.openReceipt=function(){
  if(!canEdit())return;
  window._rcpt={date:todayIso(),ref:"",total:"",tid:"",lines:[]};
  renderReceipt();
};
function renderReceipt(){
  var R=window._rcpt;
  var ys=yearList();
  var rows=R.lines.map(function(l,i){
    return '<tr>'+
      '<td><select class="rcz" data-k="tid" data-i="'+i+'" style="width:100%;min-width:210px">'+tenantOpts(l.tid)+'</select></td>'+
      '<td><select class="rcz" data-k="y" data-i="'+i+'">'+ys.map(function(y){return '<option'+(String(l.y)===String(y)?" selected":"")+'>'+y+'</option>';}).join("")+'</select></td>'+
      '<td><select class="rcz" data-k="m" data-i="'+i+'">'+MONTHS.map(function(mn,mi){return '<option value="'+mi+'"'+(+l.m===mi?" selected":"")+'>'+mn+'</option>';}).join("")+'</select></td>'+
      '<td><select class="rcz" data-k="cat" data-i="'+i+'">'+catOptions(l.cat)+'</select></td>'+
      '<td class="num"><input class="rcz num" data-k="amount" data-i="'+i+'" type="number" step="0.01" value="'+esc(l.amount)+'" style="width:100px"></td>'+
      '<td><button class="iconbtn" data-h="rmRcptLine('+i+')">&#128465;</button></td></tr>';
  }).join("");
  var alloc=R.lines.reduce(function(a,l){return a+num(l.amount);},0);
  var tot=num(R.total);
  var diff=Math.round((tot-alloc)*100)/100;
  document.getElementById("modalHost").innerHTML='<div class="modal"><div class="box" style="width:min(1000px,97vw)"><h3>Enter a receipt</h3>'+
    '<div class="hint">Put in the payment, pick the tenant, then <b>Match</b> &mdash; it is applied to the oldest unpaid month first, rent before charges. Change any line, or add lines to split one payment across several tenants or months.</div>'+
    '<div class="frow">'+
      '<label>Date received<input id="rc_date" type="date" value="'+esc(R.date)+'"></label>'+
      '<label>Reference<input id="rc_ref" value="'+esc(R.ref)+'" placeholder="bank ref / cash"></label>'+
      '<label>Amount received (&euro;)<input id="rc_total" type="number" step="0.01" value="'+esc(R.total)+'"></label>'+
      '<label>Paid by<select id="rc_tid" style="min-width:220px">'+tenantOpts(R.tid)+'</select></label>'+
      '<label>&nbsp;<button class="primary" data-h="matchReceipt()">&#8627; Match</button></label>'+
    '</div>'+
    '<div class="tblwrap"><table style="width:100%"><thead><tr><th>Tenant / unit</th><th>Year</th><th>Month</th><th>Applied to</th><th class="num">Amount</th><th></th></tr></thead><tbody>'+
      (rows||'<tr><td colspan="6" class="hint">Nothing allocated yet &mdash; enter the amount and tenant, then press Match.</td></tr>')+
    '</tbody></table></div>'+
    '<div class="frow" style="align-items:center;margin-top:6px">'+
      '<button class="ghost" data-h="addRcptLine()">+ Add a line</button>'+
      '<span class="hint" style="margin:0 0 0 10px">Allocated <b>'+money(alloc)+'</b> of '+(tot?money(tot):"&mdash;")+
        (tot&&Math.abs(diff)>0.005?' &middot; <span style="color:'+(diff>0?"#b45309":"#b91c1c")+'">'+(diff>0?money(diff)+" unallocated":money(-diff)+" over")+'</span>':"")+'</span>'+
      '<div style="flex:1"></div><button class="ghost" data-h="closeModal()">Cancel</button> <button class="primary" data-h="saveReceipt()">Save receipt</button></div>'+
    '</div></div>';
}
function collectReceipt(){
  var R=window._rcpt;
  var g=function(id){ var e=document.getElementById(id); return e?e.value:""; };
  R.date=g("rc_date")||R.date; R.ref=g("rc_ref"); R.total=g("rc_total"); R.tid=g("rc_tid");
  document.querySelectorAll(".rcz").forEach(function(inp){ var i=+inp.dataset.i,k=inp.dataset.k; if(R.lines[i])R.lines[i][k]=inp.value; });
}
window.matchReceipt=function(){
  collectReceipt();
  var R=window._rcpt;
  if(!R.tid){ alert("Choose who the payment came from."); return; }
  if(num(R.total)<=0){ alert("Enter the amount received."); return; }
  R.lines=proposeAllocation(R.tid,R.total);
  if(!R.lines.length){ alert("That tenant has nothing outstanding - add a line by hand to record the payment."); }
  renderReceipt();
};
window.addRcptLine=function(){ collectReceipt(); var R=window._rcpt; var y=yr(); R.lines.push({tid:R.tid||"",y:y,m:Math.max(0,capM(y)),cat:"Rent",amount:""}); renderReceipt(); };
window.rmRcptLine=function(i){ collectReceipt(); window._rcpt.lines.splice(i,1); renderReceipt(); };
window.saveReceipt=function(){
  collectReceipt();
  var R=window._rcpt;
  var dt=R.date||todayIso();
  var n=0;
  var blocked=[];
  R.lines.forEach(function(l){
    var amt=num(l.amount); if(!l.tid||amt===0)return;
    var t=DATA.tenants.find(function(x){return x.id==l.tid;}); if(!t)return;
    var y=String(l.y||yr()), m=+l.m||0;
    // A closed month is settled — nothing new may be posted into it.
    if(isClosed(y,m)){ blocked.push(MONTHS[m]+" "+y); return; }
    ensureYear(t,y)[m].receipts.push({date:dt,ref:R.ref||"",amount:amt,cat:l.cat||"Rent"});
    n++;
  });
  if(blocked.length){ alert("Nothing was saved: "+[...new Set(blocked)].join(", ")+" "+(blocked.length===1?"is a closed period":"are closed periods")+".\n\nAllocate to an open month, or reopen the period."); return; }
  if(!n){ alert("Nothing to save - allocate the payment first."); return; }
  var tot=num(R.total), alloc=R.lines.reduce(function(a,l){return a+num(l.amount);},0);
  window._rcpt=null;
  persist(n+" receipt allocation(s)");
  closeModal(); render();
  flash(n+" allocation(s) saved"+(tot&&Math.abs(tot-alloc)>0.5?" - received "+money(tot)+" vs allocated "+money(alloc):""));
};

/* ---- Closing a period -----------------------------------------------------
   Once the month's receipts are posted you close it, and nothing in it can be
   changed again: no rent or charge adjustments, no new receipts, no edits to
   the ones already there. Reopening is deliberate and admin-only, so a closed
   month is a statement of fact rather than a suggestion. Kept as a plain map
   of "YYYY-M" -> who closed it and when, so it travels with the data. */
function closedMap(){ if(!DATA.closed)DATA.closed={}; return DATA.closed; }
function isClosed(y,m){ return !!closedMap()[String(y)+"-"+m]; }
function closedInfo(y,m){ return closedMap()[String(y)+"-"+m]||null; }
// One place every writer asks before touching a month.
function assertOpen(y,m){
  if(!isClosed(y,m))return true;
  var c=closedInfo(y,m);
  alert(MONTHS[m]+" "+y+" is closed"+(c&&c.at?" (closed "+c.at.slice(0,10)+(c.by?" by "+c.by:"")+")":"")+".\n\nReopen the period first if it really has to change.");
  return false;
}

window.openPeriods=function(){
  if(!canEdit())return;
  var y=yr(), cap=capM(y);
  var rows=MONTHS.map(function(mn,m){
    var c=closedInfo(y,m);
    var recs=0, billed=0, out=0;
    DATA.tenants.forEach(function(t){
      if(!due(t,y,m))return;
      recs+=(ensureYear(t,y)[m].receipts||[]).length;
      billed+=dueTotal(t,y,m);
      out+=owed(t,y,m);
    });
    var future=(m>cap);
    return '<tr'+(future?' style="opacity:.5"':'')+'><td style="font-weight:600">'+mn+' '+y+'</td>'+
      '<td class="num">'+(billed?money(billed):"\u2014")+'</td>'+
      '<td class="num">'+recs+'</td>'+
      '<td class="num'+(out>0.005?" warn":"")+'">'+(out>0.005?money(out):"\u2014")+'</td>'+
      '<td>'+(c?'<span class="st PAID">closed</span><div style="font-size:10px;color:#94a3b8">'+esc((c.at||"").slice(0,10))+(c.by?" \u00B7 "+esc(c.by):"")+'</div>':'<span class="st UPCOMING">open</span>')+'</td>'+
      '<td class="actions">'+(c
        ? (isAdmin()?'<button class="ghost" data-h="reopenPeriod('+m+')">Reopen</button>':'<span class="hint" style="margin:0">admins only</span>')
        : (future?'<span class="hint" style="margin:0">not yet</span>':'<button class="ghost" data-h="closePeriod('+m+')">Close</button>'))+'</td></tr>';
  }).join("");
  document.getElementById("modalHost").innerHTML='<div class="modal"><div class="box" style="width:min(760px,96vw)"><h3>Periods \u2014 '+y+'</h3>'+
    '<div class="hint">Close a month once its receipts are posted: rent, charges and receipts in it are then locked. Outstanding balances do not stop a close \u2014 arrears carry on showing \u2014 but you cannot post into a closed month afterwards.</div>'+
    '<div class="tblwrap" style="max-height:60vh"><table style="width:100%"><thead><tr><th>Month</th><th class="num">Billed</th><th class="num">Receipts</th><th class="num">Outstanding</th><th>Status</th><th class="actions"></th></tr></thead><tbody>'+rows+'</tbody></table></div>'+
    '<div class="frow" style="justify-content:flex-end;margin-top:8px"><button class="ghost" data-h="closeModal()">Done</button></div></div></div>';
};
window.closePeriod=function(m){
  var y=yr();
  var out=0; DATA.tenants.forEach(function(t){ out+=owed(t,y,m); });
  var msg="Close "+MONTHS[m]+" "+y+"?\n\nRent, charges and receipts for that month can no longer be changed.";
  if(out>0.005)msg+="\n\nNote: "+money(out)+" is still outstanding for the month. Closing does not write it off \u2014 it stays in arrears \u2014 but later payments cannot be posted into "+MONTHS[m]+".";
  if(!confirm(msg))return;
  closedMap()[String(y)+"-"+m]={at:stamp(new Date()),by:(user?(user.name||user.username):"")};
  persist("Closed period "+MONTHS[m]+" "+y); closeModal(); render(); flash(MONTHS[m]+" "+y+" closed.");
};
window.reopenPeriod=function(m){
  if(!isAdmin()){ alert("Only an admin can reopen a period."); return; }
  var y=yr();
  if(!confirm("Reopen "+MONTHS[m]+" "+y+"? It becomes editable again."))return;
  delete closedMap()[String(y)+"-"+m];
  persist("Reopened period "+MONTHS[m]+" "+y); closeModal(); render(); flash(MONTHS[m]+" "+y+" reopened.");
};

/* ---- One tenant, one year ------------------------------------------------
   The schedule answers "how is everyone doing"; this answers "what is going on
   with this tenant" — what was billed each month, what came in against it, and
   what is left, without scrolling a wide grid to find them again. Every edit
   goes through the same month editor the schedule uses, so a change made here
   shows up everywhere. */
var ledgerTenant=null;
window.openTenant=function(id){ rememberSchedScroll(); ledgerTenant=id; activeTab="tenant"; render(); };
window.backToSchedule=function(){ ledgerTenant=null; activeTab="schedule"; render(); };

function vTenantLedger(){
  var t=DATA.tenants.find(function(x){return x.id===ledgerTenant;});
  if(!t){ backToSchedule(); return; }
  var y=yr(), cap=capM(y), p=propById(t.propertyId), L=curLease(t);

  var billed=0, recvd=0, out=0;
  var rows="";
  for(var m=0;m<12;m++){
    var isDue=due(t,y,m);
    var rent=isDue?rentOf(t,y,m):0;
    var ch=isDue?chargesTotal(t,y,m):0;
    var tot=isDue?dueTotal(t,y,m):0;
    var pa=paidAll(t,y,m);
    var recs=ensureYear(t,y)[m].receipts||[];
    var allRecv=recs.reduce(function(a,r){return a+num(r.amount);},0);
    var bal=tot-pa;
    var st=statusOf(t,y,m);
    var closed=isClosed(y,m);
    if(isDue&&m<=cap){ billed+=tot; recvd+=pa; out+=owed(t,y,m); }

    // What the charges are made of, so the month reads without opening it.
    var chBits=monthCharges(t,y,m).filter(function(c){return num(c.amount)!==0;})
      .map(function(c){return esc(ctName(c.typeId))+" "+money(num(c.amount));}).join(" · ");
    // Every receipt on the month, including anything allocated to a charge.
    var recBits=recs.length
      ? recs.map(function(r){ return '<div style="font-size:11px;color:#475569">'+esc(r.date||"")+
          (r.ref?" · "+esc(r.ref):"")+" · "+esc(catOf(r))+" <b>"+money(num(r.amount))+"</b></div>"; }).join("")
      : '<span style="color:#cbd5e1">—</span>';

    rows+='<tr'+(m>cap?' style="opacity:.55"':'')+'>'+
      '<td style="font-weight:600;white-space:nowrap">'+MONTHS[m]+' '+y+(closed?' <span title="Period closed">\u{1F512}</span>':'')+'</td>'+
      '<td class="num">'+(isDue?money(rent):"—")+'</td>'+
      '<td class="num">'+(ch?money(ch):"—")+(chBits?'<div style="font-size:10px;color:#94a3b8">'+chBits+'</div>':'')+'</td>'+
      '<td class="num" style="font-weight:600">'+(isDue?money(tot):"—")+'</td>'+
      '<td>'+recBits+(allRecv!==pa?'<div style="font-size:10px;color:#b45309">'+money(allRecv-pa)+' not against this month\u2019s bill</div>':'')+'</td>'+
      '<td class="num">'+(pa?money(pa):"—")+'</td>'+
      '<td class="num'+(bal>0.005&&m<=cap?" warn":"")+'">'+(isDue?(bal>0.005?money(bal):"paid"):"—")+'</td>'+
      '<td><span class="st '+st+'">'+(st==="NA"?"—":st.toLowerCase())+'</span></td>'+
      '<td class="actions" style="white-space:nowrap">'+
        (canEdit()&&!closed?'<button class="ghost" data-h="openReceipts('+t.id+','+m+')">Edit</button> ':'')+
        (isDue?'<button class="ghost" data-h="popInvoice('+t.id+',&#39;'+y+'&#39;,'+m+')">Invoice</button>':'')+
      '</td></tr>';
  }

  var h='<div class="panel"><div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">'+
    '<button class="ghost" data-h="backToSchedule()">\u2190 Rent schedule</button>'+
    '<h3 style="margin:0">'+esc(t.name)+'</h3>'+
    '<span class="hint" style="margin:0">'+esc(t.unit)+(p?' · '+esc(p.name):'')+' · lease '+esc(L.start||"?")+' \u2192 '+esc(L.end||"?")+'</span>'+
    '<span style="flex:1"></span>'+
    '<button class="ghost" data-h="openStatement('+t.id+')">Statement</button>'+
    (canEdit()?'<button class="ghost" data-h="openReceipt()">\u{1F4B6} Receipts</button>':'')+
    '</div>'+
    '<div class="hint">Everything billed to this tenant in '+y+' and everything received against it. Edits here are the same as editing the month in the schedule \u2014 they show up everywhere.</div></div>';

  h+='<div class="cards">'+
    card("Agreement rent",money(t.rent),"per month")+
    card("Billed "+y,money(billed),"rent + charges to "+(cap<0?"\u2014":MONTHS[cap]))+
    card("Received",money(recvd),"against those months")+
    card("Outstanding",money(out),(out>0.005?"owed":"up to date"))+
    card("Deposit held",money(netDeposit(t)),"net of refunds")+
    '</div>';

  h+='<div class="panel"><div class="tblwrap freeze"><table><thead><tr>'+
    '<th>Month</th><th class="num">Rent</th><th class="num">Charges</th><th class="num">Total due</th>'+
    '<th>Receipts</th><th class="num">Received</th><th class="num">Balance</th><th>Status</th><th class="actions"></th>'+
    '</tr></thead><tbody>'+rows+'</tbody></table></div></div>';

  document.getElementById("view").innerHTML=h;
}
window.openStatement=function(id){ stmtTenant=id; activeTab="statement"; render(); };

/* ---- Toolbar dropdowns ---- */
window.toggleMenu=function(id){
  var el=document.getElementById(id); if(!el)return;
  var wasOpen=el.classList.contains("open");
  document.querySelectorAll(".menu.open").forEach(function(m){ m.classList.remove("open"); });
  if(!wasOpen)el.classList.add("open");
};
// Any click that is not on a menu or the button that opened it closes them.
document.addEventListener("click",function(e){
  if(e.target.closest && (e.target.closest(".menu")||e.target.closest("[data-h^='toggleMenu']")))return;
  document.querySelectorAll(".menu.open").forEach(function(m){ m.classList.remove("open"); });
});

/* ---- Bulk charge editor: one charge type across every tenant and month ----
   The same grid as the rent editor, for common fees / electricity / water /
   refuse. A blank cell means the tenant's standing charge still applies; a
   figure pins that month. */
window.openChargeEditor=function(typeId){
  if(!canEdit())return;
  var ct=ctById(typeId); if(!ct){ alert("That charge type no longer exists."); return; }
  var y=yr();
  var list=DATA.tenants.filter(function(t){return t.name&&t.name!=="NO TENANT";});
  var rows=list.map(function(t){
    var std=(t.charges||[]).find(function(c){return +c.typeId===+typeId;});
    var cells="";
    for(var m=0;m<12;m++){
      var mc=monthCharges(t,y,m).find(function(c){return +c.typeId===+typeId;});
      var lk=isClosed(y,m);
      cells+='<td class="num"><input class="cez" data-id="'+t.id+'" data-m="'+m+'" type="number" step="0.01" value="'+esc(mc?mc.amount:"")+'"'+(lk?' disabled title="Period closed"':'')+' style="width:66px;text-align:right;padding:3px 4px'+(lk?';background:#f1f5f9;color:#94a3b8':'')+'"></td>';
    }
    return '<tr><td style="position:sticky;left:0;background:#fff;min-width:150px">'+esc(t.name)+'<div style="font-size:11px;color:#94a3b8">'+esc(t.unit)+'</div></td>'+
      '<td class="num" style="color:#94a3b8">'+(std?money(num(std.amount)):"—")+'</td>'+cells+'</tr>';
  }).join("");
  document.getElementById("modalHost").innerHTML='<div class="modal"><div class="box" style="width:min(1320px,98vw)"><h3>Enter / adjust '+esc(ct.name.toLowerCase())+' — '+y+'</h3>'+
    '<div class="hint">Every month is pre-filled with what the tenant is currently charged. Type the real figure when a bill comes in; clear a cell to drop the charge for that month. '+
    (ct.kind==="monthly"?'The “standing” column is the amount set on the tenant’s file.':'This is an '+esc(ct.kind==="annual"?"annual":"one-off")+' charge — fill in only the month it falls in.')+'</div>'+
    '<div class="tblwrap freeze" style="max-height:62vh"><table style="width:100%"><thead><tr><th>Tenant</th><th class="num">Standing</th>'+MONTHS.map(function(m){return '<th class="num">'+m+'</th>';}).join("")+'</tr></thead><tbody>'+rows+'</tbody></table></div>'+
    '<div class="frow" style="align-items:center;margin-top:6px"><span class="hint" style="margin:0">Saved figures apply to this charge only — rent and other charges are untouched.</span><div style="flex:1"></div><button class="ghost" data-h="closeModal()">Cancel</button> <button class="primary" data-h="saveChargeEditor('+typeId+')">Save '+esc(ct.name.toLowerCase())+'</button></div></div></div>';
};
window.saveChargeEditor=function(typeId){
  var y=yr(), n=0;
  var vals={};
  document.querySelectorAll(".cez").forEach(function(inp){
    var id=+inp.dataset.id, m=+inp.dataset.m;
    if(!vals[id])vals[id]={};
    vals[id][m]=inp.value.trim();
  });
  Object.keys(vals).forEach(function(id){
    var t=DATA.tenants.find(function(x){return x.id===+id;}); if(!t)return;
    ensureYear(t,y);
    for(var m=0;m<12;m++){
      if(isClosed(y,m))continue; // closed months are not re-billed
      var raw=vals[id][m];
      // Writing any month pins that month's whole charge set, so start from
      // what it shows today and change only this one charge.
      var cur=monthCharges(t,y,m).map(function(c){return {typeId:+c.typeId,amount:num(c.amount)};});
      var had=cur.find(function(c){return c.typeId===+typeId;});
      var want=(raw===""?null:num(raw));
      if((had?had.amount:null)===want)continue;
      var next=cur.filter(function(c){return c.typeId!==+typeId;});
      if(want!==null)next.push({typeId:+typeId,amount:want});
      var std=standingCharges(t).map(function(c){return {typeId:+c.typeId,amount:num(c.amount)};});
      var same=next.length===std.length && next.every(function(c){return std.some(function(x){return x.typeId===c.typeId&&x.amount===c.amount;});});
      if(same) delete t.pay[y][m].charges; else t.pay[y][m].charges=next;
      n++;
    }
  });
  persist("Adjusted "+ctName(typeId)+" — "+y); closeModal(); render(); flash(n?n+" month(s) updated.":"Nothing changed.");
};

/* ---- Bulk rent editor (per year) ---- */
window.openRentEditor=function(){ if(!canEdit())return; const y=yr();
  const list=DATA.tenants.filter(t=>t.name&&t.name!=="NO TENANT");
  const rows=list.map(t=>{ let cells="";
    // Closed months are shown but not editable — the figure they were billed at.
    for(let m=0;m<12;m++){ const lk=isClosed(y,m); cells+='<td class="num"><input class="rez" data-id="'+t.id+'" data-m="'+m+'" type="number" value="'+esc(rentOf(t,y,m))+'"'+(lk?' disabled title="Period closed"':'')+' style="width:62px;text-align:right;padding:3px 4px'+(lk?';background:#f1f5f9;color:#94a3b8':'')+'"></td>'; }
    return '<tr><td style="position:sticky;left:0;background:#fff;min-width:150px">'+esc(t.name)+'<div style="font-size:11px;color:#94a3b8">'+esc(t.unit)+'</div></td><td class="num" style="color:#94a3b8">'+money(t.rent)+'</td>'+cells+'</tr>'; }).join("");
  document.getElementById("modalHost").innerHTML='<div class="modal"><div class="box" style="width:min(1320px,98vw)"><h3>Enter / adjust rent — '+y+'</h3>'+
    '<div class="hint">Every month of '+y+' is pre-filled with the agreement rent. Change any month\'s figure to adjust what is charged. Blank a cell to reset it to the agreement rent.</div>'+
    '<div class="tblwrap freeze" style="max-height:62vh"><table style="width:100%"><thead><tr><th>Tenant</th><th class="num">Agreement</th>'+MONTHS.map(m=>'<th class="num">'+m+'</th>').join("")+'</tr></thead><tbody>'+rows+'</tbody></table></div>'+
    '<div class="frow" style="align-items:center;margin-top:6px"><span class="hint" style="margin:0">Tip: use the month cells in the schedule to change a single tenant, or this grid to set the whole year.</span><div style="flex:1"></div><button class="ghost" data-h="closeModal()">Cancel</button> <button class="primary" data-h="saveRent()">Save rents</button></div></div></div>';
};
window.saveRent=function(){ const y=yr(); DATA.tenants.forEach(t=>ensureYear(t,y));
  var skipped=0;
  document.querySelectorAll(".rez").forEach(inp=>{ const t=DATA.tenants.find(x=>x.id==inp.dataset.id); if(!t)return; const m=+inp.dataset.m; const v=inp.value.trim();
    // A closed month keeps the rent it was billed at.
    if(isClosed(y,m)){ skipped++; return; }
    if(v===""||num(v)===(t.rent||0)){ delete t.pay[y][m].rent; } else { t.pay[y][m].rent=num(v); } });
  persist("Adjusted rent — "+y); closeModal(); render();
  flash("Rents updated for "+y+"."+(skipped?" Closed months were left alone.":"")); };

/* ---- Batch receipt entry (table) ---- */
function tenantOpts(sel){ return '<option value="">— select tenant —</option>'+DATA.tenants.filter(t=>t.name&&t.name!=="NO TENANT").sort((a,b)=>a.name.localeCompare(b.name)).map(t=>'<option value="'+t.id+'"'+(t.id==sel?' selected':'')+'>'+esc(t.name)+' — '+esc(t.unit)+'</option>').join(""); }
// Bulk entry and receipt-splitting used to be separate modals; both are now
// the one Receipts screen above, which also matches each payment to the month
// it settles.

/* ---- All receipts (browse & correct) ---- */
var receiptsFilter="ALL";
function vReceipts(){
  const y=yr();
  const opts='<option value="ALL">All tenants</option>'+DATA.tenants.filter(t=>t.name&&t.name!=="NO TENANT").sort((a,b)=>a.name.localeCompare(b.name)).map(t=>'<option value="'+t.id+'"'+(String(t.id)===String(receiptsFilter)?' selected':'')+'>'+esc(t.name)+'</option>').join("");
  const list=[];
  DATA.tenants.forEach(t=>{ if(receiptsFilter!=="ALL"&&String(t.id)!==String(receiptsFilter))return; const py=t.pay&&t.pay[y]; if(!py)return;
    for(let m=0;m<12;m++){ (py[m].receipts||[]).forEach(r=>list.push({t,m,r})); } });
  list.sort((a,b)=>(a.r.date||"").localeCompare(b.r.date||"")||a.t.name.localeCompare(b.t.name));
  const total=list.reduce((s,x)=>s+num(x.r.amount),0);
  let h='<div class="panel"><div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><h3 style="margin:0">All receipts — '+y+'</h3>'+
    '<select id="rcFilter">'+opts+'</select><span class="badge">'+list.length+' receipts · '+money(total)+'</span></div>'+
    '<div class="hint">Every receipt captured for '+y+' (year selector top-right). Click ✎ to open that month and correct or delete a receipt.</div>'+
    '<div class="tblwrap"><table><thead><tr><th>Date</th><th>Tenant</th><th>Unit</th><th>Month</th><th>Receipt No.</th><th>Type</th><th class="num">Amount</th><th class="actions"></th></tr></thead><tbody>';
  if(!list.length)h+='<tr><td colspan="8" style="color:#94a3b8">No receipts for this selection.</td></tr>';
  list.forEach(x=>{ h+='<tr><td>'+esc(x.r.date||"—")+'</td><td>'+esc(x.t.name)+'</td><td>'+esc(x.t.unit)+'</td><td>'+MONTHS[x.m]+'</td><td>'+esc(x.r.ref||"")+'</td><td>'+esc(catOf(x.r))+'</td><td class="num">'+money(x.r.amount)+'</td>'+
    '<td class="actions">'+(canEdit()?'<button class="iconbtn" title="Edit / correct" data-h="openReceipts('+x.t.id+','+x.m+')">✎</button>':"")+'</td></tr>'; });
  h+='<tr class="total"><td colspan="6">Total ('+list.length+')</td><td class="num">'+money(total)+'</td><td></td></tr>';
  h+='</tbody></table></div></div>';
  document.getElementById("view").innerHTML=h;
  const f=document.getElementById("rcFilter"); if(f)f.onchange=e=>{receiptsFilter=e.target.value;render();};
}

/* ---- Arrears (viewed period only) ---- */
var arrProp="ALL";

/* What a tenant still owes for a year, split by what it was owed FOR.
   Each line is settled on its own: a payment allocated to rent does not cover
   the common fees, which is the same rule the receipt matching follows. So
   chasing can be specific — "the rent is paid, the water is not". */
function arrearsFor(t,y){
  var cap=capM(y);
  var byCat={}, months=[], total=0;
  for(var m=0;m<=Math.min(cap,11);m++){
    if(!due(t,y,m))continue;
    var owedHere=0;
    var rentBal=r2x(rentOf(t,y,m)-paidCat(t,y,m,"Rent"));
    if(rentBal>0.005){ byCat["Rent"]=r2x((byCat["Rent"]||0)+rentBal); owedHere+=rentBal; }
    monthCharges(t,y,m).forEach(function(c){
      var nm=ctName(c.typeId);
      var bal=r2x(num(c.amount)-paidCat(t,y,m,nm));
      if(bal>0.005){ byCat[nm]=r2x((byCat[nm]||0)+bal); owedHere+=bal; }
    });
    if(owedHere>0.005){ months.push(MONTHS[m]+(paidAll(t,y,m)>0.005?" (part)":"")); total=r2x(total+owedHere); }
  }
  return {byCat:byCat, months:months, total:total};
}
function r2x(n){ return Math.round(n*100)/100; }

function vArrears(){
  var y=yr(), cap=capM(y);
  // Which properties are in play, so a landlord can chase one building at a time.
  var props=DATA.properties.slice().sort(function(a,b){return (a.name||"").localeCompare(b.name||"");});
  var opts='<option value="ALL">All properties</option>'+props.map(function(pr){
    return '<option value="'+pr.id+'"'+(String(pr.id)===String(arrProp)?" selected":"")+'>'+esc(pr.name)+'</option>';
  }).join("")+'<option value="NONE"'+(arrProp==="NONE"?" selected":"")+'>(no property set)</option>';

  var rows=[];
  sortedTenants().forEach(function(t){
    if(arrProp==="NONE"){ if(t.propertyId) return; }
    else if(arrProp!=="ALL" && String(t.propertyId)!==String(arrProp)) return;
    var a=arrearsFor(t,y);
    if(a.total>0.005) rows.push({t:t,a:a});
  });
  rows.sort(function(x,z){ return z.a.total-x.a.total; });

  // One column per thing actually owed, rent first, so the table stays narrow.
  var cats=[]; rows.forEach(function(r){ Object.keys(r.a.byCat).forEach(function(k){ if(cats.indexOf(k)<0)cats.push(k); }); });
  cats.sort(function(a,b){ return a==="Rent"?-1:b==="Rent"?1:a.localeCompare(b); });
  var catTot={}; cats.forEach(function(c){ catTot[c]=0; });
  rows.forEach(function(r){ cats.forEach(function(c){ catTot[c]=r2x(catTot[c]+(r.a.byCat[c]||0)); }); });
  var total=rows.reduce(function(sm,r){ return r2x(sm+r.a.total); },0);

  var h='<div class="cards">'+
    card("Tenants in arrears",String(rows.length),arrProp==="ALL"?"across every property":"in this property")+
    card("Total outstanding",money(total),"Jan\u2013"+(cap<0?"\u2014":MONTHS[cap])+" "+y)+
    cats.slice(0,3).map(function(c){ return card(c+" owed",money(catTot[c]),"unpaid "+c.toLowerCase()); }).join("")+
    '</div>';

  h+='<div class="panel"><div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">'+
    '<h3 style="margin:0">Who has not paid \u2014 '+y+'</h3>'+
    '<span style="flex:1"></span>'+
    '<span style="font-size:12px;color:#64748b">Property <select id="arrProp">'+opts+'</select></span></div>'+
    '<div class="hint">Split by what is owed for. Each line settles on its own \u2014 rent paid does not cover the fees \u2014 so a part-paid month shows exactly which part is short. Only months due up to '+(cap<0?"\u2014":MONTHS[cap])+' are counted.</div>'+
    '<div class="tblwrap freeze"><table><thead><tr><th>Tenant</th><th>Property / unit</th>'+
      cats.map(function(c){ return '<th class="num">'+esc(c)+'</th>'; }).join("")+
      '<th class="num">Total</th><th>Months</th><th>Contact</th><th>Phone</th></tr></thead><tbody>';

  if(!rows.length){
    h+='<tr><td colspan="'+(6+cats.length)+'" style="color:#16a34a;font-weight:600">Nothing outstanding for this period \u{1F389}</td></tr>';
  }
  rows.forEach(function(r){
    var pr=propById(r.t.propertyId);
    h+='<tr><td><button class="linkish" data-h="openTenant('+r.t.id+')">'+esc(r.t.name)+'</button></td>'+
      '<td>'+esc(pr?pr.name:"\u2014")+'<div style="font-size:11px;color:#94a3b8">'+esc(r.t.unit)+'</div></td>'+
      cats.map(function(c){ var v=r.a.byCat[c]||0; return '<td class="num'+(v>0.005?" warn":"")+'">'+(v>0.005?money(v):"\u2014")+'</td>'; }).join("")+
      '<td class="num warn" style="font-weight:700">'+money(r.a.total)+'</td>'+
      '<td style="font-size:11.5px">'+r.a.months.join(", ")+'</td>'+
      '<td>'+esc(r.t.contact1.name)+'</td><td>'+esc(r.t.contact1.phone)+'</td></tr>';
  });
  if(rows.length){
    h+='<tr class="total"><td>Total</td><td></td>'+
      cats.map(function(c){ return '<td class="num">'+money(catTot[c])+'</td>'; }).join("")+
      '<td class="num">'+money(total)+'</td><td></td><td></td><td></td></tr>';
  }
  h+='</tbody></table></div></div>';
  document.getElementById("view").innerHTML=h;
  var sel=document.getElementById("arrProp");
  if(sel)sel.onchange=function(e){ arrProp=e.target.value; render(); };
}

/* ---- Deposits ---- */
function vDeposits(){
  let held=0,orig=0,used=0;
  DATA.tenants.forEach(t=>{ orig+=num(t.deposit); held+=netDeposit(t); (t.depositMoves||[]).forEach(mv=>used+=num(mv.amount)); });
  let h='<div class="cards">'+card("Deposits held (net)",money(held),"currently held")+card("Original deposits",money(orig),"as taken")+card("Refunded / used",money(used),"released")+'</div>';
  h+='<div class="panel"><h3>Deposit register</h3><div class="hint">Deposit held per tenant, less any refund or amount used against expenses/arrears. Record a movement (e.g. tenant moved out) to reduce what is held.</div>'+
    '<div class="tblwrap"><table><thead><tr><th>Tenant</th><th>Property / Unit</th><th class="num">Deposit taken</th><th class="num">Refunded / used</th><th class="num">Net held</th><th>Movements</th><th class="actions"></th></tr></thead><tbody>';
  let any=false;
  DATA.tenants.forEach(t=>{ if(!(num(t.deposit)>0||(t.depositMoves&&t.depositMoves.length)))return; any=true; const p=propById(t.propertyId);
    const u=(t.depositMoves||[]).reduce((s,mv)=>s+num(mv.amount),0); const net=netDeposit(t);
    const mv=(t.depositMoves||[]).map((m,ix)=>esc(m.date||"")+" · "+esc(m.type||"")+" "+money(m.amount)+(m.note?" ("+esc(m.note)+")":"")+(isAdmin()?' <a href="#" data-h="rmDepositMove('+t.id+','+ix+');return false;" style="color:#ef4444;text-decoration:none">✖</a>':"")).join("<br>")||'<span style="color:#cbd5e1">—</span>';
    h+='<tr><td>'+esc(t.name)+'</td><td>'+esc(p?p.name:"")+' '+esc(t.unit)+'</td><td class="num">'+money(t.deposit)+'</td><td class="num">'+(u?money(u):"—")+'</td><td class="num"><b>'+money(net)+'</b></td><td>'+mv+'</td>'+
      '<td class="actions">'+(canEdit()?'<button class="iconbtn" title="Record refund / deduction" data-h="depositMove('+t.id+')">＋</button>':"")+'</td></tr>';
  });
  if(!any)h+='<tr><td colspan="7" style="color:#94a3b8">No deposits recorded.</td></tr>';
  h+='</tbody></table></div></div>';
  document.getElementById("view").innerHTML=h;
}
window.depositMove=function(id){ if(!canEdit())return; const t=DATA.tenants.find(x=>x.id===id);
  document.getElementById("modalHost").innerHTML='<div class="modal"><div class="box"><h3>Deposit movement — '+esc(t.name)+'</h3>'+
   '<div class="hint">Net held '+money(netDeposit(t))+' of '+money(t.deposit)+' taken. A refund or amount used reduces what is held.</div>'+
   '<div class="frow"><label>Date<input id="dm_date" type="date" value="'+new Date().toISOString().slice(0,10)+'"></label>'+
   '<label>Type<select id="dm_type"><option>Refund to tenant</option><option>Used against expense</option><option>Used against arrears</option><option>Other</option></select></label>'+
   '<label>Amount (€)<input id="dm_amt" type="number"></label></div>'+
   '<div class="frow"><label>Note<input id="dm_note"></label></div>'+
   '<div class="frow" style="justify-content:flex-end"><button class="ghost" data-h="closeModal()">Cancel</button> <button class="primary" data-h="saveDepositMove('+id+')">Save</button></div></div></div>'; };
window.saveDepositMove=function(id){ const t=DATA.tenants.find(x=>x.id===id); const amt=num(document.getElementById("dm_amt").value); if(amt<=0){alert("Enter an amount.");return;}
  if(!t.depositMoves)t.depositMoves=[]; t.depositMoves.push({date:document.getElementById("dm_date").value,type:document.getElementById("dm_type").value,amount:amt,note:document.getElementById("dm_note").value.trim()});
  persist("Deposit movement — "+t.name); closeModal(); render(); flash("Deposit movement recorded."); };
window.rmDepositMove=function(id,ix){ if(!isAdmin()){alert("Only admins can remove.");return;} const t=DATA.tenants.find(x=>x.id===id); if(!confirm("Remove this movement?"))return; t.depositMoves.splice(ix,1); persist("Removed deposit movement — "+t.name); render(); };

/* ---- Statement (multi-year range) ---- */
function vStatement(){
  if(stmtTenant==null && DATA.tenants.length)stmtTenant=DATA.tenants[0].id;
  const ys=yearList();
  const topts=DATA.tenants.map(t=>'<option value="'+t.id+'"'+(t.id===stmtTenant?" selected":"")+'>'+esc(t.name)+' — '+esc(t.unit)+'</option>').join("");
  if(!stmtFrom) stmtFrom=ys[0]+"-01-01";
  if(!stmtTo) stmtTo=ys[ys.length-1]+"-12-31";
  let h='<div class="panel noprint"><h3>Tenant statement</h3><div class="frow">'+
    '<label>Tenant<select id="stSel">'+topts+'</select></label>'+
    '<label>From<input id="stFrom" type="date" value="'+esc(stmtFrom)+'"></label>'+
    '<label>To<input id="stTo" type="date" value="'+esc(stmtTo)+'"></label>'+
    '<label>&nbsp;<button class="ghost" data-h="window.print()">🖨 Print / PDF</button></label>'+
    '<label>&nbsp;<button class="ghost" data-h="openSendDoc(&#39;statement&#39;)">✉ Email</button></label>'+
    // Statements are a report now, not a tab — this is the way back.
    '<label>&nbsp;<button class="ghost" data-h="goTab(&#39;schedule&#39;)">← Rent schedule</button></label></div></div>';
  h+=letterheadHtml();
  const fYM=ymKey(stmtFrom), tYM=ymKey(stmtTo);
  const t=DATA.tenants.find(x=>x.id===stmtTenant);
  if(t){ const p=propById(t.propertyId), L=curLease(t);
    let charged=0,paidT=0,bal=0,rowsH="";
    // The statement bills the month in full — rent plus its charges — and
    // credits every receipt, so the running balance is what the tenant owes.
    for(const y of ys){ for(let m=0;m<12;m++){ const ck=(+y)*12+m; if(ck<fYM||ck>tYM)continue; if(!due(t,y,m)&&paidAll(t,y,m)===0)continue; const dd=due(t,y,m); const ch=dd?dueTotal(t,y,m):0; const pa=paidAll(t,y,m); const cx=dd?chargesTotal(t,y,m):0; bal+=ch-pa; charged+=ch; paidT+=pa;
      rowsH+='<tr><td>'+MONTHS[m]+' '+y+(cx?'<div style="font-size:10px;color:#94a3b8">rent '+money(rentOf(t,y,m))+' + '+monthCharges(t,y,m).filter(c=>num(c.amount)!==0).map(c=>esc(ctName(c.typeId)).toLowerCase()+" "+money(num(c.amount))).join(", ")+'</div>':'')+'</td><td class="num">'+(ch?money(ch):"—")+'</td><td class="num">'+(pa?money(pa):(dd?"€0":"—"))+'</td><td class="num">'+money(bal)+'</td></tr>'; } }
    if(!rowsH)rowsH='<tr><td colspan="4" class="hint">No activity in this date range.</td></tr>';
    h+='<div class="panel stmt-doc"><div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:10px"><h3 style="margin:0">Statement — '+esc(t.name)+'</h3><div class="hint" style="text-align:right">Period: '+esc(stmtFrom)+' → '+esc(stmtTo)+'<br>Printed: '+stamp(new Date()).slice(0,10)+'</div></div>'+
      '<div class="hint" style="margin-top:6px">'+esc(p?p.name:"")+' · '+esc(t.unit)+' · Lease '+esc(L.start||"?")+' → '+esc(L.end||"?")+' · Deposit '+money(t.deposit)+'<br>'+esc(t.contact1.name)+" "+esc(t.contact1.phone)+(t.email?" · "+esc(t.email):"")+'</div>'+
      '<div class="tblwrap" style="margin-top:12px"><table><thead><tr><th>Period</th><th class="num">Charged</th><th class="num">Paid</th><th class="num">Balance</th></tr></thead><tbody>'+rowsH+
      '<tr class="total"><td>Total</td><td class="num">'+money(charged)+'</td><td class="num">'+money(paidT)+'</td><td class="num'+(bal>0?" warn":"")+'">'+money(bal)+'</td></tr></tbody></table></div></div>';
  }
  document.getElementById("view").innerHTML=h;
  const sel=document.getElementById("stSel"); if(sel)sel.onchange=e=>{stmtTenant=+e.target.value;render();};
  const fr=document.getElementById("stFrom"); if(fr)fr.onchange=e=>{ stmtFrom=e.target.value; render(); };
  const to=document.getElementById("stTo"); if(to)to.onchange=e=>{ stmtTo=e.target.value; render(); };
}

/* ---- Users (admin) ---- */
function vUsers(){
  if(!isAdmin()){ document.getElementById("view").innerHTML='<div class="panel">Admins only.</div>'; return; }
  let h='<div class="panel"><div style="display:flex;gap:10px;align-items:center"><h3 style="margin:0;">Users</h3><button class="ghost" data-h="editUser(null)">+ Add user</button><button class="ghost" data-h="openAudit()">🕘 Audit trail (90 days)</button></div>'+
    '<div class="hint">Roles: <b>admin</b> (all + manage users), <b>editor</b> (edit data), <b>viewer</b> (read-only). This is a basic in-app lock — full enforced security comes with the online (Supabase) version.</div>'+
    '<div class="tblwrap"><table><thead><tr><th>Username</th><th>Name</th><th>Role</th><th class="actions"></th></tr></thead><tbody>';
  DATA.users.forEach(u=>{ h+='<tr><td>'+esc(u.username)+'</td><td>'+esc(u.name)+'</td><td>'+esc(u.role)+'</td><td class="actions"><button class="iconbtn" data-h="editUser(\''+esc(u.username)+'\')">✎</button>'+(u.username!==user.username?'<button class="iconbtn" data-h="delUser(\''+esc(u.username)+'\')">🗑</button>':'')+'</td></tr>'; });
  h+='</tbody></table></div></div>';
  document.getElementById("view").innerHTML=h;
}
window.editUser=function(uname){ const u=uname==null?{username:"",name:"",role:"editor"}:DATA.users.find(x=>x.username===uname);
  document.getElementById("modalHost").innerHTML='<div class="modal"><div class="box"><h3>'+(uname==null?"Add user":"Edit user")+'</h3>'+
   '<div class="frow"><label>Username<input id="u_name" value="'+esc(u.username)+'"'+(uname!=null?" disabled":"")+'></label><label>Full name<input id="u_full" value="'+esc(u.name)+'"></label></div>'+
   '<div class="frow"><label>Role<select id="u_role"><option value="admin">admin</option><option value="editor">editor</option><option value="viewer">viewer</option></select></label>'+
   '<label>'+(uname==null?"Password":"New password (blank = keep)")+'<input id="u_pw" type="password"></label></div>'+
   '<div class="frow" style="justify-content:flex-end"><button class="ghost" data-h="closeModal()">Cancel</button> <button class="primary" data-h="saveUser('+(uname==null?"null":"'"+esc(uname)+"'")+')">Save</button></div></div></div>';
  document.getElementById("u_role").value=u.role; };
window.saveUser=function(uname){ const un=document.getElementById("u_name").value.trim(), full=document.getElementById("u_full").value.trim(), role=document.getElementById("u_role").value, pw=document.getElementById("u_pw").value;
  if(uname==null){ if(!un||!pw){alert("Username and password required.");return;} if(DATA.users.some(x=>x.username.toLowerCase()===un.toLowerCase())){alert("Username exists.");return;}
    DATA.users.push({username:un,name:full,role,hash:hashPw(pw)}); }
  else { const u=DATA.users.find(x=>x.username===uname); u.name=full; u.role=role; if(pw)u.hash=hashPw(pw); }
  persist("Saved user — "+(uname||un)); closeModal(); render(); flash("User saved."); };
window.delUser=function(uname){ if(!confirm("Delete user "+uname+"?"))return; DATA.users=DATA.users.filter(x=>x.username!==uname); persist("Deleted user — "+uname); render(); };
window.openAudit=function(){ if(!isAdmin())return; const cutoff=Date.now()-90*86400000;
  const rows=(DATA.audit||[]).filter(a=>{ const d=new Date((a.ts||"").replace(" ","T")); return !isNaN(d.getTime())&&d.getTime()>=cutoff; }).slice().reverse();
  const body=rows.map(a=>'<tr><td>'+esc(a.ts)+'</td><td>'+esc(a.user)+'</td><td>'+esc(a.action)+'</td></tr>').join("")||'<tr><td colspan="3" style="color:#94a3b8">No changes logged in the last 90 days.</td></tr>';
  document.getElementById("modalHost").innerHTML='<div class="modal"><div class="box" style="width:min(780px,96vw)"><h3>Audit trail — last 90 days ('+rows.length+')</h3>'+
    '<div class="hint">Who changed what, and when. Newest first.</div>'+
    '<div class="tblwrap freeze" style="max-height:65vh"><table><thead><tr><th>When</th><th>User</th><th>Change</th></tr></thead><tbody>'+body+'</tbody></table></div>'+
    '<div class="frow" style="justify-content:flex-end;margin-top:6px"><button class="ghost" data-h="closeModal()">Close</button></div></div></div>'; };

/* ---- import / csv / snapshot ---- */
function importXlsx(file){ if(!file||!canEdit())return; const rd=new FileReader();
  rd.onload=ev=>{ try{ const wb=XLSX.read(new Uint8Array(ev.target.result),{type:"array",cellDates:true});
    const T=XLSX.utils.sheet_to_json(wb.Sheets["Tenants"],{header:1,defval:null});
    const iso=v=>v instanceof Date?v.toISOString().slice(0,10):"";
    const grp=u=>{u=(u||"").toLowerCase(); if(u.includes("golden"))return["Golden A, Nisou","Nisou"]; if(u.includes("elena"))return["Elena Homes, Pera Chorio","Pera Chorio"]; if(u.includes("nikou"))return["House — Nikou Kazantzaki Str","Dali"]; if(u.includes("1st april"))return["House — 1st April Str","Mosfiloti"]; if(u.includes("mosfiloti")||/no\.?\s*15/.test(u))return["Mosfiloti Units","Mosfiloti"]; if(u.trim()==="land"||u.includes(" land"))return["Land — Nisou","Nisou"]; if(u.includes("dali"))return["Dali Flats","Dali"]; return["Other",""]; };
    const props={},tenants=[]; let id=1;
    for(let i=3;i<T.length;i++){ const r=T[i]; if(!r)continue; const name=r[1],unit=r[2]; if(!name&&!unit)continue;
      const g=grp(unit); if(!props[g[0]])props[g[0]]={id:Object.keys(props).length+1,name:g[0],location:g[1],units:0,notes:""}; props[g[0]].units++;
      const cs=(""+(r[8]||"")).split(/[/;]/); const c1=(cs[0]||"").trim(), c2=(cs[1]||"").trim();
      const pn=s=>{const m=(s.match(/\d[\d ]{5,}\d/)||[""])[0];return {name:s.replace(m,"").trim(" -"),phone:m.trim()};};
      tenants.push({id:id++,propertyId:props[g[0]].id,name:(name||"")+"",unit:(unit||"")+"",rent:num(r[3]),deposit:num(r[7]),electricity:null,leases:[{start:iso(r[4]),renewal:iso(r[5]),end:iso(r[6])}],contact1:pn(c1),contact2:pn(c2),email:(r[9]||"")+"",agreements:[],pay:{"2026":Array.from({length:12},()=>({receipts:[]}))}}); }
    const S=XLSX.utils.sheet_to_json(wb.Sheets["Rent Schedule"],{header:1,defval:null}); let ti=0;
    for(let i=4;i<S.length;i++){ const r=S[i]; if(!r||r[0]==null)continue; const t=tenants[ti++]; if(!t)continue;
      for(let m=0;m<12;m++){ const a=r[5+3*m],dd=r[6+3*m]; if(a!=null&&num(a)>0)t.pay["2026"][m].receipts.push({date:iso(dd)||("2026-"+p2(m+1)+"-01"),ref:"",amount:num(a)}); } }
    DATA.properties=Object.values(props); DATA.tenants=tenants; persist(); initShell(); render(); flash("Imported "+tenants.length+" tenants.");
  }catch(err){ alert("Could not read file. "+err.message); } };
  rd.readAsArrayBuffer(file); }
function exportCsv(){ const y=yr(); let rows=[["Property","Unit","Tenant","Rent","LeaseStart","LeaseEnd","Deposit","Electricity","Contact1","Phone1","Contact2","Phone2","Email"].concat(MONTHS.map(m=>m+" paid"))];
  DATA.tenants.forEach(t=>{ const p=propById(t.propertyId),L=curLease(t); rows.push([p?p.name:"",t.unit,t.name,t.rent,L.start,L.end,t.deposit,(t.electricity==null?"":t.electricity?"Yes":"No"),t.contact1.name,t.contact1.phone,t.contact2.name,t.contact2.phone,t.email].concat(MONTHS.map((_,m)=>paid(t,y,m)||""))); });
  dl(new Blob([rows.map(r=>r.map(c=>'"'+(c==null?"":(""+c).replace(/"/g,'""'))+'"').join(",")).join("\n")],{type:"text/csv"}),fileBase()+"_"+y+".csv"); flash("CSV exported."); }
function saveSnapshot(){ persist(); const json=JSON.stringify(DATA); let html="<!DOCTYPE html>\n"+document.documentElement.outerHTML;
  html=html.replace(/window\.__EMBEDDED_DATA__\s*=\s*[\s\S]*?\/\*END_DATA\*\//,"window.__EMBEDDED_DATA__ = "+json+";/*END_DATA*/");
  dl(new Blob([html],{type:"text/html"}),fileBase()+"_"+(DATA.meta.updated||"").slice(0,10)+".html"); flash("Snapshot saved."); }
function dl(blob,name){ const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download=name; a.click(); }

/* ---- ledger update (one-time) ---- */
function applyLedger(){ var L=window.__LEDGER2__||window.__LEDGER__; if(!L||DATA.meta.ledgerV===5)return;
  var groups={}; DATA.tenants.forEach(function(t){ (groups[t.name]=groups[t.name]||[]).push(t); });
  DATA.tenants.forEach(function(t){ ["2024","2025","2026"].forEach(function(y){ var old=t.pay[y]||[]; var a=Array.from({length:12},function(){return {receipts:[]};});
    for(var k=0;k<12;k++){ if(old[k]&&old[k].rent!==undefined&&old[k].rent!==null)a[k].rent=old[k].rent; } t.pay[y]=a; }); });
  Object.keys(L).forEach(function(name){ var e=L[name]||{}; var g=groups[name]; if(!g||!g.length)return;
    ["2024","2025","2026"].forEach(function(y){ (e[y]||[]).forEach(function(r){ var m=parseInt(r.d.slice(5,7),10)-1; if(m<0||m>11)return;
      if(g.length===1){ g[0].pay[y][m].receipts.push({date:r.d,ref:r.r||"",amount:r.a,cat:"Rent"}); return; }
      var totRent=g.reduce(function(s,x){return s+(x.rent||0);},0)||g.length; var alloc=0;
      g.forEach(function(x,ix){ var part= ix===g.length-1 ? Math.round((r.a-alloc)*100)/100 : Math.round(r.a*((x.rent||0)/totRent)*100)/100; alloc+=part; if(part!==0)x.pay[y][m].receipts.push({date:r.d,ref:r.r||"",amount:part,cat:"Rent",split:name}); });
    }); }); });
  DATA.meta.ledgerV=5; persist("Loaded & split receipts from accounting records"); }

/* ---- seed property unit lists from tenant units (one-time) ---- */
function seedUnits(){ if(DATA.meta.unitsV===1) return;
  DATA.properties.forEach(function(p){ if(p.unitNames&&p.unitNames.length) return;
    var us=[]; DATA.tenants.filter(function(t){return t.propertyId===p.id;}).forEach(function(t){ var u=(t.unit||"").trim(); if(u&&us.indexOf(u)<0)us.push(u); });
    us.sort(function(a,b){return a.localeCompare(b,undefined,{numeric:true});});
    p.unitNames=us; if(us.length)p.units=us.length; });
  DATA.meta.unitsV=1; persist(); }

/* ---- boot ---- */
window.addEventListener("message", function(ev){ var m=ev.data||{}; if(m.type!=="init")return;
  DATA = norm(m.data && Object.keys(m.data).length ? JSON.parse(JSON.stringify(m.data)) : {meta:{},tenants:[],properties:[],users:[],audit:[]});
  user = { username: m.username||"portal", name: m.name||"", role: m.role||"viewer" };
  __SUPPRESS_SAVE=true; try{ applyLedger(); }catch(e){} try{ seedUnits(); }catch(e){} __SUPPRESS_SAVE=false;
  document.getElementById("app").classList.remove("hidden");
  initShell(); render();
});
if(window.parent!==window) window.parent.postMessage({type:"ready"}, "*");


/* ---- portal bridge: event delegation (replaces inline handlers) + autosave ---- */
var __SUPPRESS_SAVE=false, __saveT=null;
function __parseArgs(s){ s=(s||"").trim(); if(!s)return[]; var parts=[],cur="",q=null,depth=0;
  for(var i=0;i<s.length;i++){ var c=s[i];
    if(q){ cur+=c; if(c===q)q=null; continue; }
    if(c==="'"||c==='"'){ q=c; cur+=c; continue; }
    if(c==="("||c==="["){depth++;cur+=c;continue;}
    if(c===")"||c==="]"){depth--;cur+=c;continue;}
    if(c===","&&depth===0){ parts.push(cur); cur=""; continue; }
    cur+=c; }
  if(cur.trim()!=="")parts.push(cur);
  return parts.map(function(p){ p=p.trim();
    if(/^-?\d+(\.\d+)?$/.test(p))return Number(p);
    if((p[0]==="'"&&p.slice(-1)==="'")||(p[0]==='"'&&p.slice(-1)==='"'))return p.slice(1,-1);
    if(p==="null")return null; if(p==="true")return true; if(p==="false")return false;
    return p; }); }
function __resolve(name){ var parts=name.split("."); var o=window; for(var i=0;i<parts.length;i++){ o=o&&o[parts[i]]; } return o; }
function __run(expr,ev){ if(!expr)return; var ret=/;\s*return\s+false;?\s*$/.test(expr); expr=expr.replace(/;\s*return\s+false;?\s*$/,"").trim();
  var m=expr.match(/^([\w.]+)\(([\s\S]*)\)$/); if(!m)return; var fn=__resolve(m[1]); if(typeof fn!=="function")return;
  if(ret&&ev)ev.preventDefault(); fn.apply(null,__parseArgs(m[2])); }
document.addEventListener("click",function(e){ var el=e.target.closest?e.target.closest("[data-h]"):null; if(el)__run(el.getAttribute("data-h"),e); });
document.addEventListener("change",function(e){ var el=e.target.closest?e.target.closest("[data-hc]"):null; if(el)__run(el.getAttribute("data-hc"),e); });
document.addEventListener("keydown",function(e){ var el=e.target.closest?e.target.closest("[data-hk]"):null; if(el)__run(el.getAttribute("data-hk"),e); });
function postSave(){ if(__SUPPRESS_SAVE||window.parent===window)return; clearTimeout(__saveT); __saveT=setTimeout(function(){ try{ window.parent.postMessage({type:"save",data:DATA},"*"); }catch(e){} }, 700); }
