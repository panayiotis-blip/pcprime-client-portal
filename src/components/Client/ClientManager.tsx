import { useState, useRef, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
// (Link is also used below for the "deleted clients" affordance)
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import { useMFAStepUp, MFA_CANCELLED } from '../../context/MFAStepUpContext';
import { useViewPreferences } from '../../context/ViewPreferencesContext';
import { api, hasPermission } from '../../services/api';
import ViewToggle from '../shared/ViewToggle';
import MergeClients from './MergeClients';
import ColumnVisibilityModal, { type ColumnDef } from '../shared/ColumnVisibilityModal';
import * as XLSX from 'xlsx';
import { Modal, Button } from '../ui';

type SortKey = 'client_code' | 'name' | 'tax_number' | 'invoice_count';
type SortDir = 'asc' | 'desc';

// Column registry for the List view. Order = display order.
const CLIENT_COLUMNS: ColumnDef[] = [
  { id: 'client_code',         label: 'Code',           required: true,  defaultVisible: true  },
  { id: 'name',                label: 'Name',           required: true,  defaultVisible: true  },
  { id: 'client_category',     label: 'Category',                        defaultVisible: true  },
  { id: 'client_status',       label: 'Status',                          defaultVisible: true  },
  { id: 'tax_number',          label: 'TIC',                             defaultVisible: true  },
  { id: 'registration_number', label: 'HE Number',                       defaultVisible: true  },
  { id: 'city',                label: 'City',                            defaultVisible: true  },
  { id: 'updated_at',          label: 'Last Updated',                    defaultVisible: true  },
  { id: 'vat_number',          label: 'VAT',                             defaultVisible: false },
  { id: 'business_type',       label: 'Business Type',                   defaultVisible: false },
  { id: 'phone',               label: 'Phone',                           defaultVisible: false },
  { id: 'mobile',              label: 'Mobile',                          defaultVisible: false },
  { id: 'email',               label: 'Email',                           defaultVisible: false },
  { id: 'contact_person',      label: 'Contact Person',                  defaultVisible: false },
  { id: 'invoices_count',      label: 'Invoices',                        defaultVisible: false },
  { id: 'created_at',          label: 'Created',                         defaultVisible: false },
  { id: 'tags',                label: 'Tags',                            defaultVisible: false },
];

const DEFAULT_VISIBLE_COLS = CLIENT_COLUMNS.filter(c => c.defaultVisible).map(c => c.id);

const CATEGORY_OPTIONS: { value: string; label: string }[] = [
  { value: 'company',        label: 'Company' },
  { value: 'partnership',    label: 'Partnership' },
  { value: 'individual',     label: 'Individual' },
  { value: 'sole_trader',    label: 'Sole Trader' },
  { value: 'self_employed',  label: 'Self-Employed' },
  { value: 'deceased',       label: 'Deceased' },
  { value: 'dormant',        label: 'Dormant' },
  { value: 'prospective',    label: 'Prospective' },
  { value: 'other',          label: 'Other' },
  { value: 'vendor_only',    label: 'Vendor (supplier)' },
];

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: 'active',             label: 'Active' },
  { value: 'liquidated_dormant', label: 'Liquidated / Dormant' },
  { value: 'deceased',           label: 'Deceased' },
  { value: 'old_client',         label: 'Old Client' },
  { value: 'defence_tax_only',   label: 'Defence Tax Only' },
  { value: 'internal',           label: 'Internal' },
];

export default function ClientManager() {
  const { clients, refreshClients, invoices } = useApp();
  const { user } = useAuth();
  const { runWith } = useMFAStepUp();
  const { getMode, setMode } = useViewPreferences();
  const canSeeDeleted = hasPermission(user, 'clients.restore');
  const [unlinkedCount, setUnlinkedCount] = useState(0);

  useEffect(() => {
    api.countUnlinkedDirectors().then(setUnlinkedCount).catch(() => {});
  }, [clients.length]);

  // Pinned-clients map (UI polish part 3) — quick lookup for the star icon
  // on each row and for toggling pin state. Lives locally; the sidebar's
  // Favourites group has its own copy that refreshes on next reload.
  const [pinnedClientIds, setPinnedClientIds] = useState<Set<string>>(new Set());
  const [pinFavRowIds, setPinFavRowIds]       = useState<Record<string, number>>({});
  useEffect(() => {
    api.getMyFavourites()
      .then(rows => {
        const ids = new Set<string>();
        const map: Record<string, number> = {};
        for (const r of (rows as any[])) {
          if (r.favourite_type === 'client') {
            ids.add(String(r.target_id));
            map[String(r.target_id)] = r.id;
          }
        }
        setPinnedClientIds(ids);
        setPinFavRowIds(map);
      })
      .catch(() => {});
  }, []);

  const togglePinClient = async (c: any) => {
    const key = String(c.id);
    if (pinnedClientIds.has(key)) {
      const rowId = pinFavRowIds[key];
      if (!rowId) return;
      try {
        await api.unpinFavourite(rowId);
        setPinnedClientIds(prev => { const n = new Set(prev); n.delete(key); return n; });
        setPinFavRowIds(prev => { const n = { ...prev }; delete n[key]; return n; });
      } catch (err: any) { alert(err.message); }
    } else {
      try {
        const newId = await api.pinFavourite('client', key, c.name || `#${c.id}`);
        setPinnedClientIds(prev => { const n = new Set(prev); n.add(key); return n; });
        setPinFavRowIds(prev => ({ ...prev, [key]: newId }));
      } catch (err: any) { alert(err.message); }
    }
  };

  // Filter state (Phase 6 / clients-v3 Part E2)
  const [filterCategory, setFilterCategory] = useState('');
  const [filterStatus,   setFilterStatus]   = useState('');
  const [filterCity,     setFilterCity]     = useState('');
  const [filterHasVat,   setFilterHasVat]   = useState<'all' | 'yes' | 'no'>('all');
  const [filterTag,      setFilterTag]      = useState('');

  // Bulk selection (E5)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [showBulkInactive, setShowBulkInactive] = useState(false);
  const [bulkInactiveStatus, setBulkInactiveStatus] = useState('old_client');
  const [showBulkTag, setShowBulkTag] = useState(false);
  const [bulkTagInput, setBulkTagInput] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);

  // Column visibility (Phase 6 / clients-v3 Part E1)
  const [visibleColumns, setVisibleColumns] = useState<string[]>(DEFAULT_VISIBLE_COLS);
  const [showColumnsModal, setShowColumnsModal] = useState(false);

  // Load column prefs once
  useEffect(() => {
    api.getColumnPreferences()
      .then(prefs => {
        const saved = prefs?.clients;
        if (Array.isArray(saved) && saved.length > 0) setVisibleColumns(saved);
      })
      .catch(() => {});
  }, []);

  const saveColumns = (ids: string[]) => {
    setVisibleColumns(ids);
    api.setColumnPreferences('clients', ids).catch(() => {});
  };
  const resetColumns = () => saveColumns(DEFAULT_VISIBLE_COLS);

  // ----- Advanced find (E4) -----
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [adv, setAdv] = useState({
    codeFrom: '', codeTo: '',
    nameFrom: '', nameTo: '',
    ticContains: '', vatContains: '',
    heContains: '', cityContains: '',
  });
  const clearAdvanced = () => setAdv({
    codeFrom: '', codeTo: '',
    nameFrom: '', nameTo: '',
    ticContains: '', vatContains: '',
    heContains: '', cityContains: '',
  });
  const advActive = Object.values(adv).some(v => v && String(v).trim() !== '');

  // ----- Saved views (E3) -----
  const [showViews, setShowViews] = useState(false);
  const [savedViews, setSavedViews] = useState<any[]>([]);
  const [newViewName, setNewViewName] = useState('');

  const DEFAULT_VIEWS: { name: string; filter: any }[] = [
    { name: 'All Active Companies',     filter: { category: 'company',     status: 'active' } },
    { name: 'All Active Individuals',   filter: { category: 'individual',  status: 'active' } },
    { name: 'All Active Partnerships',  filter: { category: 'partnership', status: 'active' } },
    { name: 'Liquidated / Dormant',     filter: { status: 'liquidated_dormant' } },
    { name: 'Deceased',                 filter: { status: 'deceased' } },
    { name: 'Clients with VAT',         filter: { hasVat: 'yes' } },
    { name: 'Old Clients',              filter: { status: 'old_client' } },
  ];

  useEffect(() => {
    api.getSavedFilters('clients').then(setSavedViews).catch(() => {});
  }, []);

  // Apply a saved/default view's filter shape onto the live filter state.
  const applyView = (f: any) => {
    setSearchTerm(f.search ?? '');
    setFilterCategory(f.category ?? '');
    setFilterStatus(f.status ?? '');
    setFilterCity(f.city ?? '');
    setFilterHasVat(f.hasVat ?? 'all');
    setAdv({
      codeFrom: f.codeFrom ?? '', codeTo: f.codeTo ?? '',
      nameFrom: f.nameFrom ?? '', nameTo: f.nameTo ?? '',
      ticContains: f.ticContains ?? '', vatContains: f.vatContains ?? '',
      heContains: f.heContains ?? '', cityContains: f.cityContains ?? '',
    });
    setShowViews(false);
  };

  const handleSaveView = async () => {
    const name = newViewName.trim();
    if (!name) { alert('Name your view first.'); return; }
    const cfg = {
      search: searchTerm,
      category: filterCategory,
      status: filterStatus,
      city: filterCity,
      hasVat: filterHasVat,
      ...adv,
    };
    try {
      await api.createSavedFilter({ name, scope: 'clients', filter_config: cfg });
      setNewViewName('');
      const updated = await api.getSavedFilters('clients');
      setSavedViews(updated);
    } catch (err: any) {
      alert('Save failed: ' + err.message);
    }
  };

  const handleDeleteView = async (id: number, name: string) => {
    if (!confirm(`Delete saved view "${name}"?`)) return;
    try {
      await api.deleteSavedFilter(id);
      setSavedViews(prev => prev.filter(v => v.id !== id));
    } catch (err: any) {
      alert('Delete failed: ' + err.message);
    }
  };
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<any>({ client_code: '', name: '', trading_name: '', email: '', phone: '', address: '', tax_number: '', notes: '', country: 'Cyprus' });
  const [createUser, setCreateUser] = useState(false);
  const [userForm, setUserForm] = useState({ username: '', password: '', display_name: '' });
  const viewMode = getMode('clients', 'grid');
  const [searchTerm, setSearchTerm] = useState('');
  const [showImport, setShowImport] = useState(false);
  const [showMerge, setShowMerge] = useState(false);
  const [importMode, setImportMode] = useState<'template' | 'legacy'>('template');
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<any>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Column sort state for List view
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const onSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
  };
  const sortIndicator = (key: SortKey) => sortKey === key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';

  const handleAdd = async () => {
    if (!form.name.trim()) return;
    try {
      const data: any = { ...form };
      await api.createClient(data);
      await refreshClients();
      if (createUser && userForm.username) {
        alert('Client created. To create a login for them, use Supabase Dashboard → Authentication → Users, then link the user in the Users screen.');
      }
      setForm({ client_code: '', name: '', trading_name: '', email: '', phone: '', address: '', tax_number: '', notes: '', country: 'Cyprus' });
      setUserForm({ username: '', password: '', display_name: '' });
      setCreateUser(false);
      setShowForm(false);
    } catch (err: any) {
      alert(err.message);
    }
  };

  const previewCode = async (name: string) => {
    if (!name.trim()) { setForm((p: any) => ({ ...p, client_code: '' })); return; }
    try {
      const { code } = await api.getNextClientCode(name);
      setForm((p: any) => ({ ...p, client_code: code }));
    } catch {}
  };

  const handleGenerateMissing = async () => {
    if (!confirm('Generate client codes for all clients that don\'t have one?')) return;
    try {
      const result = await api.generateMissingCodes();
      await refreshClients();
      alert(`Generated codes for ${result.updated} client(s).`);
    } catch (err: any) {
      alert('Failed: ' + err.message);
    }
  };

  const handleDelete = async (id: number) => {
    const count = invoices.filter((inv: any) => inv.client_id === id).length;
    const detail = count > 0 ? ` (${count} invoice${count === 1 ? '' : 's'} on file)` : '';
    const msg = `Hide this client${detail}? All their data is preserved and they can be restored later from Clients → Deleted.`;
    if (!confirm(msg)) return;
    try {
      await runWith(() => api.deleteClient(id));
      await refreshClients();
    } catch (err: any) {
      if (err.message !== MFA_CANCELLED) alert('Delete failed: ' + err.message);
    }
  };

  const handleImport = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) { alert('Select an Excel file'); return; }
    setImporting(true);
    setImportResult(null);
    try {
      const result = importMode === 'template' ? await api.importStructured(file) : await api.importExcel(file);
      setImportResult(result);
      await refreshClients();
      if (fileRef.current) fileRef.current.value = '';
    } catch (err: any) {
      alert('Import failed: ' + err.message);
    } finally {
      setImporting(false);
    }
  };

  const getInvoiceCount = (clientId: number) => invoices.filter((inv: any) => inv.client_id === clientId).length;

  const filtered = clients.filter((c: any) => {
    // Free-text search
    if (searchTerm) {
      const t = searchTerm.toLowerCase();
      const matches = (c.name || '').toLowerCase().includes(t)
        || (c.client_code || '').toLowerCase().includes(t)
        || (c.tax_number || '').toLowerCase().includes(t)
        || (c.trading_name || '').toLowerCase().includes(t)
        || (c.city || '').toLowerCase().includes(t);
      if (!matches) return false;
    }
    // Vendor-only clients are hidden from the main list unless the category
    // filter is explicitly set to them (Part 6).
    if (c.client_category === 'vendor_only' && filterCategory !== 'vendor_only') return false;
    // Structured filters
    if (filterCategory && c.client_category !== filterCategory) return false;
    if (filterStatus   && c.client_status   !== filterStatus)   return false;
    if (filterCity     && c.city            !== filterCity)     return false;
    if (filterHasVat === 'yes' && !c.vat_number) return false;
    if (filterHasVat === 'no'  &&  c.vat_number) return false;
    if (filterTag && !(Array.isArray(c.tags) && c.tags.includes(filterTag))) return false;

    // Advanced find (E4)
    if (adv.codeFrom && (c.client_code || '') < adv.codeFrom) return false;
    if (adv.codeTo   && (c.client_code || '') > adv.codeTo)   return false;
    if (adv.nameFrom && (c.name || '').toLowerCase() < adv.nameFrom.toLowerCase()) return false;
    if (adv.nameTo   && (c.name || '').toLowerCase() > adv.nameTo.toLowerCase())   return false;
    if (adv.ticContains && !(c.tax_number || '').toLowerCase().includes(adv.ticContains.toLowerCase())) return false;
    if (adv.vatContains && !(c.vat_number || '').toLowerCase().includes(adv.vatContains.toLowerCase())) return false;
    if (adv.heContains  && !(c.registration_number || '').toLowerCase().includes(adv.heContains.toLowerCase())) return false;
    if (adv.cityContains && !(c.city || '').toLowerCase().includes(adv.cityContains.toLowerCase())) return false;

    return true;
  });

  // Distinct cities present in the data — drives the City dropdown
  const cities = useMemo(() => {
    const s = new Set<string>();
    for (const c of clients as any[]) if (c.city) s.add(c.city);
    return Array.from(s).sort();
  }, [clients]);

  // Distinct tags present in the data — drives the Tag dropdown
  const allTags = useMemo(() => {
    const s = new Set<string>();
    for (const c of clients as any[]) if (Array.isArray(c.tags)) for (const t of c.tags) if (t) s.add(t);
    return Array.from(s).sort();
  }, [clients]);

  // Active filter chips
  const activeFilters: { key: string; label: string; clear: () => void }[] = [];
  if (filterCategory)         activeFilters.push({ key: 'cat',  label: 'Category: ' + (CATEGORY_OPTIONS.find(o => o.value === filterCategory)?.label || filterCategory), clear: () => setFilterCategory('') });
  if (filterStatus)           activeFilters.push({ key: 'stat', label: 'Status: '   + (STATUS_OPTIONS.find(o => o.value === filterStatus)?.label || filterStatus),     clear: () => setFilterStatus('') });
  if (filterCity)             activeFilters.push({ key: 'city', label: 'City: ' + filterCity,                                             clear: () => setFilterCity('') });
  if (filterHasVat !== 'all') activeFilters.push({ key: 'vat',  label: 'VAT: '  + filterHasVat,                                           clear: () => setFilterHasVat('all') });
  if (filterTag)              activeFilters.push({ key: 'tag',  label: 'Tag: '  + filterTag,                                              clear: () => setFilterTag('') });
  const clearAllFilters = () => { setFilterCategory(''); setFilterStatus(''); setFilterCity(''); setFilterHasVat('all'); setFilterTag(''); };

  // Helper: render any column's cell content for a given client row
  const renderCell = (col: string, c: any) => {
    switch (col) {
      case 'client_code':          return <strong>{c.client_code || '-'}</strong>;
      case 'name':                 return (
        <>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <button
              type="button"
              className={`pin-star ${pinnedClientIds.has(String(c.id)) ? 'pinned' : ''}`}
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); togglePinClient(c); }}
              title={pinnedClientIds.has(String(c.id)) ? 'Unpin from Favourites' : 'Pin to Favourites'}
            >
              {pinnedClientIds.has(String(c.id)) ? '★' : '☆'}
            </button>
            <Link to={`/clients/${c.id}`} style={{ color: 'var(--primary)', fontWeight: 500 }}>{c.name}</Link>
          </span>
          {c.trading_name && <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{c.trading_name}</div>}
        </>
      );
      case 'client_category':      return c.client_category || '-';
      case 'client_status':        return c.client_status || '-';
      case 'tax_number':           return c.tax_number || '-';
      case 'registration_number':  return c.registration_number || '-';
      case 'city':                 return c.city || '-';
      case 'vat_number':           return c.vat_number || '-';
      case 'business_type':        return c.business_type || '-';
      case 'phone':                return c.phone || '-';
      case 'mobile':                return c.mobile || '-';
      case 'email':                return c.email || '-';
      case 'contact_person':       return c.contact_person || '-';
      case 'invoices_count':       return getInvoiceCount(c.id);
      case 'created_at':           return c.created_at ? new Date(c.created_at).toLocaleDateString() : '-';
      case 'updated_at':           return c.updated_at ? new Date(c.updated_at).toLocaleDateString() : '-';
      case 'tags': {
        const arr: string[] = Array.isArray(c.tags) ? c.tags : [];
        if (arr.length === 0) return '-';
        return (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {arr.map(t => (
              <span key={t} style={{
                background: '#eef1f5', color: 'var(--pc-navy-2)',
                padding: '1px 8px', borderRadius: 999, fontSize: 11,
              }}>{t}</span>
            ))}
          </div>
        );
      }
      default:                     return '-';
    }
  };
  const visibleColumnDefs = CLIENT_COLUMNS.filter(c => visibleColumns.includes(c.id));

  // ----- Bulk action helpers (E5) -----
  const toggleSelect = (id: number) => {
    setSelectedIds(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };
  const allOnPageSelected = filtered.length > 0
    && filtered.every((c: any) => selectedIds.has(c.id));
  const toggleSelectAll = () => {
    setSelectedIds(prev => {
      if (allOnPageSelected) return new Set();
      const n = new Set(prev);
      for (const c of filtered as any[]) n.add(c.id);
      return n;
    });
  };
  const clearSelection = () => setSelectedIds(new Set());

  const handleBulkMarkActive = async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`Mark ${selectedIds.size} client${selectedIds.size === 1 ? '' : 's'} as Active?`)) return;
    setBulkBusy(true);
    try {
      await runWith(() => api.bulkUpdateClientStatus(Array.from(selectedIds), 'active'));
      clearSelection();
      await refreshClients();
    } catch (err: any) {
      if (err.message !== MFA_CANCELLED) alert('Failed: ' + err.message);
    } finally {
      setBulkBusy(false);
    }
  };

  const handleBulkMarkInactive = async () => {
    if (selectedIds.size === 0) return;
    setBulkBusy(true);
    try {
      await runWith(() => api.bulkUpdateClientStatus(Array.from(selectedIds), bulkInactiveStatus));
      setShowBulkInactive(false);
      clearSelection();
      await refreshClients();
    } catch (err: any) {
      if (err.message !== MFA_CANCELLED) alert('Failed: ' + err.message);
    } finally {
      setBulkBusy(false);
    }
  };

  const handleBulkAddTag = async () => {
    const tag = bulkTagInput.trim();
    if (!tag) { alert('Enter a tag.'); return; }
    setBulkBusy(true);
    try {
      const n = await runWith(() => api.bulkAddTagToClients(Array.from(selectedIds), tag));
      setShowBulkTag(false);
      setBulkTagInput('');
      clearSelection();
      await refreshClients();
      alert(`Tag "${tag}" added to ${n} client${n === 1 ? '' : 's'}.`);
    } catch (err: any) {
      if (err.message !== MFA_CANCELLED) alert('Failed: ' + err.message);
    } finally {
      setBulkBusy(false);
    }
  };

  const handleBulkMarkVendor = async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`Mark ${selectedIds.size} client${selectedIds.size === 1 ? '' : 's'} as a vendor / supplier?`)) return;
    setBulkBusy(true);
    try {
      await api.bulkSetVendor(Array.from(selectedIds), true);
      clearSelection();
      await refreshClients();
    } catch (err: any) {
      alert('Failed: ' + err.message);
    } finally {
      setBulkBusy(false);
    }
  };

  const buildExportRows = () => {
    return (clients as any[])
      .filter(c => selectedIds.has(c.id))
      .map(c => ({
        'Code':         c.client_code || '',
        'Name':         c.name || '',
        'Category':     c.client_category || '',
        'Status':       c.client_status || '',
        'Active':       c.is_active === false ? 'No' : 'Yes',
        'TIC':          c.tax_number || '',
        'VAT':          c.vat_number || '',
        'HE Number':    c.registration_number || '',
        'Email':        Array.isArray(c.email) ? c.email.join('; ') : (c.email || ''),
        'Phone':        c.phone || '',
        'Mobile':       c.mobile || '',
        'City':         c.city || '',
        'Country':      c.country || '',
        'Tags':         Array.isArray(c.tags) ? c.tags.join(', ') : '',
        'Last Updated': c.updated_at ? new Date(c.updated_at).toISOString().slice(0,10) : '',
      }));
  };

  const handleBulkExportExcel = () => {
    const rows = buildExportRows();
    if (rows.length === 0) return;
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Clients');
    XLSX.writeFile(wb, `clients-${new Date().toISOString().slice(0,10)}.xlsx`);
  };

  const handleBulkExportCsv = () => {
    const rows = buildExportRows();
    if (rows.length === 0) return;
    const cols = Object.keys(rows[0]);
    const esc = (v: any) => {
      const s = String(v ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [cols.join(','), ...rows.map(r => cols.map(c => esc((r as any)[c])).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `clients-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
  };

  // Sort the filtered list — applied to the List view, also to Compact for stability.
  const sortedFiltered = [...filtered].sort((a: any, b: any) => {
    const dir = sortDir === 'asc' ? 1 : -1;
    if (sortKey === 'invoice_count') {
      return dir * (getInvoiceCount(a.id) - getInvoiceCount(b.id));
    }
    const av = String(a[sortKey] || '').toLowerCase();
    const bv = String(b[sortKey] || '').toLowerCase();
    if (av < bv) return -1 * dir;
    if (av > bv) return  1 * dir;
    return 0;
  });

  return (
    <div className="client-manager">
      <div className="list-header">
        <h2>Clients ({clients.filter((c: any) => c.client_category !== 'vendor_only').length})</h2>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-secondary btn-sm" onClick={handleGenerateMissing} title="Auto-generate codes for clients without one">
            #️⃣ Gen Codes
          </button>
          {canSeeDeleted && <Link to="/clients/deleted" className="btn btn-secondary">🗑 Deleted</Link>}
          {unlinkedCount > 0 && (
            <Link to="/clients/unlinked-directors" className="btn btn-secondary" style={{ borderColor: '#f59e0b' }} title="Director rows without a linked client">
              ⚠ Unlinked Directors ({unlinkedCount})
            </Link>
          )}
          <button className="btn btn-secondary" onClick={() => setShowMerge(!showMerge)}>
            {showMerge ? 'Cancel' : '⇄ Merge Duplicates'}
          </button>
          <button className="btn btn-secondary" onClick={() => setShowImport(!showImport)}>
            {showImport ? 'Cancel' : '📥 Import'}
          </button>
          <button className="btn btn-primary" onClick={() => setShowForm(!showForm)}>
            {showForm ? 'Cancel' : '+ Add Client'}
          </button>
        </div>
      </div>

      {/* Merge UI */}
      {showMerge && (
        <div className="card" style={{ marginBottom: 16 }}>
          <MergeClients onDone={() => setShowMerge(false)} />
        </div>
      )}

      {/* Import UI */}
      {showImport && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="import-mode-selector">
            <button className={`folder-tab ${importMode === 'template' ? 'active' : ''}`} onClick={() => setImportMode('template')}>
              📄 Template Import (Recommended)
            </button>
            <button className={`folder-tab ${importMode === 'legacy' ? 'active' : ''}`} onClick={() => setImportMode('legacy')}>
              🗂 Legacy Multi-tab Import
            </button>
          </div>

          {importMode === 'template' ? (
            <>
              <h3 style={{ marginBottom: 8 }}>Template-based Import</h3>
              <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 12 }}>
                Download the template, fill it in, and upload it back. Credentials link to clients via <code>client_code</code>.
              </p>
              <a href={api.getImportTemplateUrl()} download className="btn btn-secondary" style={{ marginBottom: 12, display: 'inline-block' }}>
                📥 Download Template
              </a>
              <div style={{ marginTop: 12 }}>
                <input ref={fileRef} type="file" accept=".xlsx,.xls" className="form-input" />
                <button className="btn btn-primary" onClick={handleImport} disabled={importing} style={{ marginTop: 12 }}>
                  {importing ? 'Importing...' : 'Upload & Import'}
                </button>
              </div>
            </>
          ) : (
            <>
              <h3 style={{ marginBottom: 8 }}>Legacy Multi-tab Import</h3>
              <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 12 }}>
                Upload your existing multi-tab Excel (PC TAX CLIENTS, CY LOGIN CODES, UBO's, etc.). This is a best-effort import.
              </p>
              <input ref={fileRef} type="file" accept=".xlsx,.xls" className="form-input" />
              <button className="btn btn-primary" onClick={handleImport} disabled={importing} style={{ marginTop: 12 }}>
                {importing ? 'Importing...' : 'Start Import'}
              </button>
            </>
          )}

          {importResult && (
            <div className="import-result" style={{ marginTop: 16, padding: 12, background: '#dcfce7', borderRadius: 6 }}>
              <h4 style={{ margin: 0, color: '#166534' }}>Import complete!</h4>
              <ul style={{ marginTop: 8, marginLeft: 20 }}>
                {importResult.clientsCreated !== undefined && <li><strong>{importResult.clientsCreated}</strong> clients created</li>}
                {importResult.clientsUpdated !== undefined && <li><strong>{importResult.clientsUpdated}</strong> clients updated</li>}
                {importResult.credentialsAdded !== undefined && <li><strong>{importResult.credentialsAdded}</strong> credentials added</li>}
                {importResult.credentialsUpdated !== undefined && <li><strong>{importResult.credentialsUpdated}</strong> credentials updated</li>}
                {importResult.tabsProcessed && <li>Tabs: {importResult.tabsProcessed.join(', ')}</li>}
              </ul>
              {(importResult.errors?.length > 0 || importResult.warnings?.length > 0) && (
                <details style={{ marginTop: 8 }}>
                  <summary>Messages ({(importResult.errors?.length || 0) + (importResult.warnings?.length || 0)})</summary>
                  <ul style={{ marginLeft: 20, fontSize: 12 }}>
                    {importResult.errors?.map((e: string, i: number) => <li key={'e'+i}>{e}</li>)}
                    {importResult.warnings?.map((w: string, i: number) => <li key={'w'+i}>⚠ {w}</li>)}
                  </ul>
                </details>
              )}
            </div>
          )}
        </div>
      )}

      {/* Add form */}
      {showForm && (
        <div className="client-form card">
          <div className="form-grid">
            <div className="form-group">
              <label>Name *</label>
              <input type="text" value={form.name} onChange={(e) => { setForm((p: any) => ({ ...p, name: e.target.value })); previewCode(e.target.value); }} className="form-input" placeholder="Client name" autoFocus />
            </div>
            <div className="form-group">
              <label>Client Code (auto-generated)</label>
              <input type="text" value={form.client_code} onChange={(e) => setForm((p: any) => ({ ...p, client_code: e.target.value.toUpperCase() }))} className="form-input" placeholder="Will auto-generate: 221XXX001" style={{ fontFamily: 'monospace' }} />
              <p style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>Format: 221 + first 3 letters + sequential number</p>
            </div>
            <div className="form-group"><label>Trading Name</label><input type="text" value={form.trading_name} onChange={(e) => setForm((p: any) => ({ ...p, trading_name: e.target.value }))} className="form-input" /></div>
            <div className="form-group"><label>Tax Number (TIC)</label><input type="text" value={form.tax_number} onChange={(e) => setForm((p: any) => ({ ...p, tax_number: e.target.value }))} className="form-input" /></div>
            <div className="form-group"><label>Email</label><input type="email" value={form.email} onChange={(e) => setForm((p: any) => ({ ...p, email: e.target.value }))} className="form-input" /></div>
            <div className="form-group"><label>Phone</label><input type="text" value={form.phone} onChange={(e) => setForm((p: any) => ({ ...p, phone: e.target.value }))} className="form-input" /></div>
            <div className="form-group full-width"><label>Address</label><input type="text" value={form.address} onChange={(e) => setForm((p: any) => ({ ...p, address: e.target.value }))} className="form-input" /></div>
            <div className="form-group full-width"><label>Notes</label><textarea value={form.notes} onChange={(e) => setForm((p: any) => ({ ...p, notes: e.target.value }))} className="form-input" rows={2} /></div>
          </div>
          <div style={{ marginTop: 16, padding: 12, background: '#f8fafc', borderRadius: 6 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontWeight: 500 }}>
              <input type="checkbox" checked={createUser} onChange={(e) => setCreateUser(e.target.checked)} />
              Create a client login for this client
            </label>
            {createUser && (
              <div className="form-grid" style={{ marginTop: 12 }}>
                <div className="form-group"><label>Login Username</label><input type="text" value={userForm.username} onChange={(e) => setUserForm(p => ({ ...p, username: e.target.value }))} className="form-input" placeholder="e.g. acme_user" /></div>
                <div className="form-group"><label>Password</label><input type="text" value={userForm.password} onChange={(e) => setUserForm(p => ({ ...p, password: e.target.value }))} className="form-input" placeholder="Initial password" /></div>
                <div className="form-group"><label>Display Name</label><input type="text" value={userForm.display_name} onChange={(e) => setUserForm(p => ({ ...p, display_name: e.target.value }))} className="form-input" placeholder="Defaults to client name" /></div>
              </div>
            )}
          </div>
          <button className="btn btn-primary" onClick={handleAdd} style={{ marginTop: 12 }}>Save Client</button>
          <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 8 }}>Other details (VAT, services, directors, credentials) can be added after creating the client.</p>
        </div>
      )}

      {/* Search + Filters + Columns + View toggle */}
      <div className="client-toolbar" style={{ flexWrap: 'wrap', gap: 8 }}>
        <input type="text" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} placeholder="Search by name, code, TIC, city..." className="form-input client-search" />
        <select className="form-input" value={filterCategory} onChange={e => setFilterCategory(e.target.value)} style={{ maxWidth: 170 }} title="Filter by category">
          <option value="">All categories</option>
          {CATEGORY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select className="form-input" value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={{ maxWidth: 180 }} title="Filter by status">
          <option value="">All statuses</option>
          {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select className="form-input" value={filterCity} onChange={e => setFilterCity(e.target.value)} style={{ maxWidth: 150 }} title="Filter by city">
          <option value="">All cities</option>
          {cities.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select className="form-input" value={filterHasVat} onChange={e => setFilterHasVat(e.target.value as any)} style={{ maxWidth: 140 }} title="Filter by VAT registration">
          <option value="all">VAT: any</option>
          <option value="yes">Has VAT</option>
          <option value="no">No VAT</option>
        </select>
        {allTags.length > 0 && (
          <select className="form-input" value={filterTag} onChange={e => setFilterTag(e.target.value)} style={{ maxWidth: 150 }} title="Filter by tag">
            <option value="">All tags</option>
            {allTags.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        )}
        <button
          className={`btn btn-sm ${advActive ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setShowAdvanced(s => !s)}
          title="Advanced search (ranges + contains)"
        >
          🔍 Find {advActive ? '●' : (showAdvanced ? '▲' : '▼')}
        </button>
        <div style={{ position: 'relative' }}>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => setShowViews(v => !v)}
            title="Saved views"
          >
            ⭐ Views {showViews ? '▲' : '▼'}
          </button>
          {showViews && (
            <div style={{
              position: 'absolute', top: '100%', right: 0, marginTop: 4,
              background: 'white', border: '1px solid var(--border)', borderRadius: 6,
              boxShadow: '0 6px 16px rgba(0,0,0,0.1)', padding: 8,
              minWidth: 280, maxHeight: 420, overflowY: 'auto', zIndex: 30,
            }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: '#64748b', padding: '4px 6px' }}>Defaults</div>
              {DEFAULT_VIEWS.map(v => (
                <button
                  key={v.name}
                  className="btn btn-link btn-sm"
                  onClick={() => applyView(v.filter)}
                  style={{ display: 'block', width: '100%', textAlign: 'left', padding: '6px 8px', borderRadius: 4 }}
                >
                  {v.name}
                </button>
              ))}
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: '#64748b', padding: '8px 6px 4px' }}>Your saved views</div>
              {savedViews.length === 0 ? (
                <p style={{ fontSize: 12, color: '#94a3b8', padding: '4px 8px', margin: 0 }}>None yet.</p>
              ) : savedViews.map((v: any) => (
                <div key={v.id} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <button
                    className="btn btn-link btn-sm"
                    onClick={() => applyView(v.filter_config || {})}
                    style={{ flex: 1, textAlign: 'left', padding: '6px 8px', borderRadius: 4 }}
                  >
                    {v.name}
                  </button>
                  <button
                    onClick={() => handleDeleteView(v.id, v.name)}
                    title="Delete view"
                    style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: '4px 8px' }}
                  >✕</button>
                </div>
              ))}
              <div style={{ borderTop: '1px solid #e2e8f0', marginTop: 8, paddingTop: 8, display: 'flex', gap: 4 }}>
                <input
                  type="text"
                  className="form-input form-input-sm"
                  value={newViewName}
                  onChange={e => setNewViewName(e.target.value)}
                  placeholder="Save current as..."
                  style={{ flex: 1 }}
                />
                <button className="btn btn-primary btn-sm" onClick={handleSaveView}>Save</button>
              </div>
            </div>
          )}
        </div>
        {viewMode === 'list' && (
          <button className="btn btn-secondary btn-sm" onClick={() => setShowColumnsModal(true)} title="Show/hide columns in the list view">
            ☰ Columns
          </button>
        )}
        <ViewToggle value={viewMode} onChange={(m) => setMode('clients', m)} />
      </div>

      {showAdvanced && (
        <div style={{
          padding: 12, background: '#f8fafc',
          border: '1px solid var(--border)', borderRadius: 6,
          margin: '0 0 12px 0',
        }}>
          <div className="form-grid">
            <div className="form-group"><label>Code from</label><input className="form-input" value={adv.codeFrom} onChange={e => setAdv(a => ({ ...a, codeFrom: e.target.value }))} placeholder="e.g. PC-CO-001" /></div>
            <div className="form-group"><label>Code to</label>  <input className="form-input" value={adv.codeTo}   onChange={e => setAdv(a => ({ ...a, codeTo:   e.target.value }))} placeholder="e.g. PC-CO-050" /></div>
            <div className="form-group"><label>Name from</label><input className="form-input" value={adv.nameFrom} onChange={e => setAdv(a => ({ ...a, nameFrom: e.target.value }))} placeholder="alphabetical from..." /></div>
            <div className="form-group"><label>Name to</label>  <input className="form-input" value={adv.nameTo}   onChange={e => setAdv(a => ({ ...a, nameTo:   e.target.value }))} placeholder="...to" /></div>
            <div className="form-group"><label>TIC contains</label><input className="form-input" value={adv.ticContains} onChange={e => setAdv(a => ({ ...a, ticContains: e.target.value }))} /></div>
            <div className="form-group"><label>VAT contains</label><input className="form-input" value={adv.vatContains} onChange={e => setAdv(a => ({ ...a, vatContains: e.target.value }))} /></div>
            <div className="form-group"><label>HE Number contains</label><input className="form-input" value={adv.heContains} onChange={e => setAdv(a => ({ ...a, heContains: e.target.value }))} /></div>
            <div className="form-group"><label>City contains</label><input className="form-input" value={adv.cityContains} onChange={e => setAdv(a => ({ ...a, cityContains: e.target.value }))} /></div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
            <button className="btn btn-link btn-sm" onClick={clearAdvanced} disabled={!advActive}>Clear advanced</button>
            <button className="btn btn-secondary btn-sm" onClick={() => setShowAdvanced(false)}>Hide</button>
          </div>
        </div>
      )}

      {activeFilters.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '0 0 12px 0' }}>
          {activeFilters.map(f => (
            <span key={f.key} style={{
              background: 'var(--pc-gold-tint)', color: 'var(--pc-navy)',
              border: '1px solid var(--pc-navy)',
              padding: '2px 10px', borderRadius: 999, fontSize: 12,
              display: 'inline-flex', alignItems: 'center', gap: 4,
            }}>
              {f.label}
              <button
                onClick={f.clear}
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'inherit', padding: 0, fontSize: 14, lineHeight: 1 }}
                title="Remove filter"
              >✕</button>
            </span>
          ))}
          <button className="btn btn-link btn-sm" onClick={clearAllFilters}>Clear all</button>
        </div>
      )}

      {showColumnsModal && (
        <ColumnVisibilityModal
          title="Choose columns — Clients list"
          columns={CLIENT_COLUMNS}
          visibleIds={visibleColumns}
          onChange={saveColumns}
          onReset={resetColumns}
          onClose={() => setShowColumnsModal(false)}
        />
      )}

      {/* Bulk action bar (E5) — visible only when rows are selected */}
      {selectedIds.size > 0 && (
        <div style={{
          display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center',
          padding: '8px 12px', background: '#fef3c7', border: '1px solid #f59e0b',
          borderRadius: 6, marginBottom: 12,
        }}>
          <strong>{selectedIds.size} selected</strong>
          <button className="btn btn-primary btn-sm" onClick={handleBulkMarkActive} disabled={bulkBusy}>Mark Active</button>
          <button className="btn btn-secondary btn-sm" onClick={() => setShowBulkInactive(true)} disabled={bulkBusy}>Mark Inactive…</button>
          <button className="btn btn-secondary btn-sm" onClick={() => setShowBulkTag(true)} disabled={bulkBusy}>Add Tag…</button>
          <button className="btn btn-secondary btn-sm" onClick={handleBulkMarkVendor} disabled={bulkBusy}>Mark as Vendor</button>
          <button className="btn btn-secondary btn-sm" onClick={handleBulkExportExcel} disabled={bulkBusy}>⬇ Excel</button>
          <button className="btn btn-secondary btn-sm" onClick={handleBulkExportCsv} disabled={bulkBusy}>⬇ CSV</button>
          <button
            className="btn btn-secondary btn-sm"
            disabled
            title="Available after email integration is live"
          >Email Statements (soon)</button>
          <button className="btn btn-link btn-sm" onClick={clearSelection}>Clear selection</button>
        </div>
      )}

      {/* Bulk Mark Inactive modal — pick which status */}
      <Modal
        open={showBulkInactive}
        onClose={() => setShowBulkInactive(false)}
        title={`Mark ${selectedIds.size} client${selectedIds.size === 1 ? '' : 's'} as inactive`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowBulkInactive(false)} disabled={bulkBusy}>Cancel</Button>
            <Button variant="primary" onClick={handleBulkMarkInactive} disabled={bulkBusy}>{bulkBusy ? 'Updating…' : 'Apply'}</Button>
          </>
        }
      >
        <p style={{ marginTop: 0, fontSize: 13, color: 'var(--pc-text-2)' }}>Pick which inactive sub-status to apply:</p>
        <select className="form-input" value={bulkInactiveStatus} onChange={e => setBulkInactiveStatus(e.target.value)} style={{ width: '100%' }}>
          {STATUS_OPTIONS.filter(s => s.value !== 'active').map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </Modal>

      {/* Bulk Add Tag modal */}
      <Modal
        open={showBulkTag}
        onClose={() => setShowBulkTag(false)}
        title={`Add a tag to ${selectedIds.size} client${selectedIds.size === 1 ? '' : 's'}`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowBulkTag(false)} disabled={bulkBusy}>Cancel</Button>
            <Button variant="primary" onClick={handleBulkAddTag} disabled={bulkBusy}>{bulkBusy ? 'Adding…' : 'Add tag'}</Button>
          </>
        }
      >
        <input
          type="text"
          className="form-input"
          value={bulkTagInput}
          onChange={e => setBulkTagInput(e.target.value)}
          placeholder="e.g. VIP / Q1 Onboarding"
          list="all-tags-suggestions"
          autoFocus
          style={{ width: '100%' }}
        />
        <datalist id="all-tags-suggestions">
          {allTags.map(t => <option key={t} value={t} />)}
        </datalist>
        <p style={{ fontSize: 12, color: 'var(--pc-text-2)', marginTop: 8 }}>
          Tags are deduplicated — adding an existing tag to a client is a no-op.
        </p>
      </Modal>

      {clients.length === 0 ? (
        <div className="empty-state"><p>No clients yet.</p></div>
      ) : filtered.length === 0 ? (
        <div className="empty-state"><p>No clients match your search.</p></div>
      ) : viewMode === 'grid' ? (
        <div className="client-cards">
          {filtered.map((client: any) => (
            <Link to={`/clients/${client.id}`} key={client.id} className="dashboard-client-card">
              <div className="dc-card-header">
                {client.client_code && <span className="client-code-badge">{client.client_code}</span>}
                <h3>{client.name}</h3>
                {client.trading_name && <p className="dc-trading">{client.trading_name}</p>}
              </div>
              <div className="dc-card-info">
                {client.tax_number && <p>TIC: {client.tax_number}</p>}
                {client.vat_number && <p>VAT: {client.vat_number}</p>}
                {client.email && <p>✉ {client.email}</p>}
                {client.phone && <p>☎ {client.phone}</p>}
                <p>{getInvoiceCount(client.id)} invoices</p>
              </div>
              <div className="dc-card-footer"><span>View Details →</span></div>
            </Link>
          ))}
        </div>
      ) : viewMode === 'compact' ? (
        <div className="client-cards client-cards-compact">
          {filtered.map((client: any) => (
            <Link to={`/clients/${client.id}`} key={client.id} className="dashboard-client-card dashboard-client-card-compact">
              <div className="dc-card-header">
                {client.client_code && <span className="client-code-badge">{client.client_code}</span>}
                <h3>{client.name}</h3>
              </div>
              <div className="dc-card-info">
                {client.tax_number && <p>TIC: {client.tax_number}</p>}
                <p>{getInvoiceCount(client.id)} invoices</p>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="export-table-wrapper">
          <table className="export-table sortable-table">
            <thead>
              <tr>
                <th style={{ width: 30 }}>
                  <input type="checkbox" checked={allOnPageSelected} onChange={toggleSelectAll} title="Select all on this page" />
                </th>
                {visibleColumnDefs.map(col => {
                  const sortable = ['client_code', 'name', 'tax_number', 'invoices_count'].includes(col.id);
                  const sortKeyForCol = col.id === 'invoices_count' ? 'invoice_count' : col.id as SortKey;
                  return (
                    <th
                      key={col.id}
                      className={sortable ? 'sortable' : ''}
                      onClick={sortable ? () => onSort(sortKeyForCol as SortKey) : undefined}
                    >
                      {col.label}
                      {sortable ? sortIndicator(sortKeyForCol as SortKey) : ''}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {sortedFiltered.map((c: any) => (
                <tr key={c.id} style={selectedIds.has(c.id) ? { background: 'var(--pc-gold-tint)' } : undefined}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(c.id)}
                      onChange={() => toggleSelect(c.id)}
                      onClick={e => e.stopPropagation()}
                    />
                  </td>
                  {visibleColumnDefs.map(col => (
                    <td key={col.id}>{renderCell(col.id, c)}</td>
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
