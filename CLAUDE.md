# PC Prime portal — working notes for Claude Code

Vite + React 19 + TypeScript, Tailwind v4, Supabase, deployed on Vercel.
Database migrations live in `supabase/migrations/` and are **numbered
sequentially** — read the highest number present and continue from there.
Edge functions in `supabase/functions/`.

## Access model — read this before writing any SQL

- `public.clients.id` is **bigint**, not uuid.
- Who may see which client is decided in **one** place:
  `public.user_can_access_client(bigint)`, which is admin-or-linked through
  `public.user_clients`. Related helpers: `public.is_admin()`,
  `public.is_supervisor_or_higher()`, `public.has_permission()`,
  `public.user_has_app_grant()`.
- Every new table that holds client data carries `client_id bigint`, has RLS
  enabled, and gets one policy that defers to `user_can_access_client`.
  **Never introduce a second register of who may access what.**

## The client reporting platform

A build is in progress: one application that produces the monthly reporting,
review and audit pack for every client whose books are kept in BTMS.

**Its specification is `docs/reporting/BUILD.md`. Read that file in full before
touching anything under `src/reporting/`, `supabase/functions/reporting-*` or
migrations 190 and up.** It carries the BTMS file formats and their traps, the
review checks, the screen list, real acceptance figures the build must reproduce,
and a phased build order.

The working prototype it is specified against is `docs/reporting/prototype.html` —
open it in a browser before writing code.

The overriding rule for that work, which outranks everything else: **the
application must never mix up client data or client information.**
