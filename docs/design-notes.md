# Design notes — Tielora

How Tielora looks and behaves today. The code is the source of truth: colours live in
`src/app/globals.css`, shared pieces in `src/components/ui/` and `src/components/shell/`.
The house rules are in `docs/CONVENTIONS.md` (rules 6 and 7 cover text and colour).

## Colour tokens

Defined once in `:root` in `src/app/globals.css`, also exposed to Tailwind as `brand-*`,
`status-*`, `page`, `surface` and `border-soft`. In components we write `var(--brand-primary)`.

Brand colours:

| Token | Value | Used for |
|---|---|---|
| `--brand-primary` | `#2e5aac` | Primary buttons, links, active items, in-progress status |
| `--brand-ink` | `#152647` | Sidebar background, headings, dark surfaces, modal backdrop tint |
| `--brand-mid` | `#1f3d77` | Hover on primary buttons and on the dark sidebar |
| `--brand-accent` | `#46c4b0` | Keyboard focus ring, progress fill, small highlights |
| `--brand-text` | `#4a4e57` | Body text. A warm gray; never pure black |
| `--brand-gray` | `#a9aeb8` | Muted text, disabled buttons, "not started" status |
| `--brand-stone` | `#d8d2c4` | Rare secondary accent; the "awaiting review" badge |

Status colours:

| Token | Value | Meaning |
|---|---|---|
| `--status-not-started` | `--brand-gray` | Not started |
| `--status-in-progress` | `--brand-primary` | In progress |
| `--status-blocked` | `#b54a4a` | Blocked, errors, danger buttons. The only red on screen |
| `--status-awaiting-review` | `--brand-stone` | Awaiting review (use dark text on it) |
| `--status-completed` | `#3e7a5e` | Completed. A muted green |

Surfaces:

| Token | Value | Used for |
|---|---|---|
| `--page-bg` | `#f5f6f7` | Page background; hover fill on rows and menu items |
| `--surface` | `#ffffff` | Cards, top bar, modals, menus |
| `--border` | `#e3e5e6` | 1px borders on cards, tables, the top bar |
| `--radius` | `6px` | Corner radius on cards, buttons, inputs, menus |

Overdue is shown as red text or icon next to the date, not as a sixth badge colour.

## Rules that never bend

- **No new hex, brand tokens only** (CONVENTIONS house rule 7). Reach for a token above. If none
  fits, talk to the lead; do not add a colour.
- **The one deliberate exception:** Microsoft's four-colour logo on the "Sign in with Microsoft"
  button. It is served as a picture file, `public/brand/microsoft-logo.svg`, so its hex values stay
  in the file and never appear in our code. The login-page test checks this.
- **Light only.** There is no dark theme and no `prefers-color-scheme` handling. Do not add one.
- **Plain-English text.** Sentence case, no jargon, no stack traces. Dates read "30 Sep 2026"
  (built with `Intl` in `src/components/format.ts`; no date library). The app is English-only.

## Typography

One font stack, set on the page and as Tailwind's `font-sans`:
`Candara, "Segoe UI", "Trebuchet MS", system-ui, sans-serif`. No web fonts are loaded.
Body text is `--brand-text`; card titles and headings are `--brand-ink`, semibold. Card titles are
`text-sm`; small helper text is `text-xs`. The wordmark is "Tielora", semibold with tight tracking.

## Layout

**Shell** (`src/components/shell/`, assembled in `src/app/(app)/layout.tsx`):
- Top bar: 56px tall, white, 1px bottom border. Holds the menu button (phone only), search, and the
  user menu. The user's name hides on very narrow screens.
- Sidebar: dark `--brand-ink`. Hidden below 768px; icon rail (64px) from 768px; full 240px with
  labels from 1024px. One set of markup, with `hidden lg:...` classes doing the switching.
- Phone: a slide-in menu (`mobile-nav.tsx`), at most 80% of the screen wide, opened from the top bar.
- Content area: grey `--page-bg` with white cards on top.

**Designed and checked at two sizes:** phone-first at **390px** wide, and laptop at **1440px**.
Anything between should simply flow.

**Cards or tables:**
- A `Card` is a white box with a 1px border, 6px corners, an optional title row and 16px padding.
  Use cards for summaries, groups of facts and anything read on a phone.
- Tables are for long comparable lists (tasks, users, documents) on laptops. On a phone the same
  data becomes stacked cards or rows rather than a squeezed table, or scrolls sideways inside its card.
- The dashboard shows six stat tiles (2 across on a phone, 3 from 640px, 6 from 1024px) and then
  two-column card pairs from 1024px, single column below.

**Sheet or side panel:**
- `Modal` (`ui/modal.tsx`): a centred dialog, three widths (`sm`, `md`, `lg`), up to 90% of the
  screen height, scrolls inside, 44px close button, dark tinted backdrop. For short forms and confirmations.
- Ask Tielora (`ai/ask-tielora-panel.tsx`): a **bottom sheet** on phones (92% of the height, rounded
  top, respects the iPhone safe area) and a **full-height side panel** on the right from 1024px.
  Both slide in over 200ms, and only when the person has not asked for reduced motion.
- Menus such as Export are small popovers under their button.

## Touch targets, hints and feedback

- **44px minimum** for anything pressed: `min-h-11` on buttons and links, `h-11 w-11` on icon-only
  buttons (modal close, Ask Tielora close). Menu rows in the Export menu are 44px too.
- **Icon-only buttons always have a name and a hint**: an `aria-label` for screen readers and a
  `title` tooltip for sighted users. A disabled action explains why in its tooltip instead of just greying out.
- **Buttons** (`ui/primitives.tsx`): `primary`, `secondary`, `danger`, `ghost`. Disabled turns grey
  (`--brand-gray`); a `loading` prop shows a `Spinner` and blocks double clicks.
- **Fields**: `Field` wraps a label, optional hint and an error line for `Input`, `DateInput`,
  `Textarea` and `Select`.
- **Focus**: every focusable thing gets a 2px `--brand-accent` outline, offset 2px, from one rule in
  `globals.css`. Never remove it.
- **Skeleton loaders** (`ui/skeleton.tsx`): `Skeleton` and `SkeletonRows` (default `h-9`, `h-11`
  on admin lists) fill the space while a page loads, in each route's `loading.tsx`. Spinners are only
  for buttons. Empty lists use `EmptyState`; failures use `ErrorBanner`; confirmations use `toast`.

## Screens at a glance

- **Dashboard**: stat tiles, then "my tasks" grouped by when they are due, progress by discipline,
  upcoming deadlines and recent activity, as cards.
- **Project page**: header with breadcrumb, status, a secondary "Ask Tielora" button (sparkle plus
  words, 44px) and the Export menu; below it, tabs and filter chips over the task list.
- **Export menu**: one button, "Export a status report". It opens a short list of formats, each with a
  one-line hint such as "Best for printing or email".
- **Admin** (people, disciplines, integrations, billing, data privacy): cards and tables under the admin
  area. Integrations and billing show a card per service; an option the plan does not include is
  disabled with a tooltip or left out, never half-working.
- **Login**: a hero picture panel (`public/login-hero.webp`) with the Tielora wordmark next to a
  simple form. Microsoft sign-in uses the logo file described above. No sign-up link: accounts are
  created by an admin.

## Before you ship a screen

Check it at 390px and 1440px; confirm there is no hex in the diff; every icon-only button has a
label and a tooltip; every pressable thing is at least 44px; loading shows a skeleton; text is plain
English in sentence case; dates read "30 Sep 2026".
