import { useLocalSearchParams } from 'expo-router';

import { findClient } from '../../api/portal';
import { defaultThreadClientId } from '../../data/staff';
import { MessagesView } from '../../features/messages/MessagesView';

/**
 * Messages — the accountant's side of the same thread.
 *
 * A `client` param arrives when you get here from a client's detail screen or
 * a "nudge"; the tab itself opens the default thread.
 */
export default function StaffMessagesScreen() {
  const { client: clientId } = useLocalSearchParams<{ client?: string }>();
  const client = findClient(clientId) ?? findClient(defaultThreadClientId);

  return (
    <MessagesView
      title={client?.name ?? 'Messages'}
      subtitle={client?.since ?? ''}
      placeholder="Message your client"
    />
  );
}
