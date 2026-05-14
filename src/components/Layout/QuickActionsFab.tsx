import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import LogCallModal from '../Admin/LogCallModal';

// Floating "+" button shown on every authed staff route (except print views).
// Click → expands a vertical stack of four shortcuts:
//   Scan Invoice  / New Task  / New Phone Log  / New Timesheet Entry
//
// Pages that have an inline "new" form check for `?new=1` on mount and pop
// the form open automatically, so we don't need duplicate modals.
export default function QuickActionsFab() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [callModalOpen, setCallModalOpen] = useState(false);

  // Close the menu on Esc
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const go = (path: string) => {
    setOpen(false);
    navigate(path);
  };

  return (
    <>
      {/* Backdrop — clicking outside closes the menu */}
      {open && <div className="fab-backdrop" onClick={() => setOpen(false)} />}

      <div className={`fab-container ${open ? 'open' : ''}`}>
        {open && (
          <ul className="fab-menu" aria-label="Quick actions">
            <li>
              <button onClick={() => go('/scan')}>
                <span className="fab-icon">⊞</span>
                <span>Scan Invoice</span>
              </button>
            </li>
            <li>
              <button onClick={() => go('/tasks?new=1')}>
                <span className="fab-icon">☑</span>
                <span>New Task</span>
              </button>
            </li>
            <li>
              <button onClick={() => { setOpen(false); setCallModalOpen(true); }}>
                <span className="fab-icon">☎</span>
                <span>New Phone Log</span>
              </button>
            </li>
            <li>
              <button onClick={() => go('/timesheet?new=1')}>
                <span className="fab-icon">⏱</span>
                <span>New Timesheet Entry</span>
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

      {callModalOpen && (
        <LogCallModal
          onClose={() => setCallModalOpen(false)}
          onSaved={() => setCallModalOpen(false)}
        />
      )}
    </>
  );
}
