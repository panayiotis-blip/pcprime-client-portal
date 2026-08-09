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
import { DocumentsProvider } from '../state/documents';
import { MessagesProvider } from '../state/messages';
import { SessionProvider, useSession } from '../state/session';
import { TasksProvider } from '../state/tasks';
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
        <DocumentsProvider>
          <MessagesProvider>
            <TasksProvider>
              <ToastProvider>
                <RootNavigator />
              </ToastProvider>
            </TasksProvider>
          </MessagesProvider>
        </DocumentsProvider>
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
 * Keeps the signed-out user on Sign in, the signed-in user off it, and each
 * role inside its own tab set — a client can never land on a staff screen by
 * deep link, and vice versa.
 */
function useAuthRedirect() {
  const { authed, role } = useSession();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    const onSignIn = segments[0] === 'sign-in';
    const inStaffArea = segments[0] === 'staff';
    const home = role === 'staff' ? '/staff/today' : '/';

    if (!authed) {
      if (!onSignIn) router.replace('/sign-in');
      return;
    }

    if (onSignIn || inStaffArea !== (role === 'staff')) {
      router.replace(home);
    }
  }, [authed, role, segments, router]);
}
