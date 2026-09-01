import {
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';

import { useTabBarHeight } from '../theme/layout';
import { CONTENT_MAX_WIDTH, color, shadowLg } from '../theme/tokens';
import { font } from '../theme/type';

const DURATION = 2400;

type ToastContextValue = { show: (message: string) => void };

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast() {
  const value = useContext(ToastContext);
  if (!value) throw new Error('useToast must be used inside <ToastProvider>');
  return value;
}

/**
 * The toast is the only elevated object in the system — everything else is
 * flat. It sits 18pt in from each side and clears the tab bar.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback((next: string) => {
    setMessage(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setMessage(''), DURATION);
  }, []);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const value = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={value}>
      {/* The toast is positioned against this box, so it clears the tab bar
          no matter which screen raised it. */}
      <View style={styles.host}>
        {children}
        {message ? <Toast message={message} /> : null}
      </View>
    </ToastContext.Provider>
  );
}

function Toast({ message }: { message: string }) {
  const tabBar = useTabBarHeight();
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(progress, {
      toValue: 1,
      duration: 250,
      easing: Easing.bezier(0.25, 0.1, 0.25, 1),
      useNativeDriver: true,
    }).start();
  }, [progress]);

  return (
    <Animated.View
      accessibilityLiveRegion="polite"
      style={[
        styles.slot,
        {
          bottom: tabBar + 18,
          opacity: progress,
          transform: [
            { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) },
          ],
        },
      ]}>
      <View style={[styles.toast, shadowLg]}>
        <Text style={styles.text}>{message}</Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  host: {
    flex: 1,
  },
  slot: {
    position: 'absolute',
    left: 18,
    right: 18,
    zIndex: 90,
    pointerEvents: 'none',
  },
  toast: {
    // Tracks the centred content column on a wide viewport.
    width: '100%',
    maxWidth: CONTENT_MAX_WIDTH - 36,
    alignSelf: 'center',
    backgroundColor: color.accent900,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  text: {
    fontFamily: font.body,
    fontSize: 14,
    lineHeight: 20,
    color: color.bg,
  },
});
