import { useRouter } from 'expo-router';
import { useCallback } from 'react';

import * as portal from '../../api/portal';
import { NoClientLinked } from '../../components/Async';
import { DocumentsView } from '../../features/documents/DocumentsView';
import { useQuery } from '../../lib/useQuery';
import { useClientId } from '../../state/session';

/**
 * Documents — what has been sent to the accountant, and how to add more.
 */
export default function DocumentsScreen() {
  const router = useRouter();
  const clientId = useClientId();

  // Only for the subtitle; the list does not wait on it.
  const profile = useQuery(
    useCallback(
      () => (clientId == null ? Promise.resolve(null) : portal.loadProfile(clientId)),
      [clientId],
    ),
    [clientId],
  );

  if (clientId == null) return <NoClientLinked />;

  return (
    <DocumentsView
      clientId={clientId}
      subtitle={profile.data?.name ?? ''}
      canUpload
      onOpenPortal={() => router.push('/portal')}
    />
  );
}
