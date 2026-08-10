import { useRouter } from 'expo-router';
import { Check } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import * as portal from '../../api/portal';
import { Async, Empty } from '../../components/Async';
import { Blueprint, BlueprintPressable } from '../../components/Blueprint';
import { Button } from '../../components/Button';
import { InitialsTile } from '../../components/InitialsTile';
import { Screen } from '../../components/Screen';
import { SectionHeader } from '../../components/Section';
import { StatusBarStyle } from '../../components/StatusBarStyle';
import { useToast } from '../../components/Toast';
import { formatLongDate } from '../../lib/dates';
import { useQuery } from '../../lib/useQuery';
import { useSession } from '../../state/session';
import { useTopPad } from '../../theme/layout';
import { HAIRLINE, color, space, tint } from '../../theme/tokens';
import { font, tracking } from '../../theme/type';

/**
 * Today — an accountant's morning triage.
 *
 * The header count is recomputed from the unchecked tasks, so ticking one off
 * is visible at the top of the screen straight away. The tick writes through
 * to `staff_tasks` immediately; the row is updated locally first so the list
 * does not lag behind the finger.
 */
export default function TodayScreen() {
  const router = useRouter();
  const topPad = useTopPad(64);
  const toast = useToast();
  const { account } = useSession();
  const userId = account?.id ?? '';

  const query = useQuery(
    useCallback(
      async () => ({
        tasks: await portal.loadStaffTasks(userId),
        summary: await portal.loadTodaySummary(),
      }),
      [userId],
    ),
    [userId],
  );

  // Ticks applied since the last load, so the UI stays ahead of the round trip.
  const [pending, setPending] = useState<Record<string, boolean>>({});

  const toggle = async (id: string, next: boolean) => {
    setPending((current) => ({ ...current, [id]: next }));
    try {
      await portal.setTaskDone(id, next);
    } catch (caught) {
      setPending((current) => {
        const { [id]: _dropped, ...rest } = current;
        return rest;
      });
      toast.show(caught instanceof Error ? caught.message : 'Could not update that task.');
    }
  };

  return (
    <Screen scroll>
      <StatusBarStyle style="light" />

      <Async query={query} loadingLabel="Pulling together your morning…">
        {({ tasks, summary }) => {
          const resolved = tasks.map((task) => ({
            ...task,
            done: pending[task.id] ?? task.done,
          }));
          const open = resolved.filter((task) => !task.done).length;

          return (
            <>
              <View style={[styles.header, { paddingTop: topPad }]}>
                <Text style={styles.eyebrow}>Staff · {formatLongDate(new Date())}</Text>
                <Text style={styles.title}>
                  {open} {open === 1 ? 'task' : 'tasks'} open
                </Text>

                <View style={styles.stats}>
                  {summary.stats.map((stat) => (
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
                {resolved.length ? (
                  <View style={styles.taskList}>
                    {resolved.map((task) => (
                      <BlueprintPressable
                        key={task.id}
                        style={styles.taskCard}
                        onPress={() => toggle(task.id, !task.done)}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: task.done }}>
                        <View style={[styles.checkbox, task.done && styles.checkboxDone]}>
                          {task.done ? <Check size={14} strokeWidth={2} color={color.bg} /> : null}
                        </View>
                        <View style={styles.taskText}>
                          <Text style={[styles.taskTitle, task.done && styles.taskTitleDone]}>
                            {task.title}
                          </Text>
                          {task.sub ? <Text style={styles.taskSub}>{task.sub}</Text> : null}
                        </View>
                      </BlueprintPressable>
                    ))}
                  </View>
                ) : (
                  <Empty>Nothing assigned to you. Enjoy it.</Empty>
                )}
              </View>

              <View style={styles.lastSection}>
                <SectionHeader title="Needs chasing" />
                {summary.chasing.length ? (
                  <Blueprint style={styles.chaseList}>
                    {summary.chasing.map((target, index) => (
                      <View
                        key={target.id}
                        style={[
                          styles.chaseRow,
                          index < summary.chasing.length - 1 && styles.divided,
                        ]}>
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
                ) : (
                  <Empty>Nothing overdue anywhere. Rare and good.</Empty>
                )}
              </View>
            </>
          );
        }}
      </Async>
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
