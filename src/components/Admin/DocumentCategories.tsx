import { useEffect, useState } from 'react';
import { Plus, ChevronUp, ChevronDown, Trash2 } from 'lucide-react';
import { api } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { Modal, Button, FormField, Input, Select } from '../ui';
import CollapsibleSection from './CollapsibleSection';

// Company Settings → Document Categories admin (UI Polish v2, Part 4).
// Manages the document_categories master list that drives the Scan Document
// dropdown (Part 3). Editing is Owner-only — RLS enforces it server-side too.

type DocCategory = {
  id: number;
  name: string;
  code: string | null;
  target_folder: string;
  ocr_enabled: boolean;
  show_due_date: boolean;
  journal_code: string | null;
  is_active: boolean;
  display_order: number;
};

// The system folders a category can file into (mirrors api.ts SYSTEM_FOLDERS
// + JOURNAL_SUBFOLDERS).
const FOLDER_OPTIONS = [
  { value: 'kyc',              label: 'KYC Documents' },
  { value: 'contracts',        label: 'Contracts' },
  { value: 'agreements',       label: 'Agreements' },
  { value: 'company_records',  label: 'Company Records' },
  { value: 'audited_accounts', label: 'Audited Accounts' },
  { value: 'scanned',          label: 'Scanned Invoices' },
  { value: 'issued_invoices',  label: 'Issued Invoices (to Client)' },
  { value: 'other',            label: 'Other' },
  { value: 'scanned_INP',      label: 'INP — Purchase Invoices' },
  { value: 'scanned_INS',      label: 'INS — Sales Invoices' },
  { value: 'scanned_PM',       label: 'PM — Bank Payments' },
  { value: 'scanned_DEP',      label: 'DEP — Deposits' },
  { value: 'scanned_JV',       label: 'JV — Journals' },
];
const folderLabel = (key: string) => FOLDER_OPTIONS.find((f) => f.value === key)?.label || key;

interface EditForm {
  name: string;
  code: string;
  target_folder: string;
  ocr_enabled: boolean;
  show_due_date: boolean;
  journal_code: string;
  is_active: boolean;
}

const EMPTY_FORM: EditForm = {
  name: '', code: '', target_folder: 'other',
  ocr_enabled: false, show_due_date: false, journal_code: '', is_active: true,
};

export default function DocumentCategories() {
  const { user } = useAuth();
  const isOwner = user?.role === 'owner';

  const [cats, setCats] = useState<DocCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [journalCodes, setJournalCodes] = useState<string[]>([]);
  // null = modal closed · 'new' = adding · number = editing that id
  const [editingId, setEditingId] = useState<number | 'new' | null>(null);
  const [form, setForm] = useState<EditForm>(EMPTY_FORM);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      setCats(await api.getAllDocumentCategories() as DocCategory[]);
    } catch {
      setCats([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);
  useEffect(() => {
    api.getJournalTypes()
      .then((jts) => setJournalCodes((jts as any[]).map((j) => j.code)))
      .catch(() => {});
  }, []);

  const openNew = () => { setForm(EMPTY_FORM); setEditingId('new'); };
  const openEdit = (c: DocCategory) => {
    setForm({
      name: c.name, code: c.code || '', target_folder: c.target_folder,
      ocr_enabled: c.ocr_enabled, show_due_date: c.show_due_date,
      journal_code: c.journal_code || '', is_active: c.is_active,
    });
    setEditingId(c.id);
  };

  const handleSave = async () => {
    if (!form.name.trim()) { alert('Name is required.'); return; }
    if (!form.target_folder) { alert('Pick a target folder.'); return; }
    setBusy(true);
    try {
      const payload = {
        name: form.name.trim(),
        code: form.code.trim() || null,
        target_folder: form.target_folder,
        ocr_enabled: form.ocr_enabled,
        show_due_date: form.show_due_date,
        journal_code: form.ocr_enabled ? (form.journal_code || null) : null,
        is_active: form.is_active,
      };
      if (editingId === 'new') {
        const nextOrder = cats.length ? Math.max(...cats.map((c) => c.display_order)) + 1 : 1;
        await api.createDocumentCategory({ ...payload, display_order: nextOrder });
      } else if (typeof editingId === 'number') {
        await api.updateDocumentCategory(editingId, payload);
      }
      setEditingId(null);
      await load();
    } catch (err: any) {
      alert('Save failed: ' + err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (c: DocCategory) => {
    if (!confirm(`Delete the "${c.name}" category? This cannot be undone.`)) return;
    try {
      await api.deleteDocumentCategory(c.id);
      await load();
    } catch (err: any) {
      alert('Delete failed: ' + err.message);
    }
  };

  const move = async (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= cats.length) return;
    const reordered = [...cats];
    const [moved] = reordered.splice(index, 1);
    reordered.splice(target, 0, moved);
    setCats(reordered); // optimistic
    try {
      await api.reorderDocumentCategories(reordered.map((c) => c.id));
    } catch (err: any) {
      alert('Reorder failed: ' + err.message);
      await load();
    }
  };

  return (
    <CollapsibleSection
      title="Document Categories"
      headerRight={isOwner && (
        <Button size="sm" leftIcon={<Plus size={15} />} onClick={openNew}>Add Category</Button>
      )}
    >
      <p style={{ fontSize: 13, color: 'var(--pc-text-2)', margin: '6px 0 12px' }}>
        The list shown in the Scan Document dropdown. OCR categories open the invoice
        editor for review; the rest file straight into the target folder.
        {!isOwner && ' Only owners can edit this list.'}
      </p>

      {loading ? (
        <p style={{ color: 'var(--pc-text-3)' }}>Loading…</p>
      ) : cats.length === 0 ? (
        <p style={{ color: 'var(--pc-text-3)' }}>
          No categories yet. {isOwner ? 'Use "Add Category" to create one.' : ''}
        </p>
      ) : (
        <table className="export-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Code</th>
              <th>Target Folder</th>
              <th style={{ textAlign: 'center' }}>OCR</th>
              <th style={{ textAlign: 'center' }}>Active</th>
              {isOwner && <th style={{ textAlign: 'right' }}>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {cats.map((c, i) => (
              <tr key={c.id} style={c.is_active ? undefined : { opacity: 0.55 }}>
                <td><strong>{c.name}</strong></td>
                <td>{c.code || '—'}</td>
                <td>{folderLabel(c.target_folder)}</td>
                <td style={{ textAlign: 'center' }}>{c.ocr_enabled ? '✓' : '—'}</td>
                <td style={{ textAlign: 'center' }}>{c.is_active ? '✓' : '—'}</td>
                {isOwner && (
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <Button size="sm" variant="ghost" iconOnly aria-label="Move up"
                      disabled={i === 0} onClick={() => move(i, -1)}>
                      <ChevronUp size={15} />
                    </Button>
                    <Button size="sm" variant="ghost" iconOnly aria-label="Move down"
                      disabled={i === cats.length - 1} onClick={() => move(i, 1)}>
                      <ChevronDown size={15} />
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => openEdit(c)}>Edit</Button>
                    <Button size="sm" variant="ghost" iconOnly aria-label="Delete"
                      onClick={() => handleDelete(c)}>
                      <Trash2 size={15} />
                    </Button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <Modal
        open={editingId !== null}
        onClose={() => setEditingId(null)}
        title={editingId === 'new' ? 'Add Document Category' : 'Edit Document Category'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditingId(null)} disabled={busy}>Cancel</Button>
            <Button variant="primary" onClick={handleSave} disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <FormField label="Name" required>
            <Input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Purchase Invoice"
              autoFocus
            />
          </FormField>
          <FormField label="Code" helper="Optional short code, e.g. INP.">
            <Input
              value={form.code}
              onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))}
              placeholder="INP"
            />
          </FormField>
          <FormField label="Target folder" helper="Where files in this category are filed.">
            <Select
              value={form.target_folder}
              onChange={(e) => setForm((f) => ({ ...f, target_folder: e.target.value }))}
              options={FOLDER_OPTIONS}
            />
          </FormField>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
            <input
              type="checkbox"
              checked={form.ocr_enabled}
              onChange={(e) => setForm((f) => ({ ...f, ocr_enabled: e.target.checked }))}
            />
            OCR enabled — scanning opens the invoice editor for review
          </label>
          {form.ocr_enabled && (
            <FormField label="Journal type" helper="Links this category to the accounting journal.">
              <Select
                value={form.journal_code}
                onChange={(e) => setForm((f) => ({ ...f, journal_code: e.target.value }))}
                options={[{ value: '', label: '— none —' }, ...journalCodes.map((c) => ({ value: c, label: c }))]}
              />
            </FormField>
          )}
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
            <input
              type="checkbox"
              checked={form.show_due_date}
              onChange={(e) => setForm((f) => ({ ...f, show_due_date: e.target.checked }))}
            />
            Show a Due Date field on the invoice editor
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
            <input
              type="checkbox"
              checked={form.is_active}
              onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))}
            />
            Active — appears in the Scan Document dropdown
          </label>
        </div>
      </Modal>
    </CollapsibleSection>
  );
}
