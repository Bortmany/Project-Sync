# Project Nexus — UI spec

Internal Oman LNG multidisciplinary engineering coordination platform. Desktop-first (design canvas: 1440px), English-only, no RTL. Built from `docs/design-notes.md` — brand tokens, layout system, and component names below are taken verbatim from that doc; nothing here contradicts it.

This spec covers all 15 screens a builder needs. Component props/variants are collected once in **§15 Shared components** — every screen below references those names verbatim instead of redefining them.

## ⚠ Orchestrator decisions — these OVERRIDE anything below that contradicts them

1. **No mandatory review-confirmation gate.** "Mark complete" on a discipline task completes it directly (subject to required-document + dependency gating). `AWAITING_REVIEW` is an *optional* hand-set status an assignee/lead may choose from the status control when work needs eyes before completion — it is never an enforced step between "Mark complete" and `COMPLETED`. Ignore any "Confirm complete / Send back" flow described below.
2. **Upload limits ARE enforced** server-side: 25 MB per file, magic-number-verified whitelist (PDF, PNG, JPG, WebP, XLSX/DOCX/PPTX/ZIP, CSV/TXT, DWG). The dropzone must state "PDF, Office, images, CSV, DWG or ZIP — up to 25 MB" and surface the server's plain-English rejection.
3. **New users**: the Admin sets (or generates) an initial password shown once at creation. No SSO/AD in this version (architecture leaves room for Microsoft identity later).
4. **REVISED (golden rule):** individual document VERSIONS can never be deleted — the revision history is append-only, no exceptions. Only a whole document can be soft-deleted (Admin/PM), which keeps its version rows for audit and reopens any required-document checklist item it satisfied. Ignore any "deleting the Latest rev promotes the previous one" flow below.
5. PM sees a read-only Disciplines list in Admin; only ADMIN gets Users (kept).
6. Gantt dependency arrows: out of scope this version (kept).

---

## Global conventions (read once, applies everywhere)

**Roles:** `Admin/GM` (full access, every project, Admin section), `Project Manager` (`PM` — manages the projects they're on, creates main tasks, overrides status), `Discipline Lead` (`Lead` — manages their discipline's tasks within a project, reassigns within it, confirms discipline-task completion), `Engineer` (works their own assigned discipline tasks). A user's org-level role is set in Admin → Users; their **per-project role + discipline** is set separately on each project's Team tab (a Discipline Lead org-wide can still be added to a specific project as a plain Engineer, etc. — per-project assignment always wins for what that user can do inside that project).

**Breakpoints:**
- `≥1024px` — full 240px sidebar, full topbar, primary design target 1440px.
- `640–1023px` — sidebar collapses to a 64px icon rail (icons only, hover tooltip shows the label); topbar search collapses to an icon that opens the search modal; two-column page grids stack to one column.
- `<640px` — sidebar is replaced by a fixed bottom nav bar (56px, 5 items: Dashboard, Projects, My Tasks, Notifications, More). "More" opens a bottom sheet containing Admin (if the role permits), and the user menu/sign out. Topbar shrinks to 48px (page title + search icon + bell). The Gantt tab shows a fallback message on this width (see §9).

**Voice:** plain English, sentence case ("Mark complete", not "Mark Complete" or "MARK COMPLETE"). Dates render as `30 Sep 2026`; relative time only inside activity/notification feeds (`2 h ago`). No jargon, no exclamation-heavy copy.

**Standard state patterns** (visual treatment — exact copy is given per screen since it varies):
- **Loading:** skeleton blocks shaped like the real content (gray shimmer bars/rows), never a bare spinner for list content. A full-page fetch may use a centered spinner only for very first paint of the whole shell.
- **Error:** a banner at the top of the affected region — light red-tinted background, `#B54A4A` icon + text, message + a "Retry" text button. Never a blocking dialog for a failed read.
- **Empty:** `EmptyState` component. On full pages/tabs, illustration on (small sail-motif graphic). Inside compact chrome — dropdowns, small cards, popovers — illustration off, text only (per design-notes: sail motif never on dense working screens).
- **No results after filtering/search** (distinct from true empty): plain text, no illustration — "No `<items>` match your filters." + "Clear filters" text button.

**Focus/contrast:** focus rings use `--olng-sail`. Body text is always `--olng-text` (warm gray, never pure black). Page/section headings and links use `--olng-blue`. Minimum interactive height: 36px on desktop widths, 44px at `<1024px` breakpoints (thumbs get bigger targets once the layout admits touch use).

---

## 1. Login

**Purpose:** authenticate an existing, admin-created account. No self-signup.

**Layout — split screen:**
- **Left panel, 45% width** (hidden entirely below 768px): `--olng-navy` background with a gradient toward `--olng-mid`, overlapping translucent `--olng-sail` triangles (sail motif) layered bottom-left to top-right. Top-left wordmark: "OMAN LNG" (small caps, 11px, letter-spaced, sail-blue) over "Project Nexus" (28px semibold, white). Mid-panel tagline, 16px, white at ~80% opacity: **"Multidisciplinary coordination for engineering teams."**
- **Right panel:** remaining width, white background, form vertically and horizontally centered, max-width 400px.

**Form (right panel), top to bottom:**
1. Heading "Sign in" (22px semibold, `--olng-blue`).
2. Email field — label "Email", input placeholder "you@omanlng.com".
3. Password field — label "Password", input type password, show/hide eye-icon toggle.
4. Small muted line under the password field: "Forgot your password? Ask your Project Nexus admin to reset it." (plain text, not a link — there is no self-service reset flow).
5. "Sign in" primary button, full width, 44px height, `--olng-blue` background / white text.
6. Footer, bottom of the form panel, 12px muted: "© Oman LNG · Project Nexus".

No signup link anywhere on this screen.

**States:**
- **Default:** as above.
- **Validating/submitting:** button label changes to "Signing in…" with an inline spinner, button disabled, fields disabled.
- **Error (wrong credentials):** thin red border on both fields; inline banner above the button, red-muted background/text: "Incorrect email or password. Try again, or contact your admin if you're locked out."
- **Error (account deactivated):** same banner style: "This account has been deactivated. Contact your admin."
- **Error (network/server):** "Couldn't sign in right now. Try again in a moment."

**Responsive:** `<768px` — hero panel hidden; form takes full width, 24px side padding; a compact wordmark ("Oman LNG · Project Nexus", single line, 14px) appears above the "Sign in" heading in place of the hidden hero.

---

## 2. App shell

**Purpose:** the persistent chrome (sidebar + topbar) around every authenticated screen.

**Sidebar** (240px, `--olng-navy` background, fixed left, full viewport height):
- Top: wordmark block — "OMAN LNG" (small caps, sail-blue, 11px) over "Project Nexus" (white, 16px semibold). Click → Dashboard.
- Nav items (each 44px row, white/sail text, icon + label): **Dashboard, Projects, My Tasks, Notifications, Admin.**
  - Notifications row carries an unread-count badge (small sail-blue filled circle, white number) — hidden entirely when the count is 0.
  - **Admin** is visible only to `Admin/GM` and `PM` roles (per design-notes). It is not rendered at all for `Lead`/`Engineer`.
  - Active item: `--olng-mid` background fill + 3px `--olng-sail` left bar.
- Nothing pinned at the bottom of the sidebar — the user menu lives in the topbar, not duplicated here.

**Topbar** (56px, white background, 1px `#E3E5E6` bottom border, spans the width right of the sidebar):
- **Left:** `Breadcrumb` on nested pages (e.g. "Projects / LNG Train 5 Debottlenecking"); on top-level pages (Dashboard, Projects list, My Tasks, Notifications, Admin) shows the page title instead (20px semibold, `--olng-blue`).
- **Center:** global search input, placeholder "Search projects, tasks, documents, people…", a muted "⌘K" badge sits inside the input's right edge. Clicking the input, or pressing `⌘K`/`Ctrl+K` from anywhere in the app, opens the search modal (quick-results dropdown, detailed in §12). `Esc` closes it.
- **Right:** notification bell icon button (unread badge = small sail-blue dot) → opens the bell dropdown (§13). Then the user menu: `Avatar` (initials, navy bg) + small chevron → dropdown showing the user's name, role/discipline line (e.g. "Discipline Lead · Mechanical"), a divider, then "Sign out".

**Content area:** below the topbar, `#F5F6F7` background, 24px padding, no max-width (information-dense engineering screens use the full width).

**Responsive:**
- `1024–1439px`: unchanged structurally; content grids reflow to fewer columns where noted per screen.
- `640–1023px`: sidebar becomes a 64px icon rail — icons only, centered, active state keeps the mid-bg + sail left bar; hovering an icon shows its label in a small tooltip. Topbar search collapses to a magnifier icon button that opens the same search modal full-width.
- `<640px`: sidebar hidden completely. A fixed bottom nav bar (56px, white, top border) replaces it with 5 icon+label (10px) items: Dashboard, Projects, My Tasks, Notifications (badge), More. "More" opens a bottom sheet listing Admin (role-gated as above) and the user menu/Sign out. Topbar shrinks to 48px: page title + search icon + bell icon (avatar/user menu moves into the More sheet).

The shell itself has no empty/loading/error state — it is structural chrome present on every authenticated screen.

---

## 3. Dashboard

**Purpose:** at-a-glance status on landing — org-wide for `Admin/PM`, own scope for `Lead/Engineer`. Layout is identical across roles; only the data scope changes (no region is hidden by role on this screen).

Page title "Dashboard" (`--olng-blue`, 20px semibold), no breadcrumb.

**Row of 6 `StatTile`s** (equal width, 16px gap; wraps 3×2 at `<1024px`, 2×3 at `<640px`): **Total, In progress, Completed, Blocked, Overdue, Due soon** (due within 7 days). The Overdue tile's number renders in red (`tone="danger"`) whenever it's greater than 0. Clicking any tile navigates to My Tasks (§11) pre-filtered by that status.

**2-column grid** (stacks to 1 column `<1024px`, 24px gap):

- **"My tasks" `Card`** — header "My tasks" + "View all →" link (→ §11). Groups: Overdue / Today / This week / Later, each a small-caps 11px muted header with a count, e.g. "OVERDUE (2)" — a group header is omitted entirely when its count is 0. Row (44px): `StatusBadge` (dot variant) + bold linked title (→ discipline-task or main-task detail) + muted project-code chip + deadline (red text if overdue).
  - Empty: `EmptyState`, no illustration (compact card) — "No tasks assigned to you yet. Once you're added to a discipline task, it'll show up here."
  - Loading: 4 skeleton rows under a skeleton group header.
  - Error: "Couldn't load your tasks. Try refreshing the page." + Retry.

- **"Discipline progress" `Card`** — header "Discipline progress". `Admin/PM`: one row per discipline, org-wide average across all projects. `Lead/Engineer`: rows limited to their own discipline(s). Row: `DisciplineDot` + name + `ProgressBar` (sail fill on gray track) + right-aligned percentage. Click a row → My Tasks filtered to that discipline.
  - Empty: "No discipline tasks yet. Progress will appear here once tasks are created."
  - Loading: 4 skeleton bar rows.
  - Error: "Couldn't load discipline progress. Try refreshing the page."

**Second 2-column grid** below (stacks `<1024px`):

- **"Upcoming deadlines" `Card`** — header + "View all →" (→ My Tasks sorted by deadline). Next 5 items across main + discipline tasks, nearest first. Row: bold date ("22 Aug"), title, project-code chip, `StatusBadge`.
  - Empty: "Nothing due soon. You're all caught up."
  - Loading: 3 skeleton rows.
  - Error: "Couldn't load upcoming deadlines. Try refreshing the page."

- **"Recent activity" `Card`** — header only, no "view all" (full history lives on each project's Activity tab). Last ~8 events across projects the user can see, using `ActivityItem`, day dividers if spanning more than one day.
  - Empty: "No activity yet. Things will start showing up here as work gets underway."
  - Loading: 5 skeleton `ActivityItem` rows.
  - Error: "Couldn't load recent activity. Try refreshing the page."

---

## 4. Projects list + "New project" flow

**Purpose:** browse every project the user can see; `Admin/PM` create new ones.

**Header:** title "Projects" (`--olng-blue`, 20px) + primary button "+ New project" top-right, visible only to `Admin/PM`.

**Toolbar:** search input "Search projects…" + `FilterChips` (Status: Active / On hold / Completed / Archived).

**`DataTable`** (44px rows), columns: Project name (bold link → Project overview §5) with a muted code chip beside it; Status (`StatusBadge`: Active = blue, On hold = sand, Completed = green, Archived = gray); Progress (`ProgressBar`, "n/m main tasks" fraction variant); Disciplines (stacked `DisciplineDot`s + overflow count); Team (`AvatarGroup`); Start date; Deadline (red text if overdue and status isn't Completed). Row click anywhere → Project overview.

**States:**
- Empty, `Admin/PM`: `EmptyState` (illustrated) — "No projects yet. Create the first one to start coordinating work." + "+ New project" button.
- Empty, `Lead/Engineer`: "You haven't been added to any projects yet. Check with your Project Manager." — no action button.
- Loading: 6 skeleton rows.
- Error: "Couldn't load projects. Try refreshing the page." + Retry.
- No results after filter/search: "No projects match your filters." + "Clear filters".

### New project flow (`Admin/PM` only)

A single `Modal` (size `md`), 3-step wizard — "Step 1 of 3" label + 3 progress dots in the header, Back/Next/Create in the footer, X to cancel (top-right, always present). If any field has been touched, closing shows a confirm sub-dialog: "Discard this new project? Your changes won't be saved." — Discard / Keep editing.

**Step 1 — Details:**
- Name (text, required)
- Code (text, required, placeholder "e.g. LNG-T5", helper text "Short code used in task lists and tags", auto-uppercased, checked for uniqueness on blur — inline error "This code is already in use." if taken)
- Start date / Deadline (`DateInput` × 2) — deadline must be on or after start; inline error "Deadline can't be before the start date."
- Description (textarea, optional, placeholder "What's this project about?")
- "Next" disabled until Name, Code, Start date and Deadline are all valid.

**Step 2 — Disciplines:**
- Heading "Which disciplines are involved in this project?"
- Checklist grid of the 8 org disciplines (Mechanical, Electrical, Instrumentation, Civil, Process, HSE, Reliability, Inspection), each row = checkbox + `DisciplineDot` + name.
- These selections become the project's discipline roster, used later everywhere a discipline picker is scoped to "this project."
- "Next" disabled until at least one is checked.

**Step 3 — Team:**
- Heading "Add people to this project"
- Repeating row: `UserPicker` (search org users) + Role select (Project Manager / Discipline Lead / Engineer) + Discipline select (enabled and required only when Role is Discipline Lead or Engineer; options come from Step 2's chosen disciplines) + a remove (×) button. "+ Add person" link appends a row.
- The creating `PM`/`Admin` is pre-added as a Project Manager row. At least one Project Manager row must remain; removing the last one shows inline: "A project needs at least one Project Manager."
- Footer button here reads "Create project" (replaces Next). Disabled until every row has a Role (and a Discipline where required).
- Submit → button shows "Creating…"; on success the modal closes, `Toast` "Project [code] created.", and the app navigates straight into the new Project overview (§5), Team tab pre-populated.
- Error: inline banner inside the modal — "Couldn't create the project. Try again." — all entered data is retained.

---

## 5. Project overview

**Header** (below topbar, above tabs): `Breadcrumb` "Projects / [Project name]". Title = project name (`--olng-blue`, 22px) + muted code chip + project `StatusBadge`. Below: progress line "6 of 10 main tasks complete · 60%" + `ProgressBar`. Meta row (small, muted): Start date — Deadline · stacked `DisciplineDot`s. A small "Edit" icon button (`Admin/PM` only) opens a single-step `Modal` reusing the Step-1 fields from the New Project flow (name, code, dates, description, status).

**Tabs** (`Tabs` component, directly under the header): **Tasks | Gantt | Documents | Team | Activity.**

### Tasks tab (default)
- "+ New main task" primary button top-right — `PM/Admin` only (§6).
- `FilterChips` row: Status, Discipline, Priority, Assignee, Deadline (each via a "+ Filter" popover — checklist for multi-select dimensions, date-range for Deadline).
- Sort dropdown (Deadline / Priority / Status / Title; default Deadline ascending).
- `DataTable` (44px rows): Title (bold link → Main-task detail §7), Disciplines (stacked `DisciplineDot`s + count), Progress ("3/5" + thin bar), Deadline (red if overdue, amber if due within 7 days), Status (`StatusBadge`), Priority (`PriorityFlag`).
- Empty, `PM/Admin`: "No main tasks yet. Break this project down into tasks to get the team moving." + "+ New main task".
- Empty, `Lead/Engineer`: "No main tasks yet. Check back once your Project Manager sets up the work." — no button.
- Loading: 8 skeleton rows. Error: "Couldn't load tasks. Try refreshing the page." + Retry.
- No results after filter: "No tasks match your filters." + "Clear filters".

### Gantt tab
Full behaviour in §9 — embedded here as the tab's content.

### Documents tab
Full behaviour in §10 — scoped to every document across this project's main and discipline tasks (includes the "Location" column described there).

### Team tab
Manage this project's disciplines and members. `Admin/PM` see edit controls; `Lead/Engineer` see the same content read-only.

- **"Disciplines" `Card`:** row per project discipline — `DisciplineDot` + name, current Lead (`Avatar` + name, or muted "No lead assigned"), member count in that discipline within this project. `Admin/PM` actions: "Set lead" (opens `UserPicker` scoped to members already assigned to that discipline on this project; if none, shows "Add members to this discipline first" instead of the picker); "Remove" (disabled with tooltip "Remove members from this discipline first" unless the discipline currently has zero members on this project). "+ Add discipline" button opens a checklist of org disciplines not yet on this project (same UI as New Project Step 2) and adds the selection.
- **"Members" `Card`:** `DataTable` — `Avatar` + name, email (muted), project role (Project Manager / Discipline Lead / Engineer), Discipline (`DisciplineDot` + name, "—" for Project Manager rows). `Admin/PM` actions: inline "Change role/discipline" selects, and "Remove from project" (confirm dialog: "Remove [Name] from this project? They'll lose access to its tasks and documents." — Remove / Cancel; blocked with "Assign another Project Manager before removing this one." if it's the last PM). "+ Add member" opens the same picker/role/discipline row used in New Project Step 3, one row at a time.
- Loading: skeleton rows in both cards. Error, per card: "Couldn't load disciplines. Try refreshing the page." / "Couldn't load team. Try refreshing the page."

### Activity tab
Single-column `ActivityItem` feed of everything on this project (task changes, document uploads, member changes, status overrides), day dividers.
- Empty: "No activity on this project yet."
- Loading: 6 skeleton `ActivityItem`s. Error: "Couldn't load activity. Try refreshing the page." + Retry.

---

## 6. "New main task" flow

**Purpose:** `PM/Admin` create a main task and its discipline tasks in one pass — minimal clicking, one continuous form, not a page maze. Opened from the Project overview → Tasks tab → "+ New main task".

A single `Modal` (size `lg`, scrollable body), title "New main task" with the project name as a subtitle chip. X to cancel, with the same discard-confirmation as the New Project flow if fields are dirty. No step indicator — everything scrolls in one form with section dividers.

**Section "Details":**
- Title (text, required)
- Description (textarea, optional)
- Priority (segmented control: Low / Medium / High — default Medium)
- Start date / Deadline (`DateInput` × 2, deadline ≥ start, same inline error as the project form)

**Section "Disciplines involved":**
- Checklist of *this project's* discipline roster only (not the full org list): checkbox + `DisciplineDot` + name.
- Checking a discipline expands an indented row builder beneath it:
  - Assignee (`UserPicker`, filtered to this project's members already on that discipline). If none exist yet, the checkbox is disabled and shows: "No one's assigned to [Discipline] on this project yet — add them in the Team tab first."
  - Deadline (`DateInput`, defaults to the main task's deadline, editable, must be on/before it — inline error "Discipline task deadline can't be after the main task's deadline.")
  - Required documents — repeating rows: name/category text input (e.g. "Isometric drawing") + remove (×); "+ Add required document" appends a row. Zero rows is valid; when empty, a muted note reads: "No required documents — this discipline task can be marked complete without an upload."
- Unchecking a discipline instantly collapses and discards its row builder (no confirmation needed — nothing is destructive yet since the main task hasn't been created).
- At least one discipline must be selected.

**Footer:** "Create main task" primary button — disabled until Title and dates are valid, at least one discipline is selected, and every selected discipline has an assignee. While disabled for the assignee reason, helper text under the button reads: "Add an assignee for each selected discipline to continue."

**Submit:** button shows "Creating…" → modal closes → `Toast` "Main task '[Title]' created with [n] discipline tasks." → navigates to the new Main-task detail (§7).
**Error:** inline banner in the modal — "Couldn't create this task. Try again." — all entered data retained.

---

## 7. Main-task detail

`Breadcrumb`: "Projects / [Project] / [Main task title]".

**Header:** Title (`--olng-blue`, 20px) + `StatusBadge` + an "Overridden" sand chip when the status was manually set (click/hover shows a tooltip: "Overridden by [Name] — see Activity for the reason") + `PriorityFlag`. Below: progress line "3 of 5 disciplines complete · 60%" + `ProgressBar`. Deadline shown in red text if overdue.

**Two-column body** — right meta rail (280px, sticky) + main column. Stacks to a single column (rail moves below main content, full width) at `<1024px`.

**Meta rail:**
- Owner (`Avatar` + name — the responsible PM; editable via `UserPicker` by `Admin/PM`)
- Created by / date
- Start date, Deadline
- Priority (editable dropdown, `PM/Admin` only)
- Disciplines involved (static list, `DisciplineDot` + name)
- Actions (role-gated, only rendered rows shown — no placeholder if a role has none):
  - "Edit details" (`PM/Admin`) — opens the Details-section fields from §6 in a small modal.
  - "Override status" (`PM/Admin`) — opens the Override-status dialog below.
  - "Delete main task" (`Admin` only) — destructive; confirm dialog: "Delete '[Title]'? This removes all its discipline tasks, documents, and comments. This can't be undone." Delete (red) / Cancel.

**Main column:**
- "Discipline progress" section — one `Card` per discipline task: `DisciplineDot` + name, discipline-task title, assignee `Avatar` + name, deadline (red if overdue), `StatusBadge`, its own required-docs chip ("2/3 docs"). Whole card clicks through to the Discipline-task page (§8). A Blocked card gets a subtle red-tinted left border and a truncated italic preview under the title, e.g. "Blocked: Waiting on vendor drawing."
- Below the cards, `Tabs`: **Documents | Comments | Activity** — scoped to the main task itself (each discipline task has its own separate set on its own page, §8).
  - **Documents:** the pattern from §10, scoped to this main task.
  - **Comments:** `CommentComposer` (with @mention popover of project members) at top, thread below (`Avatar` + name, timestamp, text; edit/delete only on the author's own comment). Empty: "No comments yet. Start the discussion." Loading: 3 skeleton rows. Error: "Couldn't load comments. Try refreshing the page." + Retry.
  - **Activity:** `ActivityItem` feed of this main task plus a roll-up of its discipline tasks' key events, including override entries with the reason inline: "**Ahmed** overrode status to Completed — reason: 'Client waived final inspection doc, approved via email.'" Empty: "No activity yet." Loading/Error: standard pattern.

**Override-status dialog** (`Modal`, size `sm`, `PM/Admin` only):
- Title "Override task status"
- Explanation: "This task can't reach [target status] yet because [n] discipline task(s) or required documents aren't complete. Overriding will force the status and record your reason for the audit trail."
- New status (select: Completed / In progress / Blocked)
- Reason (textarea, required, placeholder "Why are you overriding the normal completion rules?"; inline error if left empty on submit: "A reason is required to override status.")
- Footer: "Apply override" (`--olng-blue`, small warning icon) / Cancel.
- On success: `Toast` "Status overridden to [Status]." — header badge and "Overridden" chip update; the Activity tab logs the reason, visible to everyone with access to the task.

---

## 8. Discipline-task page

**Purpose:** the engineer's single-purpose workspace for their assigned piece of a main task.

`Breadcrumb`: "Projects / [Project] / [Main task] / [Discipline]".

**Header:** small-caps muted discipline label (e.g. "MECHANICAL") with its `DisciplineDot`, then Title (`--olng-blue`, 20px, defaults to the main task's title, editable), `StatusBadge`, assignee `Avatar` + name with a "Reassign" pencil icon (opens `UserPicker` scoped to this project's members on this discipline — visible to `Lead/PM/Admin` only), deadline (red if overdue), and a line "Part of: [Main task title] →" linking back.

**Status bar**, directly under the header — highlighted strip showing the current `StatusBadge` plus status controls (all controls below are visible to the assignee and to `Lead/PM/Admin`; anyone else sees the status bar read-only):
- If `NOT_STARTED`/`IN_PROGRESS`: secondary buttons "Start" (Not started → In progress) and "Mark as blocked".
- If `BLOCKED`: the reason shows inline — "Blocked: [reason]" — with a "Resolve block" secondary button.
- If `AWAITING_REVIEW` (see below): the assignee sees, in place of controls, muted text "Waiting on [Lead name] to confirm."; `Lead/PM/Admin` see "Confirm complete" (primary) and "Send back" (secondary).

Single column below, max-width ~760px centered in the content area, generous spacing:

1. **"What's required" `Card`:** description (from task creation; edit icon for `Lead/PM/Admin`), then a required-documents checklist: each row = ✓ (green, satisfied) or ✕ (red-muted, missing) + document name; satisfied rows show uploader + date + "View"; missing rows show muted "Not uploaded". If the task has zero required documents, this replaces the checklist with a muted note: "No required documents for this discipline task."
2. **"Documents" section:** `Dropzone` ("Drag files here, or click to browse"). On drop, an inline mini-form appears: "Which requirement does this fulfill?" select (this task's required docs, or "General attachment — not required") + "Upload" button, with an upload progress bar. Below it, the documents table for this discipline task (§10 pattern). Re-uploading against an already-satisfied requirement creates a new Rev automatically; it never overwrites. Empty table: "No files uploaded yet."
3. **"Comments" section:** same `CommentComposer` + thread pattern as §7. Empty: "No comments yet. Start the discussion."
4. **"Mark complete" button** — the ONE dominant action, full-width, 44px+, `--olng-blue`, placed as the final element on the page and mirrored as a slim sticky footer bar so it stays reachable on long pages.
   - **Enabled** when all mandatory required documents are uploaded and the task isn't Blocked.
   - **Disabled** state is gray/muted and non-clickable, but a helper line is always visible underneath it (not hover-only, so it works on touch too): "You can't mark this complete yet: [reasons]." Reasons are combined with commas, e.g. "2 required documents are still missing (Isometric drawing, Vendor datasheet), and this task is marked as blocked — resolve the block first."
   - Clicking it while enabled requires no confirmation dialog (keeps friction low): status moves to `AWAITING_REVIEW`, `Toast` "Marked ready for review. Your lead will confirm completion."
   - `Lead/PM/Admin` viewing an `AWAITING_REVIEW` task: "Confirm complete" moves it to `COMPLETED` (`Toast` "Marked complete."); "Send back" opens a small modal — "Why is this going back?" reason textarea (required) — on submit, status returns to `IN_PROGRESS` and the reason is posted as an activity entry and visible to the assignee.

**"Mark as blocked" dialog** (`Modal`, size `sm`): "What's blocking this task?" — reason textarea, required, placeholder "e.g. Waiting on vendor drawing revision." Footer: "Mark as blocked" (red-muted) / Cancel. On submit: status → `BLOCKED`, the reason shows in the status bar here and as a truncated preview on this discipline's card in the parent Main-task detail page, and is logged to Activity.

**"Resolve block":** small modal, optional note ("How was this resolved? (optional)"), Resolve / Cancel — status returns to `IN_PROGRESS`.

**Page-level states:** Loading — skeleton blocks matching the three card shapes. Error — full-width banner "Couldn't load this task. Try refreshing the page." + Retry, content withheld until it resolves.

**Role note:** only the assignee (or `Lead/PM/Admin`) sees the status controls and "Mark complete"; anyone else viewing (e.g. a teammate on another discipline) gets a read-only page but can still post comments.

---

## 9. Gantt tab

Lives inside Project overview → Gantt tab (§5). Two panes side by side.

**Left pane — task tree** (fixed 320px width):
- Toolbar: Zoom segmented control ("Weeks" / "Months", default Weeks), "Today" button (scrolls the timeline to the current date), "Collapse all / Expand all" toggle link.
- Rows (32px), all expanded by default: main task row (bold, expand/collapse chevron, `StatusBadge` dot, name, start–deadline dates muted) → child discipline-task rows (`DisciplineDot`, name, small assignee `Avatar`, `StatusBadge` dot, dates). Clicking a row's name navigates to that Main-task detail or Discipline-task page.

**Right pane — timeline grid:**
- Header columns per zoom: Weeks shows "Aug 18–24" columns; Months shows "Aug 2026" columns. Weekend columns lightly shaded. A red vertical "today" line spans the full height with a small red date label at the top.
- One horizontal bar per tree row: fill color = that task's `StatusBadge` color. Main-task bars additionally show a lighter sail-blue overlay proportional to their n/m completion; discipline-task bars are a solid fill of their status color only.
- **Interactions**, permission-gated: `PM/Admin` can drag any bar; `Discipline Lead` can drag only bars within their own discipline; `Engineer` and everyone else are view-only (cursor shows "not-allowed" on hover with a small lock icon).
  - Drag the bar body → moves start and deadline together (same duration), live ghost preview, snaps to day.
  - Drag the right edge only → changes the deadline; the start date is fixed (there is no left-edge drag in this version — start-date changes go through "Edit details" instead).
  - On drop, a `Toast` confirms the change with an "Undo" action (auto-dismiss ~6s): "Moved '[Task]' to 22–29 Aug. Undo" or, for an edge-drag: "Changed '[Task]' deadline to 29 Aug. Undo".
  - If a discipline task's new deadline now falls after its main task's deadline, the change still saves but the toast instead reads: "This pushes '[Task]' past its main task's deadline (25 Aug). Saved anyway — consider updating the main task too."
- Dependency arrows are **not** part of this version (explicitly deferred).

**States:** Empty (project has zero main tasks) — `EmptyState` replaces the whole split view: "No tasks to schedule yet. Create a main task to see it on the timeline." + "+ New main task" (`PM/Admin` only). Loading — skeleton tree rows left, empty shimmering timeline grid right. Error — "Couldn't load the schedule. Try refreshing the page." + Retry, replacing both panes.

**Responsive:** `<1024px` — tree stacks above a horizontally-scrollable timeline (minimum column width preserved). `<640px` — the split view is replaced with: "The schedule view works best on a larger screen. Use a tablet or desktop for the full Gantt view." plus a read-only fallback list (the Tasks tab's table, sorted by deadline) underneath.

---

## 10. Documents tab

Canonical documents pattern, used at Project level (pooled across every main + discipline task, with the extra "Location" column below), and reused unchanged (minus Location) on the Main-task detail Documents tab and, with the required-documents linkage described in §8, on the Discipline-task page.

**Toolbar:** search "Search documents…" + `FilterChips` (Category, Discipline, Uploaded by) + "Upload" primary button top-right. Any project member can upload (no special restriction beyond project membership).

**`DataTable`** columns: file-type icon (derived from extension), Name (bold) + a gray "Rev [n]" pill + a sail-blue "Latest" pill (shown only on the current top revision — older revisions are not separate rows; they live in Version history), Category tag (muted pill), **Location** (project-level view only — "[Main task] → [Discipline]" muted link chip, or "Main task" if attached there directly), Uploaded by (`Avatar` + name), Date, Size, Actions (Download icon button, "History" link).

**Version history:** clicking Name or "History" opens a right-side slide-over panel (`VersionHistoryList`) — every revision, newest first: Rev badge, uploader `Avatar` + name, date, optional note, per-row Download. Closes via X or click-outside.

**Version numbering rule** (applies everywhere in the app): first upload under a document name/requirement is Rev 0; each later upload matched to the same name/requirement is Rev 1, Rev 2, etc. — never overwritten, every revision stays downloadable forever.

**Upload flow:** "Upload" opens a `Modal` — `Dropzone`, then once a file is chosen: Name (auto-filled from filename, editable), Category (select or free text), "Fulfills requirement" select (discipline-task uploads only — omitted at project/main-task level), Note (optional, "Add a note (optional)" — e.g. "Updated after HAZOP comments"). "Upload" submit button with a progress bar. Success: modal closes, `Toast` "Uploaded '[filename]' as Rev [n].", the row appears/updates immediately with the "Latest" pill moving onto it.

**Delete:** `Admin/PM` only, via a row overflow (⋯) menu. Confirm: "Delete '[filename]' (Rev [n])? This can't be undone." Deleting the Latest revision promotes the previous revision to Latest automatically; deleting the only revision of a required document clears its checklist row back to ✕.

**States:**
- Empty: `EmptyState` — "No documents uploaded yet. Upload drawings, datasheets, or reports to keep everything in one place." + "Upload" button.
- Loading: 6 skeleton rows.
- Error: "Couldn't load documents. Try refreshing the page." + Retry.
- No results after search/filter: "No documents match your search." + "Clear filters".
- Upload error: inline in the upload modal — "Couldn't upload this file. Try again or use a different file." — selection retained so the user can re-pick.

---

## 11. My Tasks page

**Purpose:** the full personal task list — destination for `/my-tasks`, the dashboard's "View all →" link, and the KPI tiles.

Title "My tasks" (`--olng-blue`, 20px). Toolbar: `FilterChips` (Status, Project, Discipline, Priority, Deadline range) + sort dropdown (Deadline asc default / Priority / Status / Project) + a "Grouped / Flat list" view toggle, default Grouped.

**Grouped view:** same Overdue/Today/This week/Later grouping as the dashboard card, but showing every matching task, not a preview. Row: `StatusBadge`, bold linked title, project name + code chip, `DisciplineDot`, deadline (red/amber), full `StatusBadge` at row end.

**Flat list view:** `DataTable`, sortable columns: Title, Project, Discipline, Deadline, Status, Priority.

**States:**
- Empty: `EmptyState` — "No tasks assigned to you right now. When you're added to a discipline task, it'll show up here." — no action button.
- Loading: 8 skeleton rows (grouped skeleton headers + rows).
- Error: "Couldn't load your tasks. Try refreshing the page." + Retry.
- No results after filter: "No tasks match your filters." + "Clear filters".

---

## 12. Global search results

**Quick dropdown** (opened from the topbar search / `⌘K`/`Ctrl+K` from anywhere): live-filters as you type, grouped **Projects, Tasks, Documents, People**, capped at 3 rows per group, compact single-line rows (icon + title + short meta, no location chips). Footer link "View all [n] results →" navigates to the full search page with the query preserved. `Esc` closes it; arrow keys move the highlight; `Enter` opens the highlighted row.

**Full search page** (`/search?q=...`): search input pinned at the top (still live/editable), result count line "24 results for '[query]'" (muted). Below, grouped sections in this fixed order, each rendered only if it has ≥1 result: **Projects, Tasks, Documents, People.** Each group header shows its count, e.g. "Tasks (14)"; capped at 5 visible rows with an inline "Show more (9)" expand link if there are more.

Row shapes:
- **Projects:** name (matched text bolded) + code chip + `StatusBadge` → Project overview.
- **Tasks:** a type chip ("Main task" or the discipline name) + title (matched text bolded) + project code chip + `StatusBadge` + deadline → the respective detail page.
- **Documents:** file icon + name (matched text bolded) + Rev/Latest pills + location chip → navigates to the owning Documents tab and briefly flashes that row with a sail-blue tint (2s) so context isn't lost.
- **People:** `Avatar` + name + role/discipline label + email (muted) → clicking opens a small popover (not a full profile page, since none exists in this version): name, role/discipline, email as a `mailto:` link, and chips for the projects they're on (clicking a chip opens that Project overview).

**States:**
- Empty query result: `EmptyState` — "No results for '[query]'. Try a different name, code, or keyword."
- No query yet (e.g. back-navigation to `/search`): centered prompt, no illustration — "Type to search projects, tasks, documents, and people."
- Loading: skeleton row blocks under each expected group.
- Error: "Couldn't complete the search. Try again." + Retry — query text stays in the input.

---

## 13. Notifications page + bell dropdown

**Bell dropdown** (topbar, ~360px wide): header "Notifications" + "Mark all read" text link (right-aligned, hidden/disabled if nothing unread). Groups **New** (unread) and **Earlier** (read) — the "New" header is omitted entirely if there's nothing unread. Unread rows: 3px sail-blue left bar + light sail tint background. Row: icon-in-circle (same action-type icons as `ActivityItem`) + sentence text ("**Ahmed** assigned you to Mechanical review on LNG Train 5") + relative time. Clicking a row marks it read, deep-links to the object, and closes the dropdown. Capped at ~8 most recent, footer link "View all notifications →". Empty (compact, no illustration): "You're all caught up. Nothing to see here."

**Full page** (`/notifications`): title "Notifications" (`--olng-blue`) + "Mark all read" secondary button (disabled if nothing unread). Same New/Earlier grouping, full-width rows (48px), "Load more" button after the first 20.
- Empty: `EmptyState` — "No notifications yet. We'll let you know when something needs your attention."
- Loading: 6 skeleton rows.
- Error: "Couldn't load notifications. Try refreshing the page." + Retry.

**Trigger types** rendered through the same `ActivityItem`-style sentence template (actor bolded, present tense): assigned to a discipline task; @mentioned in a comment; main-task status changed; discipline task blocked; required document uploaded / missing-document reminder near a deadline; status override applied; added to a project or discipline; deadline approaching (~2 days out); review requested (an `AWAITING_REVIEW` handoff to the Lead).

---

## 14. Admin: Users and Disciplines

Nav entry "Admin" is visible to `Admin/GM` and `PM` (per design-notes). Landing view: `Tabs` — **Users | Disciplines.**

### Users tab — `Admin/GM` only
`PM` does not see this tab at all when they open Admin (only Disciplines, read-only — see below).

- Header: "+ New user" primary button top-right.
- Toolbar: search "Search users by name or email…" + `FilterChips` (Role, Discipline, Status: Active/Deactivated).
- `DataTable`: `Avatar` + name, email, org-level Role (Admin/GM, Project Manager, Discipline Lead, Engineer — distinct from the per-project role set on each project's Team tab), Primary discipline (`DisciplineDot` + name, "—" for Admin/PM), Status (Active/Deactivated badge), Projects count chip, Actions (⋯: Edit, Deactivate/Reactivate).
- Loading: 8 skeleton rows. Error: "Couldn't load users. Try refreshing the page." + Retry.
- No results after filter: "No users match your search." + "Clear filters".

**"+ New user" flow** (`Modal`, single form — this is the only way accounts get created, since signup is closed):
- Name, Email (format-validated; uniqueness checked on submit — "A user with this email already exists." if taken)
- Role (select: Admin/GM, Project Manager, Discipline Lead, Engineer)
- Discipline (select, required only when Role is Discipline Lead or Engineer)
- Submit → success view inside the same modal: "User created. Share these sign-in details with [Name]:" showing the email + a system-generated temporary password (monospace, "Copy" button) + note "They'll be asked to set a new password on first sign-in." "Done" closes the modal, `Toast` "User [name] created.", new row appears in the table.
- Error: inline banner — "Couldn't create this user. Try again." — fields retained.

**Edit user:** same fields (email editable too, same uniqueness check), no password field, "Save changes" button.

**Deactivate:** confirm dialog — "Deactivate [Name]? They won't be able to sign in, but their history stays on record." Deactivate (red-muted) / Cancel. Deactivated users appear grayed out with a "Deactivated" badge, remain visible in history/filters, but drop out of `UserPicker` suggestions elsewhere. **Reactivate** uses the same confirm pattern with positive framing (no red).

### Disciplines tab
`DataTable`: `DisciplineDot`, Code (e.g. "MECH"), Name (e.g. "Mechanical"), Color swatch, Projects using it (count chip), Actions.

- **`Admin/GM` view:** "+ Add discipline" primary button top-right; per row ⋯ menu with Edit and Delete (Delete disabled with tooltip "This discipline is used on active projects — remove it from those projects first" whenever the Projects-using count is above 0).
- **`PM` view:** same table, read-only — no "+ Add discipline" button, no ⋯ menu.

**Add/Edit discipline** (`Modal`, size `sm`, `Admin/GM` only): Code (short text, uppercase, required, unique), Name (text, required), Color (swatch picker limited to the design system's pre-derived muted hue palette — not a free color wheel, to protect the brand). Save → `Toast` "Discipline '[Name]' saved."

**States:**
- Empty (edge case — catalog has zero disciplines), `Admin/GM`: `EmptyState` — "No disciplines set up yet. Add the disciplines your projects will use, like Mechanical or Electrical." + "+ Add discipline". `PM`: same message, no button.
- Loading: 5 skeleton rows. Error: "Couldn't load disciplines. Try refreshing the page." + Retry.

---

## 15. Shared components

Names match `docs/design-notes.md` verbatim. Props/variants defined here are the single source of truth — every screen above references these, not its own version.

**`StatusBadge`** — props: `status` (`NOT_STARTED | IN_PROGRESS | BLOCKED | AWAITING_REVIEW | COMPLETED`), `variant` (`"badge"` default pill w/ label, or `"dot"` — an 8px filled circle only, no label, used in dense table/tree rows), `size` (`sm | md`). Labels (sentence case): "Not started", "In progress", "Blocked", "Awaiting review", "Completed". Colors per design-notes token mapping. Also reused for project-level statuses (Active = blue, On hold = sand, Completed = green, Archived = gray) — same visual system, different label set.

**`PriorityFlag`** — props: `priority` (`Low | Medium | High`), `size`, `showLabel` (bool, default false — icon-only with a hover tooltip; set true inside selects/forms where text is needed). High = red-muted, Medium = sand/amber, Low = gray.

**`DisciplineDot`** — props: `discipline`, `size` (`sm` 6px, `md` 8px, `lg` 12px for legends), `withLabel` (bool — renders dot + name inline, used in lists/filters/checklists).

**`ProgressBar`** — props: either `value` (0–100, percent-only display, used on headers) or `{n, m}` (fraction display, renders "n/m" label beside a 4–6px rounded bar, `--olng-gray`-tinted track, `--olng-sail` fill).

**`StatTile`** — props: `label`, `value`, `tone` (`default | danger`), `onClick`. Value 28px semibold, label 12px muted, optional small icon top-right.

**`FilterChips`** — props: `filters` (`{key, label, options}[]`), `activeFilters`, `onChange`. Active filters render as removable pills ("Status: Blocked ×"); a trailing "+ Filter" button opens a per-dimension popover (checklist for multi-select, radio for single-select, date-range for deadlines).

**`DataTable`** — props: `columns` (with a `sortable` flag), `rows`, `onRowClick`, `rowHeight` (default 44px), `emptyState`, `loading`, `error`. Sortable headers show a caret and toggle asc/desc; single-column sort only.

**`Avatar`** — props: `name` (initials fallback), `size` (`sm` 24px, `md` 32px, `lg` 40px). Always initials on a navy background for this version (no photo upload in scope). **`AvatarGroup`** — props: `avatars[]`, `max` — overlapping circles + a "+N" overflow chip.

**`Card`** — props: `title` (optional header with a right-aligned action slot, e.g. "View all →"), `padding`, `children`. White background, 1px `#E3E5E6` border, 6px radius.

**`EmptyState`** — props: `message` (required), `description` (optional secondary line), `actionLabel`/`onAction` (optional), `illustration` (bool — on for full pages/tabs, off inside compact chrome). Centered, small sail-motif graphic above a one-line message, optional muted description, optional primary button.

**`Modal`** — props: `title`, `size` (`sm` 420px, `md` 560px, `lg` 720px), `onClose`, `footer` (slot), `preventCloseIfDirty` (bool — triggers a discard-confirmation sub-dialog on X/backdrop click when true). Scrollable body, pinned footer.

**`Tabs`** — props: `tabs[]` (`{label, key}`), `activeKey`, `onChange`. Underline style: active = `--olng-blue` text + 2px underline, inactive = muted `--olng-text`.

**`Toast`** — props: `message`, `variant` (`success | error | info`), `action` (optional `{label, onClick}`, e.g. "Undo"), `duration` (default ~4s, 6s when it carries an action). White card, 4px colored left bar (green/red/blue per variant), shadow, auto-dismiss + manual close.

**`ActivityItem`** — props: `actor`, `verb`, `object` (`{label, href}`), `timestamp`, `icon` (colored per action type — created = blue, completed = green, blocked = red, comment = gray, document = sand). Renders "**Actor** did X on **Object**", relative time. A separate `DayDivider` sub-element (thin line + centered date) is rendered by the parent feed, not by `ActivityItem` itself.

**`CommentComposer`** — props: `onSubmit`, `mentionable` (users list), `placeholder` (default "Add a comment…"). Auto-growing textarea; typing "@" opens a mention popover (`Avatar` + name rows, arrow keys + Enter/click to select) that inserts a highlighted "@Name" token. "Post" primary button, bottom-right, disabled while empty.

**`Dropzone`** — props: `onDrop`, `accept`, `multiple` (bool), `uploading` (bool — shows per-file progress bars), `maxSizeLabel` (optional; no hard size/type limit is defined in this version — flagged below for the owner). Dashed border, upload-cloud icon, "Drag files here, or click to browse"; drag-over turns the border `--olng-sail` with a light sail tint.

**`VersionHistoryList`** — props: `versions[]` (`{rev, uploader, date, note, downloadUrl}`), `currentRev`. Newest first; current row also carries a "Latest" chip.

**`GanttChart`** — props: `tree` (nested rows), `zoom` (`weeks | months`), `permissions` (per-row editable flag), `onBarChange`. Composed of the task tree (simplified `DataTable`-style rows, no sortable headers) plus a custom timeline canvas, fully specified in §9. Registered here once so it's built as a single reusable component, not per project.

**`DateInput`** — props: `value`, `onChange`, `min`, `max`, `placeholder`. Displays as "30 Sep 2026"; calendar popover on click; typed entry accepted and normalized on blur.

**`UserPicker`** — props: `value`, `onChange`, `options` (optionally pre-filtered by project/discipline), `placeholder` (default "Search people…"). Type-ahead, dropdown rows = `Avatar` + name + muted email, single-select (every usage in this app adds people via repeating single-picker rows rather than a multi-select tag field).

**`Breadcrumb`** — props: `items[]` (`{label, href}`) — the last item is never a link. Muted text, `/` separators, `--olng-blue` for clickable ancestors, `--olng-text` for the current (last) item; middle items truncate with "…" on narrow widths.

---

## Design decisions flagged for the owner

These fill gaps the brief didn't specify. A builder can proceed on the assumptions below, but the owner may want to weigh in before or shortly after build:

1. **`AWAITING_REVIEW` as a Lead-confirmation step (§8):** the brief listed `AWAITING_REVIEW` as a status color but didn't say when it's used. This spec has an engineer's "Mark complete" move the task to Awaiting review, requiring the Discipline Lead (or PM/Admin) to confirm before it becomes Completed ("Confirm complete" / "Send back"). This is the one behavioral decision that most changes how the tool feels day to day — worth the owner's sign-off.
2. **Document delete + Rev-promotion rule (§10):** deleting the Latest revision of a document auto-promotes the previous one; deleting the only revision of a required document clears its checklist back to ✕. Not specified in the brief, but needed for the gating logic to make sense.
3. **No file size/type limit specified** for the `Dropzone` (§8, §10, §15) — flagged, not enforced in this version; add one if OLNG's file sizes (e.g. large CAD/vendor drawings) need a cap.
4. **New-user password model (§14):** since the brief says "signups closed" but doesn't mention SSO/Active Directory, this spec assumes a system-generated temporary password shown once to the Admin to share manually. If Oman LNG actually wants AD/SSO login, that changes both this screen and the Login screen (§1) and should be confirmed before build.
5. **Gantt dependency arrows** are explicitly out of scope for this version per design-notes ("later") — flagged so it isn't mistaken for an oversight.
6. **Admin nav visibility for PM (§2, §14):** design-notes states the Admin nav item is visible to Admin/GM and PM. This spec has PM see only a read-only Disciplines list there (no Users tab at all) — reasonable, but worth a quick owner nod since it's not spelled out in the brief.
