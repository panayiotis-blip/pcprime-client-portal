import { useEffect, useState } from 'react';
import { Modal, Button } from '../ui';
import { api } from '../../services/api';
import { generateDocumentPdf } from '../../services/documentPdf';

type Props = {
  open: boolean;
  onClose: () => void;
  routePath: string;        // printable billing route rendered into the PDF
  fileName: string;         // attachment file name
  defaultTo?: string;
  defaultSubject?: string;
  defaultMessage?: string;
  onSent?: () => void;
};

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Shared "Email to client" dialog. Generates a PDF of the given printable
// route and sends it as an attachment via the send-email edge function.
export default function EmailDocumentModal({
  open, onClose, routePath, fileName,
  defaultTo, defaultSubject, defaultMessage, onSent,
}: Props) {
  const [to, setTo]           = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [status, setStatus]   = useState('');

  useEffect(() => {
    if (!open) return;
    setTo(defaultTo || '');
    setSubject(defaultSubject || '');
    setMessage(defaultMessage || '');
    setStatus('');
    setSending(false);
  }, [open, defaultTo, defaultSubject, defaultMessage]);

  const handleSend = async () => {
    const recipient = to.trim();
    if (!recipient)        { alert('Enter a recipient email address.'); return; }
    if (!subject.trim())   { alert('Enter a subject.'); return; }
    setSending(true);
    try {
      setStatus('Preparing the PDF…');
      const content = await generateDocumentPdf(routePath);
      setStatus('Sending…');
      await api.sendViaOutlook({
        from_firm: true,
        to: recipient,
        subject: subject.trim(),
        body: message || 'Please find the attached document.',
        html: message
          ? message.split('\n').map(l => `<p>${escapeHtml(l) || '&nbsp;'}</p>`).join('')
          : undefined,
        attachments: [{
          filename: fileName,
          contentBase64: content,
          contentType: 'application/pdf',
        }],
      });
      setStatus('');
      alert('Email sent.');
      onSent?.();
      onClose();
    } catch (err: any) {
      alert('Could not send: ' + err.message);
      setStatus('');
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => { if (!sending) onClose(); }}
      title="Email to client"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={sending}>Cancel</Button>
          <Button variant="primary" onClick={handleSend} disabled={sending}>
            {sending ? (status || 'Sending…') : 'Send email'}
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="form-group">
          <label>To</label>
          <input
            type="email" className="form-input" value={to}
            onChange={e => setTo(e.target.value)}
            placeholder="client@example.com"
          />
        </div>
        <div className="form-group">
          <label>Subject</label>
          <input
            type="text" className="form-input" value={subject}
            onChange={e => setSubject(e.target.value)}
          />
        </div>
        <div className="form-group">
          <label>Message</label>
          <textarea
            className="form-input" rows={5} value={message}
            onChange={e => setMessage(e.target.value)}
          />
        </div>
        <p style={{ fontSize: 12, color: '#64748b', margin: 0 }}>
          📎 <strong>{fileName}</strong> will be attached as a PDF.
        </p>
        {sending && status && (
          <p style={{ fontSize: 12, color: '#1e40af', margin: 0 }}>{status}</p>
        )}
      </div>
    </Modal>
  );
}
