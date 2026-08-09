import { accountant } from '../../data/mock';
import { MessagesView } from '../../features/messages/MessagesView';

/** Messages — a direct line to the assigned accountant. */
export default function MessagesScreen() {
  return (
    <MessagesView
      title={accountant.name}
      subtitle={accountant.status}
      placeholder="Message your accountant"
    />
  );
}
