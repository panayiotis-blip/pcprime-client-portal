import { ReactNode } from 'react';
import {
  Pressable,
  PressableProps,
  StyleProp,
  StyleSheet,
  View,
  ViewStyle,
} from 'react-native';

import { HAIRLINE, RADIUS, color, tint } from '../theme/tokens';

/**
 * Blueprint registration marks — the `+` crosshairs the Industry system puts
 * at every corner of a framed object.
 *
 * Each mark is an 11pt box straddling the corner (offset 6pt outside the
 * frame on both axes), drawn as a 1pt vertical bar at x=5 crossed by a 1pt
 * horizontal bar at y=5. This is a direct transcription of the `.corner`
 * rule in the Industry stylesheet.
 *
 * The marks sit *outside* the frame, so no ancestor of a Blueprint may set
 * `overflow: 'hidden'` — it would clip them off.
 */

const MARK = 11;
const OFFSET = -6;
const ARM = 5;

export function CornerMarks({ ink = tint.markInk }: { ink?: string }) {
  const bar = { backgroundColor: ink };
  const mark = (key: string, position: ViewStyle) => (
    <View key={key} style={[styles.mark, position]}>
      <View style={[styles.vertical, bar]} />
      <View style={[styles.horizontal, bar]} />
    </View>
  );

  return (
    <>
      {mark('tl', { top: OFFSET, left: OFFSET })}
      {mark('tr', { top: OFFSET, right: OFFSET })}
      {mark('bl', { bottom: OFFSET, left: OFFSET })}
      {mark('br', { bottom: OFFSET, right: OFFSET })}
    </>
  );
}

export type BlueprintProps = {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Frame colour. Defaults to the hairline divider. */
  borderColor?: string;
  /** Registration mark colour. Use `tint.markPaper` over a navy field. */
  ink?: string;
  /**
   * Drop the marks. Reserved for the bottom sheet, whose lower corners run
   * off the bottom of the screen; everything else keeps all four.
   */
  marks?: boolean | 'top';
};

/**
 * A framed object: square, hairline-bordered, transparent, with registration
 * marks. Cards, avatars, stat blocks and figures are all built from this.
 */
export function Blueprint({
  children,
  style,
  borderColor = color.divider,
  ink,
  marks = true,
}: BlueprintProps) {
  return (
    <View style={[styles.frame, { borderColor }, style]}>
      {marks === true ? <CornerMarks ink={ink} /> : null}
      {marks === 'top' ? <TopMarks ink={ink} /> : null}
      {children}
    </View>
  );
}

/**
 * A framed card that is also a button. Pressing tints the fill to 5% of the
 * text colour — the on-device reading of the prototype's hover state.
 */
export function BlueprintPressable({
  children,
  style,
  borderColor = color.divider,
  ink,
  ...rest
}: Omit<PressableProps, 'style'> & BlueprintProps) {
  return (
    <Pressable
      accessibilityRole="button"
      {...rest}
      style={({ pressed }) => [
        styles.frame,
        { borderColor },
        pressed ? { backgroundColor: tint.pressCard } : null,
        style,
      ]}>
      <CornerMarks ink={ink} />
      {children}
    </Pressable>
  );
}

function TopMarks({ ink = tint.markInk }: { ink?: string }) {
  const bar = { backgroundColor: ink };
  return (
    <>
      {(['left', 'right'] as const).map((side) => (
        <View key={side} style={[styles.mark, { top: OFFSET, [side]: OFFSET }]}>
          <View style={[styles.vertical, bar]} />
          <View style={[styles.horizontal, bar]} />
        </View>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  frame: {
    borderWidth: HAIRLINE,
    borderRadius: RADIUS,
    // The marks overhang the frame; never clip them.
    overflow: 'visible',
  },
  mark: {
    position: 'absolute',
    width: MARK,
    height: MARK,
    zIndex: 1,
    pointerEvents: 'none',
  },
  vertical: {
    position: 'absolute',
    left: ARM,
    top: 0,
    width: 1,
    height: MARK,
  },
  horizontal: {
    position: 'absolute',
    top: ARM,
    left: 0,
    height: 1,
    width: MARK,
  },
});
