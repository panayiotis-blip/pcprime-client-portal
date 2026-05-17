import type { InputHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { cx } from './cx';

type CommonOwnProps = {
  /** Show the red error border. */
  invalid?: boolean;
};

type SingleLineProps = CommonOwnProps &
  InputHTMLAttributes<HTMLInputElement> & {
    /** When false/omitted renders an <input>. */
    multiline?: false;
  };

type MultiLineProps = CommonOwnProps &
  TextareaHTMLAttributes<HTMLTextAreaElement> & {
    /** When true renders a <textarea>. */
    multiline: true;
  };

export type InputProps = SingleLineProps | MultiLineProps;

/**
 * Shared text control. Handles text / number / email / password via the
 * `type` prop, and a textarea via `multiline`.
 */
export default function Input(props: InputProps) {
  if (props.multiline) {
    // `multiline` is destructured out so it is never spread onto the DOM node.
    const { invalid, multiline, className, ...rest } = props;
    void multiline;
    return (
      <textarea
        className={cx('pc-input', 'pc-textarea', invalid && 'pc-input--error', className)}
        {...rest}
      />
    );
  }
  const { invalid, multiline, className, ...rest } = props;
  void multiline;
  return (
    <input
      className={cx('pc-input', invalid && 'pc-input--error', className)}
      {...rest}
    />
  );
}
