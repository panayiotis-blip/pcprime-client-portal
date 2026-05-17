import type { SelectHTMLAttributes } from 'react';
import { cx } from './cx';

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  /** Show the red error border. */
  invalid?: boolean;
  /** Convenience: render these as <option>s. Otherwise pass children. */
  options?: SelectOption[];
}

/** Shared <select> styled to match the design system. */
export default function Select({
  invalid,
  options,
  className,
  children,
  ...rest
}: SelectProps) {
  return (
    <select
      className={cx('pc-select', invalid && 'pc-input--error', className)}
      {...rest}
    >
      {options
        ? options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))
        : children}
    </select>
  );
}
