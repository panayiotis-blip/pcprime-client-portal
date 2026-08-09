import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { Lock } from 'lucide-react-native';
import { StyleSheet, Text, View } from 'react-native';

import { Blueprint } from '../components/Blueprint';
import { Button } from '../components/Button';
import { Screen } from '../components/Screen';
import { StatusBarStyle } from '../components/StatusBarStyle';
import { firm, profile } from '../data/mock';
import { useTopPad } from '../theme/layout';
import { HAIRLINE, color } from '../theme/tokens';
import { font } from '../theme/type';

/**
 * Portal hand-off.
 *
 * The app does not own the portal and does not pretend to. This hands the
 * user across in an in-app browser — SFSafariViewController on iOS, Custom
 * Tabs on Android — rather than an external jump or an iframe, which portals
 * block with X-Frame-Options anyway.
 *
 * TODO: carry the session token across so the portal does not ask for a
 * second login.
 */
export default function PortalScreen() {
  const router = useRouter();
  const topPad = useTopPad(58);

  const open = () =>
    WebBrowser.openBrowserAsync(firm.portalUrl, {
      toolbarColor: color.accent900,
      controlsColor: color.accent300,
      secondaryToolbarColor: color.accent900,
    });

  return (
    <Screen>
      <StatusBarStyle style="light" />

      <View style={[styles.bar, { paddingTop: topPad }]}>
        <Button
          variant="ghost"
          label="← Back"
          onPress={() => router.back()}
          style={styles.barButton}
          labelStyle={styles.barLabel}
        />
        <View style={styles.pill}>
          <Lock size={13} strokeWidth={1.5} color={color.accent300} />
          <Text style={styles.pillText} numberOfLines={1}>
            {firm.portalHost}
          </Text>
        </View>
        <Button
          variant="ghost"
          label="Open ↗"
          onPress={open}
          style={styles.barButton}
          labelStyle={styles.barLabel}
        />
      </View>

      <View style={styles.center}>
        <Blueprint style={styles.card}>
          <Lock size={26} strokeWidth={1.5} color={color.accent} />
          <Text style={styles.title}>Your client portal</Text>
          <Text style={styles.body}>
            Signed in as {profile.name}. The portal opens in the browser with your session carried
            over — no second login.
          </Text>
          <Button
            variant="primary"
            label="Open portal ↗"
            uppercase
            onPress={open}
            style={styles.open}
            labelStyle={styles.openLabel}
          />
          <Text style={styles.url}>{firm.portalHost}</Text>
        </Blueprint>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: color.accent900,
    paddingHorizontal: 16,
    paddingBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  barButton: {
    paddingVertical: 8,
    paddingHorizontal: 6,
  },
  barLabel: {
    fontSize: 13,
    color: color.accent300,
  },
  pill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minWidth: 0,
    borderWidth: HAIRLINE,
    borderColor: color.accent600,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  pillText: {
    flex: 1,
    fontFamily: font.body,
    fontSize: 12.5,
    lineHeight: 17,
    color: color.accent300,
  },

  center: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 26,
    paddingBottom: 60,
  },
  card: {
    padding: 24,
    alignItems: 'flex-start',
  },
  title: {
    fontFamily: font.head,
    fontSize: 26,
    lineHeight: 26,
    textTransform: 'uppercase',
    color: color.text,
    marginTop: 16,
  },
  body: {
    fontFamily: font.body,
    fontSize: 14,
    lineHeight: 22.4,
    color: color.neutral700,
    marginTop: 10,
  },
  open: {
    alignSelf: 'stretch',
    marginTop: 20,
    paddingVertical: 15,
    minHeight: 50,
  },
  openLabel: {
    fontSize: 14,
  },
  url: {
    fontFamily: font.body,
    fontSize: 12,
    lineHeight: 18,
    color: color.neutral600,
    marginTop: 12,
  },
});
