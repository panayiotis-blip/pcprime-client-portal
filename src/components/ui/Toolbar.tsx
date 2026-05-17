import type { ReactNode } from 'react';
import { cx } from './cx';

export interface ToolbarProps {
  /** Page title (left, 24px bold). */
  title: ReactNode;
  /** Right-aligned action buttons. */
  actions?: ReactNode;
  /** Optional second row — typically a search bar / filter chips. */
  children?: ReactNode;
  className?: string;
}

/** Standard page header: title + actions, with an optional second row. */
export default function Toolbar({ title, actions, children, className }: ToolbarProps) {
  return (
    <div className={cx('pc-toolbar', className)}>
      <div className="pc-toolbar__row">
        <h1 className="pc-toolbar__title">{title}</h1>
        {actions != null && <div className="pc-toolbar__actions">{actions}</div>}
      </div>
      {children}
    </div>
  );
}
