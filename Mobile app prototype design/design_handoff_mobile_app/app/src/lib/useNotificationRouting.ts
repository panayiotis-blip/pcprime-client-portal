import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';

/**
 * Tapping a notification should land on the thing it was about.
 *
 * Every notification carries a `url` in its data payload — `/messages`,
 * `/documents`, `/filings` — put there by the outbox (migration 178). Two
 * cases to cover: a tap while the app is running, and a cold start where the
 * tap is what launched it.
 *
 * Navigation only happens once the user is signed in; a deep link that lands
 * on a screen behind the auth redirect would bounce straight back out. Held
 * links are replayed when the session arrives.
 */
export function useNotificationRouting(canNavigate: boolean) {
  const router = useRouter();
  const pending = useRef<string | null>(null);

  useEffect(() => {
    const go = (response: Notifications.NotificationResponse) => {
      const url = response.notification.request.content.data?.url;
      if (typeof url !== 'string' || !url.startsWith('/')) return;
      pending.current = url;
      flush();
    };

    const flush = () => {
      if (!canNavigate || !pending.current) return;
      const url = pending.current;
      pending.current = null;
      router.navigate(url as never);
    };

    // The tap that launched the app, if there was one.
    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) go(response);
    });

    const subscription = Notifications.addNotificationResponseReceivedListener(go);

    // A link that arrived before sign-in finished.
    flush();

    return () => subscription.remove();
  }, [canNavigate, router]);
}
