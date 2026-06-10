import { useEffect, useState } from 'react';

// Marks an auto-scheduled task complete + captures the supporting data
// (payment date, amount, reference, etc.). The field set is chosen from
// the originating service_stage's key — so SI/PAYE/provisional/SDC/SE
// payment tasks ask for payment details; TD7 filing asks for filing
// date + TaxisNet reference; the rest get a notes field only.

type FieldType = 'date' | 'number' | 'text' | 'textarea' | 'select';
export type CompletionField = {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  placeholder?: string;
  currency?: boolean;
  options?: string[];           // for type='select'
  section?: string;             // visual sub-heading inside the modal
};

// Common confirmation block reused by every payment/filing template. The
// fields capture who at the client confirmed the payment, how, and when —
// so an auditor (or our future selves) can reconstruct the trail without
// digging through emails.
const CONFIRMATION_FIELDS: CompletionField[] = [
  { key: 'confirmed_by',          label: 'Confirmed by',           type: 'text',
    placeholder: 'Name of client contact', section: 'Confirmation' },
  { key: 'confirmation_method',   label: 'Confirmation method',    type: 'select',
    options: ['Email', 'Phone', 'WhatsApp', 'Bank statement', 'Receipt copy', 'Portal message', 'In person', 'Other'],
    section: 'Confirmation' },
  { key: 'confirmation_received_at', label: 'Confirmation received', type: 'date',
    section: 'Confirmation' },
];

// Stage key → field list. Hardcoded so it stays easy to read. Add new
// templates here when a new stage type needs structured completion data.
const PAYMENT_FIELDS: CompletionField[] = [
  { key: 'payment_date', label: 'Payment date',         type: 'date',     required: true, section: 'Payment' },
  { key: 'amount',       label: 'Amount paid',          type: 'number',   currency: true, section: 'Payment' },
  { key: 'reference',    label: 'Receipt / reference #', type: 'text',                    section: 'Payment' },
  ...CONFIRMATION_FIELDS,
  { key: 'notes',        label: 'Notes',                type: 'textarea' },
];

const FILING_FIELDS: CompletionField[] = [
  { key: 'filing_date',   label: 'Filing date',           type: 'date',     required: true, section: 'Filing' },
  { key: 'taxisnet_ref',  label: 'TaxisNet reference',    type: 'text',                     section: 'Filing' },
  ...CONFIRMATION_FIELDS,
  { key: 'notes',         label: 'Notes',                 type: 'textarea' },
];

const PAYROLL_RUN_FIELDS: CompletionField[] = [
  { key: 'payment_date',  label: 'Payment date',         type: 'date',     required: true, section: 'Payment' },
  { key: 'total_paid',    label: 'Total payroll paid',   type: 'number',   currency: true, section: 'Payment' },
  ...CONFIRMATION_FIELDS,
  { key: 'notes',         label: 'Notes',                type: 'textarea' },
];

const NOTES_ONLY: CompletionField[] = [
  { key: 'notes', label: 'Completion notes', type: 'textarea' },
];

const TEMPLATES: Record<string, CompletionField[]> = {
  // Payroll
  si_payment:         PAYMENT_FIELDS,
  paye_payment:       PAYMENT_FIELDS,
  payroll_payment:    PAYROLL_RUN_FIELDS,
  td7_filing:         FILING_FIELDS,
  // Tax Payments service
  provisional_tax_h1: PAYMENT_FIELDS,
  provisional_tax_h2: PAYMENT_FIELDS,
  sdc_gesy_h1:        PAYMENT_FIELDS,
  sdc_gesy_h2:        PAYMENT_FIELDS,
  se_quarterly:       PAYMENT_FIELDS,
  gesy_annual_recon:  PAYMENT_FIELDS,
  // VAT
  submission:         FILING_FIELDS,   // VAT submission
  // Individual Tax Return
  filing_reminder:    FILING_FIELDS,
};

export function templateFor(stageKey: string | null | undefined): CompletionField[] | null {
  if (!stageKey) return null;
  return TEMPLATES[stageKey] || null;
}

type Props = {
  taskTitle: string;
  stageKey: string | null | undefined;
  initialData?: Record<string, any>;
  onClose: () => void;
  onConfirm: (data: Record<string, any>) => Promise<void> | void;
};

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export default function TaskCompletionModal({ taskTitle, stageKey, initialData, onClose, onConfirm }: Props) {
  const fields = templateFor(stageKey) || NOTES_ONLY;
  const [values, setValues] = useState<Record<string, any>>(() => {
    const base: Record<string, any> = {};
    for (const f of fields) {
      // Date fields default to today unless already provided.
      if (f.type === 'date') base[f.key] = initialData?.[f.key] || todayIso();
      else base[f.key] = initialData?.[f.key] ?? '';
    }
    return base;
  });
  const [saving, setSaving] = useState(false);

  // If the template changed (modal re-opened for a different task), reset.
  useEffect(() => {
    const base: Record<string, any> = {};
    for (const f of fields) {
      if (f.type === 'date') base[f.key] = initialData?.[f.key] || todayIso();
      else base[f.key] = initialData?.[f.key] ?? '';
    }
    setValues(base);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stageKey]);

  const handleSave = async () => {
    // Required-field check.
    for (const f of fields) {
      if (f.required && !values[f.key]) {
        alert(`${f.label} is required.`);
        return;
      }
    }
    // Normalise numbers.
    const out: Record<string, any> = {};
    for (const f of fields) {
      const v = values[f.key];
      if (v === '' || v == null) continue;
      out[f.key] = f.type === 'number' ? Number(v) : v;
    }
    setSaving(true);
    try {
      await onConfirm(out);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.55)', zIndex: 1200,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: '#fff', borderRadius: 8, padding: 20, width: '100%', maxWidth: 520,
        maxHeight: '90vh', overflowY: 'auto',
      }}>
        <h3 style={{ marginTop: 0, color: '#1a365d' }}>Mark task complete</h3>
        <p style={{ color: '#5a6478', fontSize: 13, marginTop: 0 }}>{taskTitle}</p>
        {!templateFor(stageKey) && stageKey && (
          <p style={{ fontSize: 12, color: '#94a3b8', marginTop: -6, marginBottom: 10 }}>
            No structured fields for this stage — capture any notes you'd like to record.
          </p>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14 }}>
          {(() => {
            // Group fields by section so the modal reads as Payment / Confirmation
            // / Notes blocks instead of a flat list.
            let lastSection: string | undefined = undefined;
            return fields.map((f, i) => {
              const sectionHeader = f.section && f.section !== lastSection ? (
                <div key={`sec-${i}`} style={{
                  fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: '#1a365d',
                  letterSpacing: '0.04em',
                  marginTop: lastSection === undefined ? 0 : 6,
                  paddingTop: lastSection === undefined ? 0 : 4,
                  borderTop: lastSection === undefined ? 'none' : '1px solid #f1f5f9',
                }}>{f.section}</div>
              ) : null;
              if (f.section) lastSection = f.section;
              return (
                <div key={f.key}>
                  {sectionHeader}
                  <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                    {f.label}{f.required && <span style={{ color: '#b91c1c' }}> *</span>}
                  </label>
                  {f.type === 'textarea' ? (
                    <textarea
                      value={values[f.key] || ''}
                      onChange={(e) => setValues(prev => ({ ...prev, [f.key]: e.target.value }))}
                      rows={3}
                      className="form-input"
                      style={{ width: '100%', fontSize: 13 }}
                      placeholder={f.placeholder}
                    />
                  ) : f.type === 'select' ? (
                    <select
                      value={values[f.key] || ''}
                      onChange={(e) => setValues(prev => ({ ...prev, [f.key]: e.target.value }))}
                      className="form-input"
                      style={{ width: '100%' }}
                    >
                      <option value=""></option>
                      {(f.options || []).map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : (
                    <input
                      type={f.type}
                      value={values[f.key] || ''}
                      onChange={(e) => setValues(prev => ({ ...prev, [f.key]: e.target.value }))}
                      className="form-input"
                      style={{ width: '100%' }}
                      placeholder={f.placeholder}
                      step={f.type === 'number' ? '0.01' : undefined}
                    />
                  )}
                  {f.currency && (
                    <p style={{ fontSize: 11, color: '#94a3b8', margin: '2px 0 0' }}>Euro amount</p>
                  )}
                </div>
              );
            });
          })()}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : '✓ Mark complete'}
          </button>
        </div>
      </div>
    </div>
  );
}
