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
    label: 'Management Dashboard',
    icon: '📊',
    asset: '/mgmt-app/',
    description: 'Financials, P&L, divisions, payroll, rentals, operations and decision insights.',
    restricted: true, // Greson Easy Loo only
    source: 'builtin',
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
