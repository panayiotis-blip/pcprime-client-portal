import { ReactNode, useEffect, useRef } from 'react';
import {
  Animated,
  Easing,
  Modal,
  Pressable,
  StyleSheet,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CONTENT_MAX_WIDTH, color, tint } from '../theme/tokens';
import { Blueprint } from './Blueprint';

/**
 * A bottom sheet: slides up over 300ms on the system's easing curve while the
 * backdrop fades in over 200ms. Tapping the backdrop dismisses.
 *
 * It keeps its top registration marks; the bottom pair would fall off the
 * edge of the screen.
 */
export function Sheet({
  visible,
  onClose,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) {
      progress.setValue(0);
      return;
    }
    Animated.timing(progress, {
      toValue: 1,
      duration: 300,
      easing: Easing.bezier(0.2, 0.8, 0.2, 1),
      useNativeDriver: true,
    }).start();
  }, [visible, progress]);

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <Animated.View
        style={[
          styles.backdrop,
          {
            opacity: progress.interpolate({
              inputRange: [0, 0.67, 1],
              outputRange: [0, 1, 1],
            }),
          },
        ]}>
        <Pressable style={styles.dismissArea} onPress={onClose} accessibilityLabel="Dismiss" />
        <Animated.View
          style={{
            transform: [
              {
                translateY: progress.interpolate({
                  inputRange: [0, 1],
                  outputRange: [height, 0],
                }),
              },
            ],
          }}>
          <Blueprint
            marks="top"
            style={[
              styles.sheet,
              { paddingBottom: 32 + Math.max(insets.bottom - 8, 0) },
            ]}>
            {children}
          </Blueprint>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: tint.backdrop,
  },
  dismissArea: {
    flex: 1,
  },
  sheet: {
    width: '100%',
    maxWidth: CONTENT_MAX_WIDTH,
    alignSelf: 'center',
    backgroundColor: color.bg,
    paddingTop: 20,
    paddingHorizontal: 22,
  },
});
