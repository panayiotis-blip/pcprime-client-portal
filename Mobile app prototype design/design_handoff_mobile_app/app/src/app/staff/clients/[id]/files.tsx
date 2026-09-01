import { useLocalSearchParams } from 'expo-router';
import { useCallback } from 'react';

import * as portal from '../../../../api/portal';
import { DocumentsView } from '../../../../features/documents/DocumentsView';
import { useQuery } from '../../../../lib/useQuery';

/**
 * A client's files, seen from the staff side.
 *
 * Not a designed screen — the prototype's "their files" button reused the
 * client's own Documents screen. It gets the same list without the upload
 * sheet or the portal hand-off, since both of those belong to the client.
 */
export default function ClientFilesScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const clientId = Number(id);

  const profile = useQuery(
    useCallback(() => portal.loadProfile(clientId), [clientId]),
    [clientId],
  );

  return <DocumentsView clientId={clientId} subtitle={profile.data?.name ?? ''} />;
}
