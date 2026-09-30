# Tielora — UI spec: Export report, weekly-brief switch, dashboard tiles and Late/Upcoming

Companion to `docs/specs/align-2026-10/briefs-and-status-report.md` (sections C, E and screen A). Builders copy from the live code, not `docs/design-notes.md`.
Rules followed: `CONVENTIONS.md` house rules 6-8 (plain English, dates like "30 Sep 2026", brand tokens from `src/app/globals.css` only, no new hex) and the EXTERNAL rule (a contractor sees no Export at all).

**Mobbin references:** pulled by the orchestrator on 30 Sep 2026 — listed under "Prior art" at the bottom of this file. They inform, they do not replace the app's own styling.

**Proposed additions to the design system: none.** Everything below uses the existing `Button`, `Card`, `Badge`, `Skeleton`, `useToast`, `ErrorBanner` and the menu pattern already in `src/components/shell/topbar.tsx` (button with `aria-haspopup="menu"`, panel with `role="menu"`). Tokens named below all exist in `globals.css`.

---

## 1. Export button and menu (project header)

File to change: `src/components/projects/project-view.tsx` (the `<header>` block). New small component `ExportMenu` beside it; copy the open/close menu behaviour from `topbar.tsx`.

**Purpose:** let a manager or team member download a status report of this project as PDF or PowerPoint.

### Who sees it
Everyone signed in except contractors. A contractor gets no button, no space where it would be, and no menu (the page already knows they are external: `isExternalUser`). While "who am I" is still loading, render nothing (no flash of a button that then disappears).

### Phone (390px)
- Header stays stacked as today. Row 1: project name (24px, `--brand-primary`), wrapping freely. Row 2: code pill, status badge, favourite star. **New Row 3, the action row:** "Edit" (ghost, managers only) on the left, "Export" on the right edge of the row. Progress text and bar follow as today.
- Export is the `secondary` button (white, `--brand-primary` border and text), with a small download icon then the word "Export" (icon + text, so it is not an icon-only button). Height **44px** minimum (add `min-h-11`; the shared Button is only about 36px tall). Edit gets the same `min-h-11` here.
- Pressing it opens the menu **directly under the button, right edge aligned to the button's right edge** (so it can never run off the 390px screen). Panel: white, `--border` outline, 6px radius, shadow, 224px wide, same look as the account menu in `topbar.tsx`.
- Menu has two rows, each **44px tall, full panel width**:
  - **PDF** — small grey second line: "Best for reading and emailing"
  - **PowerPoint** — small grey second line: "Best for editing and presenting"
  Second lines use `--brand-text` at 12px (not `--brand-gray`, which is too pale for reading in daylight). Hover/press: `--page-bg` background.
- Hover hints (`title`): button "Download a status report for this project"; PDF "Download as a PDF file"; PowerPoint "Download as a PowerPoint file (.pptx)".
- Closes on: choosing an item, tapping outside, Escape (focus returns to the button). Arrow keys move between the two items.

### Laptop (1440px)
- Name, code pill, status badge and star stay on the left of one line. **Edit and Export move to the far right of that same line** (push with `ml-auto`), 8px apart, Export last (reading-end). Nothing stretches; the progress block keeps its `max-w-md`, so the wide empty area to its right stays empty rather than filling with controls.
- Keep the buttons 44px tall (`min-h-11`) on wide screens too — laptops can have touch screens, so they never drop back to the 36px look.
- Menu drops under the button, right-aligned, same 224px width. Hover shows `--page-bg` on a row.

### Button states
| State | Look |
|---|---|
| Default | Secondary button, download icon + "Export" |
| Hover | `--page-bg` background (as existing secondary) |
| Pressed / menu open | Same, `aria-expanded` true, background `--page-bg` |
| Focus | Existing focus ring (`--brand-accent`) |
| Generating (loading) | Menu closes. Button shows the spinner and "Preparing your report…", disabled, width fixed (`min-w-[11rem]`) so nothing jumps. Screen readers hear "Preparing your report" (`aria-busy`). Edit stays usable. |
| Slow (over 10 seconds) | Text becomes "Still working… big projects take a bit longer." |
| Cooling down after a 429 | Button disabled (grey, `--brand-gray`) for the seconds in `Retry-After` (never more than 60), hint "You can export again in a moment." |

### Outcomes
- **Success:** the browser saves `<PROJECT-CODE>-status-<yyyy-mm-dd>.pdf` (or `.pptx`). At the same moment a green toast (existing `useToast`, tone success): "Your PDF report is ready. Check your downloads." / "Your PowerPoint report is ready. Check your downloads." (Toast sits bottom-right at 1440px; on phone it must not sit under the bottom nav — builder checks `mobile-nav.tsx`.)
- **Errors** appear as a small red line (`--status-blocked`, 14px, `role="alert"`) **directly under the action row**, with a "Dismiss" text button (44px tall tap area); it clears on the next Export attempt. No toast for errors, so the message is not shown twice.
  - Too many (429): "You have exported a lot of reports just now. Please wait a minute."
  - Not found: "We could not find that project."
  - Anything else, including no connection: "We could not build that report. Please try again."
- Nothing on the page changes while the file builds; the person can keep browsing tabs.

### Header "late" badge (same file, from spec section D)
Replace "N overdue" with "N late" in `--status-blocked`, bold; hover hint states the parts in words: "2 main tasks and 5 discipline tasks are past their deadline." (Wording adapts: "1 main task", "no discipline tasks".)

---

## 2. What the report looks like (PDF and PowerPoint share one design)

**Format.** PDF: A4 **landscape**. PowerPoint: 16:9 widescreen. Landscape because the timeline needs width. Same pages/slides, same order, same numbers.
**Colours** (copied once into one report-theme file from `globals.css`; the libraries cannot read CSS variables — no new values):
- Cover background `--brand-ink`; cover text white; accent line and big figure `--brand-accent`; progress track `--brand-mid`.
- Content pages: white background; page title `--brand-primary`; body text `--brand-text`; hairlines and table borders `--border`; zebra rows and phase bands `--page-bg`; table header row `--brand-ink` with white text.
- Status colours as on screen: not started `--status-not-started`, in progress `--status-in-progress`, blocked `--status-blocked` (the only red), awaiting review `--status-awaiting-review`, completed `--status-completed`.
- Anything a person must read is `--brand-text` or darker. `--brand-gray` is for lines and disabled looks only (too pale to read printed).
**Type.** One built-in sans font (the library's own; no runtime download). Sizes: cover title 36, page title 22, body/table 12 (PowerPoint body 14), footer 9. Nothing under 9. Numbers that matter are bold and sit at the right end of their row.
**Every content page:** title top-left; thin `--border` rule under it; footer left "Generated by Tielora from live project data on 30 Sep 2026."; page number right ("Page 2 of 6"; slides show the slide number). Outer margin 36pt (PDF) / 0.5in (PowerPoint). In the PowerPoint, each slide's title is a real title (so screen readers and outline view work). Colour never carries meaning alone: late bars also carry a "+5 d" label, blocked rows also say "Blocked".

**Page 1 — Cover / summary.** Full `--brand-ink` page. Top-left small "Tielora" wordmark text. Middle-left: project name (36, white, wraps to 2 lines), beneath it the project code in a pill (`--brand-accent` fill, `--brand-ink` text), then "Status report · 30 Sep 2026". Right side: the overall progress as a huge "64%" (72pt, `--brand-accent`) with a progress bar under it and "12 of 19 main tasks complete". Bottom band, one line in white: "3 main tasks and 5 discipline tasks late · 2 blocked · 7 required documents missing". (On a zero, keep the word: "0 blocked".) No footer rule on the cover; the "Generated by Tielora…" line sits at the bottom in white.

**Page 2 (+ continuation) — Timeline snapshot.** Left column (about 25% width): main task names, each followed by its discipline tasks indented and smaller. Right area: month scale across the top with the year on the first month and every January ("Sep 2026"), thin vertical month lines in `--border`. Phase bands: alternating `--page-bg` / white stripes behind the rows with the phase name at the top of each band. Main tasks are bars in their status colour; discipline tasks are thinner bars underneath in their status colour. A **Today** line: dashed `--brand-ink`, labelled "Today" at the top. Late bars: red outline plus "+5 d" at the bar end. Legend along the bottom: the five status colours, "Late", "Today".
- Capped at 40 main-task rows; below the last: "and 12 more main tasks (all are counted in the numbers)".
- A main task and its discipline tasks are never split across pages; it flows to "Timeline (2 of 3)". Show at most 6 discipline bars under one main task, then "+4 more" (my proposal, to keep the page readable; builder may raise it if the library copes).
- No dates on the project (no start/target)? The empty page says: "This project has no dates yet, so there is no timeline to draw."

**Page 3 — What is late.** Title "What is late (8)". Table columns: Task · Type (Main / Discipline) · Discipline · Assigned to · Deadline ("12 Sep 2026") · Days late. Days-late cell is bold `--status-blocked`, at the right end. Newest slip first (fewest days late at the top) as the main spec says. Continues onto more pages if long, header row repeated. Empty: a centred line "Nothing is late. Everything open is on schedule."

**Page 4 — Who is blocking.** Title "Who is blocking". Section "Blocked tasks": one card per blocked task — task name, its assignee, then "Waiting on:" and one line per blocking task with its assignee ("Pump skid layout — Salma Al Hinai"). Card has a 4pt left edge in `--status-blocked`. Section "Locked phases": "Construction is locked, waiting on FEED, which still has 9 main tasks open." Unassigned tasks read "Not assigned". Empty: "Nothing is blocked right now."

**Page 5 — Documents.** Title "Documents". Top: "Required documents in place: 41 of 48" with a bar (`--status-completed` fill on `--border` track). Table per discipline: Discipline · In place / required ("6 of 8") · small bar. Then "Missing (7)": rows of document name · task · discipline · assigned to, capped at 25 then "and 12 more". Empty: "All required documents are in place."

Wording is written for people outside the company: no "click", no screen names.

---

## 3. Admin -> Integrations: weekly brief switch

File: `src/components/admin/admin-integrations-view.tsx`, the `EVENT_LABELS` list (add a seventh entry directly after "Daily brief"; same checkbox list, same card, for both Slack and Teams).
- Label: **Weekly brief**
- Helper line (12px, same style as the daily one): "Sent once a week, early Monday morning UTC. A summary of how far each project has come since last week, what became late, which gates opened and which required documents are still missing. Off unless you switch it on."
- Default: unticked for every existing channel.
- Tap target: the whole label row is at least **44px tall** (`min-h-11`, checkbox itself enlarged to 20px). Apply the same to the six existing rows while there.
- States: while saving, the group is disabled (existing). **Outcome message (new):** toast "Weekly brief is on. The first one goes out next Monday." / "Weekly brief is off." Failure keeps the existing "Couldn't change that. Try again."
- Nothing about email on this card (email is per person, in Your account).
- Phone: the row is one column, text wraps under the checkbox. Laptop: card keeps its current width; no change.

---

## 4. Dashboard (folded-in September spec) — `src/components/dashboard/dashboard-view.tsx`

**Dates everywhere on the dashboard carry the year** ("12 Sep 2026", via the shared `formatDate`, replacing `formatShortDate` in the sign-off list, Late and Upcoming).

### Tiles
- Small caption above the tile grid, 12px `--brand-text`: **"Across the whole company"**. For a contractor the caption is **"Your work"**. (The caption also covers what the tiles link to.)
- New labels (the tile hover hint, `title`, says exactly what is counted):
  | Now | New label | Hover hint |
  |---|---|---|
  | Total | **All tasks** | "Every main task and discipline task in the projects you can see." |
  | In progress | **In progress** | "Tasks someone is working on now." |
  | Completed | **Completed** | "Tasks that are finished." |
  | Blocked | **Blocked** | "Tasks that cannot move until something else is done." |
  | Overdue | **Late** | "Main tasks and discipline tasks past their deadline and not finished." |
  | Due soon | **Due in 14 days** | "Unfinished tasks with a deadline in the next 14 days. The same list as Upcoming below." |
- Where each tile leads is fixed by the September spec (each link must open exactly what the number counts); this spec changes labels only.
- Layout unchanged: phone 2 columns (three rows), tablet 3, laptop 6 across; tiles stay at least 80px tall (well over 44px). "Late" tile keeps the red alert look when above zero.
- Loading: existing grey tile skeletons. Error: existing banner.

### "Late" and "Upcoming" as two separate cards
Replaces the single "Upcoming deadlines" card. Order on the page: tiles, sign-off card, My tasks | Discipline progress, **Late | Upcoming**, Recent activity.
- **Phone:** all stacked, Late first (bad news before plans), then Upcoming, then Recent activity.
- **Laptop (1440px):** Late (left) and Upcoming (right) side by side in the existing two-column grid; Recent activity moves to its own full-width card underneath (its rows are wide and read better spread out; 8 items as today).
- **Late card:** title "Late (4)" (count in `--status-blocked`); action link "View all ->" to the late list. Up to 5 rows, most days-late first. Row, phone: line 1 task title (truncate); line 2 the date ("12 Sep 2026"), project-code pill, status badge, and at the right end "5 days late" in bold `--status-blocked` ("1 day late"). Laptop: one line — date (fixed 112px wide, so the year fits), title, pill and badge, "5 days late" at the far right. Rows are at least 44px tall and whole-row tappable, going to the task as today.
- **Upcoming card:** title "Upcoming (7)"; helper under title "Due in the next 14 days"; up to 5 rows soonest first, same row layout, but the right-end figure is "in 3 days" / "tomorrow" / "today" in `--brand-ink`. Nothing late ever appears here.
- Empty text: Late — "Nothing is late. Nice work, team." Upcoming — "Nothing due in the next 14 days. Enjoy the quiet."
- Loading: three skeleton rows in each card (existing `SkeletonRows`); the app has no dark theme today, so the existing grey skeleton is the whole answer. Error: existing `ErrorBanner` with retry, each card independent ("Couldn't load late tasks. Try refreshing the page." / "Couldn't load upcoming tasks. Try refreshing the page.").

---

## Builder checklist

- Every new button/menu row/checkbox row is at least 44px tall on phone; icon-only controls have `title` and `aria-label` (none new are icon-only; the existing favourite star keeps its own).
- Contractor: no `ExportMenu` rendered (and the server answers not found anyway).
- Reuse: menu behaviour from `src/components/shell/topbar.tsx`; toast from `src/components/ui/toast.tsx`; skeletons from `src/components/ui/skeleton.tsx`; buttons from `src/components/ui/primitives.tsx`.
- Report files never save anything on the server; the audit line is the server spec's job.

## Decisions for the owner's taste

1. Landscape pages (chosen) vs portrait A4 for the PDF — landscape suits the timeline, portrait suits printing.
2. Cover in dark navy (chosen) vs a white cover that saves ink when printed.
3. Recent activity going full width on laptop to make room for Late | Upcoming side by side.
4. The "Due in 14 days" tile label instead of "Due soon".

## Prior art (Mobbin, pulled 30 Sep 2026)

- [Magnific — Export menu](https://mobbin.com/screens/4f1857ae-772b-460d-8a56-ab40899c0e0a): an "Export" button top-right opening a small menu where each format has a one-line hint ("Ideal for documents or printing").
- [Perplexity — download menu](https://mobbin.com/screens/5ec280f1-2e52-4afa-85ea-ec910107f564): a compact file-type menu (PDF / Markdown / DOCX) with a small icon per format — the size our two-item menu should be.
- [Tana — document header menu](https://mobbin.com/screens/d1f5b0a9-80b1-49f0-88c6-cceb833fe0a7): a status-report page whose header menu sits right-aligned under its button, as this spec places ours.
- [Basecamp — export data](https://mobbin.com/screens/6c58b6ba-1ee9-4f5c-95f1-87a96294ccf1): says up front how long an export takes — our "Preparing your report…" line does the same job for a few seconds' wait.

**Changed after prior-art review:** each menu item gets a one-line hint under its name — PDF: "Best for printing or email"; PowerPoint: "Best for presenting in a meeting".
