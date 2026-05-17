import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { cx } from './cx';

export interface FilterChip {
  /** Unique id. */
  id: string;
  /** Chip label. */
  label: ReactNode;
  /** Highlighted (selected) state. */
  active?: boolean;
  /** Click handler — typically toggles `active`. */
  onToggle?: () => void;
  /** When set, shows an X that calls this instead of removing via toggle. */
  onRemove?: () => void;
}

export interface FilterBarProps {
  /** Chips to render. */
  chips: FilterChip[];
  /** Extra controls rendered after the chips (e.g. a "Clear all" button). */
  children?: ReactNode;
  className?: string;
}

/** Horizontal strip of filter chips. */
export default function FilterBar({ chips, children, className }: FilterBarProps) {
  return (
    <div className={cx('pc-filterbar', className)}>
      {chips.map((chip) => (
        <span
          key={chip.id}
          className={cx('pc-chip', chip.active && 'pc-chip--active')}
          onClick={chip.onToggle}
          role={chip.onToggle ? 'button' : undefined}
          tabIndex={chip.onToggle ? 0 : undefined}
          onKeyDown={
            chip.onToggle
              ? (e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    chip.onToggle?.();
                  }
                }
              : undefined
          }
        >
          {chip.label}
          {chip.onRemove && (
            <span
              className="pc-chip__remove"
              role="button"
              aria-label="Remove filter"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                chip.onRemove?.();
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  e.stopPropagation();
                  chip.onRemove?.();
                }
              }}
            >
              <X size={13} />
            </span>
          )}
        </span>
      ))}
      {children}
    </div>
  );
}
