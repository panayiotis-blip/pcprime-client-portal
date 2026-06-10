import { useFieldCtx } from '../fieldContext';
import ClientNotesFeed from '../ClientNotesFeed';

// Notes tab — timestamped feed (each note its own row with author, time,
// optional attention flag, promote-to-task). The legacy single textarea
// is shown collapsed below for clients with old free-text notes that
// haven't been migrated into the feed.
export default function NotesTab() {
  const { editing, form, client, onChange } = useFieldCtx();
  const legacy = (form.notes || client.notes || '').trim();

  return (
    <div className="client-tab-content">
      <div className="form-section">
        <h3>Notes</h3>
        <p style={{ fontSize: 13, color: '#64748b', marginTop: 0, marginBottom: 12 }}>
          Timestamped notes about this client — what happened, what to remember, what to follow up on.
          Tick <strong>⚠ Needs attention</strong> on anything important, or use <strong>→ Task</strong> to
          promote a note to a staff task that lives on the Tasks page.
        </p>
        {client?.id ? <ClientNotesFeed clientId={client.id} /> : null}
      </div>

      {/* Legacy free-text notes — only shown if the client has content in
          the old clients.notes column. Edit here to update it; once empty
          this section disappears. */}
      {(legacy || editing) && (
        <div className="form-section" style={{ marginTop: 16 }}>
          <h3 style={{ fontSize: 13, color: '#64748b' }}>Legacy notes (free-text)</h3>
          <p style={{ fontSize: 12, color: '#94a3b8', marginTop: 0 }}>
            Older notes captured before the timestamped feed existed. New notes should go in the feed above.
          </p>
          {editing ? (
            <textarea
              value={form.notes || ''}
              onChange={(e) => onChange('notes', e.target.value)}
              className="form-input"
              rows={8}
              style={{ width: '100%', fontFamily: 'inherit' }}
            />
          ) : legacy ? (
            <pre style={{
              whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'inherit',
              margin: 0, padding: '10px 14px', background: '#f8fafc', borderRadius: 6,
            }}>{legacy}</pre>
          ) : null}
        </div>
      )}
    </div>
  );
}
