import { Redirect, useLocalSearchParams } from 'expo-router';

import { findClient } from '../../../../api/portal';
import { DocumentsView } from '../../../../features/documents/DocumentsView';

/**
 * A client's files, seen from the staff side.
 *
 * Not a designed screen — the prototype's "their files" button reused the
 * client's own Documents screen. It gets the same list without the upload
 * sheet or the portal hand-off, since both of those belong to the client.
 */
export default function ClientFilesScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const client = findClient(id);

  if (!client) return <Redirect href="/staff/clients" />;

  return <DocumentsView subtitle={client.name} />;
}
