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
let loadPromise: Promise<void> | null = null;

// Fetch active app_templates once (cached). Call before relying on getClientApp
// for uploaded apps; safe to call from many places (returns the shared promise).
export async function loadAppTemplates(force = false): Promise<void> {
  if (loadPromise && !force) return loadPromise;
  loadPromise = (async () => {
    const { data, error } = await supabase.from('app_templates')
      .select('key, name, icon, description, restricted, active').eq('active', true);
    if (error) { templateApps = []; return; }
    templateApps = (data || []).map((r: any) => ({
      key: r.key, label: r.name, icon: r.icon || '📦',
      description: r.description || undefined, restricted: !!r.restricted, source: 'template' as const,
    }));
  })();
  return loadPromise;
}

// Built-in apps take precedence on a key collision (protects Greson's apps).
export function allClientApps(): ClientAppDef[] {
  const builtinKeys = new Set(CLIENT_APPS.map(a => a.key));
  return [...CLIENT_APPS, ...templateApps.filter(t => !builtinKeys.has(t.key))];
}

export const getClientApp = (key: string): ClientAppDef | null =>
  allClientApps().find(a => a.key === key) || null;
