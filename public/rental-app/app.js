const MONTHS=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const LS="greson_rentals_v2";
let DATA=load(), user=null, activeTab="overview", schedYear="2026", stmtTenant=null, pdfTargetId=null;
let chart=null;
const VIEWED=new Date();

function TABS(){ const t=[["overview","Overview"],["properties","Properties"],["tenants","Tenants & Contracts"],["schedule","Rent Schedule"],["receipts","Receipts"],["arrears","Arrears"],["deposits","Deposits"],["statement","Statement"],["invoice","Invoice"]]; return t; }
function load(){ return norm({meta:{},tenants:[],properties:[],users:[],audit:[]}); }
function norm(d){ if(!d.meta)d.meta={}; if(!d.tenants)d.tenants=[]; if(!d.properties)d.properties=[]; if(!d.users)d.users=[]; if(!d.audit)d.audit=[];
  d.tenants.forEach(t=>{ if(!t.pay)t.pay={}; if(!t.leases)t.leases=[{start:t.start||"",renewal:t.renewal||"",end:t.end||""}];
    if(!t.contact1)t.contact1={name:t.contact||"",phone:""}; if(!t.contact2)t.contact2={name:"",phone:""}; if(!t.depositMoves)t.depositMoves=[];
    if(!t.agreements)t.agreements=(t.agreement?[t.agreement]:[]); delete t.agreement;
    Object.keys(t.pay).forEach(y=>{ t.pay[y].forEach(mo=>{ if(!mo.receipts)mo.receipts=(mo.a?[{date:mo.d||"",ref:"",amount:mo.a}]:[]); }); }); });
  return d; }
function persist(action){ DATA.meta.updated=stamp(new Date()); if(action){ if(!DATA.audit)DATA.audit=[]; DATA.audit.push({ts:DATA.meta.updated,user:(user?user.username:"system"),action:action}); if(DATA.audit.length>3000)DATA.audit=DATA.audit.slice(-3000); } postSave(); refreshStamps(); }
function stamp(d){ return d.getFullYear()+"-"+p2(d.getMonth()+1)+"-"+p2(d.getDate())+" "+p2(d.getHours())+":"+p2(d.getMinutes()); }
function p2(x){ return (x<10?"0":"")+x; }
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
    '<div class="login"><div class="box"><h2>Property Rentals</h2><p>Greson Easy Loo — please sign in.</p>'+
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
function statusOf(t,y,m){ const pa=paid(t,y,m),r=rentOf(t,y,m);
  const vf=mIdx(t.vacantFrom); if(vf!=null && ((+y)*12+m)>=vf) return pa>0?"PAID":"VACANT";
  if(r<=0)return pa>0?"PAID":"NA";
  if(!due(t,y,m))return pa>0?(pa>=r?"PAID":"PARTIAL"):"NA";
  if(m>capM(y))return pa>0?(pa>=r?"PAID":"PARTIAL"):"UPCOMING";
  if(pa>=r)return "PAID"; if(pa>0)return "PARTIAL"; return "UNPAID"; }
function owed(t,y,m){ if(!due(t,y,m)||m>capM(y))return 0; const b=rentOf(t,y,m)-paid(t,y,m); return b>0?b:0; }

/* ---- shell ---- */
function initShell(){
  refreshStamps();
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
    '<div class="frow" style="justify-content:flex-end;margin-top:8px"><button class="ghost" data-h="closeModal()">Cancel</button> <button class="primary" data-h="saveSettings()">Save</button></div></div></div>';
  var li=document.getElementById("st_logo");
  li.onchange=function(e){ var f=e.target.files[0]; if(!f)return; if(f.size>1500000){alert("Logo must be under 1.5 MB.");return;} var r=new FileReader(); r.onload=function(){ window._logoData=r.result; document.getElementById("st_logoPrev").innerHTML='<img src="'+r.result+'" style="max-height:64px;margin-top:4px">'; }; r.readAsDataURL(f); };
};
window.saveSettings=function(){ if(!canEdit()){alert("Read-only access.");return;}
  var g=function(id){ return document.getElementById(id).value.trim(); };
  DATA.settings=Object.assign({}, DATA.settings, { companyName:g("st_cn"), regNo:g("st_reg"), vatNo:g("st_vat"), address:g("st_addr"), phone:g("st_ph"), email:g("st_em"), invoicePrefix:g("st_inv")||"INV", bank:g("st_bank") });
  if(window._logoData!==undefined) DATA.settings.logo=window._logoData;
  persist("Updated company settings"); closeModal(); render(); flash("Settings saved."); };

/* ---- Users & access (talks to the host over postMessage → secure backend) ---- */
var __userReqId=0, __userReqs={};
window.addEventListener("message", function(e){ var m=e.data||{}; if(m.type==="users:reply" && __userReqs[m.reqId]){ __userReqs[m.reqId](m); delete __userReqs[m.reqId]; } });
function usersRequest(op, extra){ return new Promise(function(resolve){
  if(window.parent===window){ resolve({ok:false,error:"Not available here."}); return; }
  var id=++__userReqId; __userReqs[id]=resolve;
  window.parent.postMessage(Object.assign({type:"users",op:op,reqId:id}, extra||{}), "*");
  setTimeout(function(){ if(__userReqs[id]){ __userReqs[id]({ok:false,error:"Timed out."}); delete __userReqs[id]; } }, 15000);
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
function vInvoice(){
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
    '<label>&nbsp;<button class="ghost" data-h="window.print()">🖨 Print / PDF</button></label></div></div>';
  var t=DATA.tenants.find(function(x){return x.id===invTenant;});
  if(t){ var p=propById(t.propertyId); var rent=rentOf(t,invYear,invMonth); var paidAmt=paid(t,invYear,invMonth);
    var s=DATA.settings||{}; var cn=s.companyName||(DATA.meta&&DATA.meta.client)||"";
    var invNo=(s.invoicePrefix||"INV")+"-"+invYear+p2(invMonth+1)+"-"+t.id;
    var issue=stamp(now).slice(0,10); var due=invYear+"-"+p2(invMonth+1)+"-01";
    h+='<div class="panel invoice-doc">'+
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
          (t.email?'<br>'+esc(t.email):"")+'</div></div>'+
      '<div class="tblwrap" style="margin-top:14px"><table><thead><tr><th>Description</th><th class="num">Amount</th></tr></thead><tbody>'+
        '<tr><td>Rent — '+MONTHS[invMonth]+' '+invYear+' · '+esc(t.unit)+'</td><td class="num">'+money(rent)+'</td></tr>'+
        '<tr class="total"><td>Total due</td><td class="num">'+money(rent)+'</td></tr>'+
        (paidAmt>0?'<tr><td>Received to date</td><td class="num">'+money(paidAmt)+'</td></tr><tr class="total"><td>Balance outstanding</td><td class="num'+((rent-paidAmt)>0?" warn":"")+'">'+money(rent-paidAmt)+'</td></tr>':'')+
      '</tbody></table></div>'+
      (s.bank?'<div class="hint" style="margin-top:14px"><b>Payment:</b> '+esc(s.bank)+'</div>':'')+
      ((s.phone||s.email)?'<div class="hint" style="margin-top:6px">Enquiries: '+[esc(s.phone||""),esc(s.email||"")].filter(Boolean).join(" · ")+'</div>':'')+
      '</div>';
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
function yearList(){ const ys=new Set(["2024","2025","2026"]); DATA.tenants.forEach(t=>Object.keys(t.pay||{}).forEach(y=>ys.add(y))); return [...ys].sort(); }
function yr(){ return document.getElementById("selYear").value||"2026"; }
function render(){
  document.querySelectorAll("#tabs .tab").forEach((t,i)=>t.classList.toggle("active",TABS()[i]&&TABS()[i][0]===activeTab));
  if(chart){try{chart.destroy();}catch(e){}chart=null;}
  const map={overview:vOverview,properties:vProperties,tenants:vTenants,schedule:vSchedule,receipts:vReceipts,arrears:vArrears,deposits:vDeposits,statement:vStatement,invoice:vInvoice,users:vUsers};
  (map[activeTab]||vOverview)();
}

/* ---- Overview ---- */
function vOverview(){
  const y=yr(), cap=capM(y);
  let roll=0,colYTD=0,dueYTD=0,occ=0,arr=0,dep=0,oth=0; const colByM=Array(12).fill(0);
  const units=DATA.properties.reduce((s,p)=>s+(p.units||0),0)||DATA.tenants.length;
  DATA.tenants.forEach(t=>{ dep+=netDeposit(t); let a=false; const real=t.name&&t.name!=="NO TENANT";
    for(let m=0;m<12;m++){ colByM[m]+=paid(t,y,m); if(m<=cap)oth+=otherPaid(t,y,m); if(due(t,y,m)&&m<=cap){ dueYTD+=rentOf(t,y,m); colYTD+=paid(t,y,m); if(owed(t,y,m)>0)a=true; } }
    const nm=cap<0?0:cap; if(real&&due(t,y,nm)){ roll+=rentOf(t,y,nm); occ++; } if(a)arr++; });
  let h='<div class="cards">';
  h+=card("Monthly rent roll",money(roll),(cap<0?"—":MONTHS[cap])+" "+y);
  h+=card("Collected YTD",money(colYTD),"to "+(cap<0?"—":MONTHS[cap]));
  h+=card("Outstanding YTD",money(dueYTD-colYTD),(dueYTD-colYTD>0?"owed":"up to date"));
  h+=card("Occupancy",occ+" / "+units,"units let");
  h+=cardLink("In arrears",String(arr),"view outstanding","arrears");
  h+=cardLink("Deposits held",money(dep),"view register","deposits");
  h+=card("Other income",money(oth),"electricity / costs YTD");
  h+='</div><div class="panel"><h3>Rental income — '+y+'</h3><div class="hint">Rent collected per month.</div><canvas id="cRent"></canvas></div>';
  document.getElementById("view").innerHTML=h;
  chart=new Chart(document.getElementById("cRent"),{type:"bar",data:{labels:MONTHS,datasets:[{label:"Rental income",data:colByM,backgroundColor:"#1e2a78"}]},
    options:{responsive:true,plugins:{legend:{display:false}},scales:{y:{ticks:{callback:v=>"€"+v.toLocaleString()}}}}});
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
function collectLeases(){ const arr=window._leaseDraft.map(x=>({start:x.start,renewal:x.renewal,end:x.end}));
  document.querySelectorAll(".lz").forEach(inp=>{ const i=+inp.dataset.i,k=inp.dataset.k; if(!arr[i])arr[i]={start:"",renewal:"",end:""}; arr[i][k]=inp.value; });
  window._leaseDraft=arr; return arr; }
window.saveTenant=function(id){ const g=k=>document.getElementById(k).value; const leases=collectLeases().filter(L=>L.start||L.end||L.renewal); if(!leases.length)leases.push({start:"",renewal:"",end:""});
  const o={propertyId:num(g("t_prop")),unit:g("t_unit").trim(),name:g("t_name").trim(),rent:num(g("t_rent")),deposit:num(g("t_deposit")),
    electricity:(g("t_elec")===""?null:g("t_elec")==="1"),vacantFrom:g("t_vacant"),leases:leases,contact1:{name:g("t_c1n").trim(),phone:g("t_c1p").trim()},contact2:{name:g("t_c2n").trim(),phone:g("t_c2p").trim()},email:g("t_email").trim()};
  const clash=DATA.tenants.find(x=>x.id!==id && x.propertyId===o.propertyId && (x.unit||"")===o.unit && o.unit && x.name && x.name!=="NO TENANT");
  if(clash && !confirm("Unit “"+o.unit+"” is already assigned to "+clash.name+". Assign it here anyway?")) return;
  if(id==null){const t={id:nextTid(),agreements:[],pay:{}};Object.assign(t,o);ensureYear(t,"2026");DATA.tenants.push(t);} else Object.assign(DATA.tenants.find(x=>x.id===id),o);
  persist((id==null?"Added":"Edited")+" tenant — "+o.name); closeModal();render();flash("Tenant saved."); };
window.delTenant=function(id){ if(!isAdmin()){alert("Only admins can delete tenants.");return;} const t=DATA.tenants.find(x=>x.id===id); if(!confirm("Delete "+(t.name||"tenant")+"?"))return; DATA.tenants=DATA.tenants.filter(x=>x.id!==id); persist("Deleted tenant — "+t.name);render();flash("Deleted."); };
window.closeModal=function(){ document.getElementById("modalHost").innerHTML=""; };
function nextTid(){ return DATA.tenants.reduce((m,t)=>Math.max(m,t.id||0),0)+1; }
function unitTaken(propId,unit,exceptId){ return DATA.tenants.some(x=>x.id!==exceptId && x.propertyId===propId && (x.unit||"")===unit && x.name && x.name!=="NO TENANT"); }
function unitOptions(propId,current){ const p=propById(propId); const set=[]; if(p&&p.unitNames)p.unitNames.forEach(u=>{ if(u&&set.indexOf(u)<0)set.push(u); }); if(current&&set.indexOf(current)<0)set.push(current);
  return '<option value=""></option>'+set.map(u=>{ const taken=unitTaken(propId,u,current&&u===current?-999:0)&&u!==current; return '<option value="'+esc(u)+'"'+(u===current?' selected':'')+'>'+esc(u)+(taken?' — (occupied)':'')+'</option>'; }).join(""); }
window.rebuildUnitOptions=function(){ const pid=num(document.getElementById("t_prop").value); const sel=document.getElementById("t_unit"); sel.innerHTML=unitOptions(pid,""); };

/* ---- PDF agreement ---- */
window.attachPdf=function(id){ pdfTargetId=id; document.getElementById("pdfInput").click(); };
function onPdfPicked(e){ const f=e.target.files[0]; if(!f||pdfTargetId==null)return; const rd=new FileReader();
  rd.onload=ev=>{ const t=DATA.tenants.find(x=>x.id===pdfTargetId); if(!t.agreements)t.agreements=[]; t.agreements.push({name:f.name,dataUrl:ev.target.result,uploaded:stamp(new Date())}); persist("Attached agreement — "+t.name); render(); flash("Agreement attached: "+f.name); e.target.value=""; };
  rd.readAsDataURL(f); }
window.viewAgreement=function(id,idx){ const t=DATA.tenants.find(x=>x.id===id); const ag=(t.agreements||[])[idx||0]; if(!ag){alert("No agreement attached.");return;}
  try{ const parts=ag.dataUrl.split(","); const bin=atob(parts[1]); const arr=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++)arr[i]=bin.charCodeAt(i);
    const blob=new Blob([arr],{type:"application/pdf"}); const url=URL.createObjectURL(blob); window.open(url,"_blank"); }
  catch(err){ window.open(ag.dataUrl,"_blank"); } };
window.removeAgreement=function(id,idx){ if(!isAdmin()){alert("Only admins can remove agreements.");return;} const t=DATA.tenants.find(x=>x.id===id); const ag=(t.agreements||[])[idx]; if(!ag)return; if(!confirm("Remove agreement '"+ag.name+"'?"))return; t.agreements.splice(idx,1); persist("Removed agreement — "+t.name); render(); flash("Agreement removed."); };

/* ---- Rent Schedule (multi-receipt) ---- */
var schedSort="tenant";
function sortedTenants(){ const arr=DATA.tenants.slice();
  if(schedSort==="property") arr.sort((a,b)=>{ const pa=(propById(a.propertyId)||{}).name||"zzz", pb=(propById(b.propertyId)||{}).name||"zzz"; return pa.localeCompare(pb)||(a.unit||"").localeCompare(b.unit||"",undefined,{numeric:true})||(a.name||"").localeCompare(b.name||""); });
  else if(schedSort==="rent") arr.sort((a,b)=>(b.rent||0)-(a.rent||0)||(a.name||"").localeCompare(b.name||""));
  else arr.sort((a,b)=>(a.name||"").localeCompare(b.name||""));
  return arr; }
function vSchedule(){
  const y=yr(), cap=capM(y);
  let h='<div class="panel"><div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><h3 style="margin:0">Rent Schedule '+y+'</h3>'+(canEdit()?'<button class="ghost" data-h="openBatchReceipts()">+ Enter receipts</button> <button class="ghost" data-h="openSplit()">⇄ Split a receipt</button> <button class="ghost" data-h="openRentEditor()">✎ Enter / adjust rent</button>':'')+'</div><div class="hint">'+(canEdit()?"“Split a receipt” allocates one payment across units and costs (rent / electricity / other) · “Enter receipts” for bulk entry · click a month to edit one tenant. ":"")+'Only due months up to the current period are shown; future rent is not flagged as unpaid.</div>'+
    '<div style="margin-bottom:8px;font-size:12px;color:#64748b">Sort by: <select id="schSort"><option value="tenant"'+(schedSort==="tenant"?" selected":"")+'>Tenant name</option><option value="property"'+(schedSort==="property"?" selected":"")+'>Property</option><option value="rent"'+(schedSort==="rent"?" selected":"")+'>Rent (high to low)</option></select></div>'+
    '<div class="tblwrap"><table><thead><tr><th>Tenant</th><th class="num">Rent</th>'+MONTHS.map((m,i)=>'<th class="num">'+m+'</th>').join("")+'</tr></thead><tbody>';
  sortedTenants().forEach(t=>{ const _p=propById(t.propertyId); h+='<tr><td>'+esc(t.name)+'<div style="font-size:11px;color:#94a3b8">'+esc(t.unit)+(_p?' · '+esc(_p.name):'')+'</div></td><td class="num">'+money(t.rent)+'</td>';
    for(let m=0;m<12;m++){ const st=statusOf(t,y,m); const pa=paid(t,y,m); const rd=rentOf(t,y,m);
      let disp;
      if(st==="NA"){ disp='<span class="st NA">—</span>'; }
      else if(st==="VACANT"){ disp='<span class="st NA">vacant</span>'; }
      else { const due='<div style="font-size:10px;color:#94a3b8;line-height:1.2">due '+money(rd)+'</div>';
        const pay='<div style="font-weight:600;line-height:1.2">'+(pa>0?money(pa):(st==="UPCOMING"?'<span style="color:#cbd5e1">—</span>':'<span style="color:#ef4444">€0</span>'))+'</div>';
        const pill=(st==="UPCOMING")?'<span class="st UPCOMING">upcoming</span>':'<span class="st '+st+'">'+st+'</span>';
        disp=due+pay+pill; }
      const clk=canEdit()?' style="cursor:pointer" data-h="openReceipts('+t.id+','+m+')"':'';
      h+='<td class="num" style="vertical-align:top"'+clk+'>'+disp+'</td>'; }
    h+='</tr>'; });
  h+='<tr class="total"><td>Collected</td><td></td>';
  for(let m=0;m<12;m++){ let c=0; DATA.tenants.forEach(t=>c+=paid(t,y,m)); h+='<td class="num">'+money(c)+'</td>'; }
  h+='</tr></tbody></table></div></div>';
  document.getElementById("view").innerHTML=h;
  const ss=document.getElementById("schSort"); if(ss)ss.onchange=e=>{schedSort=e.target.value;render();};
}
window.openReceipts=function(id,m){ if(!canEdit())return; const y=yr(); const t=DATA.tenants.find(x=>x.id===id); const recs=ensureYear(t,y)[m].receipts;
  let rows=recs.map((r,i)=>'<div class="frow" data-r="'+i+'"><label>Date<input class="rz" data-k="date" data-i="'+i+'" type="date" value="'+esc(r.date)+'"></label><label>Reference<input class="rz" data-k="ref" data-i="'+i+'" value="'+esc(r.ref)+'"></label><label>Amount (€)<input class="rz" data-k="amount" data-i="'+i+'" type="number" value="'+esc(r.amount)+'"></label><label>Type<select class="rz" data-k="cat" data-i="'+i+'"><option'+((r.cat||"Rent")==="Rent"?" selected":"")+'>Rent</option><option'+(r.cat==="Electricity"?" selected":"")+'>Electricity</option><option'+(r.cat==="Other"?" selected":"")+'>Other</option></select></label><button class="iconbtn" data-h="rmReceipt('+id+','+m+','+i+')">🗑</button></div>').join("");
  document.getElementById("modalHost").innerHTML='<div class="modal"><div class="box"><h3>Receipts — '+esc(t.name)+' · '+MONTHS[m]+' '+y+'</h3>'+
    '<div class="frow"><label>Rent charged this month<input id="rentOv" type="number" value="'+esc(rentOf(t,y,m))+'"></label><label>&nbsp;<span class="hint" style="margin:0">Agreement rent: '+money(t.rent)+'. Change here to override just this month.</span></label></div>'+
    '<div class="hint">Existing receipts below — edit them or add extra lines.</div><div id="recBox">'+(rows||'<div class="hint">No receipts yet.</div>')+'</div>'+
    '<div class="frow"><button class="ghost" data-h="addReceiptRow('+id+','+m+')">+ Add receipt line</button></div>'+
    '<div class="frow" style="justify-content:flex-end;margin-top:6px"><button class="ghost" data-h="closeModal()">Cancel</button> <button class="primary" data-h="saveReceipts('+id+','+m+')">Save</button></div></div></div>';
};
window.addReceiptRow=function(id,m){ saveReceiptsDraft(id,m); const y=yr(); ensureYear(DATA.tenants.find(x=>x.id===id),y)[m].receipts.push({date:"",ref:"",amount:""}); openReceipts(id,m); };
window.rmReceipt=function(id,m,i){ const y=yr(); ensureYear(DATA.tenants.find(x=>x.id===id),y)[m].receipts.splice(i,1); openReceipts(id,m); };
function saveReceiptsDraft(id,m){ const y=yr(); const recs=ensureYear(DATA.tenants.find(x=>x.id===id),y)[m].receipts;
  document.querySelectorAll(".rz").forEach(inp=>{ const i=+inp.dataset.i,k=inp.dataset.k; if(recs[i])recs[i][k]=(k==="amount"?inp.value:inp.value); }); }
window.saveReceipts=function(id,m){ saveReceiptsDraft(id,m); const y=yr(); const t=DATA.tenants.find(x=>x.id===id);
  t.pay[y][m].receipts=t.pay[y][m].receipts.map(r=>({date:r.date,ref:r.ref,amount:num(r.amount),cat:r.cat||"Rent"})).filter(r=>r.amount!==0||r.date||r.ref);
  const ov=document.getElementById("rentOv"); if(ov){ const v=ov.value.trim(); if(v===""||num(v)===(t.rent||0)) delete t.pay[y][m].rent; else t.pay[y][m].rent=num(v); }
  persist("Edited receipts — "+t.name+" · "+MONTHS[m]+" "+y); closeModal(); render(); flash("Saved."); };

/* ---- Bulk rent editor (per year) ---- */
window.openRentEditor=function(){ if(!canEdit())return; const y=yr();
  const list=DATA.tenants.filter(t=>t.name&&t.name!=="NO TENANT");
  const rows=list.map(t=>{ let cells="";
    for(let m=0;m<12;m++){ cells+='<td class="num"><input class="rez" data-id="'+t.id+'" data-m="'+m+'" type="number" value="'+esc(rentOf(t,y,m))+'" style="width:62px;text-align:right;padding:3px 4px"></td>'; }
    return '<tr><td style="position:sticky;left:0;background:#fff;min-width:150px">'+esc(t.name)+'<div style="font-size:11px;color:#94a3b8">'+esc(t.unit)+'</div></td><td class="num" style="color:#94a3b8">'+money(t.rent)+'</td>'+cells+'</tr>'; }).join("");
  document.getElementById("modalHost").innerHTML='<div class="modal"><div class="box" style="width:min(1320px,98vw)"><h3>Enter / adjust rent — '+y+'</h3>'+
    '<div class="hint">Every month of '+y+' is pre-filled with the agreement rent. Change any month\'s figure to adjust what is charged. Blank a cell to reset it to the agreement rent.</div>'+
    '<div class="tblwrap" style="max-height:62vh"><table style="width:100%"><thead><tr><th style="position:sticky;left:0">Tenant</th><th class="num">Agreement</th>'+MONTHS.map(m=>'<th class="num">'+m+'</th>').join("")+'</tr></thead><tbody>'+rows+'</tbody></table></div>'+
    '<div class="frow" style="align-items:center;margin-top:6px"><span class="hint" style="margin:0">Tip: use the month cells in the schedule to change a single tenant, or this grid to set the whole year.</span><div style="flex:1"></div><button class="ghost" data-h="closeModal()">Cancel</button> <button class="primary" data-h="saveRent()">Save rents</button></div></div></div>';
};
window.saveRent=function(){ const y=yr(); DATA.tenants.forEach(t=>ensureYear(t,y));
  document.querySelectorAll(".rez").forEach(inp=>{ const t=DATA.tenants.find(x=>x.id==inp.dataset.id); if(!t)return; const m=+inp.dataset.m; const v=inp.value.trim();
    if(v===""||num(v)===(t.rent||0)){ delete t.pay[y][m].rent; } else { t.pay[y][m].rent=num(v); } });
  persist("Adjusted rent — "+y); closeModal(); render(); flash("Rents updated for "+y+"."); };

/* ---- Batch receipt entry (table) ---- */
function tenantOpts(sel){ return '<option value="">— select tenant —</option>'+DATA.tenants.filter(t=>t.name&&t.name!=="NO TENANT").sort((a,b)=>a.name.localeCompare(b.name)).map(t=>'<option value="'+t.id+'"'+(t.id==sel?' selected':'')+'>'+esc(t.name)+' — '+esc(t.unit)+'</option>').join(""); }
window.openBatchReceipts=function(){ if(!canEdit())return; if(!window._batch||!window._batch.length)window._batch=Array.from({length:6},()=>({tid:"",ref:"",date:"",amount:""})); renderBatch(); };
function renderBatch(){
  const rows=window._batch.map((r,i)=>'<tr><td><select class="bz" data-k="tid" data-i="'+i+'" style="width:100%;min-width:260px">'+tenantOpts(r.tid)+'</select></td>'+
    '<td><input class="bz" data-k="ref" data-i="'+i+'" value="'+esc(r.ref)+'" style="width:100%;min-width:120px"></td>'+
    '<td><input class="bz" data-k="date" data-i="'+i+'" type="date" value="'+esc(r.date)+'" style="width:100%"></td>'+
    '<td class="num"><input class="bz num" data-k="amount" data-i="'+i+'" type="number" value="'+esc(r.amount)+'" style="width:100px"></td>'+
    '<td><button class="iconbtn" data-h="rmBatch('+i+')">🗑</button></td></tr>').join("");
  document.getElementById("modalHost").innerHTML='<div class="modal"><div class="box" style="width:min(1150px,98vw)"><h3>Enter receipts</h3>'+
    '<div class="hint">One receipt per line — pick the tenant, receipt no., date and amount. Each receipt is filed into the month of its date. Add as many lines as you need.</div>'+
    '<div><table style="width:100%"><thead><tr><th style="min-width:280px">Tenant</th><th>Receipt No.</th><th>Date</th><th class="num">Amount (€)</th><th></th></tr></thead><tbody>'+rows+'</tbody></table></div>'+
    '<div class="frow" style="align-items:center"><button class="ghost" data-h="addBatchRow()">+ Add line</button><div style="flex:1"></div><button class="ghost" data-h="closeModal()">Cancel</button> <button class="primary" data-h="saveBatch()">Save receipts</button></div></div></div>';
}
function collectBatch(){ document.querySelectorAll(".bz").forEach(inp=>{ const i=+inp.dataset.i,k=inp.dataset.k; if(window._batch[i])window._batch[i][k]=inp.value; }); }
window.addBatchRow=function(){ collectBatch(); window._batch.push({tid:"",ref:"",date:"",amount:""}); renderBatch(); };
window.rmBatch=function(i){ collectBatch(); window._batch.splice(i,1); if(!window._batch.length)window._batch.push({tid:"",ref:"",date:"",amount:""}); renderBatch(); };
window.saveBatch=function(){ collectBatch(); let n=0;
  window._batch.forEach(r=>{ const amt=num(r.amount); if(!r.tid||amt<=0)return; const t=DATA.tenants.find(x=>x.id==r.tid); if(!t)return;
    let dt=r.date; if(!dt){ dt=new Date().toISOString().slice(0,10); } const y=dt.slice(0,4), m=parseInt(dt.slice(5,7),10)-1; if(m<0||m>11)return;
    ensureYear(t,y)[m].receipts.push({date:dt,ref:r.ref||"",amount:amt}); n++; });
  window._batch=null; persist(n+" receipt(s) entered (bulk)"); closeModal(); render(); flash(n+" receipt"+(n===1?"":"s")+" saved."); };

/* ---- Split one receipt across units & cost types ---- */
window.openSplit=function(){ if(!canEdit())return; if(!window._split)window._split={date:new Date().toISOString().slice(0,10),ref:"",total:"",lines:[{tid:"",cat:"Rent",amount:""},{tid:"",cat:"Rent",amount:""},{tid:"",cat:"Rent",amount:""}]}; renderSplit(); };
function renderSplit(){ const S=window._split;
  const catOpt=function(c){return '<option'+(c==="Rent"?" selected":"")+'>Rent</option><option'+(c==="Electricity"?" selected":"")+'>Electricity</option><option'+(c==="Other"?" selected":"")+'>Other</option>';};
  const rows=S.lines.map((l,i)=>'<tr><td><select class="sz" data-k="tid" data-i="'+i+'" style="width:100%;min-width:240px">'+tenantOpts(l.tid)+'</select></td>'+
    '<td><select class="sz" data-k="cat" data-i="'+i+'">'+catOpt(l.cat||"Rent")+'</select></td>'+
    '<td class="num"><input class="sz num" data-k="amount" data-i="'+i+'" type="number" value="'+esc(l.amount)+'" style="width:100px"></td>'+
    '<td><button class="iconbtn" data-h="rmSplit('+i+')">🗑</button></td></tr>').join("");
  const alloc=S.lines.reduce((s,l)=>s+num(l.amount),0);
  document.getElementById("modalHost").innerHTML='<div class="modal"><div class="box" style="width:min(920px,97vw)"><h3>Split a receipt</h3>'+
    '<div class="hint">Enter the payment once, then allocate it across units and cost types — e.g. one ALION payment → rent for 3 flats + electricity. Electricity/Other are tracked separately and do not affect rent arrears.</div>'+
    '<div class="frow"><label>Date<input id="sp_date" type="date" value="'+esc(S.date)+'"></label><label>Reference<input id="sp_ref" value="'+esc(S.ref)+'"></label><label>Total received (€)<input id="sp_total" type="number" value="'+esc(S.total||"")+'"></label></div>'+
    '<div class="tblwrap"><table style="width:100%"><thead><tr><th>Tenant / unit</th><th>Cost type</th><th class="num">Amount</th><th></th></tr></thead><tbody>'+rows+'</tbody></table></div>'+
    '<div class="frow" style="align-items:center"><button class="ghost" data-h="addSplit()">+ Add line</button><div style="flex:1"></div><span class="hint" style="margin:0">Allocated €'+Math.round(alloc)+(num(S.total)?" of €"+Math.round(num(S.total)):"")+'</span> <button class="ghost" data-h="closeModal()">Cancel</button> <button class="primary" data-h="saveSplit()">Save split</button></div></div></div>';
}
function collectSplit(){ const S=window._split; document.querySelectorAll(".sz").forEach(inp=>{ const i=+inp.dataset.i,k=inp.dataset.k; if(S.lines[i])S.lines[i][k]=inp.value; }); const d=document.getElementById("sp_date"),rf=document.getElementById("sp_ref"),tt=document.getElementById("sp_total"); if(d)S.date=d.value; if(rf)S.ref=rf.value; if(tt)S.total=tt.value; }
window.addSplit=function(){ collectSplit(); window._split.lines.push({tid:"",cat:"Rent",amount:""}); renderSplit(); };
window.rmSplit=function(i){ collectSplit(); window._split.lines.splice(i,1); if(!window._split.lines.length)window._split.lines.push({tid:"",cat:"Rent",amount:""}); renderSplit(); };
window.saveSplit=function(){ collectSplit(); const S=window._split; const dt=S.date||new Date().toISOString().slice(0,10); const y=dt.slice(0,4),m=parseInt(dt.slice(5,7),10)-1; if(m<0||m>11){alert("Enter a valid date.");return;}
  let n=0; S.lines.forEach(l=>{ const amt=num(l.amount); if(!l.tid||amt===0)return; const t=DATA.tenants.find(x=>x.id==l.tid); if(!t)return; ensureYear(t,y)[m].receipts.push({date:dt,ref:S.ref||"",amount:amt,cat:l.cat||"Rent"}); n++; });
  const tot=num(S.total),alloc=S.lines.reduce((s,l)=>s+num(l.amount),0);
  window._split=null; persist(n+" split allocation(s)"); closeModal(); render(); flash(n+" allocation(s) saved"+(tot&&Math.abs(tot-alloc)>0.5?" · total €"+Math.round(tot)+" vs allocated €"+Math.round(alloc):"")); };

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
function vArrears(){
  const y=yr(), cap=capM(y); const rows=[];
  DATA.tenants.forEach(t=>{ let tot=0; const ms=[];
    for(let m=0;m<=cap;m++){ const o=owed(t,y,m); if(o>0){ tot+=o; ms.push(MONTHS[m]+(statusOf(t,y,m)==="PARTIAL"?" (part)":"")); } }
    if(tot>0)rows.push({t,tot,ms}); });
  rows.sort((a,b)=>b.tot-a.tot); const total=rows.reduce((s,r)=>s+r.tot,0);
  let h='<div class="cards"><div class="card"><div class="k">Tenants in arrears</div><div class="v">'+rows.length+'</div></div>'+
    '<div class="card"><div class="k">Total outstanding</div><div class="v warn">'+money(total)+'</div><div class="d">Jan–'+(cap<0?"—":MONTHS[cap])+' '+y+'</div></div></div>';
  h+='<div class="panel"><h3>Who has not paid — '+y+'</h3><div class="hint">Unpaid/partial for the period shown only. Future (not-due) rent is excluded.</div>'+
    '<div class="tblwrap"><table><thead><tr><th>Tenant</th><th>Property</th><th class="num">Owed</th><th>Months</th><th>Contact</th><th>Phone</th><th>Email</th></tr></thead><tbody>';
  if(!rows.length)h+='<tr><td colspan="7" style="color:#16a34a;font-weight:600">All tenants up to date for this period 🎉</td></tr>';
  rows.forEach(r=>{ const p=propById(r.t.propertyId); h+='<tr><td>'+esc(r.t.name)+'</td><td>'+esc(p?p.name:r.t.unit)+'</td><td class="num warn">'+money(r.tot)+'</td><td>'+r.ms.join(", ")+'</td><td>'+esc(r.t.contact1.name)+'</td><td>'+esc(r.t.contact1.phone)+'</td><td>'+esc(r.t.email)+'</td></tr>'; });
  h+='</tbody></table></div></div>';
  document.getElementById("view").innerHTML=h;
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
  const yopt=ys.map(y=>'<option>'+y+'</option>').join("");
  let h='<div class="panel noprint"><h3>Tenant statement</h3><div class="frow">'+
    '<label>Tenant<select id="stSel">'+topts+'</select></label>'+
    '<label>From year<select id="stFrom">'+yopt+'</select></label>'+
    '<label>To year<select id="stTo">'+yopt+'</select></label>'+
    '<label>&nbsp;<button class="ghost" data-h="window.print()">🖨 Print</button></label></div></div>';
  h+=letterheadHtml();
  const t=DATA.tenants.find(x=>x.id===stmtTenant);
  if(t){ const p=propById(t.propertyId), L=curLease(t);
    let charged=0,paidT=0,bal=0,rowsH="";
    for(const y of ys){ for(let m=0;m<12;m++){ if(!due(t,y,m)&&paid(t,y,m)===0)continue; const dd=due(t,y,m); const ch=dd?rentOf(t,y,m):0; const pa=paid(t,y,m); bal+=ch-pa; charged+=ch; paidT+=pa;
      rowsH+='<tr><td>'+MONTHS[m]+' '+y+'</td><td class="num">'+(ch?money(ch):"—")+'</td><td class="num">'+(pa?money(pa):(dd?"€0":"—"))+'</td><td class="num">'+money(bal)+'</td></tr>'; } }
    h+='<div class="panel"><div style="display:flex;justify-content:space-between;flex-wrap:wrap"><h3>'+esc(t.name)+'</h3><div class="hint" style="text-align:right">Statement printed: '+stamp(new Date())+'</div></div>'+
      '<div class="hint">'+esc(p?p.name:"")+' · '+esc(t.unit)+' · Lease '+esc(L.start||"?")+' → '+esc(L.end||"?")+' · Deposit '+money(t.deposit)+' · Electricity '+(t.electricity==null?"—":(t.electricity?"tenant pays":"included"))+'<br>'+esc(t.contact1.name)+" "+esc(t.contact1.phone)+(t.email?" · "+esc(t.email):"")+'</div>'+
      '<div class="tblwrap"><table><thead><tr><th>Period</th><th class="num">Charged</th><th class="num">Paid</th><th class="num">Balance</th></tr></thead><tbody>'+rowsH+
      '<tr class="total"><td>Total</td><td class="num">'+money(charged)+'</td><td class="num">'+money(paidT)+'</td><td class="num'+(bal>0?" warn":"")+'">'+money(bal)+'</td></tr></tbody></table></div></div>';
  }
  document.getElementById("view").innerHTML=h;
  const sel=document.getElementById("stSel"); if(sel)sel.onchange=e=>{stmtTenant=+e.target.value;render();};
  const fr=document.getElementById("stFrom"),to=document.getElementById("stTo"); if(fr){fr.value=ys[0];to.value=ys[ys.length-1];
    fr.onchange=to.onchange=()=>filterStmt(); }
}
function filterStmt(){ render(); } // range applied via ys; simple full-range for now

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
    '<div class="tblwrap" style="max-height:65vh"><table><thead><tr><th>When</th><th>User</th><th>Change</th></tr></thead><tbody>'+body+'</tbody></table></div>'+
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
  dl(new Blob([rows.map(r=>r.map(c=>'"'+(c==null?"":(""+c).replace(/"/g,'""'))+'"').join(",")).join("\n")],{type:"text/csv"}),"Greson_property_rentals_"+y+".csv"); flash("CSV exported."); }
function saveSnapshot(){ persist(); const json=JSON.stringify(DATA); let html="<!DOCTYPE html>\n"+document.documentElement.outerHTML;
  html=html.replace(/window\.__EMBEDDED_DATA__\s*=\s*[\s\S]*?\/\*END_DATA\*\//,"window.__EMBEDDED_DATA__ = "+json+";/*END_DATA*/");
  dl(new Blob([html],{type:"text/html"}),"Greson_Property_Rentals_"+(DATA.meta.updated||"").slice(0,10)+".html"); flash("Snapshot saved."); }
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
