import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { REFERENCE_TOP_INSET } from './tokens';

/**
 * The design measures top padding from the physical top of the screen — the
 * status bar is overlaid on the content, not stacked above it. So a screen
 * spec'd at `64` sits 5pt below the reference device's 59pt inset.
 *
 * Re-express that gap against the real inset so the same visual breathing
 * room survives a device with a taller or shorter status bar.
 */
export function useTopPad(designTop: number, minimum = 16) {
  const insets = useSafeAreaInsets();
  return Math.max(insets.top + (designTop - REFERENCE_TOP_INSET), minimum);
}

/**
 * Tab bar geometry. The design's 26pt bottom padding is the home-indicator
 * inset; on a device we take the real one.
 */
export const TAB_BAR_ROW_HEIGHT = 52;
export const TAB_BAR_PADDING_TOP = 8;

export function useTabBarHeight() {
  const insets = useSafeAreaInsets();
  return TAB_BAR_PADDING_TOP + TAB_BAR_ROW_HEIGHT + Math.max(insets.bottom, 8);
}
