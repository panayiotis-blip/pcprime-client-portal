import { useFocusEffect } from 'expo-router';
import { setStatusBarStyle } from 'expo-status-bar';
import { useCallback } from 'react';

/**
 * Sets the status bar per screen on focus.
 *
 * Tab screens stay mounted, so a `<StatusBar>` element per screen would race;
 * driving it from focus is the only reading that stays correct. Navy screens
 * want `light`, paper screens `dark`.
 */
export function StatusBarStyle({ style }: { style: 'light' | 'dark' }) {
  useFocusEffect(
    useCallback(() => {
      setStatusBarStyle(style, true);
    }, [style]),
  );

  return null;
}
