import type { ReactNode } from 'react';
import { cx } from './cx';

export interface FormFieldProps {
  /** Field label shown above the control. */
  label?: ReactNode;
  /** `id` of the control — links the <label> for accessibility. */
  htmlFor?: string;
  /** Adds a red asterisk after the label. */
  required?: boolean;
  /** Helper text below the control (text-tertiary). */
  helper?: ReactNode;
  /** Error text below the control — overrides `helper` and turns red. */
  error?: ReactNode;
  /** The control itself (Input / Select / custom). */
  children: ReactNode;
  className?: string;
}

/** Label + control + helper/error wrapper. Pass the control as children. */
export default function FormField({
  label,
  htmlFor,
  required,
  helper,
  error,
  children,
  className,
}: FormFieldProps) {
  return (
    <div className={cx('pc-field', className)}>
      {label && (
        <label className="pc-field__label" htmlFor={htmlFor}>
          {label}
          {required && <span className="pc-field__req"> *</span>}
        </label>
      )}
      {children}
      {error ? (
        <span className="pc-field__helper pc-field__helper--error">{error}</span>
      ) : helper ? (
        <span className="pc-field__helper">{helper}</span>
      ) : null}
    </div>
  );
}
