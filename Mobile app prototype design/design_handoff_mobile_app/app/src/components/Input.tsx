import { forwardRef, useState } from 'react';
import { StyleProp, StyleSheet, TextInput, TextInputProps, TextStyle } from 'react-native';

import { HAIRLINE, RADIUS, color } from '../theme/tokens';
import { font } from '../theme/type';

export type InputProps = TextInputProps & {
  style?: StyleProp<TextStyle>;
  /** Border colour when the field is not focused. */
  borderColor?: string;
  /** Border colour on focus. Industry moves the frame to the accent. */
  focusColor?: string;
};

/**
 * A square, hairline-framed field. Focus is themed — the frame moves to the
 * accent — never a platform default ring.
 */
export const Input = forwardRef<TextInput, InputProps>(function Input(
  { style, borderColor = color.divider, focusColor = color.accent, onFocus, onBlur, ...rest },
  ref,
) {
  const [focused, setFocused] = useState(false);

  return (
    <TextInput
      ref={ref}
      placeholderTextColor={color.neutral600}
      selectionColor={color.accent}
      {...rest}
      onFocus={(event) => {
        setFocused(true);
        onFocus?.(event);
      }}
      onBlur={(event) => {
        setFocused(false);
        onBlur?.(event);
      }}
      style={[styles.base, { borderColor: focused ? focusColor : borderColor }, style]}
    />
  );
});

const styles = StyleSheet.create({
  base: {
    width: '100%',
    minHeight: 40,
    paddingVertical: 6,
    paddingHorizontal: 10,
    fontFamily: font.body,
    fontSize: 14,
    color: color.text,
    backgroundColor: color.surface,
    borderWidth: HAIRLINE,
    borderRadius: RADIUS,
  },
});
