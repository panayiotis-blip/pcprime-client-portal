# Prime & Calculate — mobile app

Expo (React Native + TypeScript) implementation of `../README.md` and the
`Prime & Calculate App.dc.html` prototype — both client and staff mode.

It talks to the same Supabase project as `portal.primeandcalculate.com` and
leans on the same row-level security, so the app can only ever show a person
what the portal would show them. Nothing here re-decides access.

## Running

```bash
cp .env.example .env    # fill in from the portal's own .env
npm install             # .npmrc pins legacy-peer-deps
npm start               # then press i / a
npm run web             # fastest way to eyeball a design change
npm run typecheck
```

Both env values are public — they ship in the portal's browser bundle too.
RLS is what protects the data. `.env` is gitignored regardless.

**Expo Go is no longer enough for everything.** The data layer, camera capture
and file picking all work in it, but remote push needs a development build.
`expo-secure-store` has no web implementation, so `npm run web` falls back to
localStorage for the session — fine for reviewing the design, never for a real
account.

## Four migrations and three functions to deploy first

Booking, push and the portal hand-off had no backend. `supabase/migrations/` in
the portal repo now has four files to run in the Supabase SQL editor, in order:

- `176_consultation_requests.sql` — a client asks for a consultation; staff
  confirm it into the diary. Appointments stay staff-only, as migration 020
  intended: a client can never write into the firm's calendar. Also adds
  `consultation_slots()`, which offers the firm's standard times minus anything
  already taken, without exposing whose appointment took them.
- `177_push_devices.sql` — one row per install, readable only by its owner.
- `178_push_outbox.sql` — what to say and when. Triggers on new firm messages
  and firm-filed documents, a nightly deadline sweep, and the per-minute cron
  that drains the queue.
- `179_portal_sso.sql` — the one-time codes behind the portal hand-off. Service
  role only: RLS is on with no policies at all.

178 schedules a function that must exist, so deploy it first:

```bash
supabase functions deploy send-push --no-verify-jwt
```

Then set `CRON_SECRET` on the function and the matching Vault secret — the
commented block at the bottom of 178 has the exact statement.

The hand-off is two more functions, and the flags are not interchangeable:

```bash
supabase functions deploy sso-mint                     # verifies the JWT
supabase functions deploy sso-exchange --no-verify-jwt # no JWT to verify yet
```

`sso-mint` must keep its JWT check — minting a code *is* the privilege being
handed out. `sso-exchange` cannot have one: it is called by a browser that is
not signed in, which is the entire point of the code.

Until 176 and 177 are run, Book and push registration fail; until 179 and both
functions are live, the portal opens signed out. Everything else works.

## Signing in

The portal's own credentials, over the same Supabase auth. Username-only
sign-in is mirrored too, mapping onto the placeholder address the portal uses.

The role comes back with the session and picks the tab set — the root layout
fences each role into its own, so a client cannot reach `/staff/*` and an
accountant cannot reach the client tabs.

There is a **second-factor screen**, which the handoff does not design. Without
it, anyone with an authenticator enrolled cannot get past the password: RLS
treats a half-verified session as unverified and every screen comes back empty.

Biometric unlock guards re-entry into a session already in the keystore. It is
not a second credential and cannot create a session from nothing.

### Into the web portal, without signing in twice

The Portal screen opens `portal.primeandcalculate.com` already signed in.
`sso-mint` gives the app a one-time code; the URL carries it in the fragment
(`#sso=…`), so it never reaches the host's access logs or a Referer header; the
portal posts it to `sso-exchange` before React mounts and gets a session back
in the response body. The code is opaque, single use, and dead after ninety
seconds.

The session's own tokens never travel in the URL. They last for days, and a URL
is copied, logged and kept in history — which is why OAuth passes a code and
not a token, and why this does too.

The exchanged session starts at `aal1`, so anyone with an authenticator is
challenged again by the portal. That is deliberate: clearing a second factor on
the phone should not silently clear it on the web.

If the code cannot be minted — offline, or the function is not deployed — the
portal still opens and asks for a password, which is the behaviour that
preceded all this.

## Layout

```
src/
  app/            expo-router routes (this is the router root, not the project root)
    _layout.tsx     fonts, providers, root stack, the role-aware redirect
    sign-in.tsx  mfa.tsx
    portal.tsx      portal hand-off — root-level, so it drops the tab bar
    booked.tsx      consultation requested — same
    (tabs)/         CLIENT tab set
      _layout.tsx   the custom tab bar
      (home)/       Home + Filings (Filings is pushed here so it keeps the tab bar)
      documents.tsx book.tsx  messages.tsx  more.tsx
    staff/          STAFF tab set
      _layout.tsx   the staff tab bar
      today.tsx     messages.tsx  more.tsx
      clients/      the list, [id] detail, and [id]/files — all in one stack, so
                    the Clients tab stays active across them
  api/portal.ts   every query, and the mapping from schema to screen
  lib/supabase.ts the client; session held in the device keystore
  lib/useQuery.ts fetch on mount and on refocus
  lib/push.ts     Expo push token registration
  components/     Blueprint, Button, Tag, Input, Screen, Sheet, Toast, Async
  features/       screen bodies both modes share: documents, messages, more
  theme/          tokens.ts (colour, spacing), type.ts (the scale), layout.ts (insets)
  data/content.ts the firm's own words — services, links, contact details
  state/session.tsx
```

`src/api/portal.ts` is the only file that knows the database exists. The
database speaks in `compliance_tasks` and `client_messages`; the screens speak
in Filings and Messages; the translation lives there.

## What comes from where

| Screen | Table |
| --- | --- |
| Profile | `clients` |
| Documents | `documents` + Storage |
| Filings, Home calendar, Home alert | `compliance_tasks` |
| Messages | `message_thread` + `client_messages`, via the portal's RPCs |
| Book | `consultation_slots()` → `request_consultation()` |
| Staff Today | `staff_tasks` + `compliance_tasks` |
| Staff Clients | `clients` + `compliance_tasks` |

## Where the design asked for data that does not exist

Each of these is derived, and the derivation is written down beside the code
that does it.

- **Document status.** No review-state column. The tag says "Sent" when the
  client uploaded it and "Received" when the firm did — both true, both from
  `uploaded_by`. Add `documents.review_status` and it becomes a straight read.
- **Document file size.** Not stored. The meta line carries category and date
  instead of the design's "1.2 MB".
- **The filing progress bar.** `compliance_tasks` records a status, not a
  percentage. Done is 100, in-progress is 60, and a pending task grows as its
  due date approaches.
- **"Clients missing docs"** — nothing records what was asked for and not sent.
  The stat counts clients with something overdue, which is the same worry
  expressed in data the portal actually holds.
- **Client fees** come from `clients.monthly_fee`, not an unbilled-work figure.
- **Document categories** are configurable in the portal, so the filter row is
  built from what the client actually has rather than the design's fixed five.

## The design rules that are easy to break

- **Radius is 0 everywhere.** Square corners are the system.
- **Cards are transparent line drawings.** The only filled objects are the gold
  primary button and the navy field sections.
- **Every framed object carries four registration marks.** They are drawn 6pt
  *outside* the frame, so no ancestor may set `overflow: 'hidden'`.
- **Gold means someone must do something.** There is no red/green semantic
  palette — urgency is a gold tag against quiet outlines.
- **Buttons are set in Barlow Condensed**, not the body face. That comes from
  the Industry `.btn` rule, and it is what the prototype renders.
- Minimum text size is 12.5px; minimum hit target is 40pt.

Loading, empty and error states are not in the handoff — it was drawn against
seeded data that always arrives. They are deliberately the quietest thing in
the system: a line of meta text on the paper ground, no illustration, no card.

## Deliberate departures from the prototype

- Tags are uppercase at 5/9 padding, per the handoff README. The prototype's
  stylesheet renders them title-case at 3/10.
- Registration marks switch to a paper tint over navy fields. In the prototype
  they are navy-on-navy, i.e. invisible.
- The Home alert card is tinted `accent @ 18%`, as the README instructs.
- The last row of a bordered list drops its divider, which would otherwise
  double up against the card's own frame.
- "Switch to staff mode" is omitted — staff mode is gated by role, as the
  handoff requires.
- Top padding is measured against the real safe-area inset instead of the
  design's flat 64pt, which assumed a 59pt status bar.
- **"YOU'RE BOOKED IN." is now "REQUEST SENT."** The design assumed booking was
  instant. It is not, and should not be: a request goes to the firm and a
  person confirms it. The screen keeps its shape and tells the truth.
- **The portal hand-off keeps its "no second sign-in," but says what it cannot
  skip.** The prototype's copy promised a clean pass-through; a code exchange
  now delivers one, except for the authenticator, which the portal asks for
  again on purpose. The screen says so rather than surprising anyone.
- Two staff screens the handoff does not design — **their files** and **staff
  More** — are built from the designed components and say so in a comment.

## Push, end to end

The app registers its Expo token against the signed-in user
(`src/lib/push.ts`), and a tapped notification lands on the screen it was about
(`src/lib/useNotificationRouting.ts` — every notification carries a `url`).

The sending side is `supabase/functions/send-push`, drained from a queue rather
than posted straight from a trigger: an HTTP call inside the transaction would
tie someone's message being saved to Expo being up, and a failure would vanish
with no record and no retry.

Three things send a notification, and only three:

| When | Collapsed by |
| --- | --- |
| The firm replies to your message | one per message |
| The firm files a document to your account | one per client per hour, so a batch upload is one buzz, not twelve |
| A filing is due in 7 days, then 1 day | one per client per lead time — Cyprus deadlines cluster, and three buzzes at 08:00 is how notifications get switched off |

Dead tokens are removed by a receipts pass: a ticket only says Expo accepted
the message, so the function asks again 15 minutes later and deletes anything
reported `DeviceNotRegistered`. Without it, uninstalled apps stay in the table
forever and every send drags a longer tail behind it.

Watch it work:

```sql
select status, count(*) from public.push_outbox group by status;
select id, title, status, attempts, last_error from public.push_outbox
 order by created_at desc limit 20;
```

Stop it without un-deploying:

```sql
update cron.job set active = false where jobname = 'send-push';
```

## Still to build

- **The hand-off has not been run against the deployed functions.** Both halves
  are written and type-check; nothing has minted a real code yet.
- **Staff notifications.** Push is client-facing, as the handoff specified — an
  accountant is not told when a client replies or uploads. The outbox is
  generic, so it is one trigger away.
- **Nothing has been sent yet.** The queue, the triggers and the receipts pass
  are written but have never run against Expo.
- **Session persistence across a cold start is untested on device.** It is
  wired through the keystore but has only been exercised in the browser.
- **`documents.review_status`**, if the four designed document states matter.
- Swap the "PC" lettermark for the real logo file.
