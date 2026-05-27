import { useEffect, useRef, useState } from 'react';
import { api } from '../../services/api';
import { formatDateTime } from '../../services/dates';

// Shared chat thread for one TOPIC. Used by the client "Messages" screen
// (viewerIsStaff=false) and the staff inbox (=true). clientId is passed so the
// client→firm email notification can fire.
export default function MessageThread({
  threadId, clientId, viewerIsStaff, onActivity,
}: { threadId: number; clientId: number; viewerIsStaff: boolean; onActivity?: () => void }) {
  const [messages, setMessages] = useState<any[]>([]);
  const [loading, setLoading]   = useState(true);
  const [body, setBody]         = useState('');
  const [sending, setSending]   = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const load = async () => {
    try {
      const m = await api.getThreadMessages(threadId);
      setMessages(m as any[]);
      await api.markThreadRead(threadId).catch(() => {});
      onActivity?.();
    } catch (err: any) {
      alert('Failed to load messages: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { setLoading(true); load(); /* eslint-disable-next-line */ }, [threadId]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [messages]);

  const send = async () => {
    const text = body.trim();
    if (!text) return;
    setSending(true);
    try {
      await api.sendClientMessage(threadId, text);
      // Notify the firm by email when a CLIENT posts (best-effort, non-blocking).
      if (!viewerIsStaff) void api.notifyNewMessage(clientId);
      setBody('');
      await load();
    } catch (err: any) {
      alert('Send failed: ' + err.message);
    } finally {
      setSending(false);
    }
  };

  const fmt = (iso: string) => formatDateTime(iso);

  if (loading) return <div className="loading-screen">Loading…</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={{ overflowY: 'auto', padding: '4px', display: 'flex', flexDirection: 'column', gap: 8, minHeight: 220, maxHeight: 460 }}>
        {messages.length === 0 ? (
          <p style={{ color: '#64748b', textAlign: 'center', marginTop: 24 }}>No messages yet.</p>
        ) : messages.map(m => {
          const mine = m.author_is_staff === viewerIsStaff;
          return (
            <div key={m.id} style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '78%' }}>
              <div style={{
                background: mine ? '#1a2e4a' : '#f1f5f9',
                color: mine ? 'white' : '#0f172a',
                padding: '8px 12px', borderRadius: 10, fontSize: 14, whiteSpace: 'pre-wrap',
              }}>{m.body}</div>
              <div style={{ fontSize: 10, color: '#94a3b8', textAlign: mine ? 'right' : 'left', marginTop: 2 }}>
                {m.author_is_staff ? 'Firm' : 'Client'} · {fmt(m.created_at)}
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <textarea
          className="form-input" rows={2} style={{ flex: 1 }} value={body}
          onChange={e => setBody(e.target.value)}
          placeholder="Type a message… (Ctrl/⌘+Enter to send)"
          onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) send(); }}
        />
        <button className="btn btn-primary" onClick={send} disabled={sending}>{sending ? '…' : 'Send'}</button>
      </div>
    </div>
  );
}
