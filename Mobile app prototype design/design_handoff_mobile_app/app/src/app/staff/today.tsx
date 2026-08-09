import { useRouter } from 'expo-router';
import { Check } from 'lucide-react-native';
import { StyleSheet, Text, View } from 'react-native';

import { Blueprint, BlueprintPressable } from '../../components/Blueprint';
import { Button } from '../../components/Button';
import { InitialsTile } from '../../components/InitialsTile';
import { Screen } from '../../components/Screen';
import { SectionHeader } from '../../components/Section';
import { StatusBarStyle } from '../../components/StatusBarStyle';
import { chasing, staffStats } from '../../data/staff';
import { formatLongDate } from '../../lib/dates';
import { useTasks } from '../../state/tasks';
import { useTopPad } from '../../theme/layout';
import { HAIRLINE, color, space, tint } from '../../theme/tokens';
import { font, tracking } from '../../theme/type';

/**
 * Today — an accountant's morning triage.
 *
 * The header count is recomputed from the unchecked tasks, so ticking one off
 * is visible at the top of the screen straight away.
 */
export default function TodayScreen() {
  const router = useRouter();
  const topPad = useTopPad(64);
  const { tasks, openCount, toggle } = useTasks();

  return (
    <Screen scroll>
      <StatusBarStyle style="light" />

      <View style={[styles.header, { paddingTop: topPad }]}>
        <Text style={styles.eyebrow}>Staff · {formatLongDate(new Date())}</Text>
        <Text style={styles.title}>
          {openCount} {openCount === 1 ? 'task' : 'tasks'} open
        </Text>

        <View style={styles.stats}>
          {staffStats.map((stat) => (
            <Blueprint
              key={stat.label}
              style={styles.stat}
              borderColor={color.accent600}
              ink={tint.markPaper}>
              <Text style={styles.statValue}>{stat.value}</Text>
              <Text style={styles.statLabel}>{stat.label}</Text>
            </Blueprint>
          ))}
        </View>
      </View>

      <View style={styles.section}>
        <SectionHeader title="Today's tasks" />
        <View style={styles.taskList}>
          {tasks.map((task) => (
            <BlueprintPressable
              key={task.id}
              style={styles.taskCard}
              onPress={() => toggle(task.id)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: task.done }}>
              <View style={[styles.checkbox, task.done && styles.checkboxDone]}>
                {task.done ? <Check size={14} strokeWidth={2} color={color.bg} /> : null}
              </View>
              <View style={styles.taskText}>
                <Text style={[styles.taskTitle, task.done && styles.taskTitleDone]}>
                  {task.title}
                </Text>
                <Text style={styles.taskSub}>{task.sub}</Text>
              </View>
            </BlueprintPressable>
          ))}
        </View>
      </View>

      <View style={styles.lastSection}>
        <SectionHeader title="Needs chasing" />
        <Blueprint style={styles.chaseList}>
          {chasing.map((target, index) => (
            <View
              key={target.id}
              style={[styles.chaseRow, index < chasing.length - 1 && styles.divided]}>
              <InitialsTile initials={target.initials} />
              <View style={styles.chaseText}>
                <Text style={styles.chaseName}>{target.name}</Text>
                <Text style={styles.chaseNeed}>{target.need}</Text>
              </View>
              <Button
                variant="secondary"
                label="Nudge"
                uppercase
                onPress={() =>
                  router.navigate({
                    pathname: '/staff/messages',
                    params: { client: target.clientId },
                  })
                }
                labelStyle={styles.nudgeLabel}
              />
            </View>
          ))}
        </Blueprint>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    backgroundColor: color.accent900,
    paddingHorizontal: space.screenX,
    paddingBottom: 24,
  },
  eyebrow: {
    fontFamily: font.body,
    fontSize: 10.5,
    lineHeight: 14,
    letterSpacing: tracking(10.5, 0.13),
    textTransform: 'uppercase',
    color: color.accent300,
  },
  title: {
    fontFamily: font.head,
    fontSize: 32,
    lineHeight: 33.6,
    textTransform: 'uppercase',
    color: color.bg,
    marginTop: 7,
  },
  stats: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 20,
  },
  stat: {
    flex: 1,
    padding: 13,
  },
  statValue: {
    fontFamily: font.head,
    fontSize: 28,
    lineHeight: 28,
    color: color.accent300,
  },
  statLabel: {
    fontFamily: font.body,
    fontSize: 11.5,
    lineHeight: 15,
    color: color.accent400,
    marginTop: 4,
  },

  section: {
    paddingHorizontal: space.screenX,
    paddingTop: 24,
  },
  lastSection: {
    paddingHorizontal: space.screenX,
    paddingTop: 26,
    paddingBottom: 30,
  },
  taskList: {
    marginTop: 14,
    gap: space.cardGap,
  },
  taskCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  checkbox: {
    width: 20,
    height: 20,
    marginTop: 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: color.divider,
  },
  checkboxDone: {
    backgroundColor: color.accent,
    borderColor: color.accent,
  },
  taskText: {
    flex: 1,
  },
  taskTitle: {
    fontFamily: font.semibold,
    fontSize: 14.5,
    lineHeight: 19,
    color: color.text,
  },
  taskTitleDone: {
    color: color.neutral500,
    textDecorationLine: 'line-through',
  },
  taskSub: {
    fontFamily: font.body,
    fontSize: 12.5,
    lineHeight: 17,
    color: color.neutral600,
    marginTop: 3,
  },

  chaseList: {
    marginTop: 14,
  },
  chaseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 13,
    paddingHorizontal: 16,
  },
  divided: {
    borderBottomWidth: HAIRLINE,
    borderBottomColor: color.divider,
  },
  chaseText: {
    flex: 1,
  },
  chaseName: {
    fontFamily: font.semibold,
    fontSize: 14.5,
    lineHeight: 19,
    color: color.text,
  },
  chaseNeed: {
    fontFamily: font.body,
    fontSize: 12.5,
    lineHeight: 17,
    color: color.neutral600,
    marginTop: 2,
  },
  nudgeLabel: {
    fontSize: 12,
  },
});
