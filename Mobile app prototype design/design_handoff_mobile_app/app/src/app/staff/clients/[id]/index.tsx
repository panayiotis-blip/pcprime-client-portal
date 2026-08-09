import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { Blueprint } from '../../../../components/Blueprint';
import { Button } from '../../../../components/Button';
import { GroupLabel } from '../../../../components/Section';
import { Screen } from '../../../../components/Screen';
import { StatusBarStyle } from '../../../../components/StatusBarStyle';
import { Tag } from '../../../../components/Tag';
import { findClient } from '../../../../api/portal';
import { useTopPad } from '../../../../theme/layout';
import { HAIRLINE, color, space } from '../../../../theme/tokens';
import { font, text } from '../../../../theme/type';

/** Client detail — open items and what is unbilled. */
export default function ClientDetailScreen() {
  const router = useRouter();
  const topPad = useTopPad(60);
  const { id } = useLocalSearchParams<{ id: string }>();
  const client = findClient(id);

  if (!client) return <Redirect href="/staff/clients" />;

  return (
    <Screen scroll>
      <StatusBarStyle style="light" />

      <View style={[styles.header, { paddingTop: topPad }]}>
        <Button
          variant="ghost"
          label="← Clients"
          onPress={() => router.back()}
          style={styles.back}
          labelStyle={styles.backLabel}
        />
        <Text style={styles.name}>{client.name}</Text>
        <Text style={styles.meta}>
          {client.type} · {client.vat}
        </Text>
      </View>

      <View style={styles.body}>
        <View style={styles.actions}>
          <Button
            variant="primary"
            label="Message"
            uppercase
            onPress={() =>
              router.navigate({ pathname: '/staff/messages', params: { client: client.id } })
            }
            style={styles.action}
            labelStyle={styles.actionLabel}
          />
          <Button
            variant="secondary"
            label="Their files"
            uppercase
            onPress={() => router.push(`/staff/clients/${client.id}/files`)}
            style={styles.action}
            labelStyle={styles.actionLabel}
          />
        </View>

        <GroupLabel style={styles.group}>Open items</GroupLabel>
        <Blueprint style={styles.list}>
          {client.items.map((item, index) => (
            <View
              key={item.id}
              style={[styles.itemRow, index < client.items.length - 1 && styles.divided]}>
              <View style={styles.itemText}>
                <Text style={text.rowTitle}>{item.title}</Text>
                <Text style={styles.itemSub}>{item.sub}</Text>
              </View>
              <Tag label={item.status.label} tone={item.status.tone} />
            </View>
          ))}
        </Blueprint>

        <GroupLabel style={styles.group}>Fees</GroupLabel>
        <Blueprint style={styles.fees}>
          <View style={styles.feesText}>
            <Text style={styles.feeAmount}>{client.fee}</Text>
            <Text style={styles.feeNote}>{client.feeNote}</Text>
          </View>
          <Button
            variant="secondary"
            label="Invoice"
            uppercase
            // No action in the design — the billing flow is not specified yet.
            onPress={() => {}}
            labelStyle={styles.invoiceLabel}
          />
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
  back: {
    alignSelf: 'flex-start',
    paddingLeft: 0,
  },
  backLabel: {
    fontSize: 13,
    color: color.accent300,
  },
  name: {
    fontFamily: font.head,
    fontSize: 30,
    lineHeight: 31.5,
    textTransform: 'uppercase',
    color: color.bg,
    marginTop: 12,
  },
  meta: {
    fontFamily: font.body,
    fontSize: 12.5,
    lineHeight: 17,
    color: color.accent400,
    marginTop: 6,
  },

  body: {
    paddingHorizontal: space.screenX,
    paddingTop: 20,
    paddingBottom: 30,
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
  },
  action: {
    flex: 1,
    paddingVertical: 13,
    minHeight: 46,
  },
  actionLabel: {
    fontSize: 13,
  },

  group: {
    marginTop: 26,
  },
  list: {
    marginTop: 12,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 15,
    paddingHorizontal: 16,
  },
  divided: {
    borderBottomWidth: HAIRLINE,
    borderBottomColor: color.divider,
  },
  itemText: {
    flex: 1,
  },
  itemSub: {
    fontFamily: font.body,
    fontSize: 12.5,
    lineHeight: 17,
    color: color.neutral600,
    marginTop: 2,
  },

  fees: {
    marginTop: 12,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  feesText: {
    flex: 1,
  },
  feeAmount: {
    fontFamily: font.head,
    fontSize: 30,
    lineHeight: 30,
    color: color.text,
  },
  feeNote: {
    fontFamily: font.body,
    fontSize: 12.5,
    lineHeight: 17,
    color: color.neutral600,
    marginTop: 4,
  },
  invoiceLabel: {
    fontSize: 12,
  },
});
