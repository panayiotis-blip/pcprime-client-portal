import { useFocusEffect } from 'expo-router';
import { ReactNode, useCallback, useRef } from 'react';
import {
  Animated,
  Easing,
  ScrollView,
  StyleProp,
  StyleSheet,
  View,
  ViewStyle,
} from 'react-native';

import { CONTENT_MAX_WIDTH, color } from '../theme/tokens';

/**
 * Screen enter: fade plus an 8pt rise over 300ms. Replays on focus, matching
 * the prototype's per-screen `scr` keyframe.
 */
function useEnter() {
  const progress = useRef(new Animated.Value(0)).current;

  useFocusEffect(
    useCallback(() => {
      progress.setValue(0);
      const animation = Animated.timing(progress, {
        toValue: 1,
        duration: 300,
        // CSS `ease`.
        easing: Easing.bezier(0.25, 0.1, 0.25, 1),
        useNativeDriver: true,
      });
      animation.start();
      return () => animation.stop();
    }, [progress]),
  );

  return {
    opacity: progress,
    transform: [
      {
        translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }),
      },
    ],
  };
}

export type ScreenProps = {
  children: ReactNode;
  /** Wrap the content in a ScrollView. */
  scroll?: boolean;
  /** Screen ground. Navy screens pass `color.accent900`. */
  background?: string;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
};

/**
 * Every screen body. Owns the enter animation and the centred content column
 * — the layout is final at 402pt wide, so wider viewports get a capped column
 * rather than stretched rows.
 */
export function Screen({
  children,
  scroll = false,
  background = color.bg,
  style,
  contentStyle,
}: ScreenProps) {
  const enter = useEnter();

  const column = <View style={[styles.column, contentStyle]}>{children}</View>;

  return (
    <Animated.View style={[styles.root, { backgroundColor: background }, enter, style]}>
      {scroll ? (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          {column}
        </ScrollView>
      ) : (
        column
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  column: {
    flex: 1,
    width: '100%',
    maxWidth: CONTENT_MAX_WIDTH,
    alignSelf: 'center',
  },
});
