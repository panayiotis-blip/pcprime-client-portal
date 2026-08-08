/* Behaviour for the /tap card. Kept in its own file rather than inline so
   the page runs under script-src 'self' — the same CSP the portal uses. */
/* one copy of each image, reused for the page logo and the sheen masks */
/* links must break out of the iframe — framed sites refuse to load inside one */
for (const a of document.querySelectorAll('a[href^="http"]')) {
  a.target = '_top';
  a.rel = 'noopener';
}

const markSrc = document.querySelector('.coin img').src;
document.querySelector('.coin img.back').src = markSrc;
const sheen = document.querySelector('.sheen.on-mark');
sheen.style.webkitMaskImage = 'url(' + markSrc + ')';
sheen.style.maskImage       = 'url(' + markSrc + ')';

const intro  = document.getElementById('intro');
const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
let closed = false;

function endIntro(){
  if (closed) return;
  closed = true;
  document.body.classList.add('ready');
  intro.classList.add('done');
  setTimeout(() => intro.remove(), 850);
}

if (reduce) {
  document.body.classList.add('ready');
  intro.remove(); closed = true;
} else {
  setTimeout(endIntro, 10200);
  intro.addEventListener('click', endIntro);
  intro.addEventListener('touchstart', endIntro, {passive:true});
  window.addEventListener('keydown', endIntro, {once:true});
}

const toast = (m) => {
  const t = document.getElementById('toast');
  t.textContent = m; t.classList.add('on');
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('on'), 2200);
};

document.getElementById('save').addEventListener('click', () => {
  const vcf = [
    'BEGIN:VCARD','VERSION:3.0',
    'N:Savvas;Panayiotis;;;',
    'FN:Panayiotis Savvas',
    'ORG:PC Prime & Calculate Consultants Ltd',
    'TITLE:Professional Accountant (SA)',
    'TEL;TYPE=CELL,VOICE:+357 96 332 274',
    'TEL;TYPE=WORK,VOICE:+357 24 258346',
    'EMAIL;TYPE=WORK:panayiotis@primeandcalculate.com',
    'EMAIL;TYPE=WORK:info@primeandcalculate.com',
    'URL:https://primeandcalculate.com',
    'ADR;TYPE=WORK:;;Dikomou 12\\, Agora Courts 2;Kiti;Larnaca;7550;Cyprus',
    'END:VCARD'
  ].join('\r\n');
  const url = URL.createObjectURL(new Blob([vcf], {type:'text/vcard'}));
  const a = document.createElement('a');
  a.href = url; a.download = 'PC-Prime-Calculate.vcf';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
  toast('Contact card downloaded');
});

document.getElementById('share').addEventListener('click', async () => {
  // Framed on the public site, location.href is the portal's own /tap URL.
  // Share the canonical address instead, so the link works wherever it lands.
  const canonical = document.querySelector('link[rel="canonical"]');
  const url = canonical ? canonical.href : location.href;
  const data = { title:'PC Prime & Calculate Consultants Ltd',
                 text:'Strategic Calculations for Business Growth', url };
  try {
    if (navigator.share) { await navigator.share(data); return; }
    await navigator.clipboard.writeText(url);
    toast('Link copied');
  } catch (e) {
    if (e && e.name === 'AbortError') return;
    toast('Copy the link from your browser bar');
  }
});
