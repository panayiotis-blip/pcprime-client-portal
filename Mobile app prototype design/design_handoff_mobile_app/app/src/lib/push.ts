import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import * as portal from '../api/portal';
import * as SecureStore from 'expo-secure-store';

/**
 * Push registration.
 *
 * Deadline reminders, "we have your document" and "your accountant replied"
 * are the reason this is an app rather than a mobile web page. All this side
 * does is tell the portal where to reach the device; the sending lives in an
 * Edge Function with the service role (see migration 177).
 *
 * Remote push needs a development build — Expo Go dropped support for it on
 * Android in SDK 53, and it never worked there for iOS.
 */

const TOKEN_KEY = 'pcprime_push_token';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

function projectId(): string | undefined {
  return (
    Constants.expoConfig?.extra?.eas?.projectId ??
    (Constants as { easConfig?: { projectId?: string } }).easConfig?.projectId
  );
}

/**
 * Asks for permission, gets an Expo push token and records it against the
 * signed-in user. Silent on failure: a phone that will not accept push is not
 * a reason to interrupt someone signing in.
 */
export async function registerForPush(): Promise<void> {
  try {
    if (!Device.isDevice) return; // Simulators never receive remote push.

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Deadlines and messages',
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }

    const existing = await Notifications.getPermissionsAsync();
    const granted =
      existing.granted || (await Notifications.requestPermissionsAsync()).granted;
    if (!granted) return;

    const id = projectId();
    if (!id) return; // Not an EAS project yet — nothing to mint a token against.

    const token = (await Notifications.getExpoPushTokenAsync({ projectId: id })).data;
    await SecureStore.setItemAsync(TOKEN_KEY, token);

    await portal.registerPushDevice({
      token,
      platform: Platform.OS === 'ios' ? 'ios' : 'android',
      deviceName: Device.deviceName,
      appVersion: Constants.expoConfig?.version ?? null,
    });
  } catch {
    // Push is an enhancement; never let it break the session.
  }
}

/** Signing out should stop the notifications reaching this handset. */
export async function unregisterPush(): Promise<void> {
  try {
    const token = await SecureStore.getItemAsync(TOKEN_KEY);
    if (!token) return;
    await portal.unregisterPushDevice(token);
    await SecureStore.deleteItemAsync(TOKEN_KEY);
  } catch {
    // Best effort.
  }
}
