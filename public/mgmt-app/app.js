window.__EMBEDDED_DATA__ = window.__EMBEDDED_DATA__ || {meta:{savedAt:""}};
const MONTHS=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const VIEWED=new Date().toISOString().slice(0,16).replace("T"," ");
const YEAR_COLORS={"2023":"#cbd5e1","2024":"#94a3b8","2025":"#2b3a8c","2026":"#10b981","2027":"#f59e0b","2028":"#8b5cf6"};
const LS_KEY="greson_mgmt_v2";
const TABS=[["summary","Summary"],["pl","Profit & Loss"],["divisions","Divisions"],["payroll","Payroll"],["rentals","Rentals"],["ops","Operations"],["insights","Insights"],["esoft","TB (e-soft)"],["data","Data & Import"],["users","Users"]];
let user=null;
function isAdmin(){ return user&&user.role==="admin"; }
function canEdit(){ return user&&user.role!=="viewer"; }
function visibleTabs(){ return TABS.filter(t=>t[0]!=="users"); }
function hashPw(s){ let h=5381; for(let i=0;i<s.length;i++){ h=((h<<5)+h)+s.charCodeAt(i); h=h&0xffffffff; } return (h>>>0).toString(16); }
function ensureUsers(){ if(!DATA.users)DATA.users=[]; if(!DATA.users.length){ DATA.users=[{username:"admin",hash:hashPw("greson2026"),role:"admin",name:"Administrator"}]; persist(); } }
function showLogin(msg){ document.getElementById("loginHost").innerHTML=
  '<div class="login"><div class="box"><h2>Management Reporting</h2><p>Greson EasyLoo — please sign in.</p>'+
  '<div class="err" id="lerr">'+(msg||"")+'</div>'+
  '<input id="lu" placeholder="Username" autocomplete="username">'+
  '<input id="lp" type="password" placeholder="Password" autocomplete="current-password">'+
  '<button class="primary" data-h="doLogin()">Sign in</button>'+
  '<p style="margin-top:14px">First time? Default login is <b>admin</b> / <b>greson2026</b> — change it in the Users tab.</p></div></div>';
  const lp=document.getElementById("lp"); if(lp)lp.onkeydown=e=>{ if(e.key==="Enter")doLogin(); }; }
window.doLogin=function(){ const u=document.getElementById("lu").value.trim(), p=document.getElementById("lp").value;
  const found=DATA.users.find(x=>x.username.toLowerCase()===u.toLowerCase()&&x.hash===hashPw(p));
  if(!found){ document.getElementById("lerr").textContent="Invalid username or password."; return; }
  user=found; document.getElementById("loginHost").innerHTML="";
  const ty=String(new Date().getFullYear()); if(years().indexOf(ty)>=0){ activeTab="summary"; }
  initShell();
  const sy=document.getElementById("selYear"); if(years().indexOf(ty)>=0){ sy.value=ty; document.getElementById("selMonth").value=(new Date().getMonth()); }
  render(); };
window.logout=function(){ if(window.parent!==window) window.parent.postMessage({type:"logout"},"*"); };
function logAudit(action){ if(!action)return; if(!DATA.audit)DATA.audit=[]; DATA.audit.push({ts:new Date().toISOString().slice(0,16).replace("T"," "),user:(user?user.username:"system"),action:action}); if(DATA.audit.length>3000)DATA.audit=DATA.audit.slice(-3000); }
const DIVS=["Loo Rental","Cleaning","Loo Sales","Prefab Houses","Property Rent","Tools","Other"];
const DIV_COLORS={"Loo Rental":"#1e2a78","Cleaning":"#2b3a8c","Loo Sales":"#f04e23","Prefab Houses":"#f59e0b","Property Rent":"#10b981","Tools":"#8b5cf6","Other":"#94a3b8"};
const METRICS=[
  {k:"revenue",label:"Revenue",cur:true,grp:"fin"},
  {k:"rentals",label:"Rental Income",cur:true,grp:"fin"},
  {k:"cleans_rev",label:"WC Cleans Income",cur:true,grp:"fin"},
  {k:"other_income",label:"Other Income",cur:true,grp:"fin"},
  {k:"cogs",label:"Cost of Sales",cur:true,grp:"fin"},
  {k:"gross_profit",label:"Gross Profit",cur:true,grp:"fin"},
  {k:"salaries",label:"Staff Costs (P&L)",cur:true,grp:"fin"},
  {k:"payroll_ctc",label:"Payroll — Cost to Company",cur:true,grp:"fin"},
  {k:"payroll_paid",label:"Payroll — Paid (net)",cur:true,grp:"fin"},
  {k:"expenses",label:"Total Expenses",cur:true,grp:"fin"},
  {k:"net_profit",label:"Net Profit",cur:true,grp:"fin"},
  {k:"rent_charged",label:"Rent Charged",cur:true,grp:"fin"},
  {k:"rent_invoiced",label:"Rent Invoiced",cur:true,grp:"fin"},
  {k:"rent_received",label:"Rent Received",cur:true,grp:"fin"},
  {k:"waybills_outstanding",label:"Waybills Outstanding",cur:true,grp:"fin"},
  {k:"cleans",label:"WC Cleans (count)",cur:false,grp:"ops"},
  {k:"jobs",label:"Jobs / Visits",cur:false,grp:"ops"},
  {k:"active_sites",label:"Active Sites",cur:false,grp:"ops"},
  {k:"deliveries",label:"Deliveries",cur:false,grp:"ops"},
  {k:"pickups",label:"Pick-ups",cur:false,grp:"ops"},
  {k:"not_done",label:"Not Done",cur:false,grp:"ops"}
];
const ALLKEYS=METRICS.map(m=>m.k);

let verInfo=null;
let DATA=load();
let charts={};
let activeTab="summary";
let editMode=false;
let insMetricA="cleans", insMetricB="revenue";

/* ---------- data helpers ---------- */
function load(){ let ls=null; try{const s=localStorage.getItem(LS_KEY); if(s)ls=JSON.parse(s);}catch(e){}
  const em=window.__EMBEDDED_DATA__; window.__VERS={ls:ls,em:em};
  if(ls){ const la=(ls.meta&&ls.meta.savedAt)||"", ea=(em.meta&&em.meta.savedAt)||"";
    if(la&&ea&&la!==ea){ const browserNewer=la>ea; verInfo={browserNewer:browserNewer,la:la,ea:ea}; return normalize(JSON.parse(JSON.stringify(browserNewer?ls:em))); }
    return normalize(ls); }
  return normalize(JSON.parse(JSON.stringify(em))); }
function normalize(d){ if(!d.meta)d.meta={currency:"€"}; if(!d.years)d.years={};
  const ylist=Array.from(new Set(["2023","2024","2025","2026","2027","2028"].concat(Object.keys(d.years))));
  ylist.forEach(y=>{ if(!d.years[y])d.years[y]={}; ALLKEYS.forEach(k=>{ if(!Array.isArray(d.years[y][k])) d.years[y][k]=Array(12).fill(null); if(d.years[y][k].length<12) d.years[y][k]=d.years[y][k].concat(Array(12-d.years[y][k].length).fill(null)); }); });
  if(!d.div) d.div = {};
  if(!d.users) d.users = [];
  if(!d.audit) d.audit = [];
  if(!d.payDept) d.payDept = {};
  if(!d.payroll) d.payroll = {};
  if(!d.payComments) d.payComments = {};
  if(!d.esoft) d.esoft = {};
  if(!d.esoftMeta) d.esoftMeta = {};
  return d; }
function divYears(){ const ys=new Set(); DIVS.forEach(dv=>{ const o=DATA.div[dv]||{}; Object.keys(o).forEach(y=>ys.add(y)); }); return [...ys].sort(); }
function divVal(dv,y,m){ const o=DATA.div[dv]&&DATA.div[dv][y]; return o&&has(o[m])?num(o[m]):0; }
function divYearTotal(dv,y){ let s=0; for(let m=0;m<12;m++)s+=divVal(dv,y,m); return s; }
function divOfName(name){ const u=(name||"").toUpperCase();
  if(u.includes("CLEAN")) return "Cleaning";
  if(u.includes("TOOL")) return "Tools";
  if(u.includes("PORTABLE TOILET")||u.includes("PREFAB TOILET")) return "Loo Sales";
  if(u.includes("PREFAB HOUSE")) return "Prefab Houses";
  if(u.includes("RENT RECEIVABLE")) return "Property Rent";
  if(u.indexOf("RENTALS")===0||u.includes("LIFTING CAGE")||u.includes("SQUATTING")||u.includes("LIGHTING RENT")||u.includes("E-BLOCK")||u.includes("RENT VIP")||u.includes("GOLD TRAILER")||u.includes("PALMA")||u.includes("DUPLEX TRAILER")) return "Loo Rental";
  return "Other"; }
function persist(action){ if(action)logAudit(action); DATA.meta.rev=(DATA.meta.rev||0)+1; DATA.meta.savedAt=new Date().toISOString().slice(0,16).replace("T"," "); postSave(); }
function years(){ return Object.keys(DATA.years).sort(); }
function metric(k){ return METRICS.find(m=>m.k===k); }
function val(y,k,m){ const a=DATA.years[y]&&DATA.years[y][k]; return a?a[m]:null; }
function num(v){ v=parseFloat(v); return isFinite(v)?v:0; }
function has(v){ return v!==null&&v!==undefined&&v!==""; }
function sumArr(a){ const n=a.filter(has); return n.length?n.reduce((x,y)=>x+num(y),0):null; }
function fmt(v,cur){ if(!has(v)) return "—"; const r=Math.round(v); return (cur?"€":"")+r.toLocaleString(); }
function fmt1(v){ return has(v)? (Math.round(v*10)/10).toLocaleString():"—"; }
function pctv(a,b){ if(!has(a)||!has(b)||num(b)===0) return null; return (num(a)-num(b))/Math.abs(num(b))*100; }
function arrow(p){ if(p===null) return {c:"flat",t:"—"}; const s=p>=0?"▲":"▼"; return {c:p>0.05?"up":(p<-0.05?"down":"flat"),t:s+" "+Math.abs(p).toFixed(1)+"%"}; }
function flash(m){ const f=document.getElementById("flash"); f.textContent=m; f.classList.add("show"); setTimeout(()=>f.classList.remove("show"),2600); }
/* derived */
function dCogs(y,m){ const c=val(y,"cogs",m); if(has(c))return c; const r=val(y,"revenue",m),g=val(y,"gross_profit",m); return (has(r)&&has(g))?r-g:null; }
function dGP(y,m){ const g=val(y,"gross_profit",m); if(has(g))return g; const r=val(y,"revenue",m),c=val(y,"cogs",m); return (has(r)&&has(c))?r-c:null; }
function dGoods(y,m){ const r=val(y,"revenue",m),rt=val(y,"rentals",m),cl=val(y,"cleans_rev",m); if(!has(r))return null; return r-(has(rt)?rt:0)-(has(cl)?cl:0); }

/* ---------- shell ---------- */
function initShell(){
  document.getElementById("stamps").textContent="Viewed: "+VIEWED+" · Updated: "+(DATA.meta.savedAt||DATA.meta.updated||"—");
  const tb=document.getElementById("tabs"); tb.innerHTML="";
  visibleTabs().forEach(([id,label])=>{ const d=document.createElement("div"); d.className="tab"+(id===activeTab?" active":""); d.textContent=label; d.onclick=()=>{activeTab=id;render();}; tb.appendChild(d); });
  const now=new Date(), cy=String(now.getFullYear()), cm=now.getMonth();
  const sy=document.getElementById("selYear"); sy.innerHTML=""; years().forEach(y=>{const o=document.createElement("option");o.value=y;o.textContent=y;sy.appendChild(o);});
  if(!sy.value) sy.value=years().indexOf(cy)>=0?cy:"2026";
  const sm=document.getElementById("selMonth"); sm.innerHTML=""; MONTHS.forEach((m,i)=>{const o=document.createElement("option");o.value=i;o.textContent=m;sm.appendChild(o);});
  if(sm.value==="") sm.value=(sy.value===cy)?cm:latestMonth(sy.value);
  sy.onchange=()=>{const yv=document.getElementById("selYear").value;document.getElementById("selMonth").value=(yv===cy)?cm:latestMonth(yv);render();};
  sm.onchange=render;
  document.getElementById("btnSave").onclick=saveSnapshot;
  document.getElementById("btnLogout").onclick=logout;
  document.getElementById("whoami").textContent=user?(user.name+" · "+user.role):"";
  const vb=document.getElementById("verBanner");
  if(vb){ if(verInfo){ const newer=verInfo.browserNewer?"your browser copy":"the file you opened", older=verInfo.browserNewer?"the file you opened":"your browser copy";
    const newAt=verInfo.browserNewer?verInfo.la:verInfo.ea, oldAt=verInfo.browserNewer?verInfo.ea:verInfo.la;
    vb.innerHTML='<div style="background:#fef3c7;border:1px solid #f59e0b;color:#7c2d12;padding:9px 14px;border-radius:8px;margin:12px 0;font-size:13px">⚠ Two versions found. You are viewing the <b>newer</b> one — '+newer+' (saved '+newAt+'). The other ('+older+', saved '+oldAt+') is older. <button class="ghost" data-h="useOtherVer()" style="margin-left:8px">View the older version</button> <button class="ghost" data-h="document.getElementById(\'verBanner\').innerHTML=\'\'">Dismiss</button></div>'; } else vb.innerHTML=""; }
}
window.useOtherVer=function(){ if(!verInfo)return; const other= verInfo.browserNewer ? window.__VERS.em : window.__VERS.ls; DATA=normalize(JSON.parse(JSON.stringify(other))); verInfo=null; initShell(); render(); flash("Switched to the other version."); };
function importPending(kind,file){ if(!file)return; flash("Received “"+file.name+"”. Send this "+kind+" export so its layout can be mapped — the importer will then load it automatically each month."); }
function importPayroll(file){ if(!file)return; if(!canEdit()){alert("Editors/admins only.");return;} const rd=new FileReader();
  rd.onload=ev=>{ try{
    const wb=XLSX.read(new Uint8Array(ev.target.result),{type:"array"});
    const rows=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{header:1,defval:null});
    // ---- e-soft "Employee Cost Report" (.xls, historical 2023–H1 2025) auto-detect ----
    const topTxt=rows.slice(0,14).map(r=>(r||[]).map(c=>String(c==null?"":c)).join(" ")).join(" ").toLowerCase();
    if(topTxt.includes("employee cost report")){
      let ey=null,em=null;
      for(let i=0;i<12&&i<rows.length;i++){ (rows[i]||[]).forEach(c=>{ if(typeof c==="string"){ const m=c.match(/(\d{2})\/(\d{4})/); if(m&&ey==null){em=+m[1]-1;ey=m[2];} } }); }
      if(ey==null){ alert("Could not read the e-soft payroll period (looking for Month Range: MM/YYYY)."); return; }
      const staff=[];
      rows.forEach(r=>{ if(!r)return; const code=String(r[1]==null?"":r[1]).trim();
        if(!/^\d{2,5}$/.test(code)) return;                       // employee rows only (skips titles/totals)
        const name=String(r[3]==null?"":r[3]).trim();
        const gross=num(r[12]), ded=num(r[14]), ctc=num(r[21]);   // e-soft fixed columns
        staff.push({code:code,name:name||("Employee "+code),dept:"Unspecified",gross:Math.round(gross*100)/100,net:Math.round((gross-ded)*100)/100,ctc:Math.round(ctc*100)/100});
      });
      if(!staff.length){ alert("No employee rows found in the e-soft report."); return; }
      if(!DATA.years[ey])DATA.years[ey]={}; normalize(DATA);
      if(DATA.payroll[ey]&&DATA.payroll[ey][em]){ const ex=DATA.payroll[ey][em];
        if(!confirm(MONTHS[em]+" "+ey+" payroll is already imported ("+(ex.staff?ex.staff.length:0)+" staff). Re-importing will REPLACE it. Continue?")) return; }
      let tctc=0,tnet=0,tg=0; staff.forEach(s=>{tctc+=s.ctc;tnet+=s.net;tg+=s.gross;});
      tctc=Math.round(tctc*100)/100; tnet=Math.round(tnet*100)/100; tg=Math.round(tg*100)/100;
      DATA.years[ey].payroll_ctc[em]=tctc; DATA.years[ey].payroll_paid[em]=tnet;
      if(!DATA.payroll[ey])DATA.payroll[ey]={};
      DATA.payroll[ey][em]={period:(em+1<10?"0":"")+(em+1)+"/"+ey,importedAt:new Date().toISOString().slice(0,16).replace("T"," "),importedBy:(user&&(user.name||user.username))||"",source:"e-soft",gross:tg,net:tnet,ctc:tctc,staff:staff};
      if(!DATA.payDept[ey])DATA.payDept[ey]={}; const dep={}; staff.forEach(s=>{dep[s.dept]=dep[s.dept]||{ctc:0,net:0,n:0};dep[s.dept].ctc+=s.ctc;dep[s.dept].net+=s.net;dep[s.dept].n++;}); DATA.payDept[ey][em]=dep;
      persist("Imported Payroll (e-soft) — "+MONTHS[em]+" "+ey+" ("+staff.length+" staff)");
      document.getElementById("selYear").value=ey; document.getElementById("selMonth").value=em; initShell(); render();
      flash("Payroll imported (e-soft): "+MONTHS[em]+" "+ey+" · "+staff.length+" staff · Cost to company "+fmt(tctc,true)+" · Net paid "+fmt(tnet,true));
      return;
    }
    let year=null,month=null;
    for(let i=0;i<4;i++){ (rows[i]||[]).forEach(c=>{ if(typeof c==="string"){ const m=c.match(/(\d{2})\/(\d{4})/); if(m&&year==null){month=+m[1]-1;year=m[2];} } }); }
    let hdr=-1; rows.forEach((r,i)=>{ if(hdr<0&&r&&r.some(c=>String(c==null?"":c).toLowerCase().includes("gross"))) hdr=i; });
    if(hdr<0){ alert("Could not find the payroll columns (Gross Salary / Employee cost / Payable Amount). Is this the Soft1 Summary payroll report?"); return; }
    const H=rows[hdr].map(c=>String(c==null?"":c).toLowerCase());
    const ci=kw=>H.findIndex(h=>h.includes(kw));
    const cCode=ci("code")>=0?ci("code"):ci("a/a"), cSur=ci("surname"), cName=H.findIndex(h=>h.includes("name")&&!h.includes("surname"));
    const cGross=ci("gross"), cNet=ci("payable"), cCTC=ci("employee cost")>=0?ci("employee cost"):ci("cost"), cDept=ci("dept");
    let ctc=0,net=0,gross=0; const dept={}; const staff=[];
    for(let i=hdr+1;i<rows.length;i++){ const r=rows[i]; if(!r)continue;
      const lbl=String(r[0]==null?"":r[0]).toLowerCase()+" "+String(r[1]==null?"":r[1]).toLowerCase();
      if(lbl.includes("total")){ ctc=num(r[cCTC]); net=num(r[cNet]); gross=num(r[cGross]); continue; }
      if(cGross>=0&&(num(r[cGross])||num(r[cCTC]))){
        const d=cDept>=0?String(r[cDept]==null?"":r[cDept]).trim():"";
        const sur=cSur>=0?String(r[cSur]==null?"":r[cSur]).trim():"";
        const nm=cName>=0?String(r[cName]==null?"":r[cName]).trim():"";
        const nameFull=(sur+" "+nm).trim()||("Employee "+(r[cCode]||i));
        const code=cCode>=0?String(r[cCode]==null?"":r[cCode]).trim():"";
        staff.push({code:code, name:nameFull, dept:d||"—", gross:Math.round(num(r[cGross])*100)/100, net:Math.round(num(r[cNet])*100)/100, ctc:Math.round(num(r[cCTC])*100)/100});
        if(d){ dept[d]=dept[d]||{ctc:0,net:0,n:0}; dept[d].ctc+=num(r[cCTC]); dept[d].net+=num(r[cNet]); dept[d].n++; }
      }
    }
    if(!ctc){ staff.forEach(s=>{ ctc+=s.ctc; net+=s.net; gross+=s.gross; }); }
    if(year==null){ alert("Imported figures but couldn't read the month from the report title. Set the period, re-import, or enter manually."); return; }
    if(!staff.length){ alert("No employee rows were found in that report."); return; }
    if(!DATA.years[year])DATA.years[year]={}; normalize(DATA);
    // duplicate guard
    if(DATA.payroll[year]&&DATA.payroll[year][month]){ const ex=DATA.payroll[year][month];
      if(!confirm(MONTHS[month]+" "+year+" payroll is already imported ("+(ex.staff?ex.staff.length:0)+" staff, cost to company "+fmt(ex.ctc,true)+").\n\nRe-importing will REPLACE it. Continue?")) return; }
    ctc=Math.round(ctc*100)/100; net=Math.round(net*100)/100; gross=Math.round(gross*100)/100;
    DATA.years[year].payroll_ctc[month]=ctc;
    DATA.years[year].payroll_paid[month]=net;
    if(!DATA.payDept)DATA.payDept={}; if(!DATA.payDept[year])DATA.payDept[year]={}; DATA.payDept[year][month]=dept;
    if(!DATA.payroll[year])DATA.payroll[year]={};
    DATA.payroll[year][month]={period:(month+1<10?"0":"")+(month+1)+"/"+year, importedAt:new Date().toISOString().slice(0,16).replace("T"," "), importedBy:(user&&(user.name||user.username))||"", gross:gross, net:net, ctc:ctc, staff:staff};
    persist("Imported Payroll — "+MONTHS[month]+" "+year+" ("+staff.length+" staff)"); document.getElementById("selYear").value=year; document.getElementById("selMonth").value=month; initShell(); render();
    flash("Payroll imported: "+MONTHS[month]+" "+year+" · "+staff.length+" staff · Cost to company "+fmt(ctc,true)+" · Net paid "+fmt(net,true));
  }catch(err){ alert("Could not read that payroll file. "+err.message); } };
  rd.readAsArrayBuffer(file); }
function latestMonth(y){ let idx=0; const r=DATA.years[y].revenue; for(let i=0;i<12;i++) if(has(r[i]))idx=i;
  if(!r.some(has)){ const c=DATA.years[y].cleans; for(let i=0;i<12;i++) if(has(c[i]))idx=i; } return idx; }
function curY(){ return document.getElementById("selYear").value; }
function curM(){ return +document.getElementById("selMonth").value; }

function render(){
  const vt=visibleTabs();
  document.querySelectorAll("#tabs .tab").forEach((t,i)=>t.classList.toggle("active",vt[i]&&vt[i][0]===activeTab));
  document.querySelectorAll(".view").forEach(v=>v.classList.add("hidden"));
  document.getElementById("periodBadge").textContent=MONTHS[curM()]+" "+curY();
  const map={summary:renderSummary,pl:renderPL,divisions:renderDivisions,payroll:renderPayroll,rentals:renderRentals,ops:renderOps,insights:renderInsights,esoft:renderEsoft,data:renderData,users:renderUsers};
  document.getElementById("view-"+activeTab).classList.remove("hidden");
  Object.values(charts).forEach(c=>{try{c.destroy();}catch(e){}}); charts={};
  map[activeTab]();
}

/* ---------- chart utils ---------- */
function baseOpts(cur,dual){ const o={responsive:true,interaction:{mode:"index",intersect:false},
  plugins:{legend:{position:"bottom",labels:{boxWidth:12,font:{size:12}}},
   tooltip:{callbacks:{label:c=>c.dataset.label+": "+(c.parsed.y===null?"—":(c.dataset.cur?"€":"")+Math.round(c.parsed.y).toLocaleString())}}},
  scales:{y:{ticks:{callback:v=>(cur?"€":"")+v.toLocaleString()}}}};
  if(dual){ o.scales.y1={position:"right",grid:{drawOnChartArea:false}}; }
  return o; }
function mkChart(id,type,labels,ds,opts){ const el=document.getElementById(id); if(!el)return; if(charts[id])charts[id].destroy(); charts[id]=new Chart(el,{type,data:{labels,datasets:ds},options:opts}); }

/* ======================= SUMMARY ======================= */
function renderSummary(){
  const y=curY(),m=curM(),py=(+y-1)+"";
  const cards=[["revenue","Revenue"],["gross_profit","Gross Profit"],["net_profit","Net Profit"],["rentals","Rental Income"],["cleans","WC Cleans"],["payroll_ctc","Payroll (CTC)"]];
  let h='<div class="cards">';
  cards.forEach(([k,lab])=>{
    const md=metric(k), v=(k==="gross_profit")?dGP(y,m):val(y,k,m);
    const pm=m>0?((k==="gross_profit")?dGP(y,m-1):val(y,k,m-1)):((k==="gross_profit")?dGP(py,11):val(py,k,11));
    const pyv=(k==="gross_profit")?dGP(py,m):val(py,k,m);
    const mo=arrow(pctv(v,pm)),yo=arrow(pctv(v,pyv));
    h+=`<div class="card"><div class="k">${lab}</div><div class="v">${fmt(v,md.cur)}</div>
      <div class="d"><span class="${mo.c}">${mo.t}</span> <span class="flat">MoM</span> · <span class="${yo.c}">${yo.t}</span> <span class="flat">YoY</span></div></div>`;
  });
  h+='</div>';
  // ratios
  const rev=val(y,"revenue",m),gp=dGP(y,m),np=val(y,"net_profit",m),cl=val(y,"cleans",m),pc=val(y,"payroll_ctc",m);
  h+='<div class="cards">';
  h+=ratioCard("Gross Margin", has(gp)&&has(rev)?(gp/rev*100).toFixed(1)+"%":"—");
  h+=ratioCard("Net Margin", has(np)&&has(rev)?(np/rev*100).toFixed(1)+"%":"—");
  h+=ratioCard("Revenue / Clean", has(rev)&&has(cl)?"€"+Math.round(rev/cl):"—");
  h+=ratioCard("Payroll % of Rev", has(pc)&&has(rev)?(pc/rev*100).toFixed(1)+"%":"—");
  h+='</div>';
  h+='<div class="grid2"><div class="panel"><h3>Revenue — 3-year trend</h3><canvas id="cSumRev"></canvas></div>'+
     '<div class="panel"><h3>Profitability (this year)</h3><canvas id="cSumProf"></canvas></div></div>';
  h+='<div class="panel"><h3>Year-on-year summary</h3><div class="hint">Full-year or year-to-date totals.</div><div class="tblwrap"><table id="tSumYoY"></table></div></div>';
  document.getElementById("view-summary").innerHTML=h;
  // charts
  mkChart("cSumRev","line",MONTHS,years().map(yy=>({label:yy,data:DATA.years[yy].revenue,borderColor:YEAR_COLORS[yy],backgroundColor:"transparent",tension:.3,spanGaps:true,pointRadius:2,cur:true,borderWidth:yy===y?3:1.5})),baseOpts(true));
  mkChart("cSumProf","bar",MONTHS,[
    {label:"Revenue",data:DATA.years[y].revenue,backgroundColor:"#cbd5e1",cur:true},
    {label:"Gross Profit",data:MONTHS.map((_,i)=>dGP(y,i)),backgroundColor:"#2b3a8c",cur:true},
    {label:"Net Profit",data:DATA.years[y].net_profit,backgroundColor:"#10b981",cur:true}
  ],baseOpts(true));
  yoyTable("tSumYoY",["revenue","gross_profit","net_profit","expenses","payroll_ctc","cleans","jobs"]);
}
function ratioCard(lab,v){ return `<div class="card"><div class="k">${lab}</div><div class="v">${v}</div><div class="d flat">${MONTHS[curM()]} ${curY()}</div></div>`; }

function yoyTable(id,keys){
  const ys=years(); let h="<thead><tr><th>Metric</th>"+ys.map(y=>"<th>"+y+"</th>").join("")+"<th>"+ys[ys.length-1]+" vs "+ys[ys.length-2]+"</th></tr></thead><tbody>";
  keys.forEach(k=>{ const md=metric(k); const tot={};
    h+="<tr><td class='rowlabel'>"+md.label+"</td>";
    ys.forEach(y=>{ let arr = k==="gross_profit"?MONTHS.map((_,i)=>dGP(y,i)):DATA.years[y][k]; const t=sumArr(arr); tot[y]=t; h+="<td>"+fmt(t,md.cur)+"</td>"; });
    const a=tot[ys[ys.length-1]],b=tot[ys[ys.length-2]],ar=arrow(pctv(a,b));
    h+="<td class='"+ar.c+"'>"+ar.t+"</td></tr>";
  });
  h+="</tbody>"; document.getElementById(id).innerHTML=h;
}

/* ======================= DIVISIONS ======================= */
function renderDivisions(){
  const y=curY(), py=(+y-1)+"";
  const dys=divYears();
  const anyData=DIVS.some(dv=>dys.some(yy=>divYearTotal(dv,yy)>0));
  if(!anyData){ document.getElementById("view-divisions").innerHTML='<div class="panel"><h3>Divisions — income split</h3><div class="hint">No divisional data yet. Import a <b>Trial Balance</b> (top bar) to split income by division from the accounts, or import a <b>Soft1 sales report</b> (once we have the format) to break out Loo Sales / Prefab / Tools.</div></div>'; return; }
  // KPI cards per division (selected year total + YoY)
  let h='<div class="cards">';
  DIVS.forEach(dv=>{ const t=divYearTotal(dv,y), p=divYearTotal(dv,py);
    const a=arrow(pctv(t,p));
    h+='<div class="card"><div class="k">'+dv+'</div><div class="v">'+fmt(t,true)+'</div><div class="d"><span class="'+a.c+'">'+a.t+'</span> <span class="flat">vs '+py+'</span></div></div>';
  });
  h+='</div>';
  h+='<div class="grid2"><div class="panel"><h3>Revenue mix by division — '+y+'</h3><canvas id="cDivMix"></canvas></div>'+
     '<div class="panel"><h3>Division share — '+y+'</h3><canvas id="cDivPie"></canvas></div></div>';
  h+='<div class="panel"><h3>Division revenue by month — '+y+'</h3><canvas id="cDivMonth"></canvas></div>';
  // table divisions x years
  h+='<div class="panel"><h3>Division revenue by year</h3><div class="hint">Income split from the accounting records. Note: from Jul 2025 the Soft1 system groups product sales as one line, so Loo Sales / Prefab / Tools for H2-2025 onward fall under “Other (goods)”.</div><div class="tblwrap"><table id="tDiv"></table></div></div>';
  document.getElementById("view-divisions").innerHTML=h;
  // charts
  const monthDs=DIVS.map(dv=>({label:dv,data:MONTHS.map((_,m)=>divVal(dv,y,m)),backgroundColor:DIV_COLORS[dv],stack:"s",cur:true}));
  const oMix=baseOpts(true); oMix.scales.x={stacked:true}; oMix.scales.y.stacked=true;
  mkChart("cDivMix","bar",MONTHS,monthDs,oMix);
  mkChart("cDivMonth","bar",MONTHS,DIVS.map(dv=>({label:dv,data:MONTHS.map((_,m)=>divVal(dv,y,m)),backgroundColor:DIV_COLORS[dv],cur:true})),baseOpts(true));
  // pie
  const el=document.getElementById("cDivPie");
  charts.cDivPie=new Chart(el,{type:"doughnut",data:{labels:DIVS,datasets:[{data:DIVS.map(dv=>divYearTotal(dv,y)),backgroundColor:DIVS.map(dv=>DIV_COLORS[dv])}]},options:{responsive:true,plugins:{legend:{position:"right",labels:{boxWidth:12,font:{size:11}}}}}});
  // table
  let t="<thead><tr><th>Division</th>"+dys.map(yy=>"<th>"+yy+"</th>").join("")+"<th>Share "+y+"</th></tr></thead><tbody>";
  const grand=DIVS.reduce((s,dv)=>s+divYearTotal(dv,y),0)||1;
  DIVS.forEach(dv=>{ t+="<tr><td class='rowlabel'>"+dv+"</td>";
    dys.forEach(yy=>{ t+="<td>"+fmt(divYearTotal(dv,yy),true)+"</td>"; });
    t+="<td>"+(divYearTotal(dv,y)/grand*100).toFixed(1)+"%</td></tr>"; });
  t+="<tr class='total'><td>Total revenue</td>"+dys.map(yy=>"<td>"+fmt(DIVS.reduce((s,dv)=>s+divYearTotal(dv,yy),0),true)+"</td>").join("")+"<td>100%</td></tr>";
  t+="</tbody>"; document.getElementById("tDiv").innerHTML=t;
}

/* ======================= PROFIT & LOSS ======================= */
function renderPL(){
  const y=curY(), py=(+y-1)+"";
  let h='<div class="panel"><h3>Profit &amp; Loss — '+y+'</h3><div class="hint">Monthly, with year total and prior-year comparison. Import a Trial Balance to auto-fill a month.</div><div class="tblwrap"><table id="tPL"></table></div></div>';
  h+='<div class="grid2"><div class="panel"><h3>Income mix — '+y+'</h3><canvas id="cPLmix"></canvas></div>'+
     '<div class="panel"><h3>Revenue vs Net Profit</h3><canvas id="cPLnp"></canvas></div></div>';
  document.getElementById("view-pl").innerHTML=h;
  // Build P&L rows
  const rows=[
    ["Rental Income",(i)=>val(y,"rentals",i),false],
    ["WC Cleans Income",(i)=>val(y,"cleans_rev",i),false],
    ["Goods &amp; Other Sales",(i)=>dGoods(y,i),false],
    ["Total Revenue",(i)=>val(y,"revenue",i),true],
    ["Cost of Sales",(i)=>neg(dCogs(y,i)),false],
    ["Gross Profit",(i)=>dGP(y,i),true],
    ["Other Income",(i)=>val(y,"other_income",i),false],
    ["Staff Costs",(i)=>neg(val(y,"salaries",i)),false],
    ["Total Operating Expenses",(i)=>neg(val(y,"expenses",i)),false],
    ["Net Profit",(i)=>val(y,"net_profit",i),true]
  ];
  let t="<thead><tr><th>Line item</th>"+MONTHS.map(m=>"<th>"+m+"</th>").join("")+"<th>"+y+" Total</th><th>"+py+" Total</th></tr></thead><tbody>";
  rows.forEach(([lab,fn,tot])=>{
    t+="<tr class='"+(tot?"total":"")+"'><td>"+lab+"</td>";
    let arr=[]; for(let i=0;i<12;i++){const v=fn(i);arr.push(v);t+="<td>"+fmt(v,true)+"</td>";}
    t+="<td><b>"+fmt(sumArr(arr),true)+"</b></td>";
    // prior year total for same line
    let pv=priorLineTotal(lab,py);
    t+="<td>"+fmt(pv,true)+"</td></tr>";
    if(lab==="Total Revenue"||lab==="Gross Profit"){ t+=marginRow(lab,y); }
  });
  t+="</tbody>"; document.getElementById("tPL").innerHTML=t;
  // charts
  mkChart("cPLmix","bar",MONTHS,[
    {label:"Rentals",data:DATA.years[y].rentals,backgroundColor:"#2b3a8c",stack:"s",cur:true},
    {label:"WC Cleans",data:DATA.years[y].cleans_rev,backgroundColor:"#10b981",stack:"s",cur:true},
    {label:"Goods & Other",data:MONTHS.map((_,i)=>dGoods(y,i)),backgroundColor:"#f59e0b",stack:"s",cur:true}
  ],(()=>{const o=baseOpts(true);o.scales.x={stacked:true};o.scales.y.stacked=true;return o;})());
  mkChart("cPLnp","bar",MONTHS,[
    {label:"Revenue",data:DATA.years[y].revenue,backgroundColor:"#cbd5e1",cur:true},
    {type:"line",label:"Net Profit",data:DATA.years[y].net_profit,borderColor:"#1e2a78",backgroundColor:"transparent",borderWidth:2,tension:.3,spanGaps:true,cur:true}
  ],baseOpts(true));
}
function neg(v){ return has(v)? -Math.abs(v)*Math.sign(v)*-1 : v; } // keep sign; costs displayed positive in totals
function marginRow(after,y){
  let t="<tr class='sub'><td>"+(after==="Total Revenue"?"— (memo)":"Gross Margin %")+"</td>";
  if(after==="Total Revenue"){ for(let i=0;i<13;i++)t+="<td></td>"; t+="<td></td>"; return ""; }
  for(let i=0;i<12;i++){ const g=dGP(y,i),r=val(y,"revenue",i); t+="<td>"+(has(g)&&has(r)?(g/r*100).toFixed(0)+"%":"—")+"</td>"; }
  const gt=sumArr(MONTHS.map((_,i)=>dGP(y,i))),rt=sumArr(DATA.years[y].revenue);
  t+="<td>"+(has(gt)&&has(rt)?(gt/rt*100).toFixed(0)+"%":"—")+"</td><td></td></tr>";
  return t;
}
function priorLineTotal(lab,py){
  const map={"Rental Income":"rentals","WC Cleans Income":"cleans_rev","Total Revenue":"revenue","Other Income":"other_income","Net Profit":"net_profit"};
  if(map[lab]) return sumArr(DATA.years[py][map[lab]]);
  if(lab==="Goods &amp; Other Sales") return sumArr(MONTHS.map((_,i)=>dGoods(py,i)));
  if(lab==="Gross Profit") return sumArr(MONTHS.map((_,i)=>dGP(py,i)));
  if(lab==="Cost of Sales") return sumArr(MONTHS.map((_,i)=>dCogs(py,i)));
  if(lab==="Staff Costs") return sumArr(DATA.years[py].salaries);
  if(lab==="Total Operating Expenses") return sumArr(DATA.years[py].expenses);
  return null;
}

/* ======================= PAYROLL ======================= */
let payQuery="", payEmp=null;
function empKeyOf(s){ return (s.code||"")+"|"+s.name; }
function gotoPayMonth(i){ document.getElementById("selMonth").value=i; payEmp=null; render(); }
function renderPayroll(){
  const y=curY(), m=curM();
  const pr=DATA.payroll[y]||{};
  const imported=[]; for(let i=0;i<12;i++) if(pr[i]) imported.push(i);
  // imported-months tracker
  let chips=MONTHS.map((mn,i)=>{ const on=!!pr[i];
    const tip=on?(pr[i].staff.length+" staff · CTC "+fmt(pr[i].ctc,true)+" · imported "+(pr[i].importedAt||"")+(pr[i].importedBy?" by "+esc(pr[i].importedBy):"")):"not imported";
    return '<span class="mchip'+(on?" on":"")+(i===m?" cur":"")+'" title="'+tip+'" data-h="gotoPayMonth('+i+')">'+mn+(on?" ✓":"")+'</span>'; }).join("");
  let h='<div class="panel"><div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><h3 style="margin:0">Payroll — '+y+'</h3>'+
    '<span class="note">'+imported.length+' of 12 months imported</span></div>'+
    '<div class="hint">Source: <b>Soft1 → Payroll → Payroll reports → Financial printouts → Payroll report (Summary)</b>. Save as Excel and use <b>⬆ Import Payroll</b> on the top bar. Re-importing a month replaces it (you\'ll be asked to confirm).</div>'+
    '<div class="mchips">'+chips+'</div></div>';
  // yearly summary table + charts
  h+='<div class="panel"><h3>Cost-to-company vs net paid</h3><div class="tblwrap"><table id="tPay"></table></div></div>';
  h+='<div class="grid2"><div class="panel"><h3>CTC vs Paid</h3><canvas id="cPay"></canvas></div>'+
     '<div class="panel"><h3>Payroll as % of revenue</h3><canvas id="cPayPct"></canvas></div></div>';
  // per-month detail
  const rec=pr[m];
  if(!rec){ h+='<div class="panel"><h3>'+MONTHS[m]+' '+y+' — staff detail</h3><div class="hint">No payroll imported for this month yet. Use ⬆ Import Payroll on the top bar.</div></div>'; }
  else if(payEmp){ h+=empPanel(y,rec); }
  else {
    // department breakdown
    const dep={}; rec.staff.forEach(s=>{ dep[s.dept]=dep[s.dept]||{ctc:0,net:0,gross:0,n:0}; dep[s.dept].ctc+=s.ctc; dep[s.dept].net+=s.net; dep[s.dept].gross+=s.gross; dep[s.dept].n++; });
    let dt="<thead><tr><th>Category</th><th>Staff</th><th>Gross</th><th>Net paid</th><th>Cost to company</th><th>% of month</th></tr></thead><tbody>";
    Object.keys(dep).sort((a,b)=>dep[b].ctc-dep[a].ctc).forEach(d=>{ const v=dep[d];
      dt+="<tr><td class='rowlabel'>"+esc(d)+"</td><td>"+v.n+"</td><td>"+fmt(v.gross,true)+"</td><td>"+fmt(v.net,true)+"</td><td>"+fmt(v.ctc,true)+"</td><td>"+(rec.ctc?(v.ctc/rec.ctc*100).toFixed(0):0)+"%</td></tr>"; });
    dt+="<tr class='total'><td>Total</td><td>"+rec.staff.length+"</td><td>"+fmt(rec.gross,true)+"</td><td>"+fmt(rec.net,true)+"</td><td>"+fmt(rec.ctc,true)+"</td><td>100%</td></tr></tbody>";
    h+='<div class="panel"><h3>'+MONTHS[m]+' '+y+' — by category</h3><div class="tblwrap"><table>'+dt+'</table></div></div>';
    // YTD by category (cumulative Jan..selected month, imported months only)
    const ydep={}; const allEmps={}; let ymonths=0, ytc=0,ytn=0,ytg=0;
    for(let i=0;i<=m;i++){ if(!pr[i])continue; ymonths++;
      pr[i].staff.forEach(s=>{ const dp=s.dept; ydep[dp]=ydep[dp]||{ctc:0,net:0,gross:0,emps:{}};
        ydep[dp].ctc+=s.ctc; ydep[dp].net+=s.net; ydep[dp].gross+=s.gross; ydep[dp].emps[empKeyOf(s)]=1; allEmps[empKeyOf(s)]=1; }); }
    let yt="<thead><tr><th>Category</th><th>Staff</th><th>Gross</th><th>Net paid</th><th>Cost to company</th></tr></thead><tbody>";
    Object.keys(ydep).sort((a,b)=>ydep[b].ctc-ydep[a].ctc).forEach(d=>{ const v=ydep[d]; ytc+=v.ctc;ytn+=v.net;ytg+=v.gross;
      yt+="<tr><td class='rowlabel'>"+esc(d)+"</td><td>"+Object.keys(v.emps).length+"</td><td>"+fmt(v.gross,true)+"</td><td>"+fmt(v.net,true)+"</td><td>"+fmt(v.ctc,true)+"</td></tr>"; });
    yt+="<tr class='total'><td>Total</td><td>"+Object.keys(allEmps).length+"</td><td>"+fmt(ytg,true)+"</td><td>"+fmt(ytn,true)+"</td><td>"+fmt(ytc,true)+"</td></tr></tbody>";
    h+='<div class="panel"><h3>Year to date — by category</h3><div class="hint">Cumulative across '+ymonths+' imported month'+(ymonths!==1?'s':'')+' (Jan–'+MONTHS[m]+' '+y+'). Staff = distinct people paid in the period.</div><div class="tblwrap"><table>'+yt+'</table></div></div>';
    // staff list
    h+='<div class="panel"><div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><h3 style="margin:0">'+MONTHS[m]+' '+y+' — staff ('+rec.staff.length+')</h3>'+
       '<input id="paySearch" placeholder="Search name, code or category…" style="flex:1;min-width:180px" value="'+esc(payQuery)+'"></div>'+
       '<div class="hint">Click a name to see their pay history and add comments.</div>'+
       '<div class="tblwrap"><table id="tStaff"></table></div></div>';
  }
  document.getElementById("view-payroll").innerHTML=h;
  // yearly table
  let t="<thead><tr><th>Line</th>"+MONTHS.map(mn=>"<th>"+mn+"</th>").join("")+"<th>Total</th></tr></thead><tbody>";
  const ctc=DATA.years[y].payroll_ctc, paid=DATA.years[y].payroll_paid, rev=DATA.years[y].revenue, sal=DATA.years[y].salaries;
  const line=(lab,arr,cls)=>{let r="<tr class='"+(cls||"")+"'><td>"+lab+"</td>";for(let i=0;i<12;i++)r+="<td>"+fmt(arr[i],true)+"</td>";r+="<td><b>"+fmt(sumArr(arr),true)+"</b></td></tr>";return r;};
  t+=line("Cost to Company (gross)",ctc);
  t+=line("Payroll Paid (net)",paid,"sub");
  const diff=MONTHS.map((_,i)=>has(ctc[i])&&has(paid[i])?ctc[i]-paid[i]:null);
  t+=line("Deductions & employer cost",diff,"sub");
  t+=line("Staff Costs per P&L",sal,"sub");
  t+="<tr class='total'><td>Payroll % of revenue</td>";
  for(let i=0;i<12;i++){t+="<td>"+(has(ctc[i])&&has(rev[i])?(ctc[i]/rev[i]*100).toFixed(0)+"%":"—")+"</td>";}
  const ct=sumArr(ctc),rt=sumArr(rev); t+="<td>"+(has(ct)&&has(rt)?(ct/rt*100).toFixed(1)+"%":"—")+"</td></tr>";
  t+="</tbody>"; document.getElementById("tPay").innerHTML=t;
  mkChart("cPay","bar",MONTHS,[
    {label:"Cost to Company",data:ctc,backgroundColor:"#1e2a78",cur:true},
    {label:"Paid (net)",data:paid,backgroundColor:"#10b981",cur:true}
  ],baseOpts(true));
  mkChart("cPayPct","line",MONTHS,[{label:"Payroll % of revenue",data:MONTHS.map((_,i)=>has(ctc[i])&&has(rev[i])?+(ctc[i]/rev[i]*100).toFixed(1):null),borderColor:"#f59e0b",backgroundColor:"transparent",tension:.3,spanGaps:true}],
    (()=>{const o=baseOpts(false);o.scales.y.ticks={callback:v=>v+"%"};return o;})());
  if(rec&&!payEmp){ drawStaff(rec); const si=document.getElementById("paySearch");
    if(si){ si.oninput=e=>{ payQuery=e.target.value; drawStaff(rec); }; } }
}
function drawStaff(rec){ const q=payQuery.trim().toLowerCase();
  const list=rec.staff.filter(s=>!q||(s.name+" "+s.code+" "+s.dept).toLowerCase().includes(q))
    .sort((a,b)=>b.ctc-a.ctc);
  let t="<thead><tr><th>Employee</th><th>Category</th><th>Gross</th><th>Net paid</th><th>Cost to company</th><th></th></tr></thead><tbody>";
  list.forEach(s=>{ const k=empKeyOf(s); const nc=(DATA.payComments[k]||[]).length;
    t+="<tr><td class='rowlabel'><a href='#' onclick=\"openEmp('"+esc(k).replace(/'/g,"\\'")+"');return false\">"+esc(s.name)+"</a>"+(s.code?" <span class='note'>#"+esc(s.code)+"</span>":"")+"</td><td>"+esc(s.dept)+"</td><td>"+fmt(s.gross,true)+"</td><td>"+fmt(s.net,true)+"</td><td>"+fmt(s.ctc,true)+"</td><td>"+(nc?"💬 "+nc:"")+"</td></tr>"; });
  if(!list.length) t+="<tr><td colspan='6' class='note'>No matches.</td></tr>";
  t+="</tbody>"; const el=document.getElementById("tStaff"); if(el) el.innerHTML=t;
}
function openEmp(k){ payEmp=k; render(); }
function closeEmp(){ payEmp=null; render(); }
function empPanel(y,rec){ const s=rec.staff.find(x=>empKeyOf(x)===payEmp);
  if(!s) return '<div class="panel"><a href="#" data-h="closeEmp();return false">← back to staff</a><div class="hint">Employee not in this month.</div></div>';
  let h='<div class="panel"><div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><a href="#" data-h="closeEmp();return false">← staff</a>'+
    '<h3 style="margin:0">'+esc(s.name)+'</h3><span class="note">'+esc(s.dept)+(s.code?" · #"+esc(s.code):"")+'</span></div>';
  // pay history across imported months of the year, with YTD total
  const pr=DATA.payroll[y]||{}; let rows=""; let tg=0,tn=0,tc=0,mp=0;
  for(let i=0;i<12;i++){ if(!pr[i])continue; const e=pr[i].staff.find(x=>empKeyOf(x)===payEmp);
    if(e){ tg+=e.gross; tn+=e.net; tc+=e.ctc; mp++; }
    rows+="<tr"+(i===curM()?" class='cur'":"")+"><td>"+MONTHS[i]+"</td><td>"+(e?esc(e.dept):"—")+"</td><td>"+(e?fmt(e.gross,true):"—")+"</td><td>"+(e?fmt(e.net,true):"—")+"</td><td>"+(e?fmt(e.ctc,true):"—")+"</td></tr>"; }
  rows+="<tr class='total'><td>Year to date</td><td>"+mp+" mo</td><td>"+fmt(tg,true)+"</td><td>"+fmt(tn,true)+"</td><td>"+fmt(tc,true)+"</td></tr>";
  h+='<div class="hint">Pay by month for '+y+', with the year-to-date total across '+mp+' month'+(mp!==1?'s':'')+' paid.</div>'+
    '<div class="tblwrap"><table><thead><tr><th>Month</th><th>Category</th><th>Gross</th><th>Net paid</th><th>Cost to company</th></tr></thead><tbody>'+rows+'</tbody></table></div></div>';
  // comments
  const cs=DATA.payComments[payEmp]||[]; let cl=cs.map((c,idx)=>'<div class="cmt"><div class="note">'+esc(c.at)+" · "+esc(c.by||"")+(canEdit()?' <a href="#" data-h="delEmpComment('+idx+');return false" style="float:right">✕</a>':'')+'</div><div>'+esc(c.text)+'</div></div>').join("");
  h+='<div class="panel"><h3>Comments</h3>'+(cl||'<div class="note">No comments yet.</div>')+
     (canEdit()?'<div style="display:flex;gap:8px;margin-top:10px"><input id="empCmt" placeholder="Add a comment about this employee…" style="flex:1"><button class="ghost" data-h="addEmpComment()">Add</button></div>':'')+'</div>';
  return h;
}
function addEmpComment(){ if(!canEdit())return; const el=document.getElementById("empCmt"); const txt=(el.value||"").trim(); if(!txt)return;
  if(!DATA.payComments[payEmp])DATA.payComments[payEmp]=[];
  const s=(DATA.payroll[curY()][curM()].staff.find(x=>empKeyOf(x)===payEmp)||{}).name||payEmp;
  DATA.payComments[payEmp].push({at:new Date().toISOString().slice(0,16).replace("T"," "),by:(user&&(user.name||user.username))||"",text:txt});
  persist("Comment on "+s); render(); }
function delEmpComment(idx){ if(!canEdit())return; const cs=DATA.payComments[payEmp]; if(!cs||!cs[idx])return;
  if(!confirm("Delete this comment?"))return; cs.splice(idx,1); persist("Deleted a payroll comment"); render(); }

/* ======================= RENTALS ======================= */
function renderRentals(){
  const y=curY();
  let h='<div class="cards" id="rentCards"></div>';
  h+='<div class="panel"><h3>Rental billing waterfall — '+y+'</h3><div class="hint">Charged → Invoiced → Received, plus waybills still outstanding. Enter figures in the Data tab.</div><div class="tblwrap"><table id="tRent"></table></div></div>';
  h+='<div class="grid2"><div class="panel"><h3>Rental income by month (3-year)</h3><canvas id="cRent"></canvas></div>'+
     '<div class="panel"><h3>Invoiced vs Received</h3><canvas id="cRentCI"></canvas></div></div>';
  document.getElementById("view-rentals").innerHTML=h;
  const rent=DATA.years[y].rentals, rev=DATA.years[y].revenue, ch=DATA.years[y].rent_charged, inv=DATA.years[y].rent_invoiced, rec=DATA.years[y].rent_received, wb=DATA.years[y].waybills_outstanding;
  const rt=sumArr(rent), rvt=sumArr(rev);
  let cds="";
  cds+=ratioCardRaw("Rental income (YTD)",fmt(rt,true));
  cds+=ratioCardRaw("Rental % of revenue",has(rt)&&has(rvt)?(rt/rvt*100).toFixed(1)+"%":"—");
  cds+=ratioCardRaw("Avg / month",has(rt)?fmt(rt/rent.filter(has).length,true):"—");
  const outstanding=(has(sumArr(inv))&&has(sumArr(rec)))?sumArr(inv)-sumArr(rec):null;
  cds+=ratioCardRaw("Invoiced − Received",has(outstanding)?fmt(outstanding,true):"—");
  cds+=ratioCardRaw("Waybills outstanding",has(sumArr(wb))?fmt(wb.filter(has).slice(-1)[0],true):"—");
  document.getElementById("rentCards").innerHTML=cds;
  let t="<thead><tr><th>Line</th>"+MONTHS.map(m=>"<th>"+m+"</th>").join("")+"<th>Total</th></tr></thead><tbody>";
  const line=(lab,arr,cls)=>{let r="<tr class='"+(cls||"")+"'><td>"+lab+"</td>";for(let i=0;i<12;i++)r+="<td>"+fmt(arr[i],true)+"</td>";r+="<td><b>"+fmt(sumArr(arr),true)+"</b></td></tr>";return r;};
  t+=line("Rent Charged",ch);
  t+=line("Rent Invoiced",inv,"sub");
  t+=line("Rent Received",rec,"sub");
  const outArr=MONTHS.map((_,i)=>has(inv[i])&&has(rec[i])?inv[i]-rec[i]:null);
  t+=line("Outstanding (invoiced−received)",outArr,"sub");
  t+=line("Waybills outstanding",wb,"sub");
  t+=line("Rental Income (P&L)",rent,"total");
  t+="<tr class='total'><td>Rental % of revenue</td>";
  for(let i=0;i<12;i++)t+="<td>"+(has(rent[i])&&has(rev[i])?(rent[i]/rev[i]*100).toFixed(0)+"%":"—")+"</td>";
  t+="<td>"+(has(rt)&&has(rvt)?(rt/rvt*100).toFixed(1)+"%":"—")+"</td></tr></tbody>";
  document.getElementById("tRent").innerHTML=t;
  mkChart("cRent","bar",MONTHS,years().map(yy=>({label:yy,data:DATA.years[yy].rentals,backgroundColor:yy===y?"#2b3a8c":(YEAR_COLORS[yy]||"#cbd5e1"),cur:true})),baseOpts(true));
  mkChart("cRentCI","bar",MONTHS,[
    {label:"Invoiced",data:inv,backgroundColor:"#2b3a8c",cur:true},
    {label:"Received",data:rec,backgroundColor:"#10b981",cur:true},
    {type:"line",label:"Waybills outstanding",data:wb,borderColor:"#f59e0b",backgroundColor:"transparent",borderWidth:2,tension:.3,spanGaps:true,cur:true}
  ],baseOpts(true));
}
function ratioCardRaw(lab,v){ return `<div class="card"><div class="k">${lab}</div><div class="v">${v}</div></div>`; }

/* ======================= OPERATIONS ======================= */
function renderOps(){
  const y=curY();
  let h='<div class="panel"><h3>Operational KPIs — '+y+' (Jobwatch)</h3><div class="hint">Import the Jobwatch operations report to update. Not-Done % flags missed service.</div><div class="tblwrap"><table id="tOps"></table></div></div>';
  h+='<div class="grid2"><div class="panel"><h3>Cleans — 3-year</h3><canvas id="cOpsCl"></canvas></div>'+
     '<div class="panel"><h3>Jobs vs Active sites — '+y+'</h3><canvas id="cOpsJob"></canvas></div></div>';
  document.getElementById("view-ops").innerHTML=h;
  const keys=["cleans","jobs","active_sites","deliveries","pickups","not_done"];
  let t="<thead><tr><th>KPI</th>"+MONTHS.map(m=>"<th>"+m+"</th>").join("")+"<th>Total</th></tr></thead><tbody>";
  keys.forEach(k=>{const a=DATA.years[y][k];t+="<tr><td class='rowlabel'>"+metric(k).label+"</td>";for(let i=0;i<12;i++)t+="<td>"+fmt(a[i],false)+"</td>";t+="<td><b>"+fmt(sumArr(a),false)+"</b></td></tr>";});
  // completion rate
  t+="<tr class='total'><td>Not-Done %</td>";
  const jb=DATA.years[y].jobs, nd=DATA.years[y].not_done;
  for(let i=0;i<12;i++){const den=has(jb[i])?jb[i]+ (has(nd[i])?nd[i]:0):null; t+="<td>"+(has(nd[i])&&has(den)?(nd[i]/den*100).toFixed(1)+"%":"—")+"</td>";}
  const ndt=sumArr(nd),jbt=sumArr(jb); t+="<td>"+(has(ndt)&&has(jbt)?(ndt/(jbt+ndt)*100).toFixed(1)+"%":"—")+"</td></tr></tbody>";
  document.getElementById("tOps").innerHTML=t;
  mkChart("cOpsCl","line",MONTHS,years().map(yy=>({label:yy,data:DATA.years[yy].cleans,borderColor:YEAR_COLORS[yy],backgroundColor:"transparent",tension:.3,spanGaps:true,pointRadius:2,borderWidth:yy===y?3:1.5})),baseOpts(false));
  mkChart("cOpsJob","bar",MONTHS,[
    {label:"Jobs / Visits",data:DATA.years[y].jobs,backgroundColor:"#2b3a8c"},
    {label:"Active sites",data:DATA.years[y].active_sites,backgroundColor:"#10b981"}
  ],baseOpts(false));
}

/* ======================= INSIGHTS (drill-down) ======================= */
function renderInsights(){
  const y=curY();
  let opsOpt=METRICS.filter(m=>m.grp==="ops").map(m=>`<option value="${m.k}">${m.label}</option>`).join("");
  let finOpt=METRICS.filter(m=>m.grp==="fin").map(m=>`<option value="${m.k}">${m.label}</option>`).join("");
  let h='<div class="panel"><h3>Decision insights — relationship explorer</h3>'+
    '<div class="hint">Pick an operational driver and a financial outcome to see how they move together (e.g. Cleans vs Revenue). Correlation and unit economics update live.</div>'+
    '<div style="display:flex;gap:14px;flex-wrap:wrap;align-items:center;margin-bottom:6px;">'+
    '<label class="kpi-mini">Driver </label><select id="insA">'+opsOpt+'</select>'+
    '<label class="kpi-mini">Outcome </label><select id="insB">'+finOpt+'</select>'+
    '<label class="kpi-mini">Year </label><select id="insY">'+years().map(yy=>`<option ${yy===y?"selected":""}>${yy}</option>`).join("")+'</select>'+
    '</div></div>';
  h+='<div class="cards" id="insCards"></div>';
  h+='<div class="panel"><h3 id="insTitle"></h3><canvas id="cIns"></canvas></div>';
  h+='<div class="panel"><h3>Monthly detail</h3><div class="tblwrap"><table id="tIns"></table></div></div>';
  document.getElementById("view-insights").innerHTML=h;
  const sa=document.getElementById("insA"), sb=document.getElementById("insB"), sYy=document.getElementById("insY");
  sa.value=insMetricA; sb.value=insMetricB;
  sa.onchange=()=>{insMetricA=sa.value;drawInsights();};
  sb.onchange=()=>{insMetricB=sb.value;drawInsights();};
  sYy.onchange=()=>{document.getElementById("selYear").value=sYy.value;drawInsights();};
  drawInsights();
}
function drawInsights(){
  const y=document.getElementById("insY").value;
  const a=insMetricA,b=insMetricB, ma=metric(a),mb=metric(b);
  const A=DATA.years[y][a].map(v=>has(v)?num(v):null), B=DATA.years[y][b].map(v=>has(v)?num(v):null);
  // pairs
  const pairs=[]; for(let i=0;i<12;i++) if(A[i]!==null&&B[i]!==null) pairs.push([A[i],B[i]]);
  const r=pearson(pairs);
  const ta=sumArr(A), tb=sumArr(B);
  const unit=(has(tb)&&has(ta)&&ta!==0)? tb/ta : null;
  let cds="";
  cds+=ratioCardRaw(ma.label+" (total)",fmt(ta,ma.cur));
  cds+=ratioCardRaw(mb.label+" (total)",fmt(tb,mb.cur));
  cds+=ratioCardRaw(mb.label+" per "+ma.label.split(" ")[0], has(unit)?(mb.cur?"€":"")+ (Math.round(unit*100)/100).toLocaleString():"—");
  cds+=ratioCardRaw("Correlation (r)", r===null?"—":r.toFixed(2)+" "+corrTag(r));
  document.getElementById("insCards").innerHTML=cds;
  document.getElementById("insTitle").textContent=ma.label+" vs "+mb.label+" — "+y;
  const o=baseOpts(false,true);
  o.scales.y.title={display:true,text:ma.label}; o.scales.y1.title={display:true,text:mb.label};
  mkChart("cIns","bar",MONTHS,[
    {label:ma.label,data:A,backgroundColor:"#2b3a8c",yAxisID:"y",cur:ma.cur},
    {type:"line",label:mb.label,data:B,borderColor:"#f59e0b",backgroundColor:"transparent",borderWidth:2,tension:.3,spanGaps:true,yAxisID:"y1",cur:mb.cur}
  ],o);
  let t="<thead><tr><th>Month</th><th>"+ma.label+"</th><th>"+mb.label+"</th><th>"+mb.label+" per "+ma.label.split(" ")[0]+"</th></tr></thead><tbody>";
  for(let i=0;i<12;i++){ const u=(A[i]&&B[i]!==null)?B[i]/A[i]:null;
    t+="<tr><td>"+MONTHS[i]+"</td><td>"+fmt(A[i],ma.cur)+"</td><td>"+fmt(B[i],mb.cur)+"</td><td>"+(has(u)?(mb.cur?"€":"")+fmt1(u):"—")+"</td></tr>";}
  t+="<tr class='total'><td>Total / avg</td><td>"+fmt(ta,ma.cur)+"</td><td>"+fmt(tb,mb.cur)+"</td><td>"+(has(unit)?(mb.cur?"€":"")+fmt1(unit):"—")+"</td></tr></tbody>";
  document.getElementById("tIns").innerHTML=t;
}
function pearson(p){ const n=p.length; if(n<3)return null; let sx=0,sy=0,sxy=0,sx2=0,sy2=0;
  p.forEach(([x,y])=>{sx+=x;sy+=y;sxy+=x*y;sx2+=x*x;sy2+=y*y;});
  const d=Math.sqrt((n*sx2-sx*sx)*(n*sy2-sy*sy)); return d===0?null:(n*sxy-sx*sy)/d; }
function corrTag(r){ const a=Math.abs(r); return a>0.7?"(strong)":a>0.4?"(moderate)":"(weak)"; }

/* ======================= DATA & IMPORT ======================= */
function impRow(id,label,fmtNote,desc){ return '<div class="impcard"><label class="filebtn">'+label+'<input id="'+id+'" type="file" accept=".xlsx,.xls,.csv" class="hidden"></label><div class="impmeta"><div class="impfmt">'+fmtNote+'</div><div class="impdesc">'+desc+'</div></div></div>'; }
function renderData(){
  const y=curY();
  let h='<div class="panel"><div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">'+
    '<h3 style="margin:0;">Data — '+y+'</h3>'+
    '<button id="btnEdit" class="ghost">'+(editMode?"✔ Done editing":"✎ Edit")+'</button>'+
    '<button id="btnCsv" class="ghost">Export CSV</button>'+
    '<label class="filebtn">Import CSV<input id="fileCsv" type="file" accept=".csv" class="hidden"></label>'+
    '<div class="spacer" style="flex:1"></div></div>'+
    '<div class="hint">Every metric, all 12 months. Currency values in €.</div>'+
    '<div class="tblwrap"><table id="tData"></table></div></div>';
  // ---- import panel (imports live here only) ----
  h+='<div class="panel"><h3>Import monthly reports</h3><div class="hint">Bring the numbers straight in from Softone / Soft1 / Jobwatch. The period is read from each report, so it files itself to the right month and year.</div><div class="imports">'+
    impRow("fileTB","⬆ Trial Balance","Softone .xlsx","Builds revenue, rental &amp; cleaning income, cost of sales, staff costs, expenses, net profit and the divisional split for that month.")+
    impRow("filePay","⬆ Payroll (Summary)","Soft1 .xlsx / e-soft .xls","Cost-to-company, net paid and the full staff list. Soft1 → Payroll → Payroll reports → Financial printouts → Payroll report (Summary). Also auto-detects the older e-soft \"Employee Cost Report\" (.xls) for 2023–H1 2025 — no departments in that system, so staff show as \"Unspecified\".")+
    impRow("fileJW","⬆ Jobwatch","Jobwatch .xlsx","Operational KPIs — cleans, jobs, sites, deliveries, pick-ups and not-done — for every year in the file.")+
    impRow("fileSales","⬆ Sales report","Soft1 .xlsx","Product-level sales split (portable toilets, prefabs, tools) once the Soft1 export is finalised.")+
    impRow("fileEsoft","⬆ e-soft TB (historical)","e-soft .xlsx","Full account-level trial balance from the old e-soft system (Jan 2023 – Jun 2025). Stored month-by-month for the TB (e-soft) tab, reporting and balance sheet. Not used after Jun 2025.")+
    '</div></div>';
  h+='<div class="panel"><div class="note">Re-importing a month asks you to confirm before it replaces existing figures. <b>Rent charged / invoiced</b> and any 2023–2024 gaps can be typed straight into the table above with <b>✎ Edit</b>.</div></div>';
  document.getElementById("view-data").innerHTML=h;
  document.getElementById("btnEdit").onclick=()=>{editMode=!editMode;render();};
  document.getElementById("btnCsv").onclick=exportCsv;
  document.getElementById("fileCsv").onchange=e=>importCsv(e.target.files[0]);
  const wire=(id,fn)=>{const el=document.getElementById(id); if(el) el.onchange=e=>fn(e.target.files[0]);};
  wire("fileTB",importTB); wire("filePay",importPayroll); wire("fileJW",importJW);
  wire("fileSales",f=>importPending("sales report",f)); wire("fileEsoft",importEsoft);
  let t="<thead><tr><th>Metric</th>"+MONTHS.map(m=>"<th>"+m+"</th>").join("")+"<th>Total</th></tr></thead><tbody>";
  METRICS.forEach(md=>{ const arr=DATA.years[y][md.k];
    t+="<tr><td class='rowlabel'>"+md.label+"</td>";
    for(let i=0;i<12;i++){ const v=arr[i];
      t+= editMode ? "<td><input data-k='"+md.k+"' data-i='"+i+"' value='"+(has(v)?v:"")+"'></td>" : "<td>"+fmt(v,md.cur)+"</td>"; }
    t+="<td><b>"+fmt(sumArr(arr),md.cur)+"</b></td></tr>";
  });
  t+="</tbody>"; document.getElementById("tData").innerHTML=t;
  if(editMode){ document.querySelectorAll("#tData input").forEach(inp=>{ inp.onchange=e=>{
    const k=e.target.dataset.k,i=+e.target.dataset.i,raw=e.target.value.trim().replace(/[€,]/g,"");
    DATA.years[y][k][i]= raw===""?null:parseFloat(raw); persist();
  };});}
}

/* ======================= TB (e-soft) ======================= */
let esoftView="m", esoftQuery="";
const ESOFT_GROUPS=[["100","Non-current assets"],["300","Current assets"],["CON","Debtors (control)"],["400","Liabilities"],["600","Capital & reserves"],["700","Income"],["750","Other income"],["800","Cost of sales"],["900","Expenses"]];
function esoftGroupLabel(t){ const g=ESOFT_GROUPS.find(x=>x[0]===t); return g?g[1]:"Other ("+(t||"?")+")"; }
function efmt(v){ if(v==null||v===""||isNaN(v))return "<span class='muted'>—</span>"; const n=Math.round(v); return "<span class='"+(v<0?"neg":"")+"'>"+(v<0?"(":"")+"€"+Math.abs(n).toLocaleString()+(v<0?")":"")+"</span>"; }
function renderEsoft(){
  const y=curY(), acc=DATA.esoft[y]||{}, meta=DATA.esoftMeta[y]||{}, codes=Object.keys(acc);
  let impMonths=[]; for(let i=0;i<12;i++) if(meta[i]) impMonths.push(i);
  let chips=MONTHS.map((mn,i)=>{const on=!!meta[i]; return '<span class="mchip'+(on?" on":"")+'" title="'+(on?(meta[i].accts+" accounts · imported "+meta[i].at+(meta[i].by?" by "+esc(meta[i].by):"")):"not imported")+'">'+mn+(on?" ✓":"")+'</span>';}).join("");
  let h='<div class="panel"><div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><h3 style="margin:0">Trial Balance — e-soft · '+y+'</h3>'+
    '<span class="note">'+impMonths.length+' of 12 months imported</span><div style="flex:1"></div>'+
    '<div class="seg"><button id="esM" class="'+(esoftView==="m"?"on":"")+'">Movement</button><button id="esC" class="'+(esoftView==="c"?"on":"")+'">Closing balance</button></div></div>'+
    '<div class="hint"><b>Movement</b> = activity in the month (drives the P&amp;L). <b>Closing balance</b> = position at month-end (balance sheet). Credits shown in (brackets). Debtors and suppliers are summarised. Historical system — data ends Jun 2025.</div>'+
    '<div class="mchips">'+chips+'</div></div>';
  if(!codes.length){ h+='<div class="panel"><div class="hint">No e-soft TB imported for '+y+' yet. Go to <b>Data &amp; Import</b> → <b>e-soft TB (historical)</b> and upload the monthly Excel files.</div></div>'; document.getElementById("view-esoft").innerHTML=h; return; }
  const isDebtor=n=>/DEBTOR|RECEIVABLE/i.test(n), isCreditor=n=>/CREDITOR|SUPPLIER|PAYABLE/i.test(n);
  const groups={}, ensure=t=>groups[t]||(groups[t]={rows:[]});
  const debt={m:Array(12).fill(0),c:Array(12).fill(0),any:false}, cred={m:Array(12).fill(0),c:Array(12).fill(0),any:false};
  codes.sort().forEach(code=>{ const a=acc[code], nm=a.n||"";
    if(isDebtor(nm)){ for(let i=0;i<12;i++){ if(a.m[i]!=null)debt.m[i]+=a.m[i]; if(a.c[i]!=null)debt.c[i]+=a.c[i]; } debt.any=true; return; }
    if(isCreditor(nm)){ for(let i=0;i<12;i++){ if(a.m[i]!=null)cred.m[i]+=a.m[i]; if(a.c[i]!=null)cred.c[i]+=a.c[i]; } cred.any=true; return; }
    ensure(a.t).rows.push({label:code+" · "+nm,m:a.m,c:a.c}); });
  if(debt.any) ensure("CON").rows.unshift({label:"TRADE DEBTORS (summarised)",m:debt.m,c:debt.c});
  if(cred.any) ensure("400").rows.unshift({label:"TRADE CREDITORS (summarised)",m:cred.m,c:cred.c});
  const q=esoftQuery.trim().toLowerCase();
  let t="<thead><tr><th style='text-align:left'>Account</th>"+MONTHS.map(mn=>"<th>"+mn+"</th>").join("")+"<th>"+(esoftView==="m"?"Year":"Latest")+"</th></tr></thead><tbody>";
  const order=ESOFT_GROUPS.concat(Object.keys(groups).filter(tp=>!ESOFT_GROUPS.some(g=>g[0]===tp)).map(tp=>[tp,esoftGroupLabel(tp)]));
  order.forEach(([tp,lbl])=>{ const g=groups[tp]; if(!g||!g.rows.length)return;
    const rws=g.rows.filter(r=>!q||r.label.toLowerCase().includes(q)); if(!rws.length)return;
    t+="<tr class='grp'><td colspan='14'>"+esc(lbl)+"</td></tr>";
    const sub=Array(12).fill(0);
    rws.forEach(r=>{ const arr=esoftView==="m"?r.m:r.c;
      t+="<tr><td class='rowlabel'>"+esc(r.label)+"</td>";
      for(let i=0;i<12;i++){ const v=arr[i]; t+="<td>"+efmt(v)+"</td>"; if(v!=null)sub[i]+=v; }
      let yr; if(esoftView==="m")yr=arr.reduce((s,v)=>s+(v||0),0); else { yr=null; for(let i=0;i<12;i++) if(arr[i]!=null)yr=arr[i]; }
      t+="<td>"+efmt(yr)+"</td></tr>"; });
    t+="<tr class='sub'><td>Subtotal — "+esc(lbl)+"</td>";
    for(let i=0;i<12;i++) t+="<td>"+(meta[i]?efmt(sub[i]):"<span class='muted'>—</span>")+"</td>";
    let ys; if(esoftView==="m")ys=sub.reduce((s,v)=>s+v,0); else { ys=null; for(let i=0;i<12;i++) if(meta[i])ys=sub[i]; }
    t+="<td>"+efmt(ys)+"</td></tr>"; });
  const tDr=Array(12).fill(0),tCr=Array(12).fill(0);
  codes.forEach(code=>{ const a=acc[code], arr=esoftView==="m"?a.m:a.c; for(let i=0;i<12;i++){ const v=arr[i]; if(v==null)continue; if(v>=0)tDr[i]+=v; else tCr[i]+=-v; } });
  t+="<tr class='total'><td>Total Debit</td>"; for(let i=0;i<12;i++)t+="<td>"+(meta[i]?efmt(tDr[i]):"<span class='muted'>—</span>")+"</td>"; t+="<td></td></tr>";
  t+="<tr class='total'><td>Total Credit</td>"; for(let i=0;i<12;i++)t+="<td>"+(meta[i]?efmt(tCr[i]):"<span class='muted'>—</span>")+"</td>"; t+="<td></td></tr>";
  t+="<tr class='total'><td>Difference</td>"; for(let i=0;i<12;i++){ const d=Math.round((tDr[i]-tCr[i])*100)/100; t+="<td>"+(meta[i]?(Math.abs(d)<1?"<span class='ok'>0 ✓</span>":efmt(d)):"<span class='muted'>—</span>")+"</td>"; } t+="<td></td></tr></tbody>";
  h+='<div class="panel"><div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:8px"><input id="esQ" placeholder="Filter accounts…" style="min-width:200px;flex:1" value="'+esc(esoftQuery)+'"><span class="note">'+codes.length+' accounts</span></div><div class="tblwrap" style="max-height:72vh"><table class="esoft">'+t+'</table></div></div>';
  document.getElementById("view-esoft").innerHTML=h;
  const bm=document.getElementById("esM"), bc=document.getElementById("esC");
  if(bm)bm.onclick=()=>{esoftView="m";renderEsoft();};
  if(bc)bc.onclick=()=>{esoftView="c";renderEsoft();};
  const q2=document.getElementById("esQ"); if(q2)q2.oninput=e=>{esoftQuery=e.target.value; renderEsoft(); const el=document.getElementById("esQ"); if(el){el.focus();el.setSelectionRange(el.value.length,el.value.length);} };
}

/* ---------- Trial Balance import ---------- */
function importTB(file){ if(!file)return; const rd=new FileReader();
  rd.onload=ev=>{ try{
    const wb=XLSX.read(new Uint8Array(ev.target.result),{type:"array"});
    const ws=wb.Sheets[wb.SheetNames[0]];
    const rows=XLSX.utils.sheet_to_json(ws,{header:1,defval:null});
    // find period
    let year=null,month=null;
    for(let i=0;i<Math.min(12,rows.length);i++){ for(const c of rows[i]){ if(typeof c==="string"){ const m=c.match(/(\d{2})\/(\d{4})/); if(m){month=+m[1]-1;year=m[2];break;} } } if(year)break; }
    if(!year){ alert("Could not read the TB period (looking for MM/YYYY). Is this a Softone Trial Balance export?"); return; }
    if(!DATA.years[year]) DATA.years[year]={}; normalize(DATA);
    let rentals=0,cleans=0,goods=0,other=0,cogs=0,expenses=0,salaries=0; const divacc={};
    rows.forEach(r=>{ const code=(r[1]==null?"":String(r[1])).trim(); if(!/^\d{3,7}$/.test(code))return;
      const name=(r[4]==null?"":String(r[4])).toUpperCase();
      const md=num(r[12]), mc=num(r[13]); const inc=mc-md, exp=md-mc;
      if(code[0]==="7"){ // income (710/750)
        const dd=divOfName(name); divacc[dd]=(divacc[dd]||0)+inc;
        if(name.includes("RENT")) rentals+=inc;
        else if(name.includes("CLEAN")) cleans+=inc;
        else if(code.slice(0,3)==="750"||name.includes("SUNDRY")||name.includes("DISCOUNT")||name.includes("TRANSPORT")||name.includes("COMMON EXP")) other+=inc;
        else goods+=inc;
      } else if(code[0]==="8"){ cogs+=exp; }
      else if(code[0]==="9"){ expenses+=exp;
        if(name.includes("WAGE")||name.includes("SALAR")||name.includes("SOCIAL INSURANCE")||name.includes("EMPLOYEE")||name.includes("CASUAL LABOUR")) salaries+=exp;
      }
    });
    const revenue=rentals+cleans+goods; const gp=revenue-cogs; const np=gp+other-expenses;
    const set=(k,v)=>{ DATA.years[year][k][month]=Math.round(v*100)/100; };
    set("rentals",rentals); set("cleans_rev",cleans); set("other_income",other); set("revenue",revenue);
    set("cogs",cogs); set("gross_profit",gp); set("salaries",salaries); set("expenses",expenses); set("net_profit",np);
    DIVS.forEach(dv=>{ if(!DATA.div[dv])DATA.div[dv]={}; if(!Array.isArray(DATA.div[dv][year]))DATA.div[dv][year]=Array(12).fill(0); DATA.div[dv][year][month]=Math.round((divacc[dv]||0)*100)/100; });
    persist("Imported Trial Balance — "+MONTHS[month]+" "+year); document.getElementById("selYear").value=year; document.getElementById("selMonth").value=month; initShell(); render();
    flash("Trial Balance imported: "+MONTHS[month]+" "+year+" · Revenue "+fmt(revenue,true)+" · Net "+fmt(np,true));
  }catch(err){ alert("Could not read that Trial Balance file. "+err.message); } };
  rd.readAsArrayBuffer(file);
}

/* ---------- e-soft full Trial Balance import (account-level, historical) ---------- */
function importEsoft(file){ if(!file)return; if(!canEdit()){alert("Editors/admins only.");return;} const rd=new FileReader();
  rd.onload=ev=>{ try{
    const wb=XLSX.read(new Uint8Array(ev.target.result),{type:"array"});
    const rows=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{header:1,defval:null});
    // period — first MM/YYYY found near the top (e.g. "01/2024 to 01/2024")
    let year=null,month=null;
    for(let i=0;i<8&&i<rows.length;i++){ (rows[i]||[]).forEach(c=>{ if(typeof c==="string"){ const m=c.match(/(\d{2})\/(\d{4})/); if(m&&year==null){month=+m[1]-1;year=m[2];} } }); }
    if(year==null){ alert("Could not read the period (looking for MM/YYYY, e.g. 01/2024). Is this an e-soft Trial Balance?"); return; }
    if(!DATA.years[year])DATA.years[year]={}; normalize(DATA);
    // duplicate guard
    if(DATA.esoftMeta[year]&&DATA.esoftMeta[year][month]){ const ex=DATA.esoftMeta[year][month];
      if(!confirm(MONTHS[month]+" "+year+" e-soft TB is already imported ("+ex.accts+" accounts). Re-importing will REPLACE that month. Continue?")) return; }
    if(!DATA.esoft[year])DATA.esoft[year]={};
    if(!DATA.esoftMeta[year])DATA.esoftMeta[year]={};
    let n=0, cD=0,cC=0,mD=0,mC=0;
    rows.forEach(r=>{ const code=(r[1]==null?"":String(r[1])).trim();
      if(!/^\d{3,8}$/.test(code)) return;                 // skips page headers / totals rows
      const name=(r[4]==null?"":String(r[4])).trim(); const type=(r[7]==null?"":String(r[7])).trim();
      const movDr=num(r[12]), movCr=num(r[13]), clsDr=num(r[15]), clsCr=num(r[16]);
      const movNet=Math.round((movDr-movCr)*100)/100, clsNet=Math.round((clsDr-clsCr)*100)/100;
      let a=DATA.esoft[year][code]; if(!a){ a=DATA.esoft[year][code]={n:name,t:type,m:Array(12).fill(null),c:Array(12).fill(null)}; }
      a.n=name||a.n; a.t=type||a.t; a.m[month]=movNet; a.c[month]=clsNet;
      n++; mD+=movDr; mC+=movCr; cD+=clsDr; cC+=clsCr;
    });
    if(!n){ alert("No account rows found. Expected account codes in column B."); return; }
    // auto-balance any small residual to Purchases (820020) so the month ties out
    const PURCH="820020";
    const clsDiff=Math.round((cD-cC)*100)/100, movDiff=Math.round((mD-mC)*100)/100;
    let adj=0;
    if(Math.abs(clsDiff)>0.01||Math.abs(movDiff)>0.01){
      let p=DATA.esoft[year][PURCH];
      if(!p){ p=DATA.esoft[year][PURCH]={n:"Purchases",t:"800",m:Array(12).fill(null),c:Array(12).fill(null)}; }
      if(Math.abs(clsDiff)>0.01){ p.c[month]=Math.round(((p.c[month]||0)-clsDiff)*100)/100; }
      if(Math.abs(movDiff)>0.01){ p.m[month]=Math.round(((p.m[month]||0)-movDiff)*100)/100; }
      adj=clsDiff;
    }
    DATA.esoftMeta[year][month]={at:new Date().toISOString().slice(0,16).replace("T"," "),by:(user&&(user.name||user.username))||"",accts:n,
      clsDr:Math.round(cD*100)/100,clsCr:Math.round(cC*100)/100,adj:Math.round(adj*100)/100};
    persist("Imported e-soft TB — "+MONTHS[month]+" "+year+" ("+n+" accounts)"+(Math.abs(adj)>=1?" · balanced to Purchases "+fmt(-adj,true):""));
    document.getElementById("selYear").value=year; document.getElementById("selMonth").value=month; initShell(); render();
    flash("e-soft TB imported: "+MONTHS[month]+" "+year+" · "+n+" accounts · closing Dr "+fmt(cD,true)+" / Cr "+fmt(cC,true)+(Math.abs(adj)>=1?" · "+fmt(-adj,true)+" posted to Purchases to balance ✓":" — balanced ✓"));
  }catch(err){ alert("Could not read that e-soft TB file. "+err.message); } };
  rd.readAsArrayBuffer(file); }

/* ---------- Jobwatch import ---------- */
function importJW(file){ if(!file)return; const rd=new FileReader();
  rd.onload=ev=>{ try{
    const wb=XLSX.read(new Uint8Array(ev.target.result),{type:"array"});
    let filled=[];
    wb.SheetNames.forEach(sn=>{ const ym=sn.match(/(20\d{2})/); if(!/total\s*monthly/i.test(sn)||!ym) return; const year=ym[1];
      if(!DATA.years[year]) DATA.years[year]={}; normalize(DATA);
      const rows=XLSX.utils.sheet_to_json(wb.Sheets[sn],{header:1,defval:null});
      rows.forEach(r=>{ let lab=(r[0]==null?"":String(r[0])).trim().toUpperCase().replace(/\s+/g," ");
        if(lab.startsWith("TOTAL")||lab.includes("COMPARISON"))return;
        let key=null;
        if(lab==="CLEANS")key="cleans";
        else if(lab.startsWith("VISITS")&&lab.includes("JOB"))key="jobs";
        else if(lab.startsWith("ACTIVE SITES"))key="active_sites";
        else if(lab==="DELIVERY")key="deliveries";
        else if(lab==="PICK UP")key="pickups";
        else if(lab==="NOT DONE")key="not_done";
        if(!key)return;
        for(let i=0;i<12;i++){ const v=r[1+i]; DATA.years[year][key][i]= (v==null||v==="")?DATA.years[year][key][i]:num(v); }
        if(!filled.includes(year))filled.push(year);
      });
    });
    if(!filled.length){ alert("No 'Total Monthly Report' sheets found. Upload the Greson operations summary .xlsx."); return; }
    persist("Imported Jobwatch — "+filled.sort().join(", ")); initShell(); render(); flash("Jobwatch imported for: "+filled.sort().join(", "));
  }catch(err){ alert("Could not read that Jobwatch file. "+err.message); } };
  rd.readAsArrayBuffer(file);
}

/* ---------- CSV / snapshot ---------- */
function exportCsv(){ let rows=[["Year","Metric"].concat(MONTHS)];
  years().forEach(y=>METRICS.forEach(md=>rows.push([y,md.label].concat(DATA.years[y][md.k].map(v=>has(v)?v:"")))));
  dl(new Blob([rows.map(r=>r.map(c=>'"'+c+'"').join(",")).join("\n")],{type:"text/csv"}),"Greson_data_export.csv"); flash("CSV exported."); }
function importCsv(file){ if(!file)return; const rd=new FileReader();
  rd.onload=ev=>{ try{ const lines=ev.target.result.split(/\r?\n/).filter(l=>l.trim());
    lines.slice(1).forEach(line=>{ const c=line.split(",").map(s=>s.replace(/^"|"$/g,"").replace(/""/g,'"'));
      const y=c[0],md=METRICS.find(m=>m.label===c[1]); if(!y||!md)return; if(!DATA.years[y])DATA.years[y]={}; normalize(DATA);
      for(let i=0;i<12;i++){const raw=(c[2+i]||"").trim();DATA.years[y][md.k][i]=raw===""?null:parseFloat(raw);} });
    persist(); initShell(); render(); flash("CSV imported."); }catch(e){alert("Could not read CSV. Use the Export CSV layout.");} };
  rd.readAsText(file); }
function saveSnapshot(){ DATA.meta.updated=new Date().toISOString().slice(0,10); persist("Saved / shared snapshot");
  const json=JSON.stringify(DATA,null,1);
  let html="<!DOCTYPE html>\n"+document.documentElement.outerHTML;
  html=html.replace(/window\.__EMBEDDED_DATA__\s*=\s*[\s\S]*?\/\*END_DATA\*\//,"window.__EMBEDDED_DATA__ = "+json+";/*END_DATA*/");
  dl(new Blob([html],{type:"text/html"}),"Greson_Management_Dashboard_"+DATA.meta.updated+".html");
  flash("Snapshot saved — ready to send to management."); }
function dl(blob,name){ const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download=name; a.click(); }

/* ---------- Users & Audit ---------- */
function esc(s){ return (s==null?"":String(s)).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
window.closeModal=function(){ document.getElementById("modalHost").innerHTML=""; };
function renderUsers(){ if(!isAdmin()){ document.getElementById("view-users").innerHTML='<div class="panel">Admins only.</div>'; return; }
  let h='<div class="panel"><div style="display:flex;gap:10px;align-items:center"><h3 style="margin:0">Users</h3><button class="filebtn" data-h="editUser(null)">+ Add user</button><button class="filebtn" data-h="openAudit()">🕘 Audit trail (90 days)</button></div>'+
    '<div class="hint">Roles: <b>admin</b> (all + manage users), <b>editor</b> (edit / import data), <b>viewer</b> (read-only). This is a basic in-app lock — enforced security comes with the online (Supabase) version.</div>'+
    '<div class="tblwrap"><table><thead><tr><th>Username</th><th>Name</th><th>Role</th><th></th></tr></thead><tbody>';
  DATA.users.forEach(u=>{ h+='<tr><td>'+esc(u.username)+'</td><td>'+esc(u.name||"")+'</td><td>'+esc(u.role)+'</td><td><button class="iconbtn" data-h="editUser(\''+esc(u.username)+'\')">✎</button>'+(u.username!==user.username?'<button class="iconbtn" data-h="delUser(\''+esc(u.username)+'\')">🗑</button>':'')+'</td></tr>'; });
  h+='</tbody></table></div></div>'; document.getElementById("view-users").innerHTML=h; }
window.editUser=function(uname){ const u=uname==null?{username:"",name:"",role:"editor"}:DATA.users.find(x=>x.username===uname);
  document.getElementById("modalHost").innerHTML='<div class="modal"><div class="box"><h3>'+(uname==null?"Add user":"Edit user")+'</h3>'+
   '<div class="frow"><label>Username<input id="u_name" value="'+esc(u.username)+'"'+(uname!=null?" disabled":"")+'></label><label>Full name<input id="u_full" value="'+esc(u.name||"")+'"></label></div>'+
   '<div class="frow"><label>Role<select id="u_role"><option value="admin">admin</option><option value="editor">editor</option><option value="viewer">viewer</option></select></label>'+
   '<label>'+(uname==null?"Password":"New password (blank = keep)")+'<input id="u_pw" type="password"></label></div>'+
   '<div class="frow" style="justify-content:flex-end"><button class="filebtn" data-h="closeModal()">Cancel</button> <button class="primary" data-h="saveUser('+(uname==null?"null":"'"+esc(uname)+"'")+')">Save</button></div></div></div>';
  document.getElementById("u_role").value=u.role; };
window.saveUser=function(uname){ const un=document.getElementById("u_name").value.trim(), full=document.getElementById("u_full").value.trim(), role=document.getElementById("u_role").value, pw=document.getElementById("u_pw").value;
  if(uname==null){ if(!un||!pw){alert("Username and password required.");return;} if(DATA.users.some(x=>x.username.toLowerCase()===un.toLowerCase())){alert("Username exists.");return;} DATA.users.push({username:un,name:full,role,hash:hashPw(pw)}); }
  else { const u=DATA.users.find(x=>x.username===uname); u.name=full; u.role=role; if(pw)u.hash=hashPw(pw); }
  persist("Saved user — "+(uname||un)); closeModal(); render(); flash("User saved."); };
window.delUser=function(uname){ if(!confirm("Delete user "+uname+"?"))return; DATA.users=DATA.users.filter(x=>x.username!==uname); persist("Deleted user — "+uname); render(); };
window.openAudit=function(){ if(!isAdmin())return; const cutoff=Date.now()-90*86400000;
  const rows=(DATA.audit||[]).filter(a=>{ const d=new Date((a.ts||"").replace(" ","T")); return !isNaN(d.getTime())&&d.getTime()>=cutoff; }).slice().reverse();
  const body=rows.map(a=>'<tr><td>'+esc(a.ts)+'</td><td>'+esc(a.user)+'</td><td>'+esc(a.action)+'</td></tr>').join("")||'<tr><td colspan="3" style="color:#94a3b8">No changes logged in the last 90 days.</td></tr>';
  document.getElementById("modalHost").innerHTML='<div class="modal"><div class="box" style="width:min(780px,96vw)"><h3>Audit trail — last 90 days ('+rows.length+')</h3><div class="hint">Who changed what, and when. Newest first.</div><div class="tblwrap" style="max-height:65vh"><table><thead><tr><th>When</th><th>User</th><th>Change</th></tr></thead><tbody>'+body+'</tbody></table></div><div class="frow" style="justify-content:flex-end;margin-top:6px"><button class="filebtn" data-h="closeModal()">Close</button></div></div></div>'; };

/* ---------- boot ---------- */
window.addEventListener("message", function(ev){ var m=ev.data||{}; if(m.type!=="init")return;
  DATA = normalize(m.data && Object.keys(m.data).length ? JSON.parse(JSON.stringify(m.data)) : {});
  user = { username:m.username||"portal", name:m.name||"", role:m.role||"viewer" };
  activeTab="summary"; initShell();
  var ty=String(new Date().getFullYear()); var sy=document.getElementById("selYear");
  if(sy&&years().indexOf(ty)>=0){ sy.value=ty; var sm=document.getElementById("selMonth"); if(sm)sm.value=(new Date().getMonth()); }
  render();
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
document.addEventListener("input",function(e){ var el=e.target.closest?e.target.closest("[data-hi]"):null; if(el)__run(el.getAttribute("data-hi"),e); });
document.addEventListener("keydown",function(e){ var el=e.target.closest?e.target.closest("[data-hk]"):null; if(el)__run(el.getAttribute("data-hk"),e); });
function postSave(){ if(__SUPPRESS_SAVE||window.parent===window)return; clearTimeout(__saveT); __saveT=setTimeout(function(){ try{ window.parent.postMessage({type:"save",data:DATA},"*"); }catch(e){} }, 700); }
