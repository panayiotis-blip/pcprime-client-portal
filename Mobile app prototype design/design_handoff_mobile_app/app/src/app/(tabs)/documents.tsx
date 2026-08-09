import { useRouter } from 'expo-router';

import { profile } from '../../data/mock';
import { DocumentsView } from '../../features/documents/DocumentsView';

/**
 * Documents — what has been sent to the accountant, and how to add more.
 */
export default function DocumentsScreen() {
  const router = useRouter();

  return (
    <DocumentsView
      subtitle={profile.company}
      canUpload
      onOpenPortal={() => router.push('/portal')}
    />
  );
}
