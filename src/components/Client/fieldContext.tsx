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
  options?: string[];
  placeholder?: string;
  fullWidth?: boolean;
}

export function Field({ label, field, type = 'text', options, placeholder, fullWidth }: FieldProps) {
  const { editing, form, client, onChange } = useFieldCtx();
  const value = form[field];

  return (
    <div className={`form-group${fullWidth ? ' full-width' : ''}`}>
      <label>{label}</label>
      {editing ? (
        options ? (
          <select
            value={value || ''}
            onChange={(e) => onChange(field, e.target.value)}
            className="form-input"
          >
            <option value="">—</option>
            {options.map(o => <option key={o} value={o}>{o}</option>)}
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
        <p className="field-value">{client[field] || '—'}</p>
      )}
    </div>
  );
}
