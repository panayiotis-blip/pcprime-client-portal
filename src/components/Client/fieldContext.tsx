import { createContext, useContext } from 'react';

// Shared edit context for all the client-detail tabs. The parent
// ClientDetail owns the actual state; tabs read/write through this
// provider so the form behaves as one logical form across many tabs.
export const FieldCtx = createContext<{
  editing: boolean;
  form: any;
  client: any;
  onChange: (field: string, value: any) => void;
}>({ editing: false, form: {}, client: {}, onChange: () => {} });

export function useFieldCtx() {
  return useContext(FieldCtx);
}

// Reusable form field that reads/writes via context.
// Defined here (not inside ClientDetail) so it doesn't get re-created
// on every render — that's what was causing input focus loss before.
interface FieldProps {
  label: string;
  field: string;
  type?: string;
  // Plain strings (value === label) or { value, label } pairs.
  options?: Array<string | { value: string; label: string }>;
  placeholder?: string;
  fullWidth?: boolean;
}

export function Field({ label, field, type = 'text', options, placeholder, fullWidth }: FieldProps) {
  const { editing, form, client, onChange } = useFieldCtx();
  const value = form[field];
  const opts = options
    ? options.map(o => (typeof o === 'string' ? { value: o, label: o } : o))
    : null;

  return (
    <div className={`form-group${fullWidth ? ' full-width' : ''}`}>
      <label>{label}</label>
      {editing ? (
        opts ? (
          <select
            value={value || ''}
            onChange={(e) => onChange(field, e.target.value)}
            className="form-input"
          >
            <option value="">—</option>
            {opts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        ) : type === 'textarea' ? (
          <textarea
            value={value || ''}
            onChange={(e) => onChange(field, e.target.value)}
            className="form-input"
            rows={3}
            placeholder={placeholder}
          />
        ) : (
          <input
            type={type}
            value={value || ''}
            onChange={(e) => onChange(field, e.target.value)}
            className="form-input"
            placeholder={placeholder}
          />
        )
      ) : (
        <p className="field-value">
          {opts
            ? (opts.find(o => o.value === client[field])?.label || client[field] || '—')
            : (client[field] || '—')}
        </p>
      )}
    </div>
  );
}
