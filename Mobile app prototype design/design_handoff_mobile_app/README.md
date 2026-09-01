# Handoff: Prime & Calculate mobile app

## Overview

A mobile app for Prime & Calculate (accounting, tax and business consulting, Larnaca, Cyprus). Two modes in one app:

- **Client mode** — a business owner checks filing deadlines, uploads documents, books a consultation, messages their accountant, and reaches the existing web client portal.
- **Staff mode** — an accountant sees today's tasks, which clients need chasing, and a client list with per-client open items and fees.

The app does **not** replace the existing client portal (`portal.primeandcalculate.com`). The portal remains the system of record for documents, filings and messages; the app is a mobile client over it, plus the things a browser cannot do: push notifications for deadlines, camera receipt capture, biometric sign-in, offline reading.

## About the design files

`Prime & Calculate App.dc.html` in this bundle is a **design reference created in HTML** — an interactive prototype showing intended look and behavior. It is not production code to copy.

The task is to **recreate these designs in the target codebase's environment**. Given the portal was built with Claude Code, the likely target is React Native or Expo sharing types/API client with the portal, or a native Swift/Kotlin app. Use the existing project's established patterns, component library and API client rather than porting the prototype's markup.

The prototype renders an iPhone-sized viewport (402 × 874 logical px) inside a device frame; the frame is presentation chrome only and is not part of the app.

## Fidelity

**High-fidelity.** Colors, typography, spacing and copy are final and should be matched. Layout is final for a 402pt-wide phone; tablet and large-phone behavior is not designed and is left to the implementer (content column stays max ~520pt, centered).

## Design tokens

The prototype is built on the "Industry" design system (steel-blue wireframe aesthetic: square corners, hairline borders, blueprint corner registration marks) with the Prime & Calculate brand palette overriding the color tokens. Keep both: the **structure** is Industry, the **color** is Prime & Calculate.

### Color

| Token | Hex | Use |
| --- | --- | --- |
| `bg` | `#F7F5F1` | App background, light screens |
| `surface` | `#FFFFFF` | Rarely used; cards are transparent |
| `text` | `#0F2A3B` | Primary text (navy) |
| `divider` | `#0F2A3B` @ 16% | All hairline borders and rules |
| `accent` / `accent-500` | `#B0813C` | Brand gold; icons, primary fills |
| `accent-100` | `#FAF4E9` | |
| `accent-200` | `#F1E4CB` | |
| `accent-300` | `#E3CC9B` | Action tag fill; text on navy fields |
| `accent-400` | `#D0AE68` | Borders on navy fields |
| `accent-600` | `#8F6830` | Pressed / hover on gold |
| `accent-700` | `#6E5025` | Gold text at body size (contrast-safe) |
| `accent-800` | `#1D4257` | Active tab icon/label |
| `accent-900` | `#0F2A3B` | Navy field: sign-in, home header, confirmation |
| `neutral-100` | `#EAE5DC` | |
| `neutral-200` | `#E9E5DE` | Progress bar track |
| `neutral-400` | `#B4AEA4` | Inactive progress fill |
| `neutral-500` | `#93908A` | Inactive tab icon/label, completed task text |
| `neutral-600` | `#7A8892` | Secondary/meta text |
| `neutral-700` | `#5C6A74` | Body text on cards |

There is no red/green semantic palette. Urgency is carried by the **gold** tag fill against quiet outline tags — see "Tags" below.

### Typography

- **Headings:** Barlow Condensed, weight 600, `text-transform: uppercase`, `line-height: 1–1.1`, letter-spacing 0.01–0.02em.
- **Body:** Barlow, weights 400/500/600.
- Scale used: screen title 34px · section header 22px · card title 15px · body 14.5px · meta 12.5px · eyebrow/label 10.5px (letter-spacing .13em, uppercase) · tab label 10px (letter-spacing .09em, uppercase).
- Minimum body size 12.5px; no text below that.

### Geometry

- **Border radius: 0 everywhere.** Square corners are the system.
- Borders: 1px `divider`.
- Cards and figures are **transparent line drawings**, never filled — the one exception is the solid gold primary button and the navy field sections.
- Every card, framed avatar and stat block carries four corner registration marks (`+` crosshairs at tl/tr/bl/br). Do not drop them.
- Spacing: screen horizontal padding 22px; card padding 14–16px; gap between stacked cards 12px; section top margin 24–28px.
- Elevation: only the toast uses a shadow. Everything else is flat.

### Icons

Lucide, stroke-width 1.5, sizes 16/18/20/22. Icons used: `home`, `folder`, `calendar`, `message-square`, `more-horizontal` (tab bar); `arrow-right`, `arrow-up`, `arrow-up-right`, `check`, `lock`.

### Hit targets

Every interactive element has `min-height: 40px`, most 44–52px. Maintain this.

## Screens

Client mode has 8 screens, staff mode 4. A bottom tab bar is present on all except Sign-in and Booking confirmed.

---

### 1. Sign in (`signin`) — client

**Purpose:** authenticate into the portal account.

**Layout:** full-bleed navy (`accent-900`). Content bottom-aligned: brand mark, headline, subcopy, then form pinned to the bottom with 34px bottom padding.

- Brand mark: 56 × 56 blueprint frame, gold border (`accent-400`), letters "PC" in Barlow Condensed 22px, paper-colored.
- Headline: Barlow Condensed 46px uppercase, `bg` color, three lines — "Precision. / Partnership. / Progress." (from the client's website).
- Subcopy: 14.5px, `accent-300`: "Sign in to your client portal — documents, deadlines and your accountant, in one place."
- Two inputs (email, password): 15.5px, padding 15/16, background `bg` @ 7%, border `accent-600`, text `bg`, min-height 44px.
- Error line, when present: 12.5px `accent-300`.
- Primary button "SIGN IN": full-width, solid gold, navy text, 15px 600 uppercase letter-spacing .06em, min-height 48px.
- Below: two ghost buttons side by side — "Use Face ID" (left) and "Forgot password" (right), 13px `accent-300`.

**Validation (prototype rules — replace with real auth):** email must contain `@` with at least one character before it and a `.` at least two characters after it, and no spaces; password ≥ 6 characters. Failing either sets an inline error and does not navigate. "Use Face ID" runs the same success path.

**On success:** → Home.

---

### 2. Home (`home`) — client

**Purpose:** the morning glance — what is due, and the two things you most often do.

**Layout, top to bottom:**

1. **Navy header** (`accent-900`, padding 64/22/26):
   - Eyebrow: 11px uppercase `accent-300` — the date, e.g. "Thursday, 6 August 2026".
   - Title: Barlow Condensed 32px uppercase, two lines — "Good morning, / Andreas".
   - Right: 40 × 40 blueprint frame with initials "AK".
   - **Alert card**, gold-tinted (`#5980A6` @ 18% in the prototype — implement as `accent` @ ~18%), gold border, corner marks: 7×7 gold square dot, title "VAT return due in 6 days" (14.5px 600, paper), sub "Q2 2026 · we need 3 more invoices" (12.5px `accent-300`), and a gold "UPLOAD" button that navigates to Documents.
2. **Two quick-action cards** in a 2-column grid, gap 14: "Documents / 3 need attention" (folder icon) → Documents; "Book a call / Free consultation" (calendar icon) → Book. Both are blueprint cards; hover tints the fill 5% text color.
3. **"YOUR CALENDAR"** section header (22px condensed uppercase) with a "All filings" ghost link → Filings. Below, one bordered card containing three rows, each: a 42px-wide date block (day in Barlow Condensed 22px `accent-700`, month in 10px uppercase `neutral-600`), title + sub, and a status tag.
4. **"SERVICES"** — six full-width cards, each name + one-line description + right arrow, all navigating to Book. Copy taken verbatim from the client's website services list.
5. **Closing navy panel**: Barlow Condensed 26px uppercase — "Over 30 years helping businesses in Cyprus decide with confidence." — plus an "About the firm →" link to `https://primeandcalculate.com/about`.

---

### 3. Documents (`portal`) — client

**Purpose:** see what has been sent to the accountant and add more.

- Title "DOCUMENTS" (34px) with a gold "UPLOAD" button opening the upload sheet.
- Sub: "Kyriakou Trading Ltd".
- Full-width secondary button: "Open the full client portal" with an external-link icon → Portal screen.
- Horizontal filter row: All · Invoices · Bank · Payroll · Filings. Selected = solid gold button, unselected = outlined. Filtering is client-side on a `cat` field.
- Document rows (blueprint cards): a 34 × 42 outlined rectangle showing the file kind (PDF/CSV/ZIP/XLS) bottom-aligned, name (truncated with ellipsis), meta line, and a status tag.

**Upload sheet** (bottom sheet, slides up 300ms `cubic-bezier(.2,.8,.2,1)`, backdrop fades 200ms; tapping the backdrop or Cancel dismisses):
- Title "ADD A DOCUMENT", sub "It goes straight to your accountant, encrypted."
- Three options, each a full-width secondary button: "Take a photo of a receipt", "Choose from Files", "Import from email".
- Any option prepends a new document to the top of the list (`Purchase invoice 4 Aug.pdf`, "Just now · 480 KB", status "Sent") and shows a toast.

**Toast:** navy, paper text, positioned 18px from each side and 104px from the bottom (above the tab bar), auto-dismisses after 2400ms. Copy: "Uploaded — Christina has been notified."

---

### 4. Portal hand-off (`web`) — client

**Purpose:** hand the user to the existing web portal without pretending the app owns it.

The prototype originally embedded the portal in an iframe; that was removed because portals typically send `X-Frame-Options`/CSP headers that block embedding. **In the real app, use an in-app browser** (`SFSafariViewController` on iOS, Custom Tabs on Android, or Expo `WebBrowser`) with the session token passed through — not a plain external link, and not an iframe.

- Navy top bar: "← Back", a lock icon and the URL `portal.primeandcalculate.com` in a bordered pill, and "Open ↗".
- Center: a single blueprint card — lock icon, "YOUR CLIENT PORTAL" (26px condensed), body "Signed in as Andreas Kyriakou. The portal opens in the browser with your session carried over — no second login.", a full-width gold "OPEN PORTAL ↗" button, and the URL in 12px meta.
- No tab bar on this screen.

---

### 5. Filings (`deadlines`) — client

**Purpose:** the full compliance year at a glance.

Title "FILINGS", sub "Everything we file on your behalf this year." Then six cards, each with title, due/filed line, a status tag, and a 4px progress bar (track `neutral-200`): filed = 100% `accent-700`; in progress = partial `accent`; scheduled/draft/not started = small `neutral-400`.

Content: VAT Q1 2026 (filed), VAT Q2 2026 (action, 62%), Payroll July (filed), Payroll August (scheduled 20%), Provisional tax 1st instalment (draft 35%), Corporate income tax 2025 (not started 5%).

---

### 6. Book a consultation (`book`) — client

**Purpose:** book the free 30-minute consultation the firm offers.

Title "BOOK A CONSULTATION", sub "30 minutes, no charge. Larnaca office or video."

Three labeled groups (labels are 10.5px uppercase, letter-spacing .13em, `neutral-600`):

1. **What is it about** — four full-width radio-style buttons with a 16 × 16 square indicator (filled when selected): "Tax & VAT question" (default), "New company setup", "Payroll & HR", "Something else". Selected = solid gold.
2. **Day** — horizontal scroller of the next 7 **weekdays** (weekends excluded), each a 58px-wide button, day-of-week in 10px uppercase over the date in Barlow Condensed 22px. No default selection.
3. **Time** — 3-column grid: 09:00, 09:30, 10:00, 11:30, 14:00, 15:30. No default selection.

**Confirm button:** disabled-looking (secondary style) and labeled "PICK A DAY AND TIME" until both a day and a time are chosen; then it becomes solid gold and reads "CONFIRM BOOKING". Tapping it when incomplete does nothing.

---

### 7. Booking confirmed (`booked`) — client

Full-bleed navy, vertically centered, no tab bar.

- 52 × 52 blueprint frame with a gold check icon.
- "YOU'RE BOOKED IN." — Barlow Condensed 42px uppercase.
- Summary line, composed: `{service} — {day, long format} at {time}, with Christina Prodromou.`
- Address block: "Dikomou 12, Agora Courts 2, Kiti, Larnaca. A calendar invite is on its way to your email."
- Gold "BACK TO HOME" and outlined "Add a note for the team" (→ Messages).

---

### 8. Messages (`chat`) — both modes

**Purpose:** a direct line to the assigned accountant (client mode) or to the client (staff mode).

- Header: name + one-line status, on `bg` with a bottom divider. Client mode: "Christina Prodromou" / "Senior accountant · usually replies within an hour". Staff mode: "Kyriakou Trading Ltd" / "Andreas Kyriakou · client since 2019".
- Message list, 10px gap. Own messages right-aligned, navy fill, paper text. Received messages left-aligned, transparent with a hairline border. Max width 80%, padding 12/15, 14.5px, line-height 1.5. **Square corners** — no bubble radius.
- Composer pinned to the bottom: input (min-height 46px) + a 46 × 46 gold send button with an up-arrow icon. Enter also sends. Empty/whitespace messages are ignored.
- After sending, a "typing…" indicator appears for 1400ms, then a canned reply arrives. **This is prototype-only** — replace with the real message API.

Seeded thread: accountant reports the July bank statement arrived and three purchase invoices are still missing for the Q2 VAT return; client replies; accountant confirms the 10 August deadline.

---

### 9. More (`more`) — client

- Profile row: 52 × 52 blueprint frame with initials, name "Andreas Kyriakou", sub "Kyriakou Trading Ltd · VAT 10234567X".
- **"FROM OUR WEBSITE"** — a bordered list of external links, each with label, host, and an external-link icon. Targets: `primeandcalculate.com` home, `/about`, `/services`, `/blog`, `/contact`, and `portal.primeandcalculate.com`.
- **"GET IN TOUCH"** — card with the phone number in Barlow Condensed 24px, hours "Mon–Fri, 9:00–17:00", the Kiti address, and two buttons: gold "CALL" (`tel:+35724258346`) and outlined "EMAIL" (`mailto:info@primeandcalculate.com`).
- "SWITCH TO STAFF MODE" (outlined) — **prototype affordance only**; in production, staff mode must be gated by the signed-in user's role, not a button.
- "Sign out" (ghost, gold text) — clears session and returns to Sign in in client mode.

---

### 10. Today (`today`) — staff

**Purpose:** an accountant's morning triage.

- Navy header: eyebrow "STAFF · {date}", title "{n} TASKS OPEN" (recomputed from unchecked tasks), and two stat blocks side by side in blueprint frames: "12 / VAT filings this week", "5 / Clients missing docs".
- **"TODAY'S TASKS"** — four checkable cards. The checkbox is a 20 × 20 square; unchecked = hairline border, checked = solid gold with a paper check. Checked task titles go `neutral-500` with a line-through. Tapping toggles and updates the header count.
- **"NEEDS CHASING"** — three rows (initials tile, name, what is missing) each with an outlined "NUDGE" button → Messages.

---

### 11. Clients (`clients`) — staff

- Title "CLIENTS", a search input below it.
- Search filters live on name and type, case-insensitive substring. Empty result shows: `No clients match "{query}"`.
- Rows: 34 × 34 initials tile, name, entity type, status tag. Tapping opens Client detail.

Six seeded clients: Kyriakou Trading Ltd (VAT due), Athina Georgiou (clear), Mediterra Foods Ltd (audit), Nicolaou & Sons (overdue), Blue Harbour Rentals (clear), Elena Papadopoulou (new).

---

### 12. Client detail (`client`) — staff

- Navy header: "← Clients" ghost button, client name in Barlow Condensed 30px uppercase, then "{entity type} · {VAT/TIC number}".
- Two buttons: gold "MESSAGE" → Messages; outlined "THEIR FILES" → Documents.
- **"OPEN ITEMS"** — bordered list of that client's items: title, sub, status tag.
- **"FEES"** — card with the amount in Barlow Condensed 30px, a note beneath, and an outlined "INVOICE" button (no action in the prototype).

---

## Tab bar

Present on every screen except Sign in, Booking confirmed and Portal hand-off. Background `bg`, 1px top divider, padding 8/6/26 (the bottom padding is the home-indicator inset — use safe-area insets in production).

Each tab: Lucide icon 22px over a 10px uppercase label, letter-spacing .09em, min-height 52px. Active = `accent-800`, inactive = `neutral-500`. No pill, no underline, no fill.

- **Client tabs:** Home · Files · Book · Messages · More. The Files tab stays active on the Portal hand-off screen.
- **Staff tabs:** Today · Clients · Messages · More. The Clients tab stays active on Client detail.

## Tags

Small uppercase labels, square, padding ~5/9, 11px 600–700.

- **Action / urgent** — gold fill `accent-300` with navy text. Used for "Action", "Missing 3 invoices", "Overdue", "In review", "VAT due", "Awaiting", "In progress".
- **Positive / done** — neutral tint. Used for "Filed", "Received", "Done", "Clear", "On track", "Ready".
- **Inert** — outlined, transparent, `neutral-700` text. Used for "Draft", "Not started", "Scheduled", "Audit", "New".

The rule: gold means *someone must do something*. Everything else stays quiet.

## Interactions & motion

- **Screen enter:** fade + 8px upward translate, 300ms ease (`scr` keyframe). Applied per screen body.
- **Bottom sheet:** 300ms `cubic-bezier(.2,.8,.2,1)` translateY from 100%; backdrop 200ms fade.
- **Toast:** same enter as a screen, 250ms; auto-dismiss at 2400ms.
- **Typing indicator:** 200ms fade in; canned reply after 1400ms.
- **Hover (desktop preview only):** cards tint to 5% of the text color. On device, use the platform's press state.
- **Focus:** 2px `accent` outline, 2px offset. Never the browser default.

Navigation in the prototype is a flat screen switch with no history stack; in production use the platform navigator with proper back behavior, and keep the tab bar's state per tab.

## State

| State | Type | Notes |
| --- | --- | --- |
| `mode` | `'client' \| 'staff'` | Drives tab set and which screens exist. In production, derive from the user's role. |
| `authed` | boolean | |
| `screen` | screen id | Replace with the platform router. |
| `email`, `pw`, `err` | string | Sign-in form. |
| `filter` | string | Documents category filter. |
| `query` | string | Client search. |
| `sel` | client id | Selected client for detail. |
| `sheet` | boolean | Upload sheet visibility. |
| `toast` | string | Empty = hidden. |
| `draft`, `msgs`, `typing` | string / array / boolean | Messages. |
| `docs` | array | Documents list; upload prepends. |
| `tasks` | array | Staff tasks with `done` flags. |
| `service`, `day`, `dayLabel`, `slot` | string / null | Booking selections; confirm requires `day && slot`. |

## Data the real app needs from the portal

All seeded content in the prototype is placeholder. The API must supply:

- **Auth:** session shared with the portal (SSO). Biometric unlock should re-use a stored refresh token, not a second credential.
- **Filings/deadlines:** title, due date, status, completion percentage.
- **Documents:** name, file kind, category, size, upload date, review status; upload endpoint accepting camera capture and file picker input.
- **Messages:** thread per client, send + receive, read state; push notification on new message.
- **Availability:** bookable slots for consultations, and a booking endpoint that returns a calendar invite.
- **Client profile:** entity name, type, VAT/TIC number.
- **Staff:** task list, clients needing documents, per-client open items and unbilled fees.

**Push notifications** are the main reason this is an app rather than a mobile web page — deadline reminders, "document received", "your accountant replied".

## Assets

No images or third-party assets are used. The brand mark is set as the letters "PC" in Barlow Condensed inside a bordered square — **replace with the real logo file**, which was not available when the prototype was built. No photography is present; the Industry design system expects photographs to be duotoned into the accent if any are added.

Fonts: Barlow and Barlow Condensed (Google Fonts, SIL Open Font License).

## Files in this bundle

- `Prime & Calculate App.dc.html` — the interactive prototype (both modes, all screens).
- `ios-frame.jsx` — the device frame used for presentation only; not part of the app.
- `industry-design-system/` — the design system stylesheet, tokens and component reference the prototype is built on. `styles.css` is the source of truth for structure; the color tokens in it are the *system's* steel-blue defaults and are overridden by the Prime & Calculate palette listed above, which is defined inline at the top of the prototype file.

To view the prototype, open the `.dc.html` file in a browser.
