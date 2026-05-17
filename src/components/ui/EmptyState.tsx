import type { ReactNode } from 'react';
import { cx } from './cx';

export interface EmptyStateProps {
  /** Icon shown in a tinted circle. */
  icon?: ReactNode;
  /** Short headline. */
  title: ReactNode;
  /** Supporting message. */
  message?: ReactNode;
  /** Primary action (e.g. a Button). */
  action?: ReactNode;
  className?: string;
}

/** Friendly placeholder for empty lists / tables. */
export default function EmptyState({ icon, title, message, action, className }: EmptyStateProps) {
  return (
    <div className={cx('pc-empty', className)}>
      {icon && <div className="pc-empty__icon">{icon}</div>}
      <h3 className="pc-empty__title">{title}</h3>
      {message && <p className="pc-empty__msg">{message}</p>}
      {action}
    </div>
  );
}
