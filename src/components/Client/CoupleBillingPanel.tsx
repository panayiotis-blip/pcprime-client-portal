import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, hasPermission } from '../../services/api';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import SearchableSelect from '../common/SearchableSelect';
import { Modal } from '../ui';

// Spouse billing link: two individual clients whose fees go out on a single
// invoice in one of their names. Records, folders and documents stay entirely
// separate — this only records who gets invoiced.

type Couple = {
  id: number;
  partner_id: number | null;
  partner_name: string | null;
  partner_code: string | null;
  payer_client_id: number;
  this_client_pays: boolean;
  notes: string | null;
};

export default function CoupleBillingPanel({ clientId }: { clientId: number }) {
  const { clients } = useApp();
  const { user } = useAuth();
  const canEdit = hasPermission(user, 'clients.write');
  const clientName = useMemo(
    () => (clients as any[]).find(c => c.id === clientId)?.name || 'this client',
    [clients, clientId],
  );
  const [couple, setCouple] = useState<Couple | null>(null);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [partnerId, setPartnerId] = useState<number | 0>(0);
  const [payerIsThis, setPayerIsThis] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setCouple(await api.getClientCouple(clientId) as Couple | null);
    } catch {
      setCouple(null);
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => { load(); }, [load]);

  // Only individuals, never this client, and the picker shows the code so two
  // people with the same surname can be told apart.
  const options = useMemo(() => (clients as any[])
    .filter(c => c.id !== clientId && c.client_type === 'individual')
    .map(c => ({
      value: c.id,
      label: c.name || `Client #${c.id}`,
      sublabel: c.client_code || undefined,
    })), [clients, clientId]);

  const openLink = () => {
    setPartnerId(0);
    setPayerIsThis(true);
    setModalOpen(true);
  };

  const saveLink = async () => {
    if (!partnerId) { alert('Choose the client to link.'); return; }
    setSaving(true);
    try {
      await api.linkClientCouple(
        clientId,
        Number(partnerId),
        payerIsThis ? clientId : Number(partnerId),
      );
      await load();
      setModalOpen(false);
    } catch (err: any) {
      alert('Could not link: ' + (err?.message || String(err)));
    } finally {
      setSaving(false);
    }
  };

  const switchPayer = async () => {
    if (!couple || couple.partner_id == null) return;
    const nextPayer = couple.this_client_pays ? couple.partner_id : clientId;
    const nextName = couple.this_client_pays ? (couple.partner_name || 'the linked client') : clientName;
    if (!confirm(`Invoice ${nextName} for both from now on?`)) return;
    try {
      await api.setCouplePayer(couple.id, nextPayer);
      await load();
    } catch (err: any) {
      alert('Could not change the payer: ' + (err?.message || String(err)));
    }
  };

  const unlink = async () => {
    if (!couple) return;
    if (!confirm(
      `Remove the billing link with ${couple.partner_name || 'the linked client'}?\n\n`
      + 'Both client records, their documents and their history are untouched — '
      + 'only the "who gets invoiced" arrangement is removed.'
    )) return;
    try {
      await api.unlinkClientCouple(couple.id);
      await load();
    } catch (err: any) {
      alert('Could not unlink: ' + (err?.message || String(err)));
    }
  };

  if (loading) return null;

  return (
    <div className="form-section">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0 }}>Billing arrangement</h3>
        {canEdit && !couple && (
          <button className="btn btn-secondary btn-sm" onClick={openLink}>Link a spouse / partner</button>
        )}
      </div>

      {!couple ? (
        <p style={{ fontSize: 13, color: '#5a6478', margin: '6px 0 0' }}>
          Invoiced on their own. Link a spouse or partner if one invoice covers both.
        </p>
      ) : (
        <>
          <p style={{ fontSize: 13, color: '#334155', margin: '8px 0 0' }}>
            Linked with{' '}
            <Link to={`/clients/${couple.partner_id}`}>
              {couple.partner_code ? <span className="client-code-inline">{couple.partner_code}</span> : null}
              {couple.partner_name || `Client #${couple.partner_id}`}
            </Link>
            .{' '}
            {couple.this_client_pays
              ? <strong>One invoice covering both is raised against this client.</strong>
              : <>The invoice covering both is raised against <strong>{couple.partner_name}</strong>, not this client.</>}
          </p>
          <p style={{ fontSize: 12, color: '#94a3b8', margin: '6px 0 0' }}>
            Both records, their documents and their filings stay separate — only the invoicing is shared.
          </p>
          {canEdit && (
            <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
              <button className="btn btn-secondary btn-sm" onClick={switchPayer}>
                Invoice {couple.this_client_pays ? (couple.partner_name || 'the other client') : clientName} instead
              </button>
              <button className="btn btn-secondary btn-sm" onClick={unlink}>Remove link</button>
            </div>
          )}
        </>
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Link a spouse or partner"
        footer={
          <>
            <button className="btn btn-secondary btn-sm" onClick={() => setModalOpen(false)}>Cancel</button>
            <button className="btn btn-primary btn-sm" onClick={saveLink} disabled={saving}>
              {saving ? 'Linking…' : 'Link'}
            </button>
          </>
        }
      >
        <div className="form-group">
          <label>Client to link</label>
          <SearchableSelect
            value={partnerId}
            options={options}
            onChange={(v) => setPartnerId(Number(v))}
            placeholder="Search individual clients…"
          />
          <small style={{ color: '#64748b', fontSize: 12 }}>
            Only individual clients are listed. A client can belong to one couple at a time.
          </small>
        </div>
        <div className="form-group">
          <label>Who receives the invoice?</label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 400 }}>
            <input type="radio" checked={payerIsThis} onChange={() => setPayerIsThis(true)} />
            {clientName}
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 400 }}>
            <input type="radio" checked={!payerIsThis} onChange={() => setPayerIsThis(false)} />
            The client selected above
          </label>
          <small style={{ color: '#64748b', fontSize: 12 }}>
            One invoice covering both people is raised against whoever is chosen here.
          </small>
        </div>
      </Modal>
    </div>
  );
}
