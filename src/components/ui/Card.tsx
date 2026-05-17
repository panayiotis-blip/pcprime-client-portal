import type { ReactNode } from 'react';
import { cx } from './cx';

export interface CardProps {
  /** Optional header title. A header bar renders if `title` or `actions` is set. */
  title?: ReactNode;
  /** Optional header actions, right-aligned. */
  actions?: ReactNode;
  /** Card content. */
  children: ReactNode;
  /** Adds a hover lift; also makes the card keyboard/click friendly. */
  clickable?: boolean;
  onClick?: () => void;
  /** Remove the default 20px body padding (e.g. when embedding a table). */
  flushBody?: boolean;
  className?: string;
  bodyClassName?: string;
}

/** White panel with subtle border + optional header bar. */
export default function Card({
  title,
  actions,
  children,
  clickable,
  onClick,
  flushBody,
  className,
  bodyClassName,
}: CardProps) {
  const hasHeader = title != null || actions != null;
  return (
    <div
      className={cx('pc-card', clickable && 'pc-card--clickable', className)}
      onClick={onClick}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={
        clickable && onClick
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
    >
      {hasHeader && (
        <div className="pc-card__header">
          {title != null && <h3 className="pc-card__title">{title}</h3>}
          {actions != null && <div className="pc-card__actions">{actions}</div>}
        </div>
      )}
      <div className={cx('pc-card__body', flushBody && 'pc-card__body--flush', bodyClassName)}>
        {children}
      </div>
    </div>
  );
}
