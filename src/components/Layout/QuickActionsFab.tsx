import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import LogCallModal from '../Admin/LogCallModal';

// Floating "+" button shown on every authed staff route (except print views).
// Click → expands a vertical stack of shortcuts. Which shortcuts appear and in
// what order is customisable per user (stored in localStorage) via "Customise…".
//
// Pages that have an inline "new" form check for `?new=1` on mount and pop
// the form open automatically, so we don't need duplicate modals.

type FabAction = { id: string; icon: string; label: string; path?: string; modal?: 'call' };

const ALL_ACTIONS: FabAction[] = [
  { id: 'scan',      icon: '⊞', label: 'Scan Document',       path: '/scan' },
  { id: 'task',      icon: '☑', label: 'New Task',            path: '/tasks?new=1' },
  { id: 'call',      icon: '☎', label: 'New Phone Log',       modal: 'call' },
  { id: 'timesheet', icon: '⏱', label: 'New Timesheet Entry', path: '/timesheet?new=1' },
];

type Pref = { id: string; enabled: boolean };
const STORAGE_KEY = 'pc_fab_actions_v1';
const DEFAULT_LAYOUT = (): Pref[] => ALL_ACTIONS.map(a => ({ id: a.id, enabled: true }));

// Read the saved layout, keeping only known actions (in saved order) and
// appending any new built-in actions (enabled) so the FAB stays forward-compatible.
function loadLayout(): Pref[] {
  let stored: any = [];
  try { const raw = localStorage.getItem(STORAGE_KEY); if (raw) stored = JSON.parse(raw); } catch { /* ignore */ }
  const known = new Set(ALL_ACTIONS.map(a => a.id));
  const seen = new Set<string>();
  const out: Pref[] = [];
  for (const p of Array.isArray(stored) ? stored : []) {
    if (p && known.has(p.id) && !seen.has(p.id)) { out.push({ id: p.id, enabled: p.enabled !== false }); seen.add(p.id); }
  }
  for (const a of ALL_ACTIONS) if (!seen.has(a.id)) out.push({ id: a.id, enabled: true });
  return out.length ? out : DEFAULT_LAYOUT();
}

export default function QuickActionsFab() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [callModalOpen, setCallModalOpen] = useState(false);
  const [layout, setLayout] = useState<Pref[]>(loadLayout);
  const [customizing, setCustomizing] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); setCustomizing(false); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const persist = (next: Pref[]) => {
    setLayout(next);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  };

  const runAction = (a: FabAction) => {
    setOpen(false);
    if (a.modal === 'call') { setCallModalOpen(true); return; }
    if (a.path) navigate(a.path);
  };

  const visible = layout
    .filter(p => p.enabled)
    .map(p => ALL_ACTIONS.find(a => a.id === p.id))
    .filter(Boolean) as FabAction[];

  const toggle = (id: string) => persist(layout.map(p => (p.id === id ? { ...p, enabled: !p.enabled } : p)));
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= layout.length) return;
    const next = [...layout];
    [next[i], next[j]] = [next[j], next[i]];
    persist(next);
  };

  return (
    <>
      {/* Backdrop — clicking outside closes the menu */}
      {open && <div className="fab-backdrop" onClick={() => setOpen(false)} />}

      <div className={`fab-container ${open ? 'open' : ''}`}>
        {open && (
          <ul className="fab-menu" aria-label="Quick actions">
            {visible.map(a => (
              <li key={a.id}>
                <button onClick={() => runAction(a)}>
                  <span className="fab-icon">{a.icon}</span>
                  <span>{a.label}</span>
                </button>
              </li>
            ))}
            <li>
              <button onClick={() => { setOpen(false); setCustomizing(true); }} style={{ opacity: 0.8 }}>
                <span className="fab-icon">⚙</span>
                <span>Customise…</span>
              </button>
            </li>
          </ul>
        )}

        <button
          className="fab-trigger"
          onClick={() => setOpen(o => !o)}
          aria-label={open ? 'Close quick actions' : 'Open quick actions'}
          aria-expanded={open}
        >
          {open ? '×' : '+'}
        </button>
      </div>

      {customizing && (
        <div className="fab-customize-backdrop" onClick={() => setCustomizing(false)}>
          <div className="fab-customize" onClick={e => e.stopPropagation()}>
            <h3>Customise quick actions</h3>
            <p className="fab-customize-hint">Tick the shortcuts to show and use the arrows to reorder. Saved on this device.</p>
            <ul>
              {layout.map((p, i) => {
                const a = ALL_ACTIONS.find(x => x.id === p.id)!;
                return (
                  <li key={p.id}>
                    <label>
                      <input type="checkbox" checked={p.enabled} onChange={() => toggle(p.id)} />
                      <span style={{ width: 20, textAlign: 'center' }}>{a.icon}</span>
                      <span>{a.label}</span>
                    </label>
                    <span className="fab-customize-move">
                      <button onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up">↑</button>
                      <button onClick={() => move(i, 1)} disabled={i === layout.length - 1} aria-label="Move down">↓</button>
                    </span>
                  </li>
                );
              })}
            </ul>
            <div className="fab-customize-actions">
              <button className="btn btn-secondary btn-sm" onClick={() => persist(DEFAULT_LAYOUT())}>Reset</button>
              <button className="btn btn-primary btn-sm" onClick={() => setCustomizing(false)}>Done</button>
            </div>
          </div>
        </div>
      )}

      {callModalOpen && (
        <LogCallModal
          onClose={() => setCallModalOpen(false)}
          onSaved={() => setCallModalOpen(false)}
        />
      )}
    </>
  );
}
