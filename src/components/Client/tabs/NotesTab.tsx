import { useFieldCtx } from '../fieldContext';

// Tab 10: Notes — single big textarea surface for the existing `notes`
// column. The form-context handles dirty-tracking + save.
export default function NotesTab() {
  const { editing, form, client, onChange } = useFieldCtx();
  return (
    <div className="client-tab-content">
      <div className="form-section">
        <h3>Internal notes</h3>
        <p style={{ fontSize: 13, color: '#64748b', marginTop: 0 }}>
          Anything important to know about this client — special arrangements, cash-basis flags,
          billing quirks, history. Visible to staff only.
        </p>
        {editing ? (
          <textarea
            value={form.notes || ''}
            onChange={(e) => onChange('notes', e.target.value)}
            className="form-input"
            rows={20}
            style={{ width: '100%', fontFamily: 'inherit' }}
            placeholder="Type freely…"
          />
        ) : (
          <pre style={{
            whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'inherit',
            margin: 0, padding: '12px 16px', background: '#f8fafc', borderRadius: 6,
            minHeight: 200, color: client.notes ? '#0f172a' : '#94a3b8',
          }}>
            {client.notes || '(empty)'}
          </pre>
        )}
      </div>
    </div>
  );
}
