import type { ReactNode } from 'react';
import type { ViewMode } from '../../context/ViewPreferencesContext';

// Windows-Explorer-style segmented icon toggle: Grid / Compact / List.
// Uses inline SVGs so we don't add an icon-library dependency for three
// icons. Active button is the only filled one.

interface Props {
  value: ViewMode;
  onChange: (mode: ViewMode) => void;
}

const BUTTONS: { mode: ViewMode; tooltip: string; icon: ReactNode }[] = [
  {
    mode: 'grid',
    tooltip: 'Grid view',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
        <rect x="1" y="1" width="6" height="6" rx="1" />
        <rect x="9" y="1" width="6" height="6" rx="1" />
        <rect x="1" y="9" width="6" height="6" rx="1" />
        <rect x="9" y="9" width="6" height="6" rx="1" />
      </svg>
    ),
  },
  {
    mode: 'compact',
    tooltip: 'Compact view',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
        <rect x="1" y="1" width="4" height="4" rx="0.5" />
        <rect x="6" y="1" width="4" height="4" rx="0.5" />
        <rect x="11" y="1" width="4" height="4" rx="0.5" />
        <rect x="1" y="6" width="4" height="4" rx="0.5" />
        <rect x="6" y="6" width="4" height="4" rx="0.5" />
        <rect x="11" y="6" width="4" height="4" rx="0.5" />
        <rect x="1" y="11" width="4" height="4" rx="0.5" />
        <rect x="6" y="11" width="4" height="4" rx="0.5" />
        <rect x="11" y="11" width="4" height="4" rx="0.5" />
      </svg>
    ),
  },
  {
    mode: 'list',
    tooltip: 'List view',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
        <rect x="1" y="2" width="14" height="2" rx="0.5" />
        <rect x="1" y="7" width="14" height="2" rx="0.5" />
        <rect x="1" y="12" width="14" height="2" rx="0.5" />
      </svg>
    ),
  },
];

export default function ViewToggle({ value, onChange }: Props) {
  return (
    <div className="view-toggle" role="group" aria-label="View mode">
      {BUTTONS.map(b => (
        <button
          key={b.mode}
          type="button"
          className={`view-btn ${value === b.mode ? 'active' : ''}`}
          onClick={() => onChange(b.mode)}
          title={b.tooltip}
          aria-pressed={value === b.mode}
          aria-label={b.tooltip}
        >
          {b.icon}
        </button>
      ))}
    </div>
  );
}
