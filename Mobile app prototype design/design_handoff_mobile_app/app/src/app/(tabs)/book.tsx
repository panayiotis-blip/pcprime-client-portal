import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '../../components/Button';
import { GroupLabel } from '../../components/Section';
import { Screen } from '../../components/Screen';
import { StatusBarStyle } from '../../components/StatusBarStyle';
import { bookingSlots, bookingTopics } from '../../data/mock';
import { nextWeekdays } from '../../lib/dates';
import { useTopPad } from '../../theme/layout';
import { color, space } from '../../theme/tokens';
import { font, text, tracking } from '../../theme/type';

/**
 * Book a consultation — the free 30-minute slot the firm offers.
 *
 * The confirm button stays a quiet outline, reading "PICK A DAY AND TIME",
 * until both a day and a time are chosen; only then does it become the solid
 * gold primary. Tapping it before that does nothing.
 */
export default function BookScreen() {
  const router = useRouter();
  const topPad = useTopPad(64);

  const days = useMemo(() => nextWeekdays(new Date()), []);
  const [topic, setTopic] = useState<string>(bookingTopics[0]);
  const [day, setDay] = useState<string | null>(null);
  const [slot, setSlot] = useState<string | null>(null);

  const ready = day !== null && slot !== null;

  const confirm = () => {
    if (!ready) return;
    const chosen = days.find((candidate) => candidate.key === day);
    router.push({
      pathname: '/booked',
      params: { topic, day: chosen?.label ?? '', slot },
    });
  };

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

        <GroupLabel style={styles.group}>Day</GroupLabel>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.dayScroller}
          contentContainerStyle={styles.dayRow}>
          {days.map((candidate) => {
            const selected = day === candidate.key;
            return (
              <Button
                key={candidate.key}
                variant={selected ? 'primary' : 'secondary'}
                onPress={() => setDay(candidate.key)}
                accessibilityLabel={candidate.label}
                accessibilityState={{ selected }}
                style={styles.day}>
                <Text style={[styles.dayName, { color: selected ? color.bg : color.text }]}>
                  {candidate.dow}
                </Text>
                <Text style={[styles.dayNumber, { color: selected ? color.bg : color.text }]}>
                  {candidate.num}
                </Text>
              </Button>
            );
          })}
        </ScrollView>

        <GroupLabel style={styles.group}>Time</GroupLabel>
        <View style={styles.slots}>
          {bookingSlots.map((option) => (
            <Button
              key={option}
              variant={slot === option ? 'primary' : 'secondary'}
              label={option}
              onPress={() => setSlot(option)}
              accessibilityState={{ selected: slot === option }}
              style={styles.slot}
              labelStyle={styles.slotLabel}
            />
          ))}
        </View>

        <Button
          variant={ready ? 'primary' : 'secondary'}
          label={ready ? 'Confirm booking' : 'Pick a day and time'}
          uppercase
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

  confirm: {
    marginTop: space.section,
    paddingVertical: 16,
    minHeight: 52,
  },
  confirmLabel: {
    fontSize: 15,
  },
});
