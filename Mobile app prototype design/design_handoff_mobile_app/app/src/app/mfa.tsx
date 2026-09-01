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
 * The second factor.
 *
 * Not in the handoff — the design was drawn before the portal's MFA was taken
 * into account — but without it anyone with an authenticator enrolled cannot
 * get past the password, because RLS treats a half-verified session as
 * unverified and every screen would come back empty.
 *
 * Built from the sign-in screen's own parts so it reads as the same moment:
 * navy field, bottom-aligned, one gold action.
 */
export default function MfaScreen() {
  const { verifyTotp, signOut } = useSession();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (value = code) => {
    if (busy) return;
    setBusy(true);
    try {
      setError((await verifyTotp(value)) ?? '');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not reach the portal.');
    } finally {
      setBusy(false);
    }
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

          <Text style={styles.headline}>{'One more\nstep.'}</Text>
          <Text style={styles.subcopy}>
            Open your authenticator app and enter the six-digit code for Prime & Calculate.
          </Text>
        </View>

        <View style={styles.form}>
          <Input
            value={code}
            onChangeText={(next) => {
              const digits = next.replace(/\D/g, '').slice(0, 6);
              setCode(digits);
              setError('');
              // Six digits is the whole code — no reason to make them reach
              // for a button as well.
              if (digits.length === 6) submit(digits);
            }}
            placeholder="000000"
            placeholderTextColor={tint.placeholderOnNavy}
            keyboardType="number-pad"
            autoComplete="one-time-code"
            textContentType="oneTimeCode"
            autoFocus
            editable={!busy}
            style={styles.field}
            borderColor={color.accent600}
            focusColor={color.accent400}
          />

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Button
            variant="primary"
            label={busy ? 'Checking…' : 'Verify'}
            uppercase
            disabled={busy || code.length < 6}
            onPress={() => submit()}
            style={styles.submit}
            labelStyle={styles.submitLabel}
          />
          <Button
            variant="ghost"
            label="Sign in as someone else"
            onPress={signOut}
            disabled={busy}
            style={styles.ghost}
            labelStyle={styles.ghostLabel}
          />
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
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
    fontFamily: font.head,
    fontSize: 26,
    letterSpacing: tracking(26, 0.3),
    textAlign: 'center',
    minHeight: 56,
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
  ghost: {
    minHeight: 44,
    marginTop: 2,
  },
  ghostLabel: {
    fontSize: 13,
    color: color.accent300,
  },
});
