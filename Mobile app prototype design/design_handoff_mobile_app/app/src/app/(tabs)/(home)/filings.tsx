import { useCallback } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import * as portal from '../../../api/portal';
import { Async, Empty, NoClientLinked } from '../../../components/Async';
import { Blueprint } from '../../../components/Blueprint';
import { ProgressBar } from '../../../components/Section';
import { Screen } from '../../../components/Screen';
import { StatusBarStyle } from '../../../components/StatusBarStyle';
import { Tag } from '../../../components/Tag';
import { FilingProgress } from '../../../data/types';
import { useQuery } from '../../../lib/useQuery';
import { useClientId } from '../../../state/session';
import { useTopPad } from '../../../theme/layout';
import { color, space } from '../../../theme/tokens';
import { font, text } from '../../../theme/type';

/**
 * Filings — the full compliance year at a glance.
 *
 * The bar under each card carries the same rule as the tags: gold for live
 * work, deep gold for done, neutral for anything dormant.
 */
const BAR_FILL: Record<FilingProgress, string> = {
  filed: color.accent700,
  'in-progress': color.accent,
  idle: color.neutral400,
};

export default function FilingsScreen() {
  const topPad = useTopPad(64);
  const clientId = useClientId();

  const query = useQuery(
    useCallback(
      () => (clientId == null ? Promise.resolve([]) : portal.loadFilings(clientId)),
      [clientId],
    ),
    [clientId],
  );

  if (clientId == null) return <NoClientLinked />;

  return (
    <Screen scroll>
      <StatusBarStyle style="dark" />
      <View style={[styles.body, { paddingTop: topPad }]}>
        <Text style={text.screenTitle}>Filings</Text>
        <Text style={styles.sub}>Everything we file on your behalf this year.</Text>

        <Async query={query} loadingLabel="Fetching your filings…">
          {(filings) =>
            filings.length ? (
              <View style={styles.list}>
                {filings.map((filing) => (
                  <Blueprint key={filing.id} style={styles.card}>
                    <View style={styles.cardHead}>
                      <View style={styles.cardText}>
                        <Text style={text.cardTitle}>{filing.title}</Text>
                        <Text style={styles.due}>{filing.due}</Text>
                      </View>
                      <Tag label={filing.status.label} tone={filing.status.tone} />
                    </View>
                    <View style={styles.bar}>
                      <ProgressBar percent={filing.percent} fill={BAR_FILL[filing.progress]} />
                    </View>
                  </Blueprint>
                ))}
              </View>
            ) : (
              <Empty>Nothing on your compliance calendar yet.</Empty>
            )
          }
        </Async>
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
  list: {
    marginTop: 24,
    gap: 14,
  },
  card: {
    paddingVertical: 15,
    paddingHorizontal: 16,
  },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  cardText: {
    flex: 1,
  },
  due: {
    fontFamily: font.body,
    fontSize: 12.5,
    lineHeight: 17,
    color: color.neutral600,
    marginTop: 3,
  },
  bar: {
    marginTop: 13,
  },
});
