import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
// (Link is also used below for the "deleted clients" affordance)
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import { useMFAStepUp, MFA_CANCELLED } from '../../context/MFAStepUpContext';
import { api, hasPermission, isSupervisorOrHigher } from '../../services/api';
import { vatCategoryLabel } from '../../services/vatCategories';
import MergeClients from './MergeClients';
import ColumnVisibilityModal, { type ColumnDef } from '../shared/ColumnVisibilityModal';
import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
// Registers Roboto Regular + Bold + Italic on every jsPDF instance — needed
// so Greek client names render correctly in the printed client list.
import { registerRobotoFont } from '../../assets/fonts/Roboto-Regular-normal.js';
import { Modal, Button } from '../ui';
import { formatDate } from '../../services/dates';

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
  { id: 'vat_category',        label: 'VAT Cat',                         defaultVisible: false },
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

// Fields that can be included on the printed client list. Each row has a
// getter that produces the cell value from a client record. Order = display
// order in the PDF when selected.
type PrintField = { id: string; label: string; get: (c: any) => string; width?: number };
const PRINT_FIELDS: PrintField[] = [
  { id: 'client_code',         label: 'Code',          get: c => c.client_code || '',                width: 18 },
  { id: 'name',                label: 'Name',          get: c => c.name || '',                       width: 55 },
  { id: 'client_category',     label: 'Category',      get: c => c.client_category || '',            width: 24 },
  { id: 'client_status',       label: 'Status',        get: c => c.client_status || '',              width: 22 },
  { id: 'tax_number',          label: 'TIC',           get: c => c.tax_number || '',                 width: 22 },
  { id: 'vat_number',          label: 'VAT',           get: c => c.vat_number || '',                 width: 22 },
  { id: 'registration_number', label: 'HE Number',     get: c => c.registration_number || '',        width: 22 },
  { id: 'business_type',       label: 'Business Type', get: c => c.business_type || '',              width: 26 },
  { id: 'phone',               label: 'Phone',         get: c => c.phone || '',                      width: 26 },
  { id: 'mobile',              label: 'Mobile',        get: c => c.mobile || '',                     width: 26 },
  { id: 'email',               label: 'Email',         get: c => Array.isArray(c.email) ? c.email.join('; ') : (c.email || ''), width: 50 },
  { id: 'contact_person',      label: 'Contact',       get: c => c.contact_person || '',             width: 32 },
  { id: 'address',             label: 'Address',       get: c => c.address || '',                    width: 50 },
  { id: 'city',                label: 'City',          get: c => c.city || '',                       width: 26 },
  { id: 'country',             label: 'Country',       get: c => c.country || '',                    width: 22 },
  { id: 'tags',                label: 'Tags',          get: c => Array.isArray(c.tags) ? c.tags.join(', ') : '', width: 28 },
  { id: 'updated_at',          label: 'Last Updated',  get: c => c.updated_at ? new Date(c.updated_at).toLocaleDateString('en-GB') : '', width: 22 },
  { id: 'created_at',          label: 'Created',       get: c => c.created_at ? new Date(c.created_at).toLocaleDateString('en-GB') : '', width: 22 },
];
const DEFAULT_PRINT_FIELDS = ['client_code', 'name', 'client_category', 'tax_number', 'phone', 'email'];

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
  // Supervisor+ only: viewing the deleted-clients list, merging duplicates,
  // and the unlinked-directors fix-up. Everyone else can still edit / add
  // clients and use everything else on this page.
  const isSupervisor = isSupervisorOrHigher(user);
  const canSeeDeleted = isSupervisor && hasPermission(user, 'clients.restore');
  const [unlinkedCount, setUnlinkedCount] = useState(0);

  useEffect(() => {
    api.countUnlinkedDirectors().then(setUnlinkedCount).catch(() => {});
  }, [clients.length]);

  // Client categories drive the category filter dropdown (editable list).
  const [categoryOptions, setCategoryOptions] = useState<{ value: string; label: string }[]>([]);
  useEffect(() => {
    api.getClientCategories()
      .then((rows) => setCategoryOptions((rows as any[]).map((r) => ({ value: r.value, label: r.label }))))
      .catch(() => {});
  }, []);

  // Cities (managed list) drive the city filter dropdown.
  const [cityOptions, setCityOptions] = useState<string[]>([]);
  useEffect(() => {
    api.getCities()
      .then((rows) => setCityOptions((rows as any[]).map((r) => r.name)))
      .catch(() => {});
  }, []);

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
  // Print Client List state
  const [showPrintModal, setShowPrintModal] = useState(false);
  const [printFields, setPrintFields] = useState<Set<string>>(() => new Set(DEFAULT_PRINT_FIELDS));
  // 'all' = current filtered+sorted list; 'selected' = only ticked rows from bulk selection.
  const [printScope, setPrintScope] = useState<'all' | 'selected'>('all');
  // Optional filters applied on top of the scope.
  const [printTypeFilter, setPrintTypeFilter] = useState<'all' | 'individual' | 'company'>('all');
  const [printFromId, setPrintFromId] = useState<number | null>(null); // alphabetic range start
  const [printToId, setPrintToId] = useState<number | null>(null);     // alphabetic range end
  // Recipient address for the Email PDF action.
  const [printEmailTo, setPrintEmailTo] = useState<string>('');
  // Send-status surface for the modal banner.
  const [emailStatus, setEmailStatus] = useState<{ kind: 'idle' | 'sending' | 'sent' | 'error'; text?: string }>({ kind: 'idle' });

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
  const [searchTerm, setSearchTerm] = useState('');
  const [showMerge, setShowMerge] = useState(false);

  // Column sort state for List view. Default to code so the list lines up
  // with how the user reads paper files.
  const [sortKey, setSortKey] = useState<SortKey>('client_code');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const onSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
  };
  const sortIndicator = (key: SortKey) => sortKey === key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';

  const handleAdd = async () => {
    const type = form.client_type || 'company';
    // Validate the right name field for the chosen type.
    if (type === 'individual') {
      if (!(form.surname || '').trim()) { alert('Surname is required for an individual.'); return; }
    } else {
      if (!(form.legal_name || form.name || '').trim()) { alert('Legal name is required for a company.'); return; }
    }
    // Last-line defence — the form already blocks Save when codeDuplicate is
    // set, but if a race somehow let this through, refuse here too.
    if (codeDuplicate) {
      alert(`Client code "${form.client_code}" is already used by ${codeDuplicate.name}. Pick a different code.`);
      return;
    }
    try {
      const data: any = { ...form, client_type: type };
      await api.createClient(data);
      await refreshClients();
      if (createUser && userForm.username) {
        alert('Client created. To create a login for them, use Supabase Dashboard → Authentication → Users, then link the user in the Users screen.');
      }
      setForm({
        client_code: '', name: '', trading_name: '', email: '', phone: '', address: '',
        tax_number: '', notes: '', country: 'Cyprus',
        client_type: 'company', first_name: '', surname: '', legal_name: '', name_tax_office: '',
      });
      setUserForm({ username: '', password: '', display_name: '' });
      setCreateUser(false);
      setShowForm(false);
    } catch (err: any) {
      alert(err.message);
    }
  };

  // Live duplicate detection for the Add Client form — checks the in-memory
  // client list as the user types so they can't even click Save with a code
  // that already exists. Empty / blank codes are not flagged here (a blank
  // means "auto-generate on save").
  const codeDuplicate = (() => {
    const code = (form.client_code || '').trim().toUpperCase();
    if (!code) return null as null | { id: number; name: string };
    const hit = clients.find((c: any) => (c.client_code || '').toUpperCase() === code);
    return hit ? { id: hit.id, name: hit.client_name || hit.name || '(unnamed)' } : null;
  })();

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

  const getInvoiceCount = (clientId: number) => invoices.filter((inv: any) => inv.client_id === clientId).length;

  const filtered = clients.filter((c: any) => {
    // Free-text search
    if (searchTerm) {
      const t = searchTerm.toLowerCase();
      const matches = (c.name || '').toLowerCase().includes(t)
        || (c.client_name || '').toLowerCase().includes(t)
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
    if (filterCity     && (c.city || '').toLowerCase() !== filterCity.toLowerCase()) return false;
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

  // Distinct tags present in the data — drives the Tag dropdown
  const allTags = useMemo(() => {
    const s = new Set<string>();
    for (const c of clients as any[]) if (Array.isArray(c.tags)) for (const t of c.tags) if (t) s.add(t);
    return Array.from(s).sort();
  }, [clients]);

  // Active filter chips
  const activeFilters: { key: string; label: string; clear: () => void }[] = [];
  if (filterCategory)         activeFilters.push({ key: 'cat',  label: 'Category: ' + (categoryOptions.find(o => o.value === filterCategory)?.label || filterCategory), clear: () => setFilterCategory('') });
  if (filterStatus)           activeFilters.push({ key: 'stat', label: 'Status: '   + (STATUS_OPTIONS.find(o => o.value === filterStatus)?.label || filterStatus),     clear: () => setFilterStatus('') });
  if (filterCity)             activeFilters.push({ key: 'city', label: 'City: ' + filterCity,                                             clear: () => setFilterCity('') });
  if (filterHasVat !== 'all') activeFilters.push({ key: 'vat',  label: 'VAT: '  + filterHasVat,                                           clear: () => setFilterHasVat('all') });
  if (filterTag)              activeFilters.push({ key: 'tag',  label: 'Tag: '  + filterTag,                                              clear: () => setFilterTag('') });
  const clearAllFilters = () => { setFilterCategory(''); setFilterStatus(''); setFilterCity(''); setFilterHasVat('all'); setFilterTag(''); };

  // Helper: render any column's cell content for a given client row
  const renderCell = (col: string, c: any) => {
    switch (col) {
      case 'client_code':          return c.client_code
        ? <Link to={`/clients/${c.id}`} style={{ color: 'var(--primary)', fontWeight: 600, fontFamily: 'monospace' }}>{c.client_code}</Link>
        : <span style={{ color: '#94a3b8' }}>-</span>;
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
            <Link to={`/clients/${c.id}`} style={{ color: 'var(--primary)', fontWeight: 500 }}>{c.client_name || c.name}</Link>
          </span>
          {c.client_name && c.name && c.client_name !== c.name && (
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{c.name}</div>
          )}
          {c.trading_name && <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{c.trading_name}</div>}
        </>
      );
      case 'client_category':      return c.client_category || '-';
      case 'client_status':        return c.client_status || '-';
      case 'tax_number':           return c.tax_number || '-';
      case 'registration_number':  return c.registration_number || '-';
      case 'city':                 return c.city || '-';
      case 'vat_number':           return c.vat_number || '-';
      case 'vat_category':         return c.vat_category
        ? <span title={vatCategoryLabel(c.vat_category) || undefined}>{c.vat_category}</span>
        : '-';
      case 'business_type':        return c.business_type || '-';
      case 'phone':                return c.phone || '-';
      case 'mobile':                return c.mobile || '-';
      case 'email':                return c.email || '-';
      case 'contact_person':       return c.contact_person || '-';
      case 'invoices_count':       return getInvoiceCount(c.id);
      case 'created_at':           return formatDate(c.created_at, '-');
      case 'updated_at':           return formatDate(c.updated_at, '-');
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

  // Comprehensive column set for the full export — covers every field a
  // sane user would want without needing to query Supabase directly.
  // Used by both the bulk-selected exports and the "Export All" buttons.
  const rowFromClient = (c: any) => ({
    'Code':         c.client_code || '',
    'Name':         c.name || '',
    'Client Name':  c.client_name || '',
    'Trading Name': c.trading_name || '',
    'Type':         c.client_type || '',
    'Category':     c.client_category || '',
    'Status':       c.client_status || '',
    'Active':       c.is_active === false ? 'No' : 'Yes',
    // Individual-specific identification
    'First Name':   c.first_name || '',
    'Surname':      c.surname || '',
    'ID Number':    c.id_number || '',
    'Passport No':  c.passport_number || '',
    'DOB':          c.date_of_birth || '',
    'Nationality':  c.nationality || '',
    // Company-specific
    'Legal Name':       c.legal_name || '',
    'HE Number':        c.registration_number || '',
    'Incorporation':    c.incorporation_date || '',
    'Year End (DD/MM)': c.year_end_date || '',
    'Financial Year End': c.financial_year_end || '',
    // Tax / VAT
    'TIC':              c.tax_number || '',
    'Name (Tax Office)': c.name_tax_office || '',
    'VAT Number':       c.vat_number || '',
    'VAT Status':       c.vat_status || '',
    'VAT Registered':   c.vat_registration_date || '',
    'VAT Category':     c.vat_category || '',
    'VAT Start Month':  c.vat_start_month || '',
    'OSS VAT Category': c.oss_vat_category || '',
    'OSS Start Month':  c.oss_vat_start_month || '',
    // Social Insurance / Employer
    'SI Number':         c.social_insurance_number || '',
    'Employer Number':   c.employer_number || '',
    'Ergani Number':     c.ergani_number || '',
    'SI Registration':   c.si_registration_date || '',
    // Tax return
    'Tax Return Type':   c.tax_return_type || '',
    // Contact
    'Email':        Array.isArray(c.email) ? c.email.join('; ') : (c.email || ''),
    'Phone':        c.phone || '',
    'Mobile':       c.mobile || '',
    'Fax':          c.fax || '',
    'Contact Person': c.contact_person || '',
    // Address
    'Address':      c.address || '',
    'City':         c.city || '',
    'Country':      c.country || '',
    // Business
    'Business Type': c.business_type || '',
    'Services':      c.services || '',
    'Monthly Fee':   c.monthly_fee ?? '',
    'Vendor':        c.is_vendor ? 'Yes' : 'No',
    'Tags':          Array.isArray(c.tags) ? c.tags.join(', ') : '',
    'Notes':         c.notes || '',
    // Timestamps
    'Created':       c.created_at ? new Date(c.created_at).toISOString().slice(0,10) : '',
    'Last Updated':  c.updated_at ? new Date(c.updated_at).toISOString().slice(0,10) : '',
  });

  // Full-list exports — driven from the Print / Export modal so they
  // honour the same scope (selected vs all), type filter, and from/to
  // range the user picks for the PDF. Always emits every column from
  // rowFromClient (the field checkboxes only apply to the PDF, since
  // Excel has no column-width concern).
  const handleExportAllExcel = () => {
    const source = buildPrintRows().visibleClients;
    if (source.length === 0) { alert('No clients in the current filter.'); return; }
    const rows = source.map(rowFromClient);
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Clients');
    XLSX.writeFile(wb, `clients-${new Date().toISOString().slice(0,10)}.xlsx`);
    setShowPrintModal(false);
  };

  const handleExportAllCsv = () => {
    const source = buildPrintRows().visibleClients;
    if (source.length === 0) { alert('No clients in the current filter.'); return; }
    const rows = source.map(rowFromClient);
    const cols = Object.keys(rows[0]);
    const esc = (v: any) => {
      const s = v == null ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [cols.join(','), ...rows.map(r => cols.map(c => esc((r as any)[c])).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `clients-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    setShowPrintModal(false);
  };

  // Build the rows + selected field defs for the printed list. Uses the
  // currently-displayed (filtered + sorted) clients — same set the user sees
  // in the table on screen, minus the vendor-only category.
  const buildPrintRows = () => {
    const selectedFields = PRINT_FIELDS.filter(f => printFields.has(f.id));
    // 1) Start from scope. 'selected' uses the bulk-ticked rows; 'all' uses
    //    the full filtered+sorted list. Vendor-only entries are excluded.
    let base = (printScope === 'selected'
      ? sortedFiltered.filter((c: any) => selectedIds.has(c.id))
      : sortedFiltered
    ).filter((c: any) => c.client_category !== 'vendor_only');
    // 2) Apply the type filter (Individuals / Companies / All).
    if (printTypeFilter === 'individual') base = base.filter((c: any) => c.client_type === 'individual');
    else if (printTypeFilter === 'company') base = base.filter((c: any) => c.client_type === 'company');
    // 3) Apply the alphabetic-name range, but only in 'all' scope. The user
    //    picks "from" and "to" clients; the output is the inclusive slice in
    //    alphabetic order (we re-sort by name for the range so the slice is
    //    meaningful even if the on-screen sort is by Code).
    if (printScope === 'all' && (printFromId || printToId)) {
      const byName = [...base].sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
      const fromIdx = printFromId ? byName.findIndex(c => c.id === printFromId) : 0;
      const toIdx   = printToId   ? byName.findIndex(c => c.id === printToId)   : byName.length - 1;
      if (fromIdx !== -1 && toIdx !== -1) {
        const lo = Math.min(fromIdx, toIdx);
        const hi = Math.max(fromIdx, toIdx);
        base = byName.slice(lo, hi + 1);
      }
    }
    return { selectedFields, visibleClients: base };
  };

  const handlePrintPdf = async (emailAfter: boolean = false) => {
    if (emailAfter && !printEmailTo.trim()) {
      setEmailStatus({ kind: 'error', text: 'Enter a recipient address above before clicking Email PDF.' });
      return;
    }
    if (emailAfter) setEmailStatus({ kind: 'sending', text: 'Generating PDF…' });
    const { selectedFields, visibleClients } = buildPrintRows();
    if (selectedFields.length === 0) { alert('Pick at least one field.'); return; }
    if (visibleClients.length === 0) { alert('No clients to print.'); return; }

    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true });
    registerRobotoFont(doc);
    doc.setFont('Roboto', 'normal');

    const PAGE_W = 297, PAGE_H = 210; // A4 landscape
    const MARGIN_L = 12, MARGIN_R = 12, MARGIN_T = 14, MARGIN_B = 12;
    const CONTENT_W = PAGE_W - MARGIN_L - MARGIN_R;
    const NAVY: [number, number, number] = [26, 54, 93];
    const GOLD: [number, number, number] = [155, 134, 31];
    const MUTED: [number, number, number] = [90, 100, 120];

    // Scale column widths so they fill the page exactly.
    const requestedTotal = selectedFields.reduce((s, f) => s + (f.width || 25), 0);
    const scale = CONTENT_W / requestedTotal;
    const colWidths = selectedFields.map(f => (f.width || 25) * scale);

    const today = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
    let pageNum = 1;
    let totalPages = 1;

    const isSelected = printScope === 'selected';
    const docTitle = isSelected ? 'Client List — Selected' : 'Client List';
    const drawHeader = () => {
      doc.setTextColor(NAVY[0], NAVY[1], NAVY[2]);
      doc.setFont('Roboto', 'bold');
      doc.setFontSize(13);
      doc.text('PC Prime & Calculate Consultants Ltd', MARGIN_L, MARGIN_T);
      doc.setFontSize(10);
      doc.setTextColor(GOLD[0], GOLD[1], GOLD[2]);
      doc.text(docTitle, MARGIN_L, MARGIN_T + 5);
      doc.setFontSize(7.5);
      doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
      doc.setFont('Roboto', 'italic');
      doc.text(`Generated ${today}  ·  ${visibleClients.length} client${visibleClients.length === 1 ? '' : 's'}  ·  ${selectedFields.length} fields`, MARGIN_L, MARGIN_T + 10);
      // Gold underline
      doc.setDrawColor(GOLD[0], GOLD[1], GOLD[2]);
      doc.setLineWidth(0.5);
      doc.line(MARGIN_L, MARGIN_T + 13, PAGE_W - MARGIN_R, MARGIN_T + 13);
    };

    const drawTableHeader = (y: number) => {
      doc.setFillColor(GOLD[0], GOLD[1], GOLD[2]);
      doc.rect(MARGIN_L, y, CONTENT_W, 6, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFont('Roboto', 'bold');
      doc.setFontSize(7.5);
      let x = MARGIN_L;
      selectedFields.forEach((f, i) => {
        doc.text(f.label, x + 1.5, y + 4);
        x += colWidths[i];
      });
    };

    const drawFooter = () => {
      doc.setFont('Roboto', 'italic');
      doc.setFontSize(7);
      doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
      doc.text(`Page ${pageNum} of ${totalPages}`, PAGE_W / 2, PAGE_H - 5, { align: 'center' });
    };

    drawHeader();
    let cursorY = MARGIN_T + 16;
    drawTableHeader(cursorY);
    cursorY += 6;

    doc.setFont('Roboto', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(0, 8, 20);
    const ROW_H = 5.5;
    const CHAR_W = 1.45; // approximate mm per character at fontSize 7.5

    visibleClients.forEach((c: any, idx: number) => {
      if (cursorY + ROW_H > PAGE_H - MARGIN_B - 6) {
        drawFooter();
        doc.addPage();
        pageNum++;
        totalPages = pageNum;
        drawHeader();
        cursorY = MARGIN_T + 16;
        drawTableHeader(cursorY);
        cursorY += 6;
        doc.setFont('Roboto', 'normal');
        doc.setFontSize(7.5);
        doc.setTextColor(0, 8, 20);
      }
      // Zebra striping
      if (idx % 2 === 1) {
        doc.setFillColor(248, 250, 252);
        doc.rect(MARGIN_L, cursorY, CONTENT_W, ROW_H, 'F');
      }
      let x = MARGIN_L;
      selectedFields.forEach((f, i) => {
        const raw = String(f.get(c) || '');
        const maxChars = Math.max(4, Math.floor((colWidths[i] - 2) / CHAR_W));
        const display = raw.length > maxChars ? raw.slice(0, maxChars - 1) + '…' : raw;
        doc.text(display, x + 1.5, cursorY + 3.8);
        x += colWidths[i];
      });
      // Row separator
      doc.setDrawColor(226, 232, 240);
      doc.setLineWidth(0.1);
      doc.line(MARGIN_L, cursorY + ROW_H, MARGIN_L + CONTENT_W, cursorY + ROW_H);
      cursorY += ROW_H;
    });

    // Stamp the final page count on every page footer (we only know it now).
    const finalPageCount = pageNum;
    for (let p = 1; p <= finalPageCount; p++) {
      doc.setPage(p);
      doc.setFont('Roboto', 'italic');
      doc.setFontSize(7);
      doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
      // Clear any previous footer text first (overpaint with white rect)
      doc.setFillColor(255, 255, 255);
      doc.rect(MARGIN_L, PAGE_H - 8, CONTENT_W, 6, 'F');
      doc.text(`Page ${p} of ${finalPageCount}`, PAGE_W / 2, PAGE_H - 5, { align: 'center' });
    }

    const filename = `client-list${isSelected ? '-selected' : ''}-${new Date().toISOString().slice(0, 10)}.pdf`;
    // Always download a local copy too — useful for the firm's file and as
    // a fallback in case the SMTP send fails.
    doc.save(filename);

    if (emailAfter) {
      // Convert the in-memory PDF to base64 so the Edge Function can attach it.
      const ab = doc.output('arraybuffer') as ArrayBuffer;
      const bytes = new Uint8Array(ab);
      let binary = '';
      const CHUNK = 0x8000;
      for (let i = 0; i < bytes.length; i += CHUNK) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK) as unknown as number[]);
      }
      const contentBase64 = btoa(binary);

      const todayLabel = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
      const fieldsList = selectedFields.map(f => f.label).join(', ');
      const subject = isSelected
        ? `Client List (Selected) — ${todayLabel}`
        : `Client List — ${todayLabel}`;
      const body = [
        `Hello,`,
        ``,
        `Please find attached the ${isSelected ? 'selected ' : ''}client list PDF prepared on ${todayLabel}.`,
        ``,
        `  • File: ${filename}`,
        `  • Rows: ${visibleClients.length} client${visibleClients.length === 1 ? '' : 's'}`,
        `  • Fields included: ${fieldsList}`,
        ``,
        `Kind regards,`,
        `PC Prime & Calculate Consultants Ltd`,
      ].join('\n');

      setEmailStatus({ kind: 'sending', text: 'Sending via Outlook…' });
      try {
        await api.sendViaOutlook({
          to: printEmailTo.trim(),
          subject,
          body,
          attachments: [{ filename, contentBase64, contentType: 'application/pdf' }],
        });
        setEmailStatus({ kind: 'sent', text: `Sent to ${printEmailTo.trim()}` });
        // Hold the success banner briefly so the user notices, then close.
        setTimeout(() => { setShowPrintModal(false); setEmailStatus({ kind: 'idle' }); }, 1500);
      } catch (err: any) {
        setEmailStatus({ kind: 'error', text: 'Send failed: ' + (err?.message || String(err)) });
      }
      return; // keep the modal open until the user sees the result
    }

    setShowPrintModal(false);
  };

  const togglePrintField = (id: string) => {
    setPrintFields(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
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

  // Range dropdown options for the Print modal — type-filtered + sorted by
  // name. Declared AFTER sortedFiltered because the useMemo callback runs
  // eagerly during render and would otherwise hit the TDZ on sortedFiltered.
  const rangeClientOptions = useMemo(() => {
    let base = sortedFiltered.filter((c: any) => c.client_category !== 'vendor_only');
    if (printTypeFilter === 'individual') base = base.filter((c: any) => c.client_type === 'individual');
    else if (printTypeFilter === 'company') base = base.filter((c: any) => c.client_type === 'company');
    return [...base].sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  }, [sortedFiltered, printTypeFilter]);

  // If the type filter narrows the list such that the previously-selected
  // From/To client is no longer in it, reset those fields.
  useEffect(() => {
    if (printFromId && !rangeClientOptions.some(c => c.id === printFromId)) setPrintFromId(null);
    if (printToId   && !rangeClientOptions.some(c => c.id === printToId))   setPrintToId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeClientOptions]);

  return (
    <div className="client-manager">
      <div className="list-header">
        <h2>Clients ({clients.filter((c: any) => c.client_category !== 'vendor_only').length})</h2>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-secondary btn-sm" onClick={handleGenerateMissing} title="Auto-generate codes for clients without one">
            #️⃣ Gen Codes
          </button>
          {canSeeDeleted && <Link to="/clients/deleted" className="btn btn-secondary">🗑 Deleted</Link>}
          {isSupervisor && unlinkedCount > 0 && (
            <Link to="/clients/unlinked-directors" className="btn btn-secondary" style={{ borderColor: '#f59e0b' }} title="Director rows without a linked client">
              ⚠ Unlinked Directors ({unlinkedCount})
            </Link>
          )}
          {isSupervisor && (
            <button className="btn btn-secondary" onClick={() => setShowMerge(!showMerge)}>
              {showMerge ? 'Cancel' : '⇄ Merge Duplicates'}
            </button>
          )}
          <button className="btn btn-secondary" onClick={() => { setPrintScope('all'); setShowPrintModal(true); }} title="Print, Excel or CSV export of the current filtered client list">
            🖨 Print / Export
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

      {/* Add form */}
      {showForm && (
        <div className="client-form card">
          <div className="form-grid">
            <div className="form-group">
              <label>Type</label>
              <select
                className="form-input"
                value={form.client_type || 'company'}
                onChange={(e) => setForm((p: any) => ({ ...p, client_type: e.target.value }))}
              >
                <option value="company">Company</option>
                <option value="individual">Individual</option>
              </select>
            </div>
            {(form.client_type || 'company') === 'individual' ? (
              <>
                <div className="form-group">
                  <label>Surname *</label>
                  <input
                    type="text"
                    value={form.surname || ''}
                    onChange={(e) => {
                      const surname = e.target.value;
                      const next = `${form.first_name || ''} ${surname}`.trim();
                      setForm((p: any) => ({ ...p, surname, name: next }));
                      previewCode(surname);
                    }}
                    className="form-input"
                    placeholder="Surname (used for the client code)"
                    autoFocus
                  />
                </div>
                <div className="form-group">
                  <label>First Name</label>
                  <input
                    type="text"
                    value={form.first_name || ''}
                    onChange={(e) => {
                      const first_name = e.target.value;
                      const next = `${first_name} ${form.surname || ''}`.trim();
                      setForm((p: any) => ({ ...p, first_name, name: next }));
                    }}
                    className="form-input"
                    placeholder="First name"
                  />
                </div>
              </>
            ) : (
              <div className="form-group">
                <label>Legal Name *</label>
                <input
                  type="text"
                  value={form.legal_name || form.name || ''}
                  onChange={(e) => {
                    const legal_name = e.target.value;
                    setForm((p: any) => ({ ...p, legal_name, name: legal_name }));
                    previewCode(legal_name);
                  }}
                  className="form-input"
                  placeholder="Company legal name"
                  autoFocus
                />
              </div>
            )}
            <div className="form-group">
              <label>Name as per Tax Office</label>
              <input
                type="text"
                value={form.name_tax_office || ''}
                onChange={(e) => setForm((p: any) => ({ ...p, name_tax_office: e.target.value }))}
                className="form-input"
                placeholder="Greek name as on tax returns"
              />
            </div>
            <div className="form-group">
              <label>Client Code (auto-generated)</label>
              <input
                type="text"
                value={form.client_code}
                onChange={(e) => setForm((p: any) => ({ ...p, client_code: e.target.value.toUpperCase() }))}
                className="form-input"
                placeholder="Will auto-generate: 221XXX001"
                style={{ fontFamily: 'monospace', borderColor: codeDuplicate ? '#dc2626' : undefined }}
              />
              {codeDuplicate ? (
                <p style={{ fontSize: 12, color: '#dc2626', marginTop: 4, fontWeight: 500 }}>
                  ⚠ Code <strong>{form.client_code}</strong> is already used by{' '}
                  <Link to={`/clients/${codeDuplicate.id}`} style={{ color: '#dc2626', textDecoration: 'underline' }}>
                    {codeDuplicate.name}
                  </Link>. Pick a different code before saving.
                </p>
              ) : (
                <p style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>Format: 221 + first 3 letters + sequential number</p>
              )}
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
          <button className="btn btn-primary" onClick={handleAdd} style={{ marginTop: 12 }} disabled={!!codeDuplicate} title={codeDuplicate ? `Code already used by ${codeDuplicate.name}` : undefined}>
            Save Client
          </button>
          <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 8 }}>Other details (VAT, services, directors, credentials) can be added after creating the client.</p>
        </div>
      )}

      {/* Search + Filters + Columns + View toggle */}
      <div className="client-toolbar" style={{ flexWrap: 'wrap', gap: 8 }}>
        <input type="text" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} placeholder="Search by name, code, TIC, city..." className="form-input client-search" />
        <select className="form-input" value={filterCategory} onChange={e => setFilterCategory(e.target.value)} style={{ maxWidth: 170 }} title="Filter by category">
          <option value="">All categories</option>
          {categoryOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select className="form-input" value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={{ maxWidth: 180 }} title="Filter by status">
          <option value="">All statuses</option>
          {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select className="form-input" value={filterCity} onChange={e => setFilterCity(e.target.value)} style={{ maxWidth: 150 }} title="Filter by city">
          <option value="">All cities</option>
          {cityOptions.map(c => <option key={c} value={c}>{c}</option>)}
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
            title="Quick filter presets — apply a ready-made or saved filter"
          >
            ⚡ Quick Filters {showViews ? '▲' : '▼'}
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
        <button className="btn btn-secondary btn-sm" onClick={() => setShowColumnsModal(true)} title="Show/hide columns in the list view">
          ☰ Columns
        </button>
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

      {/* Print List modal — pick which fields to include then generate a PDF */}
      {showPrintModal && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.55)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16,
        }} onClick={() => setShowPrintModal(false)}>
          <div onClick={(e) => e.stopPropagation()} style={{
            background: 'white', borderRadius: 8, padding: 20, maxWidth: 560, width: '100%',
            maxHeight: '85vh', overflowY: 'auto',
          }}>
            <h3 style={{ marginTop: 0, color: '#1a365d' }}>
              🖨 {printScope === 'selected' ? 'Print Selected Clients' : 'Print Client List'}
            </h3>
            <p style={{ color: '#64748b', fontSize: '0.88em', marginTop: 0 }}>
              {printScope === 'selected' ? (
                <>The PDF will contain the <strong>{selectedIds.size} selected</strong> client{selectedIds.size === 1 ? '' : 's'} in the current sort order. Pick which fields to include.</>
              ) : (
                <>The PDF uses the current filter + sort. Use the filters below to narrow further by client type and/or an alphabetic range, then pick which fields to include.</>
              )}
            </p>

            {/* Filter section: type radios + (in 'all' scope) From / To range pickers */}
            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 4, padding: '10px 12px', marginBottom: 12 }}>
              <div style={{ fontSize: '0.78em', fontWeight: 600, color: '#1a365d', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Filter</div>
              <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: printScope === 'all' ? 10 : 0, fontSize: '0.86em' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
                  <input type="radio" name="ptype" checked={printTypeFilter === 'all'}        onChange={() => setPrintTypeFilter('all')} />
                  All clients
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
                  <input type="radio" name="ptype" checked={printTypeFilter === 'individual'} onChange={() => setPrintTypeFilter('individual')} />
                  Individuals only
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
                  <input type="radio" name="ptype" checked={printTypeFilter === 'company'}    onChange={() => setPrintTypeFilter('company')} />
                  Companies only
                </label>
              </div>
              {printScope === 'all' && (
                <>
                  <div style={{ fontSize: '0.74em', color: '#64748b', marginBottom: 4 }}>
                    Range (alphabetic by name) — leave either side blank for "first" / "last"
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <div>
                      <label style={{ fontSize: '0.74em', color: '#5a6478', display: 'block', marginBottom: 2 }}>From client</label>
                      <select className="form-input form-input-sm" value={printFromId ?? ''} onChange={e => setPrintFromId(e.target.value ? Number(e.target.value) : null)} style={{ width: '100%' }}>
                        <option value="">— First —</option>
                        {rangeClientOptions.map((c: any) => (
                          <option key={c.id} value={c.id}>{c.client_code ? c.client_code + ' · ' : ''}{c.name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label style={{ fontSize: '0.74em', color: '#5a6478', display: 'block', marginBottom: 2 }}>To client</label>
                      <select className="form-input form-input-sm" value={printToId ?? ''} onChange={e => setPrintToId(e.target.value ? Number(e.target.value) : null)} style={{ width: '100%' }}>
                        <option value="">— Last —</option>
                        {rangeClientOptions.map((c: any) => (
                          <option key={c.id} value={c.id}>{c.client_code ? c.client_code + ' · ' : ''}{c.name}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  {(printFromId || printToId || printTypeFilter !== 'all') && (
                    <button
                      type="button"
                      className="btn btn-link btn-sm"
                      onClick={() => { setPrintTypeFilter('all'); setPrintFromId(null); setPrintToId(null); }}
                      style={{ padding: 0, marginTop: 4 }}
                    >Clear filters</button>
                  )}
                </>
              )}
              <div style={{ marginTop: 8, fontSize: '0.78em', color: '#1a365d', fontWeight: 600 }}>
                {buildPrintRows().visibleClients.length} client{buildPrintRows().visibleClients.length === 1 ? '' : 's'} will be printed
              </div>
            </div>
            <div style={{
              display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '4px 12px',
              marginBottom: 14, padding: '8px 4px', maxHeight: 320, overflowY: 'auto',
              border: '1px solid #e2e8f0', borderRadius: 4,
            }}>
              {PRINT_FIELDS.map(f => (
                <label key={f.id} style={{
                  display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.86em',
                  cursor: 'pointer', padding: '3px 6px', userSelect: 'none',
                }}>
                  <input
                    type="checkbox"
                    checked={printFields.has(f.id)}
                    onChange={() => togglePrintField(f.id)}
                  />
                  {f.label}
                </label>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  className="btn btn-link btn-sm"
                  onClick={() => setPrintFields(new Set(PRINT_FIELDS.map(f => f.id)))}
                  type="button"
                >Select all</button>
                <button
                  className="btn btn-link btn-sm"
                  onClick={() => setPrintFields(new Set(DEFAULT_PRINT_FIELDS))}
                  type="button"
                >Reset to defaults</button>
              </div>
              <div style={{ fontSize: '0.78em', color: '#64748b' }}>
                {printFields.size} of {PRINT_FIELDS.length} fields selected
              </div>
            </div>
            <div style={{ marginBottom: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <label style={{ fontSize: '0.74em', color: '#5a6478' }}>
                  Email to (optional) — used when clicking "Email PDF"
                </label>
                <Link
                  to="/settings/email"
                  target="_blank"
                  rel="noreferrer"
                  style={{ fontSize: '0.72em', color: '#9b861f' }}
                  title="Connect your Outlook account so the app can send mail on your behalf"
                >
                  ⚙ Email settings
                </Link>
              </div>
              <input
                type="email"
                className="form-input form-input-sm"
                value={printEmailTo}
                onChange={e => setPrintEmailTo(e.target.value)}
                placeholder="recipient@example.com (leave blank to choose in your mail client)"
                style={{ width: '100%' }}
              />
            </div>
            {emailStatus.kind !== 'idle' && (
              <div style={{
                marginBottom: 10,
                padding: '8px 10px',
                borderRadius: 4,
                fontSize: '0.84em',
                background: emailStatus.kind === 'sent' ? '#dcfce7' : emailStatus.kind === 'error' ? '#fee2e2' : '#dbeafe',
                color:      emailStatus.kind === 'sent' ? '#15803d' : emailStatus.kind === 'error' ? '#b91c1c' : '#1e40af',
                border:     `1px solid ${emailStatus.kind === 'sent' ? '#86efac' : emailStatus.kind === 'error' ? '#fca5a5' : '#93c5fd'}`,
              }}>
                {emailStatus.kind === 'sending' && '⏳ '}
                {emailStatus.kind === 'sent'    && '✓ '}
                {emailStatus.kind === 'error'   && '⚠ '}
                {emailStatus.text}
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap', alignItems: 'center' }}>
              <button className="btn btn-secondary" onClick={() => { setShowPrintModal(false); setEmailStatus({ kind: 'idle' }); }} disabled={emailStatus.kind === 'sending'}>Cancel</button>
              <button
                className="btn btn-secondary"
                onClick={handleExportAllExcel}
                disabled={emailStatus.kind === 'sending'}
                title="Excel export — every column (the field checkboxes above only affect the PDF)"
              >
                ⬇ Excel
              </button>
              <button
                className="btn btn-secondary"
                onClick={handleExportAllCsv}
                disabled={emailStatus.kind === 'sending'}
                title="CSV export — every column (the field checkboxes above only affect the PDF)"
              >
                ⬇ CSV
              </button>
              <button
                className="btn btn-secondary"
                onClick={() => handlePrintPdf(true)}
                disabled={printFields.size === 0 || emailStatus.kind === 'sending'}
                title="Generates the PDF, attaches it, and sends through your Outlook account (configure in /settings/email)"
              >
                📧 Email PDF
              </button>
              <button className="btn btn-primary" onClick={() => handlePrintPdf(false)} disabled={printFields.size === 0 || emailStatus.kind === 'sending'}>
                Generate PDF
              </button>
            </div>
            <p style={{ fontSize: '0.72em', color: '#94a3b8', marginTop: 6, marginBottom: 0, textAlign: 'right' }}>
              Excel / CSV exports always include every column. The field checkboxes above only affect the PDF.
            </p>
          </div>
        </div>
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
          <button className="btn btn-secondary btn-sm" onClick={() => { setPrintScope('selected'); setShowPrintModal(true); }} disabled={bulkBusy} title="Open the print/export panel scoped to selected clients (PDF, Excel or CSV)">
            🖨 Print / Export Selected
          </button>
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
