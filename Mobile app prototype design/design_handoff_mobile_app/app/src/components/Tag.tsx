import { StyleProp, StyleSheet, Text, TextStyle, View, ViewStyle } from 'react-native';

import { HAIRLINE, RADIUS, color } from '../theme/tokens';
import { font, tracking } from '../theme/type';

/**
 * Status tags.
 *
 * The rule the whole system turns on: **gold means someone must do
 * something.** Everything else stays quiet. There is no red/green semantic
 * palette — urgency is carried by the gold fill against quiet outlines.
 */
export type TagTone =
  /** Action / urgent — gold fill, navy text. */
  | 'action'
  /** Positive / done — neutral tint. */
  | 'positive'
  /** Inert — outlined, transparent. */
  | 'inert';

export function Tag({
  label,
  tone,
  style,
  textStyle,
}: {
  label: string;
  tone: TagTone;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
}) {
  return (
    <View style={[styles.base, tones[tone].container, style]}>
      <Text style={[styles.label, tones[tone].label, textStyle]}>{label}</Text>
    </View>
  );
}

const tones: Record<TagTone, { container: ViewStyle; label: TextStyle }> = {
  action: {
    container: { backgroundColor: color.accent300, borderColor: color.accent300 },
    label: { color: color.accent900 },
  },
  positive: {
    container: { backgroundColor: color.neutral100, borderColor: color.neutral100 },
    label: { color: color.neutral800 },
  },
  inert: {
    container: { backgroundColor: 'transparent', borderColor: color.divider },
    label: { color: color.neutral700 },
  },
};

const styles = StyleSheet.create({
  base: {
    alignSelf: 'flex-start',
    paddingVertical: 5,
    paddingHorizontal: 9,
    borderRadius: RADIUS,
    // The filled tones carry a same-colour border so every tag in a row is
    // the same height as an outlined one.
    borderWidth: HAIRLINE,
  },
  label: {
    fontFamily: font.semibold,
    fontSize: 11,
    lineHeight: 13,
    letterSpacing: tracking(11, 0.02),
    textTransform: 'uppercase',
  },
});
