// The reporting platform's own route tree, rendered outside the portal shell
// so it fills the screen: it has its own left rail (BUILD.md §8) and its own
// idea of a session.
//
// Staff only until P6. The database says so too — every reporting policy goes
// through reporting.staff_can_access() — so this guard is the courtesy of a
// clear message rather than the control itself.

import { Routes, Route, Navigate, NavLink } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { isStaffRole } from '../services/api';
import { ReportingSession, useReportingSession } from './session';
import ChooseClient from './pages/ChooseClient';
import ReportingSetup from './pages/ReportingSetup';
import DataImport from './pages/DataImport';
import AccountMapping from './pages/AccountMapping';
import Reports from './pages/Reports';

export default function ReportingApp() {
  const { user } = useAuth();
  if (!isStaffRole(user)) return <Navigate to="/" replace />;
  return (
    <ReportingSession>
      <Inner />
    </ReportingSession>
  );
}

function Inner() {
  const { client, leave } = useReportingSession();

  // Before a client is chosen there are exactly two screens: pick one, or set
  // up which clients there are to pick. Setup is deliberately reachable ONLY
  // from here — it is about many clients at once, which is the one thing a
  // session must never be.
  if (!client) {
    return (
      <Routes>
        <Route path="/setup" element={<ReportingSetup />} />
        <Route path="*" element={<ChooseClient />} />
      </Routes>
    );
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#f8fafc' }}>
      <aside style={{
        width: 210, flex: 'none', background: '#fff', borderRight: '1px solid #e2e8f0',
        padding: '16px 0', position: 'sticky', top: 0, height: '100vh',
      }}>
        <div style={{ padding: '0 16px 14px' }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#0f172a', lineHeight: 1.3 }}>{client.name}</div>
          <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
            {client.code ? `${client.code} · ` : ''}client reporting
          </div>
        </div>

        <Group title="Reports">
          <Item to="/reporting/reports">Profit and loss · Balance sheet</Item>
        </Group>

        <Group title="Configure">
          <Item to="/reporting/import">Data import</Item>
          <Item to="/reporting/mapping">Account mapping</Item>
        </Group>

        <div style={{ padding: '14px 16px 0', marginTop: 'auto' }}>
          {/* The only way to change client. §12: no dropdown inside the session. */}
          <button className="btn btn-secondary btn-sm" style={{ width: '100%' }} onClick={leave}>
            Leave {client.code ?? 'this client'}
          </button>
          <NavLink to="/" style={{ display: 'block', marginTop: 8, fontSize: 12, color: '#64748b' }}>
            ← Back to the portal
          </NavLink>
        </div>
      </aside>

      <main style={{ flex: 1, minWidth: 0 }}>
        <Routes>
          <Route path="/" element={<Navigate to="/reporting/import" replace />} />
          <Route path="/import" element={<DataImport />} />
          <Route path="/mapping" element={<AccountMapping />} />
          <Route path="/reports" element={<Reports />} />
          {/* Setup is about every client at once, so it cannot open inside a
              session. Say that, rather than bouncing to another screen and
              looking like a broken link. */}
          <Route path="/setup" element={<SetupIsOutside name={client.code ?? client.name} onLeave={leave} />} />
          <Route path="*" element={<Navigate to="/reporting/import" replace />} />
        </Routes>
      </main>
    </div>
  );
}

function SetupIsOutside({ name, onLeave }: { name: string; onLeave: () => void }) {
  return (
    <div style={{ padding: 24, maxWidth: 560 }}>
      <h1 style={{ fontSize: 20, margin: '0 0 6px' }}>Reporting setup</h1>
      <p style={{ fontSize: 13, color: '#475569', margin: '0 0 16px' }}>
        This screen is about every client at once — which ones we report on, and the BTMS company
        each one's books are kept under. It cannot open while you are working on <b>{name}</b>,
        because a session is only ever about one client.
      </p>
      <button className="btn btn-primary" onClick={onLeave}>Leave {name} and open setup</button>
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{
        fontSize: 10, letterSpacing: '.09em', textTransform: 'uppercase',
        color: '#94a3b8', padding: '0 16px 6px',
      }}>{title}</div>
      {children}
    </div>
  );
}

function Item({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <NavLink
      to={to}
      style={({ isActive }) => ({
        display: 'block', padding: '7px 16px', fontSize: 13.5, textDecoration: 'none',
        color: isActive ? '#0f172a' : '#475569',
        background: isActive ? '#f1f5f9' : 'transparent',
        borderLeft: `3px solid ${isActive ? '#0f172a' : 'transparent'}`,
        fontWeight: isActive ? 600 : 400,
      })}
    >{children}</NavLink>
  );
}
