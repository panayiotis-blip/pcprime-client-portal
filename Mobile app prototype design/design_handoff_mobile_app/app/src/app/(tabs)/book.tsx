import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import * as portal from '../../api/portal';
import { Async, Empty, NoClientLinked } from '../../components/Async';
import { Button } from '../../components/Button';
import { GroupLabel } from '../../components/Section';
import { Screen } from '../../components/Screen';
import { StatusBarStyle } from '../../components/StatusBarStyle';
import { bookingTopics } from '../../data/content';
import { Slot } from '../../data/types';
import { useQuery } from '../../lib/useQuery';
import { useClientId } from '../../state/session';
import { useTopPad } from '../../theme/layout';
import { color, space } from '../../theme/tokens';
import { font, text, tracking } from '../../theme/type';

/**
 * Book a consultation — the free 30-minute slot the firm offers.
 *
 * The days and times come from `consultation_slots`, which subtracts anything
 * already in the firm's diary, so a client is never offered a time that has
 * gone. The confirm button stays a quiet outline until both a day and a time
 * are chosen.
 */
export default function BookScreen() {
  const router = useRouter();
  const topPad = useTopPad(64);
  const clientId = useClientId();

  const query = useQuery(useCallback(() => portal.loadSlots(), []), []);

  const [topic, setTopic] = useState<string>(bookingTopics[0]);
  const [dayKey, setDayKey] = useState<string | null>(null);
  const [slotIso, setSlotIso] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  const slots = query.data ?? [];

  // One entry per bookable day, in order, for the day scroller.
  const days = useMemo(() => {
    const seen = new Map<string, Slot>();
    for (const slot of slots) if (!seen.has(slot.dayKey)) seen.set(slot.dayKey, slot);
    return Array.from(seen.values());
  }, [slots]);

  const timesForDay = useMemo(
    () => (dayKey ? slots.filter((slot) => slot.dayKey === dayKey) : []),
    [slots, dayKey],
  );

  const chosen = slots.find((slot) => slot.iso === slotIso) ?? null;
  const noClient = clientId == null;
  const ready = chosen !== null;

  const confirm = async () => {
    if (!ready || sending || clientId == null) return;
    setSending(true);
    setError('');
    try {
      await portal.requestConsultation({ clientId, topic, startsAt: chosen.iso });
      router.push({
        pathname: '/booked',
        params: { topic, day: chosen.dayLabel, slot: chosen.time },
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not send that request.');
    } finally {
      setSending(false);
    }
  };

  if (noClient) return <NoClientLinked />;

  return (
    <Screen scroll>
      <StatusBarStyle style="dark" />
      <View style={[styles.body, { paddingTop: topPad }]}>
        <Text style={text.screenTitle}>Book a consultation</Text>
        <Text style={styles.sub}>30 minutes, no charge. Larnaca office or video.</Text>

        <GroupLabel style={styles.group}>What is it about</GroupLabel>
        <View style={styles.topics}>
          {bookingTopics.map((option) => {
            const selected = topic === option;
            const ink = selected ? color.bg : color.text;
            return (
              <Button
                key={option}
                variant={selected ? 'primary' : 'secondary'}
                label={option}
                onPress={() => setTopic(option)}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                style={styles.topic}
                labelStyle={styles.topicLabel}
                left={
                  <View
                    style={[
                      styles.indicator,
                      { borderColor: ink, backgroundColor: selected ? ink : 'transparent' },
                    ]}
                  />
                }
              />
            );
          })}
        </View>

        <Async query={query} loadingLabel="Checking what is free…">
          {() =>
            days.length === 0 ? (
              <Empty>
                No free consultation times in the next fortnight. Send us a message and we will
                find one.
              </Empty>
            ) : (
              <>
                <GroupLabel style={styles.group}>Day</GroupLabel>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={styles.dayScroller}
                  contentContainerStyle={styles.dayRow}>
                  {days.map((day) => {
                    const selected = dayKey === day.dayKey;
                    return (
                      <Button
                        key={day.dayKey}
                        variant={selected ? 'primary' : 'secondary'}
                        onPress={() => {
                          setDayKey(day.dayKey);
                          // The chosen time belonged to the old day.
                          setSlotIso(null);
                        }}
                        accessibilityLabel={day.dayLabel}
                        accessibilityState={{ selected }}
                        style={styles.day}>
                        <Text style={[styles.dayName, { color: selected ? color.bg : color.text }]}>
                          {day.dow}
                        </Text>
                        <Text
                          style={[styles.dayNumber, { color: selected ? color.bg : color.text }]}>
                          {day.dayNumber}
                        </Text>
                      </Button>
                    );
                  })}
                </ScrollView>

                <GroupLabel style={styles.group}>Time</GroupLabel>
                {dayKey ? (
                  <View style={styles.slots}>
                    {timesForDay.map((slot) => (
                      <Button
                        key={slot.iso}
                        variant={slotIso === slot.iso ? 'primary' : 'secondary'}
                        label={slot.time}
                        onPress={() => setSlotIso(slot.iso)}
                        accessibilityState={{ selected: slotIso === slot.iso }}
                        style={styles.slot}
                        labelStyle={styles.slotLabel}
                      />
                    ))}
                  </View>
                ) : (
                  <Text style={styles.hint}>Pick a day to see the times.</Text>
                )}
              </>
            )
          }
        </Async>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Button
          variant={ready ? 'primary' : 'secondary'}
          label={sending ? 'Sending…' : ready ? 'Request this time' : 'Pick a day and time'}
          uppercase
          disabled={sending}
          onPress={confirm}
          style={styles.confirm}
          labelStyle={styles.confirmLabel}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: {
    paddingHorizontal: space.screenX,
    paddingBottom: 30,
  },
  sub: {
    fontFamily: font.body,
    fontSize: 12.5,
    lineHeight: 17,
    color: color.neutral600,
    marginTop: 6,
  },
  group: {
    marginTop: 26,
  },

  topics: {
    marginTop: 12,
    gap: 10,
  },
  topic: {
    justifyContent: 'flex-start',
    gap: 11,
    paddingVertical: 14,
    paddingHorizontal: 16,
    minHeight: 48,
  },
  topicLabel: {
    flex: 1,
    fontSize: 14.5,
    textAlign: 'left',
  },
  indicator: {
    width: 16,
    height: 16,
    borderWidth: 1.5,
  },

  dayScroller: {
    marginTop: 12,
    flexGrow: 0,
  },
  dayRow: {
    gap: 7,
    paddingBottom: 2,
  },
  day: {
    width: 58,
    flexDirection: 'column',
    gap: 0,
    paddingTop: 10,
    paddingBottom: 12,
    paddingHorizontal: 0,
    minHeight: 62,
  },
  dayName: {
    fontFamily: font.body,
    fontSize: 10,
    lineHeight: 13,
    letterSpacing: tracking(10, 0.12),
    textTransform: 'uppercase',
    opacity: 0.7,
  },
  dayNumber: {
    fontFamily: font.head,
    fontSize: 22,
    lineHeight: 24.2,
  },

  slots: {
    marginTop: 12,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
  },
  slot: {
    // Three to a row: a fourth would need 120% of the width.
    flexGrow: 1,
    flexBasis: 0,
    minWidth: '30%',
    minHeight: 46,
  },
  slotLabel: {
    fontSize: 14,
  },
  hint: {
    fontFamily: font.body,
    fontSize: 12.5,
    lineHeight: 17,
    color: color.neutral600,
    marginTop: 12,
  },

  error: {
    fontFamily: font.body,
    fontSize: 12.5,
    lineHeight: 17,
    color: color.accent700,
    marginTop: 16,
  },
  confirm: {
    marginTop: space.section,
    paddingVertical: 16,
    minHeight: 52,
  },
  confirmLabel: {
    fontSize: 15,
  },
});
