import { ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { Query } from '../lib/useQuery';
import { Button } from './Button';
import { color, space } from '../theme/tokens';
import { font } from '../theme/type';

/**
 * Loading, empty and error states.
 *
 * The handoff designs none of these — it was drawn against seeded data that
 * always arrives. They are deliberately the quietest thing in the system: a
 * line of meta text on the paper ground, no illustration, no card. The one
 * exception is a failed load, which gets a Try again button, because a dead
 * end with no way out is worse than a plain one.
 */

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <View style={styles.state}>
      <ActivityIndicator color={color.accent} />
      <Text style={styles.text}>{label}</Text>
    </View>
  );
}

export function Empty({ children }: { children: string }) {
  return (
    <View style={styles.state}>
      <Text style={styles.text}>{children}</Text>
    </View>
  );
}

export function Failed({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <View style={styles.state}>
      <Text style={styles.text}>{message}</Text>
      <Button variant="secondary" label="Try again" onPress={onRetry} style={styles.retry} />
    </View>
  );
}

/**
 * Shown on a client screen when the signed-in account has no client attached.
 * It happens for real — an invited user the firm has not linked yet — and for
 * one frame on every screen before the auth redirect settles, so it has to be
 * calm rather than alarming.
 */
export function NoClientLinked() {
  return (
    <View style={styles.screen}>
      <Empty>Your account is not linked to a client yet. The firm can put that right.</Empty>
    </View>
  );
}

/**
 * Renders a query's three outcomes. Content is a function so it only sees
 * data that has actually arrived — no null-checking in every screen.
 */
export function Async<T>({
  query,
  children,
  loadingLabel,
}: {
  query: Query<T>;
  children: (data: T) => ReactNode;
  loadingLabel?: string;
}) {
  if (query.data !== null) return <>{children(query.data)}</>;
  if (query.loading) return <Loading label={loadingLabel} />;
  if (query.error) return <Failed message={query.error} onRetry={query.reload} />;
  return null;
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    justifyContent: 'center',
  },
  state: {
    alignItems: 'center',
    gap: 12,
    paddingVertical: 40,
    paddingHorizontal: space.screenX,
  },
  text: {
    fontFamily: font.body,
    fontSize: 14,
    lineHeight: 20,
    color: color.neutral600,
    textAlign: 'center',
  },
  retry: {
    minWidth: 140,
  },
});
