import { Stack } from 'expo-router';

import { color } from '../../../theme/tokens';

/**
 * The Clients tab's stack: the list, a client's detail, and that client's
 * files. All three keep the tab bar, with Clients staying active.
 */
export default function ClientsStackLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: color.bg },
      }}
    />
  );
}
