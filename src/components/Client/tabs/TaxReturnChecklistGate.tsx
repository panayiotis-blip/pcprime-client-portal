import { useMemo, useState } from 'react';
import { checklistItems } from '../../shared/taxReturnChecklist';
import type { ChecklistFormType, ChecklistItem } from '../../shared/taxReturnChecklist';

// Pre-start information checklist. Shown before the TD1 return editor opens so
// staff confirm we hold everything needed for the client before data entry.
// Input UI is our own design; this gate is purely a readiness control.

export interface ChecklistState {
  items?: Record<string, boolean>;
  notes?: string;
  confirmed_at?: string | null;
  confirmed_by?: string | null;
}

interface Props {
  formType: ChecklistFormType;
  clientName?: string;
  taxYear: number;
  initial?: ChecklistState;
  canEdit: boolean;
  onConfirm: (state: ChecklistState) => Promise<void> | void;
  onCancel: () => void;
}

export default function TaxReturnChecklistGate({
  formType, clientName, taxYear, initial, canEdit, onConfirm, onCancel,
}: Props) {
  const items = useMemo<ChecklistItem[]>(() => checklistItems(formType), [formType]);
  const [checked, setChecked] = useState<Record<string, boolean>>(initial?.items || {});
  const [notes, setNotes] = useState<string>(initial?.notes || '');
  const [busy, setBusy] = useState(false);

  const total = items.length;
  const done = items.filter(i => checked[i.key]).length;
  const allDone = done === total;
  const previously = initial?.confirmed_at
    ? new Date(initial.confirmed_at).toLocaleString('en-GB')
    : null;

  const toggle = (key: string) =>
    setChecked(prev => ({ ...prev, [key]: !prev[key] }));

  const confirm = async () => {
    setBusy(true);
    try {
      await onConfirm({
        items: checked,
        notes: notes.trim(),
        confirmed_at: new Date().toISOString(),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="client-tab-content" style={{ maxWidth: 760 }}>
      <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <button className="btn btn-secondary btn-sm" onClick={onCancel}>← Back to filings</button>
        <strong style={{ fontSize: '1.05em' }}>
          Information checklist — {formType === 'self_employed' ? 'Self Employed' : 'Individual'} {taxYear}
        </strong>
      </div>

      <div style={{ background: 'var(--pc-bg-alt, #f4f6f9)', border: '1px solid var(--pc-border, #d9dee6)', borderRadius: 8, padding: '14px 16px' }}>
        <p style={{ margin: '0 0 10px', color: 'var(--pc-text-2, #5a6478)', fontSize: '0.9em' }}>
          Before we begin {clientName ? <strong>{clientName}</strong> : 'this client'}’s return, confirm we hold
          everything needed. Tick what we have; note anything still outstanding. You can open the editor either
          way, but the confirmation is recorded.
        </p>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '6px 0 14px' }}>
          <div style={{ flex: 1, height: 8, background: 'var(--pc-border, #d9dee6)', borderRadius: 4, overflow: 'hidden' }}>
            <div style={{ width: `${(done / total) * 100}%`, height: '100%', background: allDone ? '#2e7d32' : 'var(--pc-accent, #9b861f)', transition: 'width .2s' }} />
          </div>
          <span style={{ fontSize: '0.82em', color: 'var(--pc-text-2, #5a6478)', whiteSpace: 'nowrap' }}>{done}/{total} ready</span>
        </div>

        <div style={{ display: 'grid', gap: 6 }}>
          {items.map(item => (
            <label key={item.key}
              style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '8px 10px', borderRadius: 6,
                background: checked[item.key] ? 'rgba(46,125,50,0.08)' : '#fff',
                border: '1px solid var(--pc-border, #e1e5ec)', cursor: canEdit ? 'pointer' : 'default' }}>
              <input type="checkbox" checked={!!checked[item.key]} disabled={!canEdit}
                onChange={() => toggle(item.key)} style={{ marginTop: 3 }} />
              <span>
                <span style={{ fontWeight: 600, fontSize: '0.9em' }}>{item.label}</span>
                {item.hint && <span style={{ display: 'block', fontSize: '0.78em', color: 'var(--pc-text-2, #5a6478)' }}>{item.hint}</span>}
              </span>
            </label>
          ))}
        </div>

        <label style={{ display: 'block', marginTop: 14 }}>
          <span style={{ fontSize: '0.82em', fontWeight: 600, color: 'var(--pc-text-2, #5a6478)' }}>Outstanding items / notes</span>
          <textarea className="form-input" rows={3} value={notes} disabled={!canEdit}
            onChange={e => setNotes(e.target.value)}
            placeholder="e.g. waiting on rental expenses and the foreign dividend statement"
            style={{ width: '100%', marginTop: 4, resize: 'vertical' }} />
        </label>

        {previously && (
          <p style={{ fontSize: '0.78em', color: 'var(--pc-text-2, #5a6478)', marginTop: 10 }}>
            Last confirmed {previously}.
          </p>
        )}

        <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
          <button className="btn btn-primary" onClick={confirm} disabled={busy || !canEdit}>
            {busy ? 'Saving…' : allDone ? 'Confirm — all ready, open editor' : `Open editor (${total - done} outstanding)`}
          </button>
          <button className="btn btn-secondary" onClick={onCancel} disabled={busy}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
