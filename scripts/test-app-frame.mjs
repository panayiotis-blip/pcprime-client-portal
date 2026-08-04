// What /api/app-frame actually sends back.
//
// The shim was defined but never injected, so every uploaded app loaded blank
// and saved into nothing — and the pieces all passed their own tests. This
// exercises the handler itself, with the network stubbed, and asserts on the
// response body.
//
//   node scripts/test-app-frame.mjs
import handler from '../api/app-frame.js';

const APP_HTML = '<meta charset="utf-8"><script>if(!window.storage)console.log("no storage")<\/script>';

function fakeRes() {
  return {
    _status: 0, _body: '', _headers: {},
    setHeader(k, v) { this._headers[k] = v; },
    status(s) { this._status = s; return this; },
    send(b) { this._body = b; return this; },
  };
}
const call = async (query, { html = APP_HTML, fail = false } = {}) => {
  global.fetch = async () => (fail ? Promise.reject(new Error('down')) : { json: async () => html });
  process.env.VITE_SUPABASE_URL = 'https://example.supabase.co';
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY = 'anon';
  const res = fakeRes();
  await handler({ query }, res);
  return res;
};

let bad = 0;
const check = (label, ok) => { console.log((ok ? '  ok   ' : '  FAIL ') + label); if (!ok) bad++; };

const served = await call({ v: 'sometoken' });
check('serves the app', served._status === 200 && served._body.includes('charset'));
check('INJECTS the storage shim', /window\.storage\s*=/.test(served._body));
check('shim runs before the app', served._body.indexOf('window.storage=') < served._body.indexOf('if(!window.storage)'));
check('shim asks the host for the document', served._body.includes('type:"ready"'));
check('shim posts saves back', served._body.includes('type:"save"'));
check('shim exposes the portal user', served._body.includes('__portalUser'));
check('shim implements get/set/delete', ['get:', 'set:', 'delete:'].every((k) => served._body.includes(k)));

const noToken = await call({});
check('no token → asks for a reload', noToken._status === 404 && /needs reloading/.test(noToken._body));

const missing = await call({ v: 'nope' }, { html: null });
check('unknown token → not available', missing._status === 404 && /not available/.test(missing._body));

const broken = await call({ v: 'x' }, { fail: true });
check('upstream failure → handled', broken._status === 404);

console.log(bad ? `\n${bad} FAILED` : '\nall good');
process.exit(bad ? 1 : 0);
