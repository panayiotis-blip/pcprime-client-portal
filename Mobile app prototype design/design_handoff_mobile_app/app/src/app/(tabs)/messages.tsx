import { useCallback } from 'react';

import * as portal from '../../api/portal';
import { NoClientLinked } from '../../components/Async';
import { MessagesView } from '../../features/messages/MessagesView';
import { useQuery } from '../../lib/useQuery';
import { useClientId } from '../../state/session';

/** Messages — a direct line to the assigned accountant. */
export default function MessagesScreen() {
  const clientId = useClientId();

  const manager = useQuery(
    useCallback(
      () => (clientId == null ? Promise.resolve(null) : portal.loadAccountManager(clientId)),
      [clientId],
    ),
    [clientId],
  );

  if (clientId == null) return <NoClientLinked />;

  return (
    <MessagesView
      clientId={clientId}
      viewerIsStaff={false}
      title={manager.data?.name ?? 'Prime & Calculate'}
      subtitle={manager.data?.status ?? ''}
      placeholder="Message your accountant"
    />
  );
}
