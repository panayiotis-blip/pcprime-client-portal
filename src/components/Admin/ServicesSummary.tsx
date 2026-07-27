import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, isSupervisorOrHigher } from '../../services/api';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import { PanelSkeleton } from '../ui';

// Cross-client services matrix — a row per client, a column per catalogue
// service, tick a cell to provide that service to that client. Enabling a
// service activates all of its stages ("sub-services") automatically, so one
// tick allocates the whole workflow. Owner/supervisor only. Same look and feel
// as the Tax Filings summary.

type ServiceDef = { id: number; key: string; label: string; enabled: boolean; ordinal: number };

const key = (clientId: number, serviceId: number) => `${clientId}:${serviceId}`;

export default function ServicesSummary() {
  const { clients } = useApp();
  const { user } = useAuth();
  const canEdit = isSupervisorOrHigher(user);

  const [services, setServices] = useState<ServiceDef[]>([]);
  const [enabled, setEnabled] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [withServicesOnly, setWithServicesOnly] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [defs, cs] = await Promise.all([
          api.getServiceDefinitions(),
          api.getAllClientServices(),
        ]);
        if (cancelled) return;
        setServices((defs as ServiceDef[]).filter(s => s.enabled).sort((a, b) => a.ordinal - b.ordinal));
        const set = new Set<string>();
        for (const r of cs) if (r.service_id != null && r.enabled) set.add(key(r.client_id, r.service_id));
        setEnabled(set);
      } catch {
        if (!cancelled) { setServices([]); setEnabled(new Set()); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Real service clients only (exclude vendor-only records).
  const baseClients = useMemo(
    () => (clients as any[]).filter(c => c.client_category !== 'vendor_only'),
    [clients],
  );

  const rows = useMemo(() => {
    const t = search.trim().toLowerCase();
    return baseClients
      .filter(c => !t || (c.name || '').toLowerCase().includes(t) || (c.client_code || '').toLowerCase().includes(t))
      .filter(c => !withServicesOnly || services.some(s => enabled.has(key(c.id, s.id))))
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }, [baseClients, services, enabled, search, withServicesOnly]);

  const has = (clientId: number, serviceId: number) => enabled.has(key(clientId, serviceId));

  // Toggle one cell — optimistic, reverts on error.
  const toggleCell = async (clientId: number, serviceId: number, next: boolean) => {
    if (!canEdit) return;
    const k = key(clientId, serviceId);
    setEnabled(prev => { const s = new Set(prev); next ? s.add(k) : s.delete(k); return s; });
    try {
      await api.toggleClientService(clientId, serviceId, next);
    } catch (e: any) {
      setEnabled(prev => { const s = new Set(prev); next ? s.delete(k) : s.add(k); return s; });
      alert('Could not update: ' + (e?.message || e));
    }
  };

  // Column header state for the visible rows: all / some / none.
  const columnState = (serviceId: number): 'all' | 'some' | 'none' => {
    if (rows.length === 0) return 'none';
    let on = 0;
    for (const c of rows) if (has(c.id, serviceId)) on++;
    return on === 0 ? 'none' : on === rows.length ? 'all' : 'some';
  };

  // Bulk set a service for every visible client in one upsert.
  const toggleColumn = async (serviceId: number) => {
    if (!canEdit || busy) return;
    const next = columnState(serviceId) !== 'all'; // any off → turn all on; all on → clear
    const affected = rows.filter(c => has(c.id, serviceId) !== next);
    if (!affected.length) return;
    if (!confirm(`${next ? 'Add' : 'Remove'} “${services.find(s => s.id === serviceId)?.label}” ${next ? 'to' : 'from'} ${affected.length} visible client${affected.length === 1 ? '' : 's'}?`)) return;
    setBusy(true);
    const snapshot = new Set(enabled);
    setEnabled(prev => {
      const s = new Set(prev);
      for (const c of affected) { const k = key(c.id, serviceId); next ? s.add(k) : s.delete(k); }
      return s;
    });
    try {
      await api.setClientServiceBulk(affected.map(c => ({ client_id: c.id, service_id: serviceId, enabled: next })));
    } catch (e: any) {
      setEnabled(snapshot);
      alert('Bulk update failed: ' + (e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  // Per-client state across all services: all / some / none.
  const rowState = (clientId: number): 'all' | 'some' | 'none' => {
    if (services.length === 0) return 'none';
    let on = 0;
    for (const s of services) if (has(clientId, s.id)) on++;
    return on === 0 ? 'none' : on === services.length ? 'all' : 'some';
  };

  // Bulk set every service on/off for one client in a single upsert.
  const toggleRow = async (clientId: number) => {
    if (!canEdit || busy) return;
    const next = rowState(clientId) !== 'all'; // any off → turn all on; all on → clear
    const affected = services.filter(s => has(clientId, s.id) !== next);
    if (!affected.length) return;
    const cname = (rows.find(c => c.id === clientId)?.name) || `#${clientId}`;
    if (!confirm(`${next ? 'Add all' : 'Remove all'} ${affected.length} service${affected.length === 1 ? '' : 's'} ${next ? 'to' : 'from'} ${cname}?`)) return;
    setBusy(true);
    const snapshot = new Set(enabled);
    setEnabled(prev => {
      const s = new Set(prev);
      for (const svc of affected) { const k = key(clientId, svc.id); next ? s.add(k) : s.delete(k); }
      return s;
    });
    try {
      await api.setClientServiceBulk(affected.map(svc => ({ client_id: clientId, service_id: svc.id, enabled: next })));
    } catch (e: any) {
      setEnabled(snapshot);
      alert('Update failed: ' + (e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  if (!canEdit) {
    return <div className="empty-state"><p>This screen is available to owners and supervisors only.</p></div>;
  }

  return (
    <div className="dashboard">
      <div className="dashboard-header"><h2 style={{ margin: 0 }}>Services provided — all clients</h2></div>
      <p style={{ fontSize: 13, color: '#64748b', margin: '4px 0 12px' }}>
        Tick a service to provide it to a client — all of that service's stages are included automatically.
        Use the checkbox in a column header to set a service for every client currently shown.
      </p>

      <div className="tf-summary-controls">
        <label>
          <span className="tf-control-label">Search</span>
          <input
            type="text" className="form-input form-input-sm"
            placeholder="Client name or code" value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </label>
        <label className="tf-check">
          <input type="checkbox" checked={withServicesOnly} onChange={e => setWithServicesOnly(e.target.checked)} />
          With services only
        </label>
        <span style={{ fontSize: 12, color: '#94a3b8', alignSelf: 'center' }}>{rows.length} clients{busy ? ' · saving…' : ''}</span>
      </div>

      {loading ? (
        <PanelSkeleton rows={8} />
      ) : services.length === 0 ? (
        <div className="empty-state"><p>No services in the catalogue. Add them in Service Settings first.</p></div>
      ) : rows.length === 0 ? (
        <div className="empty-state"><p>No clients match your search.</p></div>
      ) : (
        <div className="compliance-table-wrapper">
          <table className="compliance-table" style={{ fontSize: 13 }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', minWidth: 220 }}>Client</th>
                <th style={{ textAlign: 'center', padding: '6px 10px', whiteSpace: 'nowrap', borderRight: '1px solid #e2e8f0' }}>
                  <div style={{ fontSize: 12 }}>All</div>
                  <div style={{ fontSize: 10, color: '#64748b' }}>per client</div>
                </th>
                {services.map(s => {
                  const st = columnState(s.id);
                  return (
                    <th key={s.id} style={{ textAlign: 'center', whiteSpace: 'nowrap', padding: '6px 10px' }}>
                      <div style={{ fontSize: 12 }}>{s.label}</div>
                      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, color: '#64748b', marginTop: 2, cursor: 'pointer' }}
                        title={`Set “${s.label}” for all ${rows.length} shown clients`}>
                        <input
                          type="checkbox"
                          checked={st === 'all'}
                          ref={el => { if (el) el.indeterminate = st === 'some'; }}
                          onChange={() => toggleColumn(s.id)}
                          disabled={busy}
                        />
                        all
                      </label>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map(c => (
                <tr key={c.id}>
                  <td className="tf-client-cell">
                    <Link to={`/clients/${c.id}`}>
                      {c.client_code ? <span className="client-code-inline">{c.client_code}</span> : null}
                      {c.name || `Client #${c.id}`}
                    </Link>
                  </td>
                  <td style={{ textAlign: 'center', borderRight: '1px solid #e2e8f0' }}>
                    <input
                      type="checkbox"
                      checked={rowState(c.id) === 'all'}
                      ref={el => { if (el) el.indeterminate = rowState(c.id) === 'some'; }}
                      onChange={() => toggleRow(c.id)}
                      disabled={busy}
                      title={`Toggle all services for ${c.name || `#${c.id}`}`}
                      aria-label={`All services for ${c.name || c.id}`}
                    />
                  </td>
                  {services.map(s => (
                    <td key={s.id} style={{ textAlign: 'center' }}>
                      <input
                        type="checkbox"
                        checked={has(c.id, s.id)}
                        onChange={e => toggleCell(c.id, s.id, e.target.checked)}
                        aria-label={`${s.label} for ${c.name}`}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
