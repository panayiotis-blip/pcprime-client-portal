import { useEffect, useState } from 'react';
import { api } from '../../services/api';

const REPORT_TYPES = ['Profit & Loss', 'VAT report', 'Management accounts', 'Balance sheet', 'Other'];

// Staff tab on a client's folder: upload finished reports for the client to
// view in their portal (advisor_report + advisor-reports bucket, migration 084).
export default function ClientReportsTab({ clientId }: { clientId: number }) {
  const [rows, setRows]       = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy]       = useState(false);
  const [fileKey, setFileKey] = useState(0);
  const [file, setFile]       = useState<File | null>(null);
  const [title, setTitle]     = useState('');
  const [type, setType]       = useState(REPORT_TYPES[0]);
  const [period, setPeriod]   = useState('');
  const [notes, setNotes]     = useState('');

  const load = async () => {
    setLoading(true);
    try { setRows(await api.getAdvisorReports(clientId) as any[]); }
    catch (e: any) { alert(e.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [clientId]);

  const upload = async () => {
    if (!file) { alert('Choose a file to upload.'); return; }
    if (!title.trim()) { alert('Enter a report title.'); return; }
    setBusy(true);
    try {
      const path = await api.uploadAdvisorReportFile(clientId, file);
      await api.createAdvisorReport({
        owner_client_id: clientId, title: title.trim(), report_type: type,
        period_label: period.trim() || null, notes: notes.trim() || null,
        file_name: file.name, storage_path: path, mime_type: file.type || null,
      });
      setFile(null); setTitle(''); setPeriod(''); setNotes(''); setType(REPORT_TYPES[0]);
      setFileKey(k => k + 1);
      await load();
    } catch (e: any) { alert('Upload failed: ' + e.message); }
    finally { setBusy(false); }
  };

  const view = async (r: any) => {
    try { window.open(await api.advisorReportFileUrl(r.storage_path), '_blank'); }
    catch (e: any) { alert(e.message); }
  };
  const del = async (r: any) => {
    if (!confirm(`Delete "${r.title}"? The client will no longer see this report.`)) return;
    try { await api.deleteAdvisorReport(r.id, r.storage_path); await load(); }
    catch (e: any) { alert(e.message); }
  };

  return (
    <div>
      <div className="card" style={{ marginBottom: 16 }}>
        <h4 style={{ marginTop: 0 }}>Publish a report to this client</h4>
        <div className="form-grid">
          <div className="form-group full-width">
            <label>File *</label>
            <input key={fileKey} type="file" className="form-input" onChange={e => setFile(e.target.files?.[0] || null)} />
          </div>
          <div className="form-group">
            <label>Title *</label>
            <input className="form-input" value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. 2025 Profit & Loss" />
          </div>
          <div className="form-group">
            <label>Type</label>
            <select className="form-input" value={type} onChange={e => setType(e.target.value)}>
              {REPORT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>Period</label>
            <input className="form-input" value={period} onChange={e => setPeriod(e.target.value)} placeholder="e.g. Year 2025, 2026 Q1" />
          </div>
          <div className="form-group full-width">
            <label>Note to client (optional)</label>
            <textarea className="form-input" rows={2} value={notes} onChange={e => setNotes(e.target.value)} />
          </div>
        </div>
        <div style={{ textAlign: 'right', marginTop: 8 }}>
          <button className="btn btn-primary" onClick={upload} disabled={busy}>{busy ? 'Uploading…' : 'Publish report'}</button>
        </div>
      </div>

      <h4>Published reports</h4>
      {loading ? <div className="loading-screen">Loading…</div>
        : rows.length === 0 ? <p style={{ color: '#94a3b8' }}>No reports published to this client yet.</p>
        : (
          <table className="export-table">
            <thead>
              <tr><th>Date</th><th>Title</th><th>Type</th><th>Period</th><th></th></tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id}>
                  <td>{(r.created_at || '').slice(0, 10)}</td>
                  <td>{r.title}{r.notes ? <div style={{ fontSize: 12, color: '#94a3b8' }}>{r.notes}</div> : null}</td>
                  <td>{r.report_type || '—'}</td>
                  <td>{r.period_label || '—'}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button className="btn btn-link btn-sm" onClick={() => view(r)}>View</button>
                    <button className="btn btn-link btn-sm" style={{ color: '#b91c1c' }} onClick={() => del(r)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
    </div>
  );
}
