// Registry of embeddable per-client apps. Add a new app by:
//   1. dropping its CSP-clean static build under public/<folder>/
//      (external scripts only, no inline handlers — see rental-app),
//   2. adding an entry here,
//   3. enabling it for a client (Apps tab in the client file).
// Data for each (client, app) lives in public.client_app_data (migration 161).

export type ClientAppDef = {
  key: string;      // stable id, stored in client_apps.app_key
  label: string;
  icon: string;     // emoji for nav/tab
  asset: string;    // path to the app's static index.html folder (served from public/)
  description?: string;
  // Restricted apps are built for one specific client and are NOT offered in
  // the "add an app" picker — assign them via migration/SQL. They still show
  // (and open) on clients they're already assigned to.
  restricted?: boolean;
};

export const CLIENT_APPS: ClientAppDef[] = [
  {
    key: 'rentals',
    label: 'Property Rentals',
    icon: '🏠',
    asset: '/rental-app/',
    description: 'Tenants & contracts, rent schedule, receipts, arrears, deposits and statements.',
    restricted: true, // Greson Easy Loo only
  },
];

export const getClientApp = (key: string): ClientAppDef | null =>
  CLIENT_APPS.find(a => a.key === key) || null;
