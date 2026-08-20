# Design notes — Project Nexus (Oman LNG)

Distilled from Mobbin research (Aug 2026) + OLNG brand constraints. This feeds the ui-designer's screen spec and every UI builder. Patterns were studied from Wrike, Motion, Height, Asana, Qatalog, Shopify, Dovetail, Twenty, Airtable, komoot — we borrow interaction patterns, never visual identity.

## Brand tokens (hard constraints — Oman LNG)
```
--olng-blue:      #00558C   /* primary actions, links, active nav, headers */
--olng-navy:      #003E51   /* sidebar background, dark surfaces */
--olng-mid:       #004F71   /* hover states on navy, secondary emphasis */
--olng-sail:      #5BC2E7   /* highlights, progress fill, focus rings, sail motif */
--olng-text:      #5F6062   /* body text — warm gray, NEVER pure black */
--olng-gray:      #B1B3B4   /* borders, muted text, disabled */
--olng-sand:      #D1CCBD   /* rare secondary accent (e.g. AWAITING_REVIEW badge) */
```
- Font stack: `Candara, "Segoe UI", "Trebuchet MS", system-ui, sans-serif` (Candara ships on the OLNG Windows fleet; fallbacks are humanist).
- Sail motif (overlapping translucent light-blue triangles) ONLY on: login page, empty states. Never on dense working screens.
- No OLNG logo asset — text wordmark: "Oman LNG" small caps over "Project Nexus" or inline "Oman LNG · Project Nexus".
- Status colors stay inside the brand family + conventional signals: NOT_STARTED gray #B1B3B4 · IN_PROGRESS #00558C · BLOCKED red #B54A4A (muted, only red on screen) · AWAITING_REVIEW #D1CCBD (sand, dark text) · COMPLETED green #3E7A5E (muted industrial green) · OVERDUE = red text/icon next to the deadline, not a sixth badge color.
- Discipline accent dots: derive 8 muted hues (blue-family first, then muted supporting hues) — used as small dots/left borders, never large fills.

## Layout system
- **App shell**: fixed left sidebar 240px, `--olng-navy` background, white/sail text; top bar 56px with global search (center, ⌘K), notification bell, user menu. Content area max-width none (engineering = information-dense), 24px padding, `#F5F6F7` page background, white cards, 1px `#E3E5E6` borders, 6px radius. (Pattern: Wrike/Height shells.)
- **Nav items**: Dashboard, Projects, My Tasks, Notifications, Admin (admin/PM only). Active item = `--olng-mid` background + `--olng-sail` left bar.
- Desktop-first; sidebar collapses to icon rail <1024px, bottom nav <640px.

## Screen patterns (from research)
1. **Dashboard** (Wrike widget grid + Motion table): row of 6 KPI stat tiles (Total, In Progress, Completed, Blocked, Overdue, Due Soon — Overdue tile gets red number when >0); then 2-col grid: "My Tasks" list (grouped by due: Overdue/Today/This week/Later, each row = status dot, title, project code, deadline) and "Discipline Progress" (one row per discipline: dot, name, progress bar in --olng-sail on gray, %); below: "Upcoming deadlines" list + "Recent activity" feed.
2. **Task tables** (Dovetail/Twenty/Aboard): filter chip row above table — removable chips + "+ Filter" popover (Status, Discipline, Priority, Assignee, Deadline) + sort dropdown; dense rows 44px: Title (bold, links), Disciplines (stacked dots + count), Progress ("3/5" + thin bar), Deadline (red if overdue, amber if <7d), Status badge, Priority flag. Column headers sortable.
3. **Main-task detail** (Asana/Qatalog split): header block (breadcrumb, title, status badge + override indicator, progress "3/5 disciplines · 60%" with bar, deadline, priority); RIGHT META RAIL 280px (owner, created by/date, start, deadline, priority, disciplines involved, actions per role); MAIN: "Discipline Progress" card list — one card per discipline task: discipline dot+name, title, assignee avatar+name, deadline, status badge, its own required-docs count ("2/3 docs"), open → subtask page. Below: tabs [Documents | Comments | Activity].
4. **Discipline-task page** (engineer's simple flow, PRD §28): single column, huge clarity: what's required (description + required-docs checklist with ✓/✕), upload area, comment box, ONE dominant action button "Mark Complete" (disabled with reason tooltip while mandatory docs missing / dependency open — shows exactly what blocks). Status changer for in-progress/blocked with reason.
5. **Documents** (Shopify/Mistral file tables): table rows: file-type icon, name (+ "Rev 3" badge + "Latest" chip), category tag, uploader avatar+name, date, size, actions (download, history). "Upload" primary button top-right; drag-drop zone. Version history = expandable panel/modal listing every rev with uploader, date, note, download each.
6. **Gantt** (Wrike split table+timeline, Airtable bars): left pane = collapsible task tree (main task rows → discipline rows) with name, status, dates; right pane = timeline grid, week/month headers, weekend shading, red "today" line, bars colored by status with progress overlay, drag bar = move, drag right edge = change deadline (PM/Admin/lead per permissions), dependency arrows later. Zoom toggle Weeks/Months.
7. **Activity feed** (komoot/Record Club): single column, icon-in-circle per action type, "**Actor** did X on **object**" sentence, relative time, day dividers. Same component for task activity tab and dashboard.
8. **Notifications**: grouped New/Earlier, unread = sail-blue left bar, row click deep-links, "mark all read".
9. **Login**: split screen — left 45% sail-motif hero panel (navy gradient + translucent triangles + wordmark + "The best at what we do." NOT used — that's the deck tagline; use "Multidisciplinary coordination for engineering teams"), right form (email, password, sign in). No signup link (admin-created accounts).

## Component inventory (build once, reuse)
StatusBadge · PriorityFlag · DisciplineDot · ProgressBar ("n/m" variant) · StatTile · FilterChips · DataTable (sortable) · Avatar (initials, navy bg) · Card · EmptyState (sail motif, one-line message + action) · Modal · Tabs · Toast · ActivityItem · CommentComposer (@mention popover) · Dropzone · VersionHistoryList · GanttChart · DateInput · UserPicker · Breadcrumb.

## Voice
Plain English, sentence case everywhere ("Mark complete", "3 of 5 disciplines complete"). Dates: "30 Sep 2026". Relative only in feeds ("2 h ago"). No jargon, no shouting caps.
