import { useLocalSearchParams } from 'expo-router';
import { useCallback } from 'react';

import * as portal from '../../api/portal';
import { Empty } from '../../components/Async';
import { Screen } from '../../components/Screen';
import { MessagesView } from '../../features/messages/MessagesView';
import { useQuery } from '../../lib/useQuery';

/**
 * Messages — the accountant's side of the same thread.
 *
 * A `client` param arrives from a client's detail screen or a "nudge". With
 * no param there is no thread to open: the tab asks which client first, rather
 * than guessing.
 */
export default function StaffMessagesScreen() {
  const { client } = useLocalSearchParams<{ client?: string }>();
  const clientId = client ? Number(client) : null;

  const profile = useQuery(
    useCallback(
      () => (clientId == null ? Promise.resolve(null) : portal.loadProfile(clientId)),
      [clientId],
    ),
    [clientId],
  );

  if (clientId == null) {
    return (
      <Screen>
        <Empty>Open a client and choose Message to write to them.</Empty>
      </Screen>
    );
  }

  return (
    <MessagesView
      clientId={clientId}
      viewerIsStaff
      title={profile.data?.name ?? 'Client'}
      subtitle={profile.data?.taxLabel ?? ''}
      placeholder="Message your client"
    />
  );
}
