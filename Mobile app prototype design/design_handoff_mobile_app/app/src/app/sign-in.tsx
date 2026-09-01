import { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native';

import { Blueprint } from '../components/Blueprint';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { Screen } from '../components/Screen';
import { StatusBarStyle } from '../components/StatusBarStyle';
import { useSession } from '../state/session';
import { color, tint } from '../theme/tokens';
import { font, tracking } from '../theme/type';

/**
 * Sign in — full-bleed navy, content bottom-aligned, form pinned to the
 * bottom edge.
 *
 * The credentials are the portal's: the same account, over the same Supabase
 * auth, so there is no separate app login to keep in step.
 */
export default function SignInScreen() {
  const { signIn, unlockWithBiometrics, biometricsAvailable } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError(await sanitise(() => signIn(email, password)));
    setBusy(false);
  };

  const unlock = async () => {
    if (busy) return;
    setBusy(true);
    setError(await sanitise(unlockWithBiometrics));
    setBusy(false);
  };

  return (
    <Screen background={color.accent900}>
      <StatusBarStyle style="light" />
      <KeyboardAvoidingView
        style={styles.root}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.masthead}>
          <Blueprint style={styles.brand} borderColor={color.accent400} ink={tint.markPaper}>
            <Text style={styles.brandLetters}>PC</Text>
          </Blueprint>

          <Text style={styles.headline}>{'Precision.\nPartnership.\nProgress.'}</Text>
          <Text style={styles.subcopy}>
            Sign in to your client portal — documents, deadlines and your accountant, in one place.
          </Text>
        </View>

        <View style={styles.form}>
          <Input
            value={email}
            onChangeText={(next) => {
              setEmail(next);
              setError('');
            }}
            placeholder="Email address"
            placeholderTextColor={tint.placeholderOnNavy}
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            textContentType="emailAddress"
            editable={!busy}
            style={styles.field}
            borderColor={color.accent600}
            focusColor={color.accent400}
          />
          <Input
            value={password}
            onChangeText={(next) => {
              setPassword(next);
              setError('');
            }}
            placeholder="Password"
            placeholderTextColor={tint.placeholderOnNavy}
            secureTextEntry
            autoComplete="current-password"
            textContentType="password"
            onSubmitEditing={submit}
            returnKeyType="go"
            editable={!busy}
            style={styles.field}
            borderColor={color.accent600}
            focusColor={color.accent400}
          />

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Button
            variant="primary"
            label={busy ? 'Signing in…' : 'Sign in'}
            uppercase
            disabled={busy}
            onPress={submit}
            style={styles.submit}
            labelStyle={styles.submitLabel}
          />

          <View style={styles.ghostRow}>
            <Button
              variant="ghost"
              label="Use Face ID"
              onPress={unlock}
              // Nothing to unlock into on a device that cannot, or has never
              // held a session.
              disabled={busy || !biometricsAvailable}
              style={styles.ghost}
              labelStyle={styles.ghostLabel}
            />
            <Button
              variant="ghost"
              label="Forgot password"
              onPress={() =>
                setError('Reset your password in the web portal, then sign in here.')
              }
              disabled={busy}
              style={styles.ghost}
              labelStyle={styles.ghostLabel}
            />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

/** Never let a raw network failure reach the user as a stack trace. */
async function sanitise(run: () => Promise<string | null>): Promise<string> {
  try {
    return (await run()) ?? '';
  } catch (caught) {
    return caught instanceof Error ? caught.message : 'Could not reach the portal.';
  }
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    paddingHorizontal: 27,
    paddingBottom: 34,
  },
  masthead: {
    flex: 1,
    justifyContent: 'flex-end',
    paddingBottom: 34,
  },
  brand: {
    width: 56,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 30,
  },
  brandLetters: {
    fontFamily: font.head,
    fontSize: 22,
    lineHeight: 26,
    color: color.bg,
  },
  headline: {
    fontFamily: font.head,
    fontSize: 46,
    lineHeight: 46,
    textTransform: 'uppercase',
    color: color.bg,
  },
  subcopy: {
    fontFamily: font.body,
    fontSize: 14.5,
    lineHeight: 22.5,
    color: color.accent300,
    marginTop: 16,
  },
  form: {
    gap: 10,
  },
  field: {
    paddingVertical: 15,
    paddingHorizontal: 16,
    fontSize: 15.5,
    minHeight: 44,
    color: color.bg,
    backgroundColor: tint.fieldOnNavy,
  },
  error: {
    fontFamily: font.body,
    fontSize: 12.5,
    lineHeight: 17,
    letterSpacing: tracking(12.5, 0.02),
    color: color.accent300,
  },
  submit: {
    paddingVertical: 16,
    minHeight: 48,
    marginTop: 4,
  },
  submitLabel: {
    fontFamily: font.head,
    fontSize: 15,
  },
  ghostRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 2,
  },
  ghost: {
    minHeight: 44,
  },
  ghostLabel: {
    fontSize: 13,
    color: color.accent300,
  },
});
