import { Stack } from 'expo-router';

import { color } from '../../../theme/tokens';

/**
 * The Home tab's stack. Filings is pushed from here rather than living at the
 * root, so the tab bar stays put on it — as the design has it.
 */
export default function HomeStackLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: color.bg },
      }}
    />
  );
}
