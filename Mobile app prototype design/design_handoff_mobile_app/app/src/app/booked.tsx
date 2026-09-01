import { useLocalSearchParams, useRouter } from 'expo-router';
import { Check } from 'lucide-react-native';
import { StyleSheet, Text, View } from 'react-native';

import { Blueprint } from '../components/Blueprint';
import { Button } from '../components/Button';
import { Screen } from '../components/Screen';
import { StatusBarStyle } from '../components/StatusBarStyle';
import { firm } from '../data/content';
import { color, tint } from '../theme/tokens';
import { font } from '../theme/type';

/**
 * Consultation requested — full-bleed navy, vertically centred, no tab bar.
 *
 * The design said "YOU'RE BOOKED IN.", written when booking was assumed to be
 * instant. It is not: a request goes to the firm and a person confirms it, so
 * the diary is never written to by a client. The screen keeps its shape and
 * tells the truth about what just happened.
 */
export default function BookedScreen() {
  const router = useRouter();
  const { topic, day, slot } = useLocalSearchParams<{
    topic?: string;
    day?: string;
    slot?: string;
  }>();

  const summary = [topic, day && slot ? `${day} at ${slot}` : null]
    .filter(Boolean)
    .join(' — ');

  /** Leave the confirmation behind rather than stacking on top of it. */
  const leaveTo = (destination: '/' | '/messages') => {
    router.dismissAll();
    router.navigate(destination);
  };

  return (
    <Screen background={color.accent900}>
      <StatusBarStyle style="light" />
      <View style={styles.body}>
        <Blueprint style={styles.mark} borderColor={color.accent400} ink={tint.markPaper}>
          <Check size={26} strokeWidth={1.5} color={color.accent300} />
        </Blueprint>

        <Text style={styles.headline}>Request sent.</Text>
        <Text style={styles.summary}>
          {summary ? `${summary}. ` : ''}We will confirm by email, usually the same working day.
        </Text>
        <Text style={styles.address}>
          {firm.shortAddress} If the time no longer suits, tell us in a message and we will move
          it.
        </Text>

        <Button
          variant="primary"
          label="Back to home"
          uppercase
          onPress={() => leaveTo('/')}
          style={styles.primary}
          labelStyle={styles.primaryLabel}
        />
        <Button
          variant="secondary"
          label="Add a note for the team"
          onPress={() => leaveTo('/messages')}
          borderColor={color.accent600}
          style={styles.secondary}
          labelStyle={styles.secondaryLabel}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 28,
    paddingBottom: 60,
  },
  mark: {
    width: 52,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headline: {
    fontFamily: font.head,
    fontSize: 42,
    lineHeight: 42,
    textTransform: 'uppercase',
    color: color.bg,
    marginTop: 26,
  },
  summary: {
    fontFamily: font.body,
    fontSize: 15,
    lineHeight: 24,
    color: color.accent300,
    marginTop: 14,
  },
  address: {
    fontFamily: font.body,
    fontSize: 14,
    lineHeight: 22.4,
    color: color.accent400,
    marginTop: 16,
  },
  primary: {
    marginTop: 32,
    paddingVertical: 16,
    minHeight: 52,
  },
  primaryLabel: {
    fontSize: 15,
  },
  secondary: {
    marginTop: 10,
    paddingVertical: 15,
    minHeight: 50,
  },
  secondaryLabel: {
    fontSize: 14.5,
    color: color.bg,
  },
});
