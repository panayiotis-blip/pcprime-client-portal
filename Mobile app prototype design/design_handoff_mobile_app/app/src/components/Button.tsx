import { ReactNode } from 'react';
import {
  Pressable,
  PressableProps,
  StyleProp,
  StyleSheet,
  Text,
  TextStyle,
  ViewStyle,
} from 'react-native';

import { HAIRLINE, RADIUS, color, tint } from '../theme/tokens';
import { font, tracking } from '../theme/type';

/**
 * Buttons are square, hairline-framed and set in Barlow Condensed — the
 * Industry `.btn` uses the heading family, so "SIGN IN" and the filter chips
 * are condensed, not body text.
 *
 * The solid gold primary is the one filled object in the system; secondary is
 * an outline and ghost is bare.
 */

export type ButtonVariant = 'primary' | 'secondary' | 'ghost';

export type ButtonProps = Omit<PressableProps, 'style' | 'children'> & {
  label?: string;
  variant?: ButtonVariant;
  style?: StyleProp<ViewStyle>;
  labelStyle?: StyleProp<TextStyle>;
  /** Uppercase + .06em tracking — the "action" treatment. */
  uppercase?: boolean;
  left?: ReactNode;
  right?: ReactNode;
  children?: ReactNode;
  /** Frame colour override, for outlined buttons over a navy field. */
  borderColor?: string;
};

export function Button({
  label,
  variant = 'secondary',
  style,
  labelStyle,
  uppercase,
  left,
  right,
  children,
  borderColor,
  ...rest
}: ButtonProps) {
  const flat = StyleSheet.flatten<TextStyle>(labelStyle) ?? {};
  const size = typeof flat.fontSize === 'number' ? flat.fontSize : 14;

  return (
    <Pressable
      accessibilityRole="button"
      {...rest}
      style={({ pressed }) => [
        styles.base,
        variants[variant].container,
        borderColor ? { borderColor } : null,
        pressed && !rest.disabled ? variants[variant].pressed : null,
        rest.disabled ? styles.disabled : null,
        style,
      ]}>
      {left}
      {label != null ? (
        <Text
          style={[
            styles.label,
            variants[variant].label,
            uppercase
              ? { textTransform: 'uppercase', letterSpacing: tracking(size, 0.06) }
              : null,
            labelStyle,
          ]}>
          {label}
        </Text>
      ) : null}
      {children}
      {right}
    </Pressable>
  );
}

const variants: Record<
  ButtonVariant,
  { container: ViewStyle; pressed: ViewStyle; label: TextStyle }
> = {
  primary: {
    container: { backgroundColor: color.accent, borderColor: color.accent },
    // Industry's :active step — one past the base on the ramp.
    pressed: { backgroundColor: color.accent700, borderColor: color.accent700 },
    label: { color: color.bg },
  },
  secondary: {
    container: { borderColor: color.divider },
    pressed: { backgroundColor: tint.pressInk },
    label: { color: color.text },
  },
  ghost: {
    container: { borderColor: 'transparent', paddingHorizontal: 3.4 },
    pressed: { backgroundColor: tint.pressAccent },
    label: { color: color.accent700 },
  },
};

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderWidth: HAIRLINE,
    borderRadius: RADIUS,
    // Every interactive element clears 40pt.
    minHeight: 40,
  },
  label: {
    fontFamily: font.head,
    fontSize: 14,
    lineHeight: 17,
  },
  disabled: {
    opacity: 0.45,
  },
});
