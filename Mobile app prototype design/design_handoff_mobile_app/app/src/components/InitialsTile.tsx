import { StyleProp, StyleSheet, Text, TextStyle, View, ViewStyle } from 'react-native';

import { HAIRLINE, RADIUS, color } from '../theme/tokens';
import { font } from '../theme/type';

/**
 * The small framed initials tile used in the staff client and chasing lists.
 *
 * It is a plain hairline square rather than a Blueprint: the design gives
 * registration marks to cards and avatars, not to the 34pt tiles inside a
 * list row, where four extra crosshairs per row would read as noise.
 */
export function InitialsTile({
  initials,
  size = 34,
  style,
  textStyle,
}: {
  initials: string;
  size?: number;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
}) {
  return (
    <View style={[styles.tile, { width: size, height: size }, style]}>
      <Text style={[styles.text, textStyle]}>{initials}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: HAIRLINE,
    borderColor: color.divider,
    borderRadius: RADIUS,
  },
  text: {
    fontFamily: font.body,
    fontSize: 12,
    lineHeight: 16,
    color: color.accent700,
  },
});
