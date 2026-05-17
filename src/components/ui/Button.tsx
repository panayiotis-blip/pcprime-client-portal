import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cx } from './cx';

export type ButtonVariant = 'primary' | 'secondary' | 'destructive' | 'ghost';
export type ButtonSize = 'sm' | 'default' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visual style. Defaults to `primary`. */
  variant?: ButtonVariant;
  /** Height preset. Defaults to `default` (36px). */
  size?: ButtonSize;
  /** Render as a square icon-only button (no text). */
  iconOnly?: boolean;
  /** Optional icon shown before the label. */
  leftIcon?: ReactNode;
  /** Optional icon shown after the label. */
  rightIcon?: ReactNode;
}

/**
 * Shared button. `type` defaults to "button" so it never accidentally
 * submits a surrounding form — pass type="submit" explicitly when needed.
 */
export default function Button({
  variant = 'primary',
  size = 'default',
  iconOnly = false,
  leftIcon,
  rightIcon,
  type = 'button',
  className,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(
        'pc-btn',
        `pc-btn--${variant}`,
        size !== 'default' && `pc-btn--${size}`,
        iconOnly && 'pc-btn--icon',
        className,
      )}
      {...rest}
    >
      {leftIcon && <span className="pc-btn__icon">{leftIcon}</span>}
      {children}
      {rightIcon && <span className="pc-btn__icon">{rightIcon}</span>}
    </button>
  );
}
