import { ReactNode } from 'react';
import { StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';

import { color } from '../theme/tokens';
import { text } from '../theme/type';

/**
 * A 22px condensed section header, optionally with a ghost link on the right
 * (baseline-aligned with the heading, as on Home's "YOUR CALENDAR").
 */
export function SectionHeader({
  title,
  right,
  style,
}: {
  title: string;
  right?: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.header, style]}>
      <Text style={text.sectionHeader}>{title}</Text>
      {right}
    </View>
  );
}

/** The 10.5px uppercase group label used above form groups and lists. */
export function GroupLabel({ children, style }: { children: string; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={style}>
      <Text style={text.eyebrow}>{children}</Text>
    </View>
  );
}

/**
 * A 4pt progress bar. Filed reads as a full deep-gold bar; work in progress
 * as a partial gold one; anything not started stays neutral.
 */
export function ProgressBar({ percent, fill }: { percent: number; fill: string }) {
  return (
    <View style={styles.track}>
      <View style={[styles.fill, { width: `${percent}%`, backgroundColor: fill }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: 12,
  },
  track: {
    height: 4,
    backgroundColor: color.neutral200,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
  },
});
