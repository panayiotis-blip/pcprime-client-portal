import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cx } from './cx';

export interface ModalProps {
  /** Controls visibility. When false the modal renders nothing. */
  open: boolean;
  /** Called on Esc, backdrop click, or the close button. */
  onClose: () => void;
  /** Header title. */
  title?: ReactNode;
  /** Modal body content. */
  children: ReactNode;
  /** Footer content — typically right-aligned buttons. */
  footer?: ReactNode;
  /** `default` = 600px max width, `lg` = 800px (forms). */
  size?: 'default' | 'lg';
  /** Allow closing by clicking the dimmed backdrop. Defaults to true. */
  closeOnBackdrop?: boolean;
}

/**
 * Centred modal rendered into document.body via a portal.
 * Locks body scroll and closes on Esc while open.
 */
export default function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  size = 'default',
  closeOnBackdrop = true,
}: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="pc-modal-overlay"
      onMouseDown={(e) => {
        if (closeOnBackdrop && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={cx('pc-modal', size === 'lg' && 'pc-modal--lg')}
        role="dialog"
        aria-modal="true"
      >
        <div className="pc-modal__header">
          {title != null ? <h3 className="pc-modal__title">{title}</h3> : <span />}
          <button
            type="button"
            className="pc-btn pc-btn--ghost pc-btn--icon pc-btn--sm"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>
        <div className="pc-modal__body">{children}</div>
        {footer != null && <div className="pc-modal__footer">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
