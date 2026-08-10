import { BarlowCondensed_600SemiBold } from '@expo-google-fonts/barlow-condensed/600SemiBold';
import { Barlow_400Regular } from '@expo-google-fonts/barlow/400Regular';
import { Barlow_500Medium } from '@expo-google-fonts/barlow/500Medium';
import { Barlow_600SemiBold } from '@expo-google-fonts/barlow/600SemiBold';
import { useFonts } from 'expo-font';
import { Stack, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ToastProvider } from '../components/Toast';
import { SessionProvider, useSession } from '../state/session';
import { color } from '../theme/tokens';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Barlow_400Regular,
    Barlow_500Medium,
    Barlow_600SemiBold,
    BarlowCondensed_600SemiBold,
  });

  useEffect(() => {
    if (fontsLoaded) SplashScreen.hideAsync();
  }, [fontsLoaded]);

  // Barlow and Barlow Condensed carry the whole design; showing the screens
  // in a fallback face first would be worse than a beat of splash.
  if (!fontsLoaded) return null;

  return (
    <SafeAreaProvider>
      <SessionProvider>
        <ToastProvider>
          <RootNavigator />
        </ToastProvider>
      </SessionProvider>
    </SafeAreaProvider>
  );
}

function RootNavigator() {
  useAuthRedirect();

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: color.bg },
      }}>
      <Stack.Screen name="sign-in" />
      <Stack.Screen name="mfa" />
      {/* Two tab sets. Which one you get is a consequence of your role. */}
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="staff" />
      {/* Both of these deliberately drop the tab bar. */}
      <Stack.Screen name="portal" />
      <Stack.Screen name="booked" />
    </Stack>
  );
}

/**
 * Sends each session where it belongs: out to Sign in when there is none, to
 * the second-factor screen when one is outstanding, and otherwise into the tab
 * set for the role the portal gave us. A client can never land on a staff
 * screen, and vice versa.
 */
function useAuthRedirect() {
  const { ready, account, mfaPending, role } = useSession();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    // Nothing is mounted until the stored session has been read; redirecting
    // before then would bounce a signed-in user out to the sign-in screen.
    if (!ready) return;

    const first = segments[0];
    const onSignIn = first === 'sign-in';
    const onMfa = first === 'mfa';

    if (mfaPending) {
      if (!onMfa) router.replace('/mfa');
      return;
    }

    if (!account) {
      if (!onSignIn) router.replace('/sign-in');
      return;
    }

    const inStaffArea = first === 'staff';
    const home = role === 'staff' ? '/staff/today' : '/';

    if (onSignIn || onMfa || inStaffArea !== (role === 'staff')) {
      router.replace(home);
    }
  }, [ready, account, mfaPending, role, segments, router]);
}
