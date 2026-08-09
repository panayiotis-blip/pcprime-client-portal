import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { BlueprintPressable } from '../../../components/Blueprint';
import { InitialsTile } from '../../../components/InitialsTile';
import { Input } from '../../../components/Input';
import { Screen } from '../../../components/Screen';
import { StatusBarStyle } from '../../../components/StatusBarStyle';
import { Tag } from '../../../components/Tag';
import { clients } from '../../../data/staff';
import { useTopPad } from '../../../theme/layout';
import { color, space } from '../../../theme/tokens';
import { font, text } from '../../../theme/type';

/** Clients — the book, searchable by name and entity type. */
export default function ClientsScreen() {
  const router = useRouter();
  const topPad = useTopPad(64);
  const [query, setQuery] = useState('');

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return clients;
    return clients.filter(
      (client) =>
        client.name.toLowerCase().includes(needle) ||
        client.type.toLowerCase().includes(needle),
    );
  }, [query]);

  return (
    <Screen scroll>
      <StatusBarStyle style="dark" />
      <View style={[styles.body, { paddingTop: topPad }]}>
        <Text style={text.screenTitle}>Clients</Text>

        <Input
          value={query}
          onChangeText={setQuery}
          placeholder="Search clients"
          autoCorrect={false}
          autoCapitalize="none"
          clearButtonMode="while-editing"
          style={styles.search}
        />

        <View style={styles.list}>
          {visible.map((client) => (
            <BlueprintPressable
              key={client.id}
              style={styles.row}
              accessibilityLabel={`${client.name}, ${client.type}`}
              onPress={() => router.push(`/staff/clients/${client.id}`)}>
              <InitialsTile initials={client.initials} />
              <View style={styles.rowText}>
                <Text style={styles.name} numberOfLines={1}>
                  {client.name}
                </Text>
                <Text style={styles.type} numberOfLines={1}>
                  {client.type}
                </Text>
              </View>
              <Tag label={client.status.label} tone={client.status.tone} />
            </BlueprintPressable>
          ))}
        </View>

        {visible.length === 0 ? (
          <Text style={styles.empty}>No clients match &ldquo;{query}&rdquo;</Text>
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: {
    paddingHorizontal: space.screenX,
    paddingBottom: 30,
  },
  search: {
    marginTop: 16,
    paddingVertical: 13,
    paddingHorizontal: 15,
    fontSize: 15,
    minHeight: 46,
  },
  list: {
    marginTop: 16,
    gap: space.cardGap,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
  },
  name: {
    fontFamily: font.semibold,
    fontSize: 14.5,
    lineHeight: 19,
    color: color.text,
  },
  type: {
    fontFamily: font.body,
    fontSize: 12.5,
    lineHeight: 17,
    color: color.neutral600,
    marginTop: 2,
  },
  empty: {
    fontFamily: font.body,
    fontSize: 14,
    lineHeight: 20,
    color: color.neutral600,
    textAlign: 'center',
    paddingVertical: 40,
  },
});
