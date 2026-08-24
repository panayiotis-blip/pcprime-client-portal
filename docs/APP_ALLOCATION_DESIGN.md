# Client apps: templates, allocation and per-client customisation

**Status:** proposal, awaiting decisions. Written 2026-08-24.

**The ask.** Everything added to the portal should be a *template*; templates get
allocated to chosen clients; a template can be customised per client.

---

## 1. Where we actually are

There are **two kinds of app** and they behave differently, which is the root of
the confusion.

| | Built-in | Uploaded template |
|---|---|---|
| Lives in | code, `public/<app>/` | `app_templates` row (`html` column) |
| Registered by | `CLIENT_APPS` in `src/services/clientApps.ts` | `loadAppTemplates()` at runtime |
| Rendered via | iframe `srcdoc` | same-origin `/api/app-frame` |
| Versioned | no — whatever is deployed | yes, `app_templates.version` |
| Allocated by | Apps tab in the client file | Clients → App Templates → allocate |
| Per-client customisation | **not possible** | `client_apps.html_override` |
| Examples | `rentals`, `mgmt` | `pandima-rentals`, `payroll-2026` |

`client_apps` already carries most of the machinery the ask needs:

- `html_override` — this client's own copy; shared edits stop reaching them
- `pinned_html` / `pinned_version` — hold a client on the version they had
- `is_customised` / `is_pinned` — reporting flags
- `variant_token` — the unguessable handle the iframe loads by

So the gap is **not** the data model. It is that built-in apps never entered it,
and that allocation happens through two unrelated screens.

## 2. Two bugs found while investigating

**2.1 Disabling an app creates a row.** `api.setClientApp()` upserts
`{client_id, app_key, enabled:false}`. Toggling an app off — or on and then off
while looking around — leaves a permanent row. This is why `rentals` showed ten
allocations when one was intended: six were empty `enabled=false` rows nobody
meant to create.

*Fix:* delete the row when disabling; upsert only when enabling. One-line change,
plus the cleanup already done on 2026-08-24.

**2.2 Bulk allocation copied one client's data to three others.** On 28 July,
`rentals` was allocated across the Greson group and Greson Easy Loo's 32 tenants
were **copied** into Properties, Tools Limited and Tools Holdings. No client user
could reach them (0 logins, 0 grants), so nothing leaked — but three separate
legal entities each held another's tenant list and contact details.

*Fix:* allocation must always create an **empty** instance. Copying data between
clients should not be reachable from an allocation screen at all; if a "clone
this client's setup" feature is ever wanted, it belongs behind its own explicit,
named action with a confirmation naming both clients.

## 3. Proposal

### 3.1 One list, one allocation path

Register built-ins as `app_templates` rows carrying a `builtin_asset` path
(`/rental-app/`) instead of `html`. Then:

- **one** admin screen lists every app, built-in or uploaded, with `active`,
  `restricted`, allocation count and version
- **one** allocation path, `allocateTemplate`, which is already explicit and
  idempotent and always creates an empty instance
- the client file's Apps tab becomes *activate/deactivate for this client* only —
  it stops being a way to invent allocations

`clientApps.ts` keeps its registry as the *renderer* map (which asset path, is it
a component app, is it staff-only). It stops being the source of truth for
*existence*.

### 3.2 Customisation: configure, don't fork

"Customise the template under each customer" can mean two very different things,
and the difference matters:

**Configuration (recommended default).** A settings blob per client —
already available inside `client_app_data` — driving labels, which charge types
exist, VAT flags, which screens appear. The client stays on the shared app and
keeps receiving fixes.

**Forking (`html_override`).** A genuine copy of the HTML for one client. Real
customisation, but that client is then **cut off from every future fix**. We just
shipped a fix for a bug that was silently destroying uploaded contracts; a forked
client would still have it.

So forking should stay possible but be a deliberate, marked act: a confirmation
that names the consequence, the `is_customised` flag surfaced in the apps list,
and a "return to shared" action (`resetClientAppToShared`, which exists).

For built-ins, forking additionally requires bundling `public/<app>/` into one
self-contained HTML — the `build_from_source.cjs` idea, which produced the stale
`Greson_Property_Rentals.html` and should not be revived as-is. **Recommendation:
do not offer forking for built-ins in the first pass.** Configuration covers the
real cases; forking a 130 kB app plus its vendor libraries per client buys little
and costs update safety.

### 3.3 Migration path

1. Fix 2.1 (delete-on-disable). Small, independent, do it now.
2. Add `builtin_asset` to `app_templates`; insert rows for `rentals` and `mgmt`
   (`mgmt` stays `restricted` — it is written around one client).
3. Point the apps admin screen at the merged list; make the client Apps tab
   activate-only.
4. Add the per-client configuration blob, starting with what the rentals app
   already needs (charge types, VAT flags, visible screens).
5. Only if still wanted: forking for uploaded templates, with the warning and
   the reset path.

Steps 1–3 remove the confusion. Step 4 is the part that delivers "customise per
customer" without trading away update safety.

## 4. Decisions needed

1. **Configuration or forking** as the default meaning of "customise per client"?
   The recommendation is configuration, with forking as a marked exception.
2. **Should built-ins be forkable at all?** Recommendation: no, not in pass one.
3. **`mgmt`** stays restricted to Greson Easy Loo — confirm.
4. **Does anything need "clone another client's setup"?** If yes it gets its own
   named action, never a side effect of allocation.
