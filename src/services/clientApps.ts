import { supabase } from '../lib/supabase';

// Registry of embeddable per-client apps. Two sources:
//  - BUILT-IN apps (below): shipped in code, a CSP-clean static build under
//    public/<folder>/, rendered via iframe srcdoc.
//  - UPLOADED TEMPLATES (app_templates, migration 167): self-contained HTML
//    uploaded from the portal, rendered in an isolated blob frame. Loaded at
//    runtime via loadAppTemplates() and merged in here.
// Data for each (client, app) lives in public.client_app_data (migration 161),
// keyed per client_id + app_key — so the same template on two clients keeps
// separate data.

export type ClientAppDef = {
  key: string;      // stable id, stored in client_apps.app_key
  label: string;
  icon: string;     // emoji for nav/tab
  asset?: string;   // built-in only: path to the static index.html folder (public/)
  description?: string;
  restricted?: boolean; // not offered in the generic "add an app" picker
  source?: 'builtin' | 'template';
  // Rendered as a React view inside the portal instead of an iframe. Framed
  // apps only see what the bridge hands them; a component app runs as portal
  // code, so it can query the client's real data under the caller's RLS.
  component?: boolean;
  // Firm-only: never offered to a client or an app-grant user, whatever the
  // allocation says. For internal views over a client's numbers.
  staffOnly?: boolean;
  // What can be configured per client (migration 187). Declared here rather
  // than discovered from the app, because the configuration screen has to be
  // usable without opening the app first. An app with no entry gets the
  // generic options (title) and nothing else — which is the honest answer for
  // an uploaded template whose internals we cannot know.
  config?: {
    tabs?: { key: string; label: string }[];   // screens that can be hidden
    vat?: boolean;                              // offers the VAT block
  };
};

export const CLIENT_APPS: ClientAppDef[] = [
  {
    key: 'rentals',
    label: 'Property Rentals',
    icon: '🏠',
    asset: '/rental-app/',
    description: 'Tenants & contracts, rent schedule, receipts, arrears, deposits and statements.',
    source: 'builtin',
    // Reusable across clients — each client gets their own blank instance
    // (data is isolated per client_id + app_key). Greson keeps its data.
    // Keys mirror TABS() in public/rental-app/app.js. Overview is deliberately
    // absent: it is the landing screen, and hiding it would leave the app with
    // nowhere to open.
    config: {
      tabs: [
        { key: 'properties', label: 'Properties' },
        { key: 'tenants',    label: 'Tenants & Contracts' },
        { key: 'schedule',   label: 'Rent Schedule' },
        { key: 'receipts',   label: 'Receipts' },
        { key: 'arrears',    label: 'Arrears' },
        { key: 'deposits',   label: 'Deposits' },
        { key: 'invoice',    label: 'Invoices' },
      ],
      vat: true,
    },
  },
  {
    key: 'mgmt',
    label: 'Management Dashboard (Greson Easy Loo)',
    icon: '📊',
    asset: '/mgmt-app/',
    // Written around ONE client: Greson's divisions, payroll and operations are
    // baked into it, so it is not a general reporting app and must never be
    // offered to another client. A generic reporting app for everyone is a
    // separate build. restricted keeps it out of the add-an-app picker.
    description: 'Built for Greson Easy Loo only — their financials, P&L, divisions, payroll, rentals and operations.',
    restricted: true,
    source: 'builtin',
  },
  {
    key: 'mgmt-report',
    label: 'Management Report',
    icon: '📈',
    // The general reporting app, for any client — unlike 'mgmt', which is
    // Greson's alone. Runs as portal code so it reads the client's real
    // invoices and expenses rather than figures re-keyed into an app.
    description: 'Profit & loss from the client\'s own invoices and expenses, against the previous period and last year, with your own adjustments.',
    source: 'builtin',
    component: true,
    staffOnly: true,
  },
];

// ---- Uploaded templates (loaded at runtime) ----
let templateApps: ClientAppDef[] = [];
// Keys an admin has switched off. Held separately because a retired built-in
// still exists in CLIENT_APPS and has to be removed from the merged list.
let retired = new Set<string>();
let loadPromise: Promise<void> | null = null;

// Fetch active app_templates once (cached). Call before relying on getClientApp
// for uploaded apps; safe to call from many places (returns the shared promise).
export async function loadAppTemplates(force = false): Promise<void> {
  if (loadPromise && !force) return loadPromise;
  loadPromise = (async () => {
    // Inactive rows are fetched too, not filtered away: a built-in also exists
    // in CLIENT_APPS, so silently dropping its row would leave the hard-coded
    // copy on display and make "active" appear to do nothing for exactly the
    // apps this migration was meant to bring under control.
    const { data, error } = await supabase.from('app_templates')
      .select('key, name, icon, description, restricted, active, builtin_asset');
    if (error) { templateApps = []; retired = new Set(); return; }
    const rows = (data || []) as any[];
    retired = new Set(rows.filter(r => !r.active).map(r => r.key));
    templateApps = rows.filter(r => r.active).map((r: any) => ({
      key: r.key, label: r.name, icon: r.icon || '📦',
      description: r.description || undefined, restricted: !!r.restricted,
      // A row carrying builtin_asset IS one of the built-ins (migration 186) —
      // the row owns its name, icon and flags; the files still ship in the build.
      source: (r.builtin_asset ? 'builtin' : 'template') as 'builtin' | 'template',
      asset: r.builtin_asset || undefined,
    }));
  })();
  return loadPromise;
}

// One list from two sources.
//
// Built-in DEFINITIONS stay in CLIENT_APPS above because they must be available
// synchronously: this is called while rendering, and returning an empty list
// before the fetch resolves would blank the Apps nav for everyone. What the
// database row adds is authority over the editable metadata — name, icon,
// description, restricted — so an admin can change those without a deploy.
//
// Anything only the code can know (asset path, component, staffOnly) is kept
// from the built-in definition and never taken from the row, so a bad row
// cannot turn a staff-only app into a client-facing one.
export function allClientApps(): ClientAppDef[] {
  const rowFor = new Map(templateApps.map(t => [t.key, t]));
  const builtins = CLIENT_APPS.filter(a => !retired.has(a.key)).map(a => {
    const row = rowFor.get(a.key);
    if (!row) return a;
    return {
      ...a,
      label: row.label || a.label,
      icon: row.icon || a.icon,
      description: row.description ?? a.description,
      restricted: row.restricted,
    };
  });
  const builtinKeys = new Set(CLIENT_APPS.map(a => a.key));
  return [...builtins, ...templateApps.filter(t => !builtinKeys.has(t.key))];
}

export const getClientApp = (key: string): ClientAppDef | null =>
  allClientApps().find(a => a.key === key) || null;
