# PC Prime Design System v2

The shared visual foundation for the portal — introduced in **UI Polish v2, Part 1a**.

## Where things live

| What | Path |
|------|------|
| Design tokens + component CSS | `src/styles/design-system.css` |
| Shared components | `src/components/ui/` |
| Single import point | `src/components/ui/index.ts` |
| Verification page | `src/components/_design/DesignSystemDemo.tsx` → route `/design-system` |

## How to use it

Import any component from the `ui` barrel:

```tsx
import { Button, Card, DataTable, FormField, Input } from '../ui';
```

Use tokens directly in CSS or inline styles via `var(--pc-…)`:

```css
color: var(--pc-text-2);
padding: var(--pc-sp-16);
border-radius: var(--pc-radius-md);
```

## Conventions

- **Namespacing.** Every variable is `--pc-*` and every class is `.pc-*`. This is
  deliberate: the new system sits *alongside* the legacy `src/index.css` without
  overriding it. A page only changes appearance once it is migrated to these
  components (Parts 1b / 1c). Nothing changes "by accident".
- **No font below 12px.** The smallest token is `--pc-fs-12`.
- **8px spacing grid.** Use `--pc-sp-*`, not hard-coded pixel values.
- **Greek text.** All components must render Greek correctly — the demo page
  exercises this with `ΑΧΙΛΛΕΥΣ & ΑΙΜΙΛΙΟΣ ΚΩΝΣΤΑΝΤΙΝΟΣ ΑΙΜΙΛΙΑΝΙΔΗΣ Δ.Ε.Π.Ε.`

## Components

| Component | Purpose |
|-----------|---------|
| `Button` | `primary` / `secondary` / `destructive` / `ghost`, sizes `sm`/`default`/`lg`, `iconOnly`. |
| `Input` | Text / number / email / password; `multiline` renders a textarea. `invalid` for error state. |
| `Select` | Styled `<select>`; pass `options` or `<option>` children. |
| `FormField` | Label + control + helper/error wrapper. |
| `Card` | White panel with optional header bar; `clickable` adds a hover lift. |
| `Modal` | Portalled, centred, Esc + backdrop close, scroll-locked. `size="lg"` for forms. |
| `DataTable` | Generic table: sticky header, optional pagination footer + empty state. |
| `Toolbar` | Page header: title + actions, optional second row. |
| `FilterBar` | Horizontal strip of filter chips. |
| `RecordCounter` | "Showing 1–50 of 238" + pagination + page-size selector. |
| `EmptyState` | Friendly placeholder for empty lists. |

## Verifying

Run the dev server and open **`/design-system`** while logged in. The page renders
every component in isolation for sign-off before any real page is migrated.

## Status

- **Part 1a** — foundation (this) — ✅ built, awaiting verification.
- **Part 1b** — migrate high-traffic pages — not started.
- **Part 1c** — migrate remaining pages — not started.
