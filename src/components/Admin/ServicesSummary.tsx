import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, isSupervisorOrHigher, isStaffRole } from '../../services/api';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import { PanelSkeleton } from '../ui';
import { vatFireMonths } from '../../services/vatCategories';

// Cross-client services matrix — a row per client, a column per catalogue
// service, tick a cell to provide that service to that client. Enabling a
// service activates all of its stages ("sub-services") automatically, so one
// tick allocates the whole workflow. Owner/supervisor only. Same look and feel
// as the Tax Filings summary.

type ServiceDef = { id: number; key: string; label: string; enabled: boolean; ordinal: number };

const key = (clientId: number, serviceId: number) => `${clientId}:${serviceId}`;

const filled = (value: unknown) => String(value ?? '').trim().length > 0;

/** Registered for VAT: a VAT number on file, or a period category assigned.
 *  Either alone is enough to mean "we file VAT for these people" — the number
 *  arrives with the registration, the category with the first return. */
const isVatRegistered = (c: any) => filled(c?.vat_number) || filled(c?.vat_category);

/** Enough registration detail to compute WHEN their returns fall due. */
const hasVatSchedule = (c: any) => filled(c?.vat_category) && filled(c?.vat_start_month);

export default function ServicesSummary() {
  const { clients } = useApp();
  const { user } = useAuth();
  const canEdit = isSupervisorOrHigher(user);

  const [services, setServices] = useState<ServiceDef[]>([]);
  const [enabled, setEnabled] = useState<Set<string>>(new Set());
  // Account manager per client: staff list + local overrides so a change shows
  // immediately (the clients context isn't refetched on every save).
  const [staffUsers, setStaffUsers] = useState<{ id: string; name: string }[]>([]);
  const [managers, setManagers] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [withServicesOnly, setWithServicesOnly] = useState(false);
  const [vatOnly, setVatOnly] = useState(false);
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);

  // One-off: set each VAT client's task months from their VAT registration
  // (category A-G + start month), so staggered VAT periods generate correctly.
  const syncVatFromReg = async () => {
    const vat = services.find(s => s.key === 'vat_return');
    if (!vat) { alert('No VAT Return service found in the catalogue.'); return; }
    if (!confirm("Set every VAT client's task months from their VAT registration (category + start month)? This replaces the per-client VAT months.")) return;
    setSyncing(true);
    try {
      const stages = await api.getServiceStages();
      const vatStageIds = (stages as any[]).filter(s => s.service_id === vat.id).map(s => s.id);
      const rows = await api.getClientServicesWithVatReg(vat.id);
      let set = 0, skipped = 0;
      for (const r of rows) {
        const months = vatFireMonths(r.vat_category, r.vat_start_month);
        if (!months.length) { skipped++; continue; }
        for (const stId of vatStageIds) await api.upsertStageOverride(r.id, stId, { active_months: months });
        set++;
      }
      alert(`VAT task months set for ${set} client(s) from their registration.` + (skipped ? `\n${skipped} skipped — no VAT category / start month on file.` : ''));
    } catch (e: any) {
      alert('Sync failed: ' + (e?.message || e));
    } finally {
      setSyncing(false);
    }
  };
  const [categoryOptions, setCategoryOptions] = useState<{ value: string; label: string }[]>([]);
  const [filterCategory, setFilterCategory] = useState('');

  useEffect(() => {
    api.getClientCategories()
      .then(rows => setCategoryOptions((rows as any[]).map(r => ({ value: r.value, label: r.label }))))
      .catch(() => {});
    // Internal staff for the account-manager picker (exclude client-role + inactive).
    api.getUsers()
      .then(all => setStaffUsers((all as any[])
        .filter(u => isStaffRole(u) && u.active !== false)
        .map(u => ({ id: u.id, name: u.display_name || u.username }))))
      .catch(() => {});
  }, []);

  // Seed the account-manager overrides from the clients context once loaded.
  useEffect(() => {
    const seed: Record<number, string> = {};
    for (const c of clients as any[]) if (c.account_manager) seed[c.id] = c.account_manager;
    setManagers(seed);
  }, [clients]);

  const setManager = async (clientId: number, uid: string) => {
    const prev = managers[clientId] || '';
    setManagers(m => ({ ...m, [clientId]: uid }));
    try {
      await api.updateClient(clientId, { account_manager: uid || null });
    } catch (e: any) {
      setManagers(m => ({ ...m, [clientId]: prev }));
      alert('Could not set account manager: ' + (e?.message || e));
    }
  };

  // Bulk-set the account manager for every client currently shown (respects
  // the category/search/with-services filters).
  const [bulkManager, setBulkManager] = useState('');
  const setAllShown = async () => {
    const ids = rows.map(c => c.id);
    if (!ids.length) return;
    const who = bulkManager ? (staffUsers.find(u => u.id === bulkManager)?.name || 'that person') : 'Unassigned';
    if (!confirm(`Set the account manager to “${who}” for all ${ids.length} shown client${ids.length === 1 ? '' : 's'}?\n\nThis overwrites any manager already set on them.`)) return;
    setBusy(true);
    const snapshot = { ...managers };
    setManagers(m => { const n = { ...m }; for (const id of ids) n[id] = bulkManager; return n; });
    try {
      await api.setAccountManagerBulk(ids, bulkManager || null);
    } catch (e: any) {
      setManagers(snapshot);
      alert('Bulk update failed: ' + (e?.message || e));
    } finally {
      setBusy(false);
    }
  };

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
      .filter(c => !filterCategory || c.client_category === filterCategory)
      .filter(c => !t || (c.name || '').toLowerCase().includes(t) || (c.client_code || '').toLowerCase().includes(t))
      .filter(c => !withServicesOnly || services.some(s => enabled.has(key(c.id, s.id))))
      .filter(c => !vatOnly || isVatRegistered(c))
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }, [baseClients, services, enabled, search, withServicesOnly, filterCategory, vatOnly]);

  // Of the VAT clients on screen, how many could actually be scheduled? The
  // month sync needs a category AND a start month; a client with a VAT number
  // and nothing else is silently skipped, so say so before it happens.
  const vatMissingReg = useMemo(
    () => rows.filter(c => isVatRegistered(c) && !hasVatSchedule(c)).length,
    [rows],
  );

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
      <div className="dashboard-header">
        <h2 style={{ margin: 0 }}>Services provided — all clients</h2>
        <button className="btn btn-secondary" onClick={syncVatFromReg} disabled={syncing}
          title="Set each VAT client's task months from their VAT registration (category + start month)">
          {syncing ? 'Setting VAT periods…' : '⟳ Set VAT periods from registrations'}
        </button>
      </div>
      <p style={{ fontSize: 13, color: '#64748b', margin: '4px 0 12px' }}>
        Tick a service to provide it to a client — all of that service's stages are included automatically.
        Use the checkbox in a column header to set a service for every client currently shown.
      </p>

      <div className="tf-summary-controls">
        <label>
          <span className="tf-control-label">Category</span>
          <select className="form-input form-input-sm" value={filterCategory} onChange={e => setFilterCategory(e.target.value)}>
            <option value="">All categories</option>
            {categoryOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
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
        <label className="tf-check" title="Clients with a VAT number or a VAT period category on file">
          <input type="checkbox" checked={vatOnly} onChange={e => setVatOnly(e.target.checked)} />
          VAT registered only
        </label>
        <span style={{ fontSize: 12, color: '#94a3b8', alignSelf: 'center' }}>
          {rows.length} clients{busy ? ' · saving…' : ''}
          {vatOnly && vatMissingReg > 0 && (
            <span style={{ color: '#b4720d' }}>
              {' · '}{vatMissingReg} without category/start month
            </span>
          )}
        </span>
        <label style={{ marginLeft: 'auto' }}>
          <span className="tf-control-label">Set manager for all shown</span>
          <span style={{ display: 'flex', gap: 6 }}>
            <select className="form-input form-input-sm" value={bulkManager} onChange={e => setBulkManager(e.target.value)} style={{ minWidth: 140 }}>
              <option value="">— Unassigned —</option>
              {staffUsers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
            <button className="btn btn-secondary btn-sm" onClick={setAllShown} disabled={busy || rows.length === 0}
              title="Assign this manager to every client currently shown">
              Apply to {rows.length}
            </button>
          </span>
        </label>
      </div>

      {loading ? (
        <PanelSkeleton rows={8} />
      ) : services.length === 0 ? (
        <div className="empty-state"><p>No services in the catalogue. Add them in Service Settings first.</p></div>
      ) : rows.length === 0 ? (
        <div className="empty-state"><p>No clients match your search.</p></div>
      ) : (
        <div className="svc-matrix-wrap">
          <table className="svc-matrix">
            <thead>
              <tr>
                <th className="svc-col-client">Client</th>
                <th style={{ textAlign: 'left', minWidth: 150 }}>
                  Account manager<div style={{ fontSize: 10, color: '#64748b', fontWeight: 400 }}>auto-assigned tasks</div>
                </th>
                <th className="svc-col-all">
                  All<div style={{ fontSize: 10, color: '#64748b', fontWeight: 400 }}>per client</div>
                </th>
                {services.map(s => {
                  const st = columnState(s.id);
                  return (
                    <th key={s.id} className="svc-col">
                      <div style={{ marginBottom: 3 }}>{s.label}</div>
                      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, color: '#64748b', fontWeight: 400, cursor: 'pointer' }}
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
                  <td className="svc-col-client">
                    <Link to={`/clients/${c.id}`}>
                      {c.client_code ? <span className="client-code-inline">{c.client_code}</span> : null}
                      {c.name || `Client #${c.id}`}
                    </Link>
                  </td>
                  <td style={{ textAlign: 'left' }}>
                    <select
                      className="form-input form-input-sm"
                      style={{ minWidth: 140 }}
                      value={managers[c.id] || ''}
                      onChange={e => setManager(c.id, e.target.value)}
                      title={`Account manager for ${c.name || `#${c.id}`} — new scheduled tasks are assigned to them`}
                    >
                      <option value="">— unassigned —</option>
                      {staffUsers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                    </select>
                  </td>
                  <td className="svc-col-all">
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
                    <td key={s.id} className="svc-col">
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
