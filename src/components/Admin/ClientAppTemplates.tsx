import { useEffect, useMemo, useRef, useState } from 'react';
import { api, isSupervisorOrHigher } from '../../services/api';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import { CLIENT_APPS, allClientApps, loadAppTemplates } from '../../services/clientApps';
import { PanelSkeleton } from '../ui';

// Clients → App Templates. A library of app templates (built-in + uploaded);
// upload a self-contained HTML app and allocate it to clients. Each allocated
// client gets the app with its OWN blank data (client_app_data is keyed per
// client + app), so two clients on the same template never share data.

type Tmpl = { id: number; key: string; name: string; icon: string; description: string | null; restricted: boolean; active: boolean; version?: number; preview_token?: string | null };
type PreviewApp = { key: string; label: string; asset?: string; previewToken?: string };
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

export default function ClientAppTemplates() {
  const { user } = useAuth();
  const [templates, setTemplates] = useState<Tmpl[] | null>(null);
  const [allocFor, setAllocFor] = useState<{ key: string; label: string } | null>(null);
  const [editing, setEditing] = useState<Tmpl | null>(null);
  const [preview, setPreview] = useState<PreviewApp | null>(null);
  const [orphans, setOrphans] = useState<Array<{ app_key: string; clients: number }>>([]);

  const load = () => {
    api.listAppTemplates().then(t => setTemplates(t as Tmpl[])).catch(() => setTemplates([]));
    // Allocations whose app no longer exists — deleting a template used to
    // leave these behind, and they still list as apps that cannot load.
    loadAppTemplates(true) // refresh the runtime registry so renders pick up changes
      .then(() => api.getOrphanAppKeys(allClientApps().map(a => a.key)))
      .then(setOrphans).catch(() => setOrphans([]));
  };
  useEffect(load, []);

  if (!isSupervisorOrHigher(user)) return <div className="empty-state"><p>This screen is available to owners and supervisors only.</p></div>;

  const builtinKeys = new Set(CLIENT_APPS.map(a => a.key));
  const uploaded = (templates || []).filter(t => !builtinKeys.has(t.key));

  const setActive = async (t: Tmpl) => { try { await api.updateAppTemplate(t.id, { active: !t.active }); load(); } catch (e: any) { alert(e?.message || 'Failed'); } };

  // Retire an app for good. The summary is fetched first so the confirmation
  // can name the clients and the data that will be destroyed with it.
  const removeEverywhere = async (t: { key: string; name: string }) => {
    let s: Awaited<ReturnType<typeof api.purgeAppEverywhere>>;
    try { s = await api.purgeAppEverywhere(t.key, true); }
    catch (e: any) { alert(e?.message || 'Failed'); return; }
    const lines = [
      `Remove "${t.name}" everywhere? This cannot be undone.`,
      '',
      `• ${s.clients} client${s.clients === 1 ? '' : 's'} lose the app${s.client_names.length ? ': ' + s.client_names.join(', ') : ''}`,
      `• ${s.data_rows} saved data record${s.data_rows === 1 ? '' : 's'} deleted`,
      `• ${s.grants} access grant${s.grants === 1 ? '' : 's'} removed`,
      ...(s.legacy_users ? [`• ${s.legacy_users} old username login${s.legacy_users === 1 ? '' : 's'} removed`] : []),
      `• the template itself is deleted`,
    ];
    if (!confirm(lines.join('\n'))) return;
    try { await api.purgeAppEverywhere(t.key); load(); }
    catch (e: any) { alert(e?.message || 'Failed'); }
  };

  return (
    <div className="dashboard" style={{ padding: '1rem 1.5rem' }}>
      <div className="dashboard-header"><h2 style={{ margin: 0 }}>App Templates</h2></div>
      <p style={{ fontSize: 13, color: '#64748b', margin: '4px 0 16px' }}>
        Upload a self-contained app (one HTML file) once, then allocate it to any clients. Each client gets their own blank
        copy — the same template on two clients never shares data. Uploaded apps run in an isolated frame.
      </p>

      <UploadForm onCreated={load} />

      <h3 style={{ color: '#1a365d', margin: '22px 0 10px', fontSize: 15 }}>Library</h3>
      {templates === null ? <PanelSkeleton rows={4} /> : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(300px,1fr))', gap: 12 }}>
          {/* Built-in apps — allocatable, not editable here */}
          {CLIENT_APPS.map(a => (
            <div key={a.key} style={card}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: a.component ? 'default' : 'pointer' }}
                onClick={() => { if (!a.component) setPreview({ key: a.key, label: a.label, asset: a.asset }); }}
                title={a.component ? '' : 'Click to preview'}>
                <span style={{ fontSize: 22 }}>{a.icon}</span>
                <strong style={{ color: '#1a365d' }}>{a.label}</strong>
                <span style={badge('#e0e7ff', '#3730a3')}>built-in</span>
                {a.restricted && <span style={badge('#fef3c7', '#92400e')}>restricted</span>}
              </div>
              {a.description && <p style={desc}>{a.description}</p>}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
                <button className="btn btn-primary btn-sm" onClick={() => setAllocFor({ key: a.key, label: a.label })}>Allocate to clients</button>
                {/* Component apps are portal views, not framed documents — they
                    need a real client's data, so there is nothing to preview. */}
                {!a.component && <button className="btn btn-secondary btn-sm" onClick={() => setPreview({ key: a.key, label: a.label, asset: a.asset })}>Preview</button>}
              </div>
            </div>
          ))}
          {/* Uploaded templates */}
          {uploaded.map(t => (
            <div key={t.id} style={{ ...card, opacity: t.active ? 1 : 0.6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }} title="Click to preview"
                onClick={() => setPreview({ key: t.key, label: t.name, previewToken: t.preview_token || undefined })}>
                <span style={{ fontSize: 22 }}>{t.icon}</span>
                <strong style={{ color: '#1a365d' }}>{t.name}</strong>
                <span style={badge('#dcfce7', '#166534')}>uploaded</span>
                {!t.active && <span style={badge('#f1f5f9', '#64748b')}>inactive</span>}
              </div>
              <div style={{ fontSize: 11, color: '#94a3b8' }}>key: {t.key} · v{t.version ?? 1}</div>
              {t.description && <p style={desc}>{t.description}</p>}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
                <button className="btn btn-primary btn-sm" onClick={() => setAllocFor({ key: t.key, label: t.name })}>Allocate to clients</button>
                <button className="btn btn-secondary btn-sm" onClick={() => setPreview({ key: t.key, label: t.name, previewToken: t.preview_token || undefined })}>Preview</button>
                <button className="btn btn-secondary btn-sm" onClick={() => setEditing(t)}>Edit</button>
                <button className="btn btn-secondary btn-sm" onClick={() => setActive(t)}>{t.active ? 'Deactivate' : 'Activate'}</button>
                <button className="btn btn-secondary btn-sm" style={{ color: '#b91c1c' }} onClick={() => removeEverywhere(t)}>Remove everywhere</button>
              </div>
            </div>
          ))}
          {uploaded.length === 0 && <div className="empty-state" style={{ gridColumn: '1/-1' }}><p>No uploaded templates yet — upload one above.</p></div>}
        </div>
      )}

      {orphans.length > 0 && (
        <div style={{ marginTop: 22 }}>
          <h3 style={{ color: '#92400e', margin: '0 0 6px', fontSize: 15 }}>Apps with nothing behind them</h3>
          <p style={{ fontSize: 12.5, color: '#64748b', margin: '0 0 10px' }}>
            These app keys are still allocated to clients, but no template answers to them any more — the template was deleted
            or deactivated. They cannot load, so clear them out.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {orphans.map(o => (
              <div key={o.app_key} style={{ ...card, flexDirection: 'row', alignItems: 'center', gap: 12, background: '#fffbeb', borderColor: '#fde68a' }}>
                <strong style={{ color: '#92400e' }}>{o.app_key}</strong>
                <span style={{ fontSize: 12.5, color: '#64748b' }}>allocated to {o.clients} client{o.clients === 1 ? '' : 's'}</span>
                <button className="btn btn-secondary btn-sm" style={{ marginLeft: 'auto', color: '#b91c1c' }}
                  onClick={() => removeEverywhere({ key: o.app_key, name: o.app_key })}>Remove everywhere</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {allocFor && <AllocateModal appKey={allocFor.key} label={allocFor.label} onClose={() => setAllocFor(null)} />}
      {editing && <EditModal tmpl={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
      {preview && <PreviewModal app={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}

// ---- Upload a new template ----
function UploadForm({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: '', key: '', icon: '📦', description: '', restricted: false });
  const [keyEdited, setKeyEdited] = useState(false);
  const [html, setHtml] = useState('');
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);

  const onName = (name: string) => setF(p => ({ ...p, name, key: keyEdited ? p.key : slug(name) }));
  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setFileName(file.name);
    try { setHtml(await file.text()); } catch { alert('Could not read that file.'); }
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!html.trim()) { alert('Choose an HTML file for the app.'); return; }
    setBusy(true);
    try {
      await api.createAppTemplate({ key: f.key.trim(), name: f.name.trim(), icon: f.icon.trim() || '📦', description: f.description.trim(), html, restricted: f.restricted });
      setF({ name: '', key: '', icon: '📦', description: '', restricted: false }); setKeyEdited(false); setHtml(''); setFileName(''); setOpen(false);
      onCreated();
    } catch (e: any) { alert(e?.message || 'Failed'); } finally { setBusy(false); }
  };

  if (!open) return <button className="btn btn-primary" onClick={() => setOpen(true)}>+ Upload an app</button>;

  return (
    <form onSubmit={submit} style={{ ...card, background: '#f8fafc' }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: '#1a365d', marginBottom: 12 }}>Upload an app template</div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label style={lbl}>Name *<br /><input className="form-input" value={f.name} onChange={e => onName(e.target.value)} placeholder="e.g. Property Rentals" required style={{ minWidth: 200 }} /></label>
        <label style={lbl}>Key *<br /><input className="form-input" value={f.key} onChange={e => { setKeyEdited(true); setF(p => ({ ...p, key: slug(e.target.value) })); }} placeholder="property-rentals" required style={{ minWidth: 160 }} /></label>
        <label style={lbl}>Icon<br /><input className="form-input" value={f.icon} onChange={e => setF(p => ({ ...p, icon: e.target.value }))} style={{ width: 60, textAlign: 'center' }} /></label>
        <label style={{ ...lbl, fontSize: 12, color: '#475569', display: 'flex', alignItems: 'center', gap: 6, paddingBottom: 8 }}>
          <input type="checkbox" checked={f.restricted} onChange={e => setF(p => ({ ...p, restricted: e.target.checked }))} /> Restricted (hide from add-app picker)
        </label>
      </div>
      <label style={{ ...lbl, display: 'block', marginTop: 10 }}>Description<br />
        <input className="form-input" value={f.description} onChange={e => setF(p => ({ ...p, description: e.target.value }))} placeholder="What the app does" style={{ width: '100%', maxWidth: 520 }} /></label>
      <div style={{ marginTop: 12 }}>
        <label style={lbl}>App HTML file *<br />
          <input type="file" accept=".html,text/html" onChange={e => onFile(e.target.files?.[0])} /></label>
        {fileName && <span style={{ fontSize: 12, color: '#166534', marginLeft: 8 }}>✓ {fileName} ({Math.round(html.length / 1024)} KB)</span>}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        <button className="btn btn-primary" type="submit" disabled={busy || !f.name.trim() || !f.key.trim() || !html}>{busy ? 'Uploading…' : 'Upload template'}</button>
        <button className="btn btn-secondary" type="button" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </form>
  );
}

// ---- Preview an app from the library ----
// Runs the real app, full-screen, on an EMPTY document: it is handed no
// client's data and every save it attempts is dropped, so looking at an app
// can never touch anyone's records. Uploaded templates are served by their
// preview token (migration 173); built-in apps come from their static files.
function PreviewModal({ app, onClose }: { app: { key: string; label: string; asset?: string; previewToken?: string }; onClose: () => void }) {
  const [srcDoc, setSrcDoc] = useState('');
  const [url, setUrl] = useState('');
  const [err, setErr] = useState('');
  const frameRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    let alive = true;
    setSrcDoc(''); setUrl(''); setErr('');
    (async () => {
      if (app.asset) {
        try {
          const html = await fetch(app.asset + 'index.html').then(r => r.text());
          if (alive) setSrcDoc(html);
        } catch (e: any) { if (alive) setErr('Could not load the app: ' + (e?.message || e)); }
      } else if (app.previewToken) {
        setUrl(`/api/app-frame?v=${encodeURIComponent(app.previewToken)}`);
      } else {
        setErr('This template has no preview yet — run migration 173, then reload.');
      }
    })();
    return () => { alive = false; };
  }, [app.key, app.asset, app.previewToken]);

  // Stand in for the portal host: hand the app an empty document so it renders,
  // answer its user-admin calls with nothing, and swallow saves.
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const win = frameRef.current?.contentWindow;
      if (!win || e.source !== win) return;
      const m: any = e.data || {};
      if (m.type === 'ready') {
        win.postMessage({ type: 'init', data: {}, role: 'admin', name: 'Preview', username: 'preview' }, '*');
      } else if (m.type === 'users' && m.reqId != null) {
        win.postMessage({ type: 'users:reply', reqId: m.reqId, ok: true, data: [] }, '*');
      }
      // 'save' is deliberately ignored — a preview writes nothing.
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);

  return (
    <div style={overlay} onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: '#fff', borderRadius: 12, width: 'min(1200px,96vw)', height: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: '1px solid #e2e8f0' }}>
          <strong style={{ color: '#1a365d' }}>{app.label}</strong>
          <span style={{ fontSize: 12, background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e', borderRadius: 6, padding: '2px 8px' }}>
            Preview · empty data, nothing is saved
          </span>
          <button className="btn btn-secondary btn-sm" style={{ marginLeft: 'auto' }} onClick={onClose}>Close</button>
        </div>
        {err ? <div className="empty-state" style={{ margin: 16 }}><p style={{ color: '#b91c1c' }}>{err}</p></div> : (
          <iframe
            ref={frameRef}
            {...(srcDoc ? { srcDoc } : { src: url })}
            title={app.label}
            sandbox="allow-scripts allow-downloads allow-modals allow-popups allow-forms"
            style={{ flex: 1, width: '100%', border: 0, background: '#f4f6f9' }}
          />
        )}
      </div>
    </div>
  );
}

// ---- Edit a template: details, and replacing the app itself ----
// Replacing the HTML is the moment that matters: every client following the
// shared template would change under them the second it saves. So the file
// picker is followed by an explicit choice — push it to those clients, or hold
// them on what they are running now (which snapshots today's HTML onto each).
// Clients already customised or pinned are listed as untouched either way;
// they only move when you push a version to them from their own Apps tab.
function EditModal({ tmpl, onClose, onSaved }: { tmpl: Tmpl; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ name: tmpl.name, icon: tmpl.icon, description: tmpl.description || '', restricted: tmpl.restricted });
  const [html, setHtml] = useState('');
  const [fileName, setFileName] = useState('');
  const [rollout, setRollout] = useState<Awaited<ReturnType<typeof api.getTemplateRollout>> | null>(null);
  const [mode, setMode] = useState<'apply' | 'keep'>('apply');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  useEffect(() => { api.getTemplateRollout(tmpl.key).then(setRollout).catch(() => setRollout(null)); }, [tmpl.key]);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setFileName(file.name);
    try { setHtml(await file.text()); } catch { alert('Could not read that file.'); }
  };

  const save = async () => {
    setBusy(true); setNote('');
    try {
      await api.updateAppTemplate(tmpl.id, {
        name: f.name.trim(), icon: f.icon.trim() || '📦',
        description: f.description.trim() || undefined, restricted: f.restricted,
      });
      if (html.trim()) {
        const r = await api.saveTemplateHtml(tmpl.key, html, mode);
        setNote(mode === 'keep'
          ? `Saved as v${r.version}. ${r.kept} client${r.kept === 1 ? '' : 's'} held on the previous version.`
          : `Saved as v${r.version}. Clients on the shared version now get it.`);
        // Let the note register before the list refreshes underneath.
        setTimeout(onSaved, 900);
      } else onSaved();
    } catch (e: any) { alert(e?.message || 'Failed'); }
    finally { setBusy(false); }
  };

  const following = rollout?.following.length ?? 0;

  return (
    <div style={overlay} onClick={onClose}>
      <div style={modal} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
          <h3 style={{ margin: 0, color: '#1a365d' }}>Edit “{tmpl.name}”</h3>
          <span style={{ marginLeft: 8, fontSize: 12, color: '#94a3b8' }}>v{rollout?.version ?? tmpl.version ?? 1}</span>
          <button className="btn btn-secondary btn-sm" style={{ marginLeft: 'auto' }} onClick={onClose}>Close</button>
        </div>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={lbl}>Name<br /><input className="form-input" value={f.name} onChange={e => setF(p => ({ ...p, name: e.target.value }))} style={{ minWidth: 200 }} /></label>
          <label style={lbl}>Icon<br /><input className="form-input" value={f.icon} onChange={e => setF(p => ({ ...p, icon: e.target.value }))} style={{ width: 60, textAlign: 'center' }} /></label>
          <label style={{ ...lbl, display: 'flex', alignItems: 'center', gap: 6, paddingBottom: 8 }}>
            <input type="checkbox" checked={f.restricted} onChange={e => setF(p => ({ ...p, restricted: e.target.checked }))} /> Restricted
          </label>
        </div>
        <label style={{ ...lbl, display: 'block', marginTop: 10 }}>Description<br />
          <input className="form-input" value={f.description} onChange={e => setF(p => ({ ...p, description: e.target.value }))} style={{ width: '100%' }} /></label>

        <div style={{ marginTop: 16, borderTop: '1px solid #eef1f5', paddingTop: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#1a365d', marginBottom: 6 }}>Replace the app (optional)</div>
          <input type="file" accept=".html,text/html" onChange={e => onFile(e.target.files?.[0])} />
          {fileName && <span style={{ fontSize: 12, color: '#166534', marginLeft: 8 }}>✓ {fileName} ({Math.round(html.length / 1024)} KB)</span>}

          {html.trim() && (
            <div style={{ marginTop: 12, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: 12 }}>
              <div style={{ fontSize: 12.5, color: '#0f172a', fontWeight: 600, marginBottom: 8 }}>
                {following === 0
                  ? 'No client is following the shared version right now.'
                  : `${following} client${following === 1 ? '' : 's'} follow${following === 1 ? 'es' : ''} the shared version: ${rollout!.following.map(c => c.client_name || `#${c.client_id}`).join(', ')}`}
              </div>
              <label style={radio}>
                <input type="radio" checked={mode === 'apply'} onChange={() => setMode('apply')} />
                <span><strong>Give them the new version</strong> — they pick it up next time the app loads.</span>
              </label>
              <label style={radio}>
                <input type="radio" checked={mode === 'keep'} onChange={() => setMode('keep')} />
                <span><strong>Leave them on the current version</strong> — each keeps a copy of today's app; only new allocations get the new one.</span>
              </label>
              {!!rollout?.fixed.length && (
                <div style={{ fontSize: 12, color: '#92400e', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 6, padding: '6px 10px', marginTop: 8 }}>
                  Untouched either way ({rollout.fixed.length}): {rollout.fixed.map(c => `${c.client_name || '#' + c.client_id}${c.customised ? ' (customised)' : ` (v${c.pinned_version ?? '?'})`}`).join(', ')}.
                  Push a new version to them from the client's Apps tab.
                </div>
              )}
            </div>
          )}
        </div>

        {note && <div style={{ background: '#ecfdf5', border: '1px solid #a7f3d0', color: '#065f46', borderRadius: 8, padding: '8px 12px', fontSize: 13, marginTop: 12 }}>{note}</div>}
        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <button className="btn btn-primary" disabled={busy || !f.name.trim()} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ---- Allocate a template to clients ----
function AllocateModal({ appKey, label, onClose }: { appKey: string; label: string; onClose: () => void }) {
  const { clients } = useApp();
  const [allocated, setAllocated] = useState<Record<number, boolean> | null>(null); // client_id → enabled
  const [search, setSearch] = useState('');
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);

  const load = () => {
    api.getTemplateAllocations(appKey).then(rows => {
      const m: Record<number, boolean> = {}; rows.forEach(r => { m[r.client_id] = r.enabled; }); setAllocated(m);
    }).catch(() => setAllocated({}));
  };
  useEffect(load, [appKey]);

  const opts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (clients as any[])
      .filter(c => c.client_category !== 'vendor_only')
      .filter(c => !q || `${c.name || ''} ${c.client_code || ''}`.toLowerCase().includes(q))
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
      .slice(0, 200);
  }, [clients, search]);

  const toggle = (id: number) => setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const allocate = async () => {
    const ids = [...sel].filter(id => !allocated?.[id]);
    if (!ids.length) { alert('Select at least one client not already allocated.'); return; }
    setBusy(true);
    try { await api.allocateTemplate(appKey, ids); setSel(new Set()); load(); }
    catch (e: any) { alert(e?.message || 'Failed'); } finally { setBusy(false); }
  };
  const remove = async (clientId: number) => {
    if (!confirm('Remove this app from the client? Their data is kept and restored if you re-allocate.')) return;
    try { await api.setClientApp(clientId, appKey, false); load(); } catch (e: any) { alert(e?.message || 'Failed'); }
  };

  const allocatedIds = allocated ? Object.keys(allocated).filter(k => allocated[+k]).map(Number) : [];
  const nameOf = (id: number) => { const c = (clients as any[]).find(x => x.id === id); return c ? `${c.client_code ? `[${c.client_code}] ` : ''}${c.name}` : `#${id}`; };

  return (
    <div style={overlay} onClick={onClose}>
      <div style={modal} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
          <h3 style={{ margin: 0, color: '#1a365d' }}>Allocate “{label}” to clients</h3>
          <button className="btn btn-secondary btn-sm" style={{ marginLeft: 'auto' }} onClick={onClose}>Close</button>
        </div>
        <p style={{ fontSize: 12, color: '#64748b', margin: '0 0 12px' }}>Each client gets their own blank copy — no data is shared between clients.</p>

        {allocatedIds.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#64748b', marginBottom: 4 }}>Currently allocated ({allocatedIds.length})</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {allocatedIds.map(id => (
                <span key={id} style={{ fontSize: 12, background: '#eef2ff', color: '#3730a3', borderRadius: 12, padding: '3px 10px', display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                  {nameOf(id)}<button onClick={() => remove(id)} style={{ border: 0, background: 'none', color: '#b91c1c', cursor: 'pointer', fontSize: 13, lineHeight: 1 }}>×</button>
                </span>
              ))}
            </div>
          </div>
        )}

        <input className="form-input" placeholder="Search clients by name or code…" value={search} onChange={e => setSearch(e.target.value)} style={{ width: '100%', marginBottom: 8 }} />
        {allocated === null ? <PanelSkeleton rows={4} /> : (
          <div style={{ maxHeight: 320, overflow: 'auto', border: '1px solid #e2e8f0', borderRadius: 8 }}>
            {opts.map(c => {
              const isAlloc = !!allocated[c.id];
              return (
                <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderBottom: '1px solid #f1f5f9', fontSize: 13, opacity: isAlloc ? 0.5 : 1 }}>
                  <input type="checkbox" disabled={isAlloc} checked={isAlloc || sel.has(c.id)} onChange={() => toggle(c.id)} />
                  <span>{c.client_code ? <span className="client-code-inline">{c.client_code}</span> : null}{c.name}</span>
                  {isAlloc && <span style={{ marginLeft: 'auto', fontSize: 11, color: '#94a3b8' }}>allocated</span>}
                </label>
              );
            })}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button className="btn btn-primary" disabled={busy || sel.size === 0} onClick={allocate}>{busy ? 'Allocating…' : `Allocate to ${sel.size || ''} selected`}</button>
        </div>
      </div>
    </div>
  );
}

const card: React.CSSProperties = { border: '1px solid #e2e8f0', borderRadius: 10, padding: 14, background: '#fff', display: 'flex', flexDirection: 'column', gap: 6 };
const desc: React.CSSProperties = { fontSize: 12, color: '#64748b', margin: 0 };
const lbl: React.CSSProperties = { fontSize: 12, color: '#64748b' };
const radio: React.CSSProperties = { display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12.5, color: '#334155', padding: '4px 0', cursor: 'pointer' };
const badge = (bg: string, color: string): React.CSSProperties => ({ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', background: bg, color, borderRadius: 6, padding: '2px 6px' });
const overlay: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(15,23,42,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, zIndex: 1000 };
const modal: React.CSSProperties = { background: '#fff', borderRadius: 14, padding: 20, width: 'min(560px,94vw)', maxHeight: '90vh', overflow: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,.3)' };
