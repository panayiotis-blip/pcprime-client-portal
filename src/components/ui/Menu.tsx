import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cx } from './cx';

export interface MenuItem {
  key: string;
  label: ReactNode;
  /** Optional leading icon. */
  icon?: ReactNode;
  onSelect?: () => void;
  /** Render as a link instead of a button — e.g. a print view opened in a new tab. */
  href?: string;
  target?: string;
  disabled?: boolean;
  /** Native tooltip — use it to explain why an item is disabled. */
  title?: string;
  /** Destructive styling (red label). */
  danger?: boolean;
  /** Draw a divider above this item. */
  separatorBefore?: boolean;
}

export interface MenuProps {
  /** Trigger button contents. */
  label: ReactNode;
  items: MenuItem[];
  /** Which edge the panel aligns to. Defaults to `right`. */
  align?: 'left' | 'right';
  disabled?: boolean;
  /** Class for the trigger button. Defaults to a small secondary button. */
  buttonClassName?: string;
  title?: string;
}

/**
 * Dropdown menu for overflow actions. Closes on select, on Escape, and on a
 * click outside. Items with no room in a toolbar live here rather than being
 * dropped — every handler stays reachable.
 */
export default function Menu({
  label, items, align = 'right', disabled = false,
  buttonClassName = 'btn btn-secondary btn-sm', title,
}: MenuProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  if (!items.length) return null;

  return (
    <div className="pc-menu" ref={wrapRef}>
      <button
        type="button"
        className={buttonClassName}
        onClick={() => setOpen(o => !o)}
        disabled={disabled}
        title={title}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {label}
      </button>

      {open && (
        <div className={cx('pc-menu__panel', `pc-menu__panel--${align}`)} role="menu">
          {items.map(item => {
            const inner = (
              <>
                {item.icon && <span className="pc-menu__icon">{item.icon}</span>}
                {item.label}
              </>
            );
            const className = cx('pc-menu__item', item.danger && 'pc-menu__item--danger');
            return (
              <div key={item.key}>
                {item.separatorBefore && <div className="pc-menu__sep" />}
                {item.href && !item.disabled ? (
                  <a
                    className={className}
                    href={item.href}
                    target={item.target}
                    rel={item.target === '_blank' ? 'noopener noreferrer' : undefined}
                    title={item.title}
                    role="menuitem"
                    onClick={() => setOpen(false)}
                  >
                    {inner}
                  </a>
                ) : (
                  <button
                    type="button"
                    className={className}
                    disabled={item.disabled}
                    title={item.title}
                    role="menuitem"
                    onClick={() => { setOpen(false); item.onSelect?.(); }}
                  >
                    {inner}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
