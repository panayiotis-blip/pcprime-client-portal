# Prime & Calculate — mobile app

Expo (React Native + TypeScript) implementation of `../README.md` and the
`Prime & Calculate App.dc.html` prototype — both client and staff mode.

All content is mock. The portal API is not wired up yet.

## Signing in

Auth is mocked, so any valid-looking email and a 6+ character password get in.
**The email domain picks the mode**, standing in for the portal telling us the
user's role:

| Sign in as | Lands on |
| --- | --- |
| `anyone@primeandcalculate.com` | Staff — Today · Clients · Messages · More |
| any other address, or Face ID | Client — Home · Files · Book · Messages · More |

The root layout fences each role into its own tab set, so a client cannot
reach `/staff/*` and an accountant cannot reach the client tabs.

## Running

```bash
npm install       # the repo pins legacy-peer-deps in .npmrc
npm start         # then press i / a, or scan the QR in Expo Go
npm run web       # fastest way to eyeball a change
npm run typecheck
```

No custom native modules are used, so it runs in Expo Go as-is.

## Layout

```
src/
  app/            expo-router routes (this is the router root, not the project root)
    _layout.tsx     fonts, providers, root stack, the role-aware redirect
    sign-in.tsx
    portal.tsx      portal hand-off — root-level, so it drops the tab bar
    booked.tsx      booking confirmed — same
    (tabs)/         CLIENT tab set
      _layout.tsx   the custom tab bar
      (home)/       Home + Filings (Filings is pushed here so it keeps the tab bar)
      documents.tsx book.tsx  messages.tsx  more.tsx
    staff/          STAFF tab set
      _layout.tsx   the staff tab bar
      today.tsx     messages.tsx  more.tsx
      clients/      the list, [id] detail, and [id]/files — all in one stack, so
                    the Clients tab stays active across them
  components/     Blueprint, Button, Tag, Input, Screen, Sheet, Toast, Section
  features/       screen bodies both modes share: documents, messages, more
  theme/          tokens.ts (colour, spacing), type.ts (the scale), layout.ts (insets)
  data/           mock content (mock.ts client, staff.ts staff) and its types
  api/portal.ts   the seam where the real portal API goes
  state/          session, documents, messages, tasks
  lib/dates.ts    date formatting, hand-rolled so it matches on every engine
```

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

## Deliberate departures from the prototype

- Tags are uppercase at 5/9 padding, per the handoff README. The prototype's
  stylesheet renders them title-case at 3/10.
- Registration marks switch to a paper tint over navy fields. In the prototype
  they are navy-on-navy, i.e. invisible.
- The Home alert card is tinted `accent @ 18%`, as the README instructs. The
  prototype still had the design system's steel blue there.
- The last row of a bordered list drops its divider, which would otherwise
  double up against the card's own frame.
- "Switch to staff mode" is omitted. The handoff is explicit that staff mode
  must be gated by the signed-in user's role, so it is — see "Signing in".
- Top padding is measured against the real safe-area inset instead of the
  design's flat 64pt, which assumed a 59pt status bar.

Two staff screens the handoff does not design, both built from the same
components as the designed ones:

- **Their files** — the prototype pointed this at the client's own Documents
  screen. Staff get that list without the upload sheet or the portal hand-off,
  since both belong to the client.
- **Staff More** — the prototype pointed the staff More tab at the client's
  More, which would have shown an accountant a client's company and VAT
  number. Same layout, with the accountant's own identity instead.

The staff Messages composer reads "Message your client"; the prototype reused
the client's "Message your accountant" in both modes. Both modes still share
one seeded thread, and the header reflects whichever client you arrived from.

## Before this ships

- Auth: SSO with the portal; persist the session, and have biometric unlock
  re-use a stored refresh token rather than the current mock success path.
- Replace the bodies in `src/api/portal.ts` with real calls.
- Carry the session token into the in-app browser on the portal hand-off.
- Push notifications — deadline reminders, "document received", "your
  accountant replied". They are the reason this is an app.
- Swap the "PC" lettermark for the real logo file.
