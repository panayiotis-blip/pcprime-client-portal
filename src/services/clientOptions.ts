import type { SearchOption } from '../components/common/SearchableSelect';

// Shared mapping: client rows -> SearchableSelect options, so every client
// picker in the app searches and displays identically. Search matches on the
// client name (label) or the client code (sublabel). Change the format here
// once and every picker follows.
export function toClientOptions(clients: any[]): SearchOption[] {
  return (clients || []).map(c => ({
    value: c.id,
    label: c.client_name || c.name || '',
    sublabel: c.client_code || undefined,
  }));
}
