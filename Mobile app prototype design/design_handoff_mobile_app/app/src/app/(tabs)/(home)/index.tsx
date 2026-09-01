import { useRouter } from 'expo-router';
import { ArrowRight, Calendar, Folder } from 'lucide-react-native';
import { useCallback } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import * as portal from '../../../api/portal';
import { Async, NoClientLinked } from '../../../components/Async';
import { Blueprint, BlueprintPressable } from '../../../components/Blueprint';
import { Button } from '../../../components/Button';
import { Screen } from '../../../components/Screen';
import { SectionHeader } from '../../../components/Section';
import { StatusBarStyle } from '../../../components/StatusBarStyle';
import { Tag } from '../../../components/Tag';
import { closingPanel, firm, services } from '../../../data/content';
import { formatLongDate } from '../../../lib/dates';
import { useQuery } from '../../../lib/useQuery';
import { useClientId, useSession } from '../../../state/session';
import { useTopPad } from '../../../theme/layout';
import { HAIRLINE, color, space, tint } from '../../../theme/tokens';
import { font, text, tracking } from '../../../theme/type';

/**
 * Home — the morning glance: what is due, and the two things a client most
 * often does.
 */
export default function HomeScreen() {
  const router = useRouter();
  const { account } = useSession();
  const clientId = useClientId();
  const topPad = useTopPad(64);

  const query = useQuery(
    useCallback(async () => {
      if (clientId == null) return { alert: null, deadlines: [] };
      return {
        alert: await portal.loadAlert(clientId),
        deadlines: await portal.loadDeadlines(clientId),
      };
    }, [clientId]),
    [clientId],
  );

  const firstName = (account?.name || '').split(' ')[0];

  if (clientId == null) return <NoClientLinked />;

  return (
    <Screen scroll>
      <StatusBarStyle style="light" />

      <View style={[styles.header, { paddingTop: topPad }]}>
        <View style={styles.headerRow}>
          <View style={styles.greeting}>
            <Text style={styles.date}>{formatLongDate(new Date())}</Text>
            <Text style={styles.title}>{`Good morning,\n${firstName}`}</Text>
          </View>
          <Blueprint style={styles.avatar} borderColor={color.accent600} ink={tint.markPaper}>
            <Text style={styles.avatarLetters}>{account?.initials ?? ''}</Text>
          </Blueprint>
        </View>

        {query.data?.alert ? (
          <Blueprint style={styles.alert} borderColor={color.accent400} ink={tint.markPaper}>
            <View style={styles.alertDot} />
            <View style={styles.alertBody}>
              <Text style={styles.alertTitle}>{query.data.alert.title}</Text>
              <Text style={styles.alertSub}>{query.data.alert.sub}</Text>
            </View>
            <Button
              variant="primary"
              label="Upload"
              uppercase
              onPress={() => router.navigate('/documents')}
              style={styles.alertAction}
              labelStyle={styles.alertActionLabel}
            />
          </Blueprint>
        ) : null}
      </View>

      <View style={styles.quickRow}>
        <QuickAction
          icon={<Folder size={22} strokeWidth={1.5} color={color.accent} />}
          title="Documents"
          sub="Send and review"
          onPress={() => router.navigate('/documents')}
        />
        <QuickAction
          icon={<Calendar size={22} strokeWidth={1.5} color={color.accent} />}
          title="Book a call"
          sub="Free consultation"
          onPress={() => router.navigate('/book')}
        />
      </View>

      <View style={styles.section}>
        <SectionHeader
          title="Your calendar"
          right={
            <Button
              variant="ghost"
              label="All filings"
              onPress={() => router.push('/filings')}
              labelStyle={styles.sectionLink}
            />
          }
        />
        <Async query={query} loadingLabel="Checking your deadlines…">
          {({ deadlines }) =>
            deadlines.length ? (
              <Blueprint style={styles.list}>
                {deadlines.map((deadline, index) => (
                  <View
                    key={deadline.id}
                    style={[styles.listRow, index < deadlines.length - 1 && styles.divided]}>
                    <View style={styles.dateBlock}>
                      <Text style={styles.dateDay}>{deadline.day}</Text>
                      <Text style={styles.dateMonth}>{deadline.month}</Text>
                    </View>
                    <View style={styles.rowBody}>
                      <Text style={text.rowTitle}>{deadline.title}</Text>
                      <Text style={styles.rowSub}>{deadline.sub}</Text>
                    </View>
                    <Tag label={deadline.status.label} tone={deadline.status.tone} />
                  </View>
                ))}
              </Blueprint>
            ) : (
              <Blueprint style={styles.clearCard}>
                <Text style={styles.clearText}>Nothing due. We will tell you when there is.</Text>
              </Blueprint>
            )
          }
        </Async>
      </View>

      <View style={styles.section}>
        <SectionHeader title="Services" />
        <View style={styles.serviceList}>
          {services.map((service) => (
            <BlueprintPressable
              key={service.name}
              style={styles.serviceCard}
              onPress={() => router.navigate('/book')}>
              <View style={styles.rowBody}>
                <Text style={text.cardTitle}>{service.name}</Text>
                <Text style={styles.serviceDesc}>{service.description}</Text>
              </View>
              <ArrowRight size={18} strokeWidth={1.5} color={color.accent} />
            </BlueprintPressable>
          ))}
        </View>
      </View>

      <View style={styles.closingWrap}>
        <View style={styles.closing}>
          <Text style={styles.closingHeadline}>{closingPanel.headline}</Text>
          <Pressable
            accessibilityRole="link"
            onPress={() => Linking.openURL(firm.aboutUrl)}
            style={styles.closingLinkHit}>
            <Text style={styles.closingLink}>{closingPanel.link}</Text>
          </Pressable>
        </View>
      </View>
    </Screen>
  );
}

function QuickAction({
  icon,
  title,
  sub,
  onPress,
}: {
  icon: React.ReactNode;
  title: string;
  sub: string;
  onPress: () => void;
}) {
  return (
    <BlueprintPressable style={styles.quickCard} onPress={onPress}>
      {icon}
      <Text style={styles.quickTitle}>{title}</Text>
      <Text style={styles.rowSub}>{sub}</Text>
    </BlueprintPressable>
  );
}

const styles = StyleSheet.create({
  header: {
    backgroundColor: color.accent900,
    paddingHorizontal: space.screenX,
    paddingBottom: 26,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 14,
  },
  greeting: {
    flexShrink: 1,
  },
  date: {
    fontFamily: font.body,
    fontSize: 11,
    lineHeight: 15,
    letterSpacing: tracking(11, 0.13),
    textTransform: 'uppercase',
    color: color.accent300,
  },
  title: {
    fontFamily: font.head,
    fontSize: 32,
    lineHeight: 33.6,
    textTransform: 'uppercase',
    color: color.bg,
    marginTop: 6,
  },
  avatar: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarLetters: {
    fontFamily: font.body,
    fontSize: 13,
    color: color.bg,
  },
  alert: {
    marginTop: 26,
    paddingVertical: 15,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    backgroundColor: tint.alert,
  },
  alertDot: {
    width: 7,
    height: 7,
    backgroundColor: color.accent300,
  },
  alertBody: {
    flex: 1,
  },
  alertTitle: {
    fontFamily: font.semibold,
    fontSize: 14.5,
    lineHeight: 19,
    color: color.bg,
  },
  alertSub: {
    fontFamily: font.body,
    fontSize: 12.5,
    lineHeight: 17,
    color: color.accent300,
    marginTop: 2,
  },
  alertAction: {
    paddingVertical: 10,
    paddingHorizontal: 13,
  },
  alertActionLabel: {
    fontSize: 12,
  },

  quickRow: {
    flexDirection: 'row',
    gap: 14,
    paddingHorizontal: space.screenX,
    paddingTop: 22,
  },
  quickCard: {
    flex: 1,
    alignItems: 'flex-start',
    padding: 16,
  },
  quickTitle: {
    fontFamily: font.semibold,
    fontSize: 15,
    lineHeight: 20,
    color: color.text,
    marginTop: 10,
  },

  section: {
    paddingHorizontal: space.screenX,
    paddingTop: space.section,
  },
  sectionLink: {
    fontSize: 13,
    color: color.accent700,
  },
  list: {
    marginTop: 12,
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 15,
    paddingHorizontal: 16,
  },
  divided: {
    borderBottomWidth: HAIRLINE,
    borderBottomColor: color.divider,
  },
  clearCard: {
    marginTop: 12,
    padding: 16,
  },
  clearText: {
    fontFamily: font.body,
    fontSize: 14,
    lineHeight: 20,
    color: color.neutral600,
  },
  dateBlock: {
    width: 42,
    alignItems: 'center',
  },
  dateDay: {
    fontFamily: font.head,
    fontSize: 22,
    lineHeight: 22,
    color: color.accent700,
  },
  dateMonth: {
    fontFamily: font.body,
    fontSize: 10,
    lineHeight: 13,
    letterSpacing: tracking(10, 0.12),
    textTransform: 'uppercase',
    color: color.neutral600,
    marginTop: 2,
  },
  rowBody: {
    flex: 1,
  },
  rowSub: {
    fontFamily: font.body,
    fontSize: 12.5,
    lineHeight: 17,
    color: color.neutral600,
    marginTop: 2,
  },

  serviceList: {
    marginTop: 14,
    gap: space.cardGap,
  },
  serviceCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  serviceDesc: {
    fontFamily: font.body,
    fontSize: 12.5,
    lineHeight: 18,
    color: color.neutral600,
    marginTop: 3,
  },

  closingWrap: {
    paddingHorizontal: space.screenX,
    paddingTop: space.section,
    paddingBottom: 30,
  },
  closing: {
    backgroundColor: color.accent900,
    padding: 24,
  },
  closingHeadline: {
    fontFamily: font.head,
    fontSize: 26,
    lineHeight: 28.6,
    textTransform: 'uppercase',
    color: color.bg,
  },
  closingLinkHit: {
    alignSelf: 'flex-start',
    marginTop: 16,
    minHeight: 40,
    justifyContent: 'center',
  },
  closingLink: {
    fontFamily: font.body,
    fontSize: 13,
    lineHeight: 18,
    letterSpacing: tracking(13, 0.08),
    textTransform: 'uppercase',
    color: color.accent300,
  },
});
