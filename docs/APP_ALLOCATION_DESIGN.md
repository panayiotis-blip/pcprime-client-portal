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

### 3.1 One list, one allocation path — mostly already true

**Correction (2026-08-24):** an earlier draft of this section claimed built-ins
and uploaded templates had separate allocation screens. They do not. Clients →
App Templates already lists both under one "Library", and both already carry an
**Allocate to clients** button going through the same `allocateTemplate` path.
The confusion came from the row-leak bug in §2.1, not from the allocation screen.

What was genuinely missing, and is now done (migration 186): a built-in had no
row of its own, so its name, icon, description and availability were frozen in
`clientApps.ts` and could only change with a deploy. Built-ins now have an
`app_templates` row carrying a `builtin_asset` path instead of `html`, so an
admin can rename one or switch it off from the portal.

Deliberately still not offered for a built-in: replacing the HTML or "remove
everywhere". Its files ship in the build — there is nothing to upload over, and
nothing to delete.

`clientApps.ts` keeps the built-in definitions because `allClientApps()` is
called during render and must answer synchronously; returning an empty list
while a fetch resolves would blank the Apps nav. The row supplies the editable
metadata on top. Anything only the code can know — asset path, `component`,
`staffOnly` — is never taken from the row, so a bad row cannot turn a staff-only
app into a client-facing one.

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

## 4. Decisions — settled 2026-08-24

1. **Configuration**, not forking, is what "customise per client" means here.
2. **Built-ins are not forkable.** A fork would cut that client off from every
   future fix.
3. **`mgmt` stays restricted** to Greson Easy Loo.
4. **No "clone another client's setup"** is wanted.

## 5. What is done, and what is next

Done:

- §2.1 delete-on-disable (commit `ee70c88`) — a row carrying customisation, a
  pin or a data document is kept and merely disabled; only an empty one goes
- The 9 unintended `rentals` allocations and 3 copied datasets removed, backed
  up in `_backup_rentals_allocations_20260824`
- Migration 186 — built-ins get a row, so they can be renamed and switched off
  without a deploy

- **Per-client configuration — BUILT** (commit `baa531a`, migration 187).
  `client_app_config(client_id, app_key, config jsonb)`: the firm's settings for
  one client's copy of an app, deliberately a separate table from
  `client_app_data` (the client's own content) so a client edit can never
  overwrite an accountant's decision. Read is `user_can_access_client`; write is
  `is_supervisor_or_higher`, NOT `user_can_access_client`, which is also true for
  the client's own users.

  Delivered to the app in the same `init` message as its data, so it never
  renders unconfigured and then rearranges. App-only users hold no Supabase
  session, so `app-session` returns the config alongside their data instead.

  Configurable for rentals: the name that client sees, which screens they get
  (Overview excluded — the app must have somewhere to open), and VAT (off
  entirely, or rate plus whether rent is vatable). Charge-type VAT flags stay in
  the app: which charges exist is the client's business, the rate is the firm's.

  Absent configuration means the app behaves exactly as before, so every
  unconfigured client is bit-for-bit unchanged.

**All four decisions are now implemented.** What remains is verification on real
screens, not construction.
