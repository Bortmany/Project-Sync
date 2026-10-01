# Tielora — weekly brief, one-click status report, and numbers that agree

Status: SPEC, build-ready. Branch `align-2026-10`. Build plan: "Step 3 — Briefs and reports" in `Agents/.claude/worktrees/vision-plans/docs/visions/build/tielora.md` (it fixes most technical choices; this spec follows it and names the few places it adds to it).
Also folds in and supersedes: `Agents/docs/specs/tielora/dashboard-numbers-that-agree.md` (September; still NOT BUILT — I re-read `dashboard.ts` and `briefs.ts` on this branch and its root causes are all still true: tiles at `dashboard.ts:105-117`, "Upcoming" with no lower bound at `:150-176`, the locked-phase count at `briefs.ts:769`. The builder re-checks `my-tasks-view.tsx` and `format.ts` before touching them, which I did not open.)
Conventions read: `docs/CONVENTIONS.md` — tenant rule, external rule, golden rule, house rules, "Notifications and the deadline sweep", "Chat delivery", "Transactional email".
Backlog: `Agents/docs/backlog.md` has no Tielora section, so no row is named. The owner's file is untouched.
Prior art: I have no Mobbin access in this session and will not invent links. `ui-designer` pulls 2–3 flows of "export a project status report" (PDF/PowerPoint menu on a project header) and "weekly digest email" at design time and cites them by `mobbin_url`.

## The problem, in the owner's words

Managers want to walk into Monday knowing where every project stands without opening six screens, and to hand a client or a boss a clean status report without retyping numbers into slides. Today the daily chat digest is the only summary, and September's testing showed the numbers on the home screen contradict the lists behind them ("which one do I read out in the Sunday meeting?"). A report or weekly brief built on top of numbers that disagree would make that worse, so the numbers are fixed in the same build and every new output reads from the same place the screens do.

## What changes for the user (plain English)

1. **Monday brief.** Once a week, early Monday morning UTC, a company's chat channel (Slack or Teams) gets one summary of the past seven days: how far each project has come since a week ago, what became late this week, which gates opened, and how many required documents are still missing. Administrators switch it on per channel in Admin → Integrations (it is off unless asked for). People who switch on the weekly email in Your account (that switch is built in the parallel "Microsoft first" step, `emailWeeklyBrief`) get the same summary by email, limited to the projects they belong to.
2. **Export button.** On every project's header a manager or team member presses **Export** and chooses **PDF** or **PowerPoint**. They get a file with a timeline picture, what is late, who is blocking whom, and document status. Every number in it is the number the screens show that same moment.
3. **Numbers that agree** (from September's spec): each home-screen tile counts exactly what its link opens; "Late" and "Upcoming" become two blocks; a project's Brief quotes the right number for a locked phase; the "Awaiting review" shortcut in My tasks filters on the first click; completed old work never sits under "TODAY".

## Screen by screen

**A. Admin → Integrations (chat card).** A seventh switch, "Weekly brief", beside the daily brief switch, off by default. Helper line in the same style as the daily one: "Sent once a week, early Monday morning UTC." The card shows nothing about email here — email is per person.

**B. The Monday brief itself (chat card and email).**
- Title: "This week's brief — N active projects". One line per active project (same 12-project cap as the daily digest, with "and N more active projects" after it):
  `CODE Name — 64% (58% a week ago) · 5 late (2 new this week) · 3 blocked · 4 documents missing`
- Below the lines, one "Gates opened this week" line naming each phase that opened, or omitted if none.
- "Late" uses the one shared definition (see section D): main tasks and discipline tasks are both named, e.g. "2 main tasks and 5 discipline tasks late", never a bare number.
- Chat version is company-wide (as the daily digest already is). **The email version is per person**: each recipient sees only the projects they are a member of (an ADMIN sees all of their own company's), and a person with no visible project gets no email. The email is plain text, like every Tielora email; no attachment.
- Links use `APP_BASE_URL` as the daily digest does; unset, the message names the page instead.

**C. Project header: Export.** A button "Export" opens a two-item menu, "PDF" and "PowerPoint". Pressing one shows "Preparing your report…" on the button, then the browser saves `<PROJECT-CODE>-status-<yyyy-mm-dd>.pdf` (or `.pptx`). It is fetched by the page and saved (not a plain link) so that a refusal shows a plain-English message under the button instead of navigating away. Messages: 429 "You have exported a lot of reports just now. Please wait a minute."; not found "We could not find that project."; anything else "We could not build that report. Please try again." Hidden for contractors. **Run `ui-designer` before building** (button placement on a crowded header, phone layout of the menu, the report pages/slides themselves, and the tile labels below).

**The report, page by page / slide by slide (same content in both formats):**
1. *Cover / summary:* project name and code, date generated (UTC, "30 Sep 2026"), overall progress, and the one line "N main tasks and M discipline tasks late · B blocked · D required documents missing".
2. *Timeline snapshot:* the project's Gantt drawn as a picture — main tasks as bars with their discipline tasks beneath, a "today" line, phase bands, late bars marked. Capped at 40 main-task rows with "and N more" (numbers still count all).
3. *What is late:* the late list, newest slip first, each row with days over, discipline, and assignee name.
4. *Who is blocking:* each blocked task with the tasks it is waiting on and those tasks' assignees; locked phases with "waiting on FEED, which still has 9 main tasks open" (the corrected sentence).
5. *Documents:* mandatory required documents in place vs missing, per discipline, plus the missing list (capped at 25 rows with "and N more").
6. Footer on every page: "Generated by Tielora from live project data on <date>." Nothing about the recipient.

**D. One definition of "late", everywhere** (September spec default, carried forward): any main task or discipline task past its deadline day and not complete, derived at read time by `isOverdue()`/the same database line `dayWindow().overdueCutoff` draws. One shared helper returns the two counts; the dashboard, project header badge, Brief tab, timeline, daily digest, weekly brief and report all call it. Where a place counts only one kind, its label says so in words ("1 main task overdue"). This changes the existing daily digest wording (its "overdue" is main-tasks-only today) to name both kinds — a deliberate change, covered by the same test.

**E. Home screen, Brief, My tasks** — exactly as September's spec sections 1–6, with its three suggested defaults standing unless the owner overrides: tiles are the whole company scoped to the projects the person may see and clearly labelled "Across the whole company" (a contractor's block reads "Your work"); overdue counts both kinds; one 14-day "Upcoming" window with "Due soon" counting the same items. The Brief's locked-phase line quotes the **blocking** phase's open count (`briefs.ts:769` reads the locked phase's own count; fix it to read the phase named by `lockedByPhaseName`). `my-tasks-view.tsx` re-reads `status`, `priority` and `discipline` from the address when it changes, not just `due`. `dueBucket()` in `format.ts` returns no date bucket for completed work.

## How the numbers are computed (this is what "no new history table" rests on)

I checked: **everything the weekly brief needs is already derivable from existing rows, so nothing new is stored and nothing is scaled down.**
- *Progress a week ago:* `projectBrief()` already does exactly this per project — a main task finished when its last discipline task's `completedAt` was set (or when an override was recorded), tasks created inside the window are left out of both numbers, and `REOPENED` audit rows stop a re-finished task counting as new progress. The builder **extracts that logic into one shared function that takes project ids and a `since` date** (no signed-in person needed, one grouped query for all projects, as `completionMoments()` already is) and both `projectBrief()` and the weekly brief call it. That is what makes the weekly line equal the project Brief. Known, already-accepted limits carry over: a moment that cannot be recovered counts as "older than a week", and a task finished-then-reopened-then-finished inside the window is understated. The weekly brief footnote does not need to say so; the Brief tab's wording already does.
- *What became late this week:* still-open work whose deadline day ended inside the last seven days, i.e. `deadline` between `overdueCutoff − 7 days` and `overdueCutoff`. A pure date test on existing columns. (Work that became late and was finished since is not late now and is not listed.)
- *Gates opened:* `gateOpenMoments()` (already in `briefs.ts`) for moments inside the window.
- *Documents awaiting:* mandatory required documents with no document attached, on open, live discipline tasks — the count `requiredDocCountsFor()` in `tasks.ts` already produces for the timeline hint. It is currently private to `tasks.ts`; export it (or move it beside the shared helpers) so the Gantt, the weekly brief and the report use one function.
- *Report:* built from `projectBrief()` (progress, blocked tasks, locked phases, next gate), `ganttForProject()` (timeline and the late list, derived with the shared late helper), and the document counts above. **Small addition:** the Brief's blocked-task entries name the blocking tasks but not who holds them; add the blockers' assignee names to `ProjectBriefDTO` (additive) and show them in the Brief tab too, so the screen and the report say the same thing.

## Sweep behaviour (weekly brief)

- Same hourly run, same advisory lock rules as the daily digest; runs after the daily digest and reads no extra lock. Its own 30-second chat budget, checked after each company, longest-waiting first (`weeklyBriefSentAt` ascending, never-sent first).
- **Send line:** 05:00 UTC on the Monday of the current week. A channel is due when it is enabled, has `weeklyBrief` on, and `weeklyBriefSentAt` is null or before that line. `weeklyBriefSentAt` is stamped after each company is dealt with, whether or not there was anything to say, exactly as the daily one is; only the channels that were due are posted to (ids handed to a `deliverWeeklyBrief`, generalised from `deliverDailyBrief`, never "every enabled channel").
- **Catch-up window (decision, easy to change):** a server that was down on Monday sends late but only until 05:00 UTC Tuesday; after that the week is skipped, because a "this week" brief arriving on Thursday would be wrong. Missing a week costs a summary, never correctness.
- **Toggle:** `weeklyBrief` added to `IntegrationEventToggles` with zod `.default(false)`, so rows saved before it existed keep parsing. It is excluded from `TOGGLE_FOR_TYPE`/`FanOutToggle` alongside `dailyBrief`.
- **Email leg:** recipients are active users of that company, not EXTERNAL, with `emailWeeklyBrief` on, and only while `emailAvailable()` is true (dormant means silent). Sent after computing, never awaited, one attempt plus the one-retry rule; a failure log line carries purpose and user id only. Each person's email is built from projects that person may see. The email shares the same send line and the same catch-up window.
- **Nothing stored, nothing audited, no notification row** — the same documented exception as the daily digest; CONVENTIONS records it as the fourth (the report's audit row is a separate matter, below).

## What a CONTRACTOR sees

Nothing new. Default, and enforced by tests:
- `GET /api/projects/[id]/report` answers **not found** for EXTERNAL, before any data is read (`isExternal(actor)` first, then `assertCanViewProject`), the same as `projectBrief()` today. No Export button on their screens.
- A contractor is never a weekly-brief email recipient, whatever their preference says, and never appears by name in the chat card or any email except as a plain assignee name where a company member could already see it. Their own-work reminders are unchanged.
- The dashboard changes for them are the September spec's: their tiles read "Your work" and count only their assigned tasks.

## Out of scope

- Storing any snapshot, history table, or generated file: reports are built on the spot and streamed, never saved to disk or the database.
- Attaching the report to the weekly email, scheduling reports, emailing a report to a client, choosing report contents, branding or logo upload, other languages.
- Weekly brief on Slack/Teams with buttons, per-project chat channels, changing the hour or weekday, per-person weekly time zones.
- A company-wide report (one project at a time only), a "blocked" reason field, task cancel/archive, the company-wide blocked view (all named out of scope in September's spec and still so).
- The `emailWeeklyBrief` preference and its unsubscribe link (parallel Microsoft-first step; this spec only reads it).
- Any change to how a main task's status or progress is derived (`deriveMainTask()` stays the only writer).
- Choosing the PDF/PowerPoint libraries — see below.

## Library choice (left to the build)

A `researcher` note goes at the top of the build brief before code is written. Binding constraints: **no headless browser, runs on Node 22 with no new system package** (no Chromium, no fonts or binaries installed on Railway), licence compatible with commercial use, small enough not to bloat the server bundle, and it must draw shapes (for the timeline) rather than embed a screenshot. Candidates in the plan: `pdf-lib` or `@react-pdf/renderer`; `pptxgenjs`. Two build notes: report colours cannot read CSS variables, so the palette lives in one report-theme file copying the exact values of the existing brand tokens in `globals.css` (house rule 7: no new hex values); and fonts must be ones the library ships or a built-in — no downloads at runtime.

## Data touched (plain terms)

- Each chat channel remembers **when its last weekly brief went out** (one date), so it goes once a week. Nothing about the brief's contents is kept.
- **Company-level email date (see open question 1):** a second date on the company remembers when the weekly email last went out, because a company can have email readers without any chat channel, and the channel's date cannot serve them.
- Reports are built from live data and leave no copy. Each export writes one audit line saying who exported which project in which format — never the contents.
- The weekly chat toggle is added to the channel's existing settings block; old blocks read it as "off".
- Everything else (late, progress, documents, gates, tile counts) is worked out at read time from what already exists.

## Migration (additive only) — `weekly_brief`

`npx prisma migrate dev --name weekly_brief`. Adds `OrgIntegration.weeklyBriefSentAt` (nullable timestamp) and `User.weeklyBriefEmailedAt` (nullable timestamp — a per-person date, matching `User.dailyBriefEmailedAt` in `microsoft-first.md`, so a run stopped by the 30-second budget resumes where it left off). Nothing dropped, renamed or made stricter; null means "never sent", which is what every existing row means. As always, delete the five trigram `DropIndex` lines from the generated SQL by hand and check `pg_indexes` on both databases afterwards (five rows each). Add the amendment to CONVENTIONS' migration list in the same change. The toggle itself needs no migration (`eventToggles` is Json). Also add the new column(s) to `workspace-export.ts`, which selects `dailyBriefSentAt` today — the company export must include what the company owns.

## Audited, rate limited, privacy

- **AUDITED:** `REPORT_EXPORTED` — one `ActivityLog` row per successful export: actor, `entityType: "Project"`, project id, `metadata: { format }`, summary "«Name» exported a status report for «CODE» as PDF". Written in its own transaction after the file is built, the way `PERSONAL_EXPORT` is (a GET that writes one row; the same accepted shape as `/api/account/export`), and never for a refused or failed request. Add the constant to `ACTIVITY` in `activity.ts`. **Not audited:** the weekly brief (chat or email), and anything on the dashboard — reads, same exception as the daily digest. (`EMAIL_SENT` rows are for link emails; a summary email carries no token and is not audited.)
- **RATE LIMITED:** the report route goes through `guardRead` (the ordinary per-person read limit) **and** its own `limit(byUser(userId, "report-export"), 10, 60_000)`; denied with 429, a plain-English message and `Retry-After`. The weekly brief has no user-facing entry point to limit; its guards are once-per-week stamping, the 30-second budget and the per-company project cap. No new mutation action is added, so `beginMutation` needs no new entry. Responses carry `Cache-Control: private, no-store`.
- **PRIVACY page: does not change, with one check.** No new personal data is collected: the report and the brief re-present work data the app already holds; the audit row names the person who exported, like every audit row. But the weekly email is a new *use* of a person's address and depends on the preference the Microsoft-first step adds; if that step's privacy wording says only "daily brief and alerts", the builder adds "weekly summary" to it in this build. (Standards §6: `/privacy` changes in the same diff if anything new is stored about a person.)
- **Touches the core guarantee?** Reads only; nothing writes status or progress. But the fold-in changes the counted definition of overdue (`isOverdue()` is golden-rule territory) so tests are required: `src/lib/__tests__/progress.test.ts` (or the service-level equivalent) extended for the shared late helper, plus `phase-lock.test.ts`/`phases.service.test.ts` if the locked-phase sentence's source changes.
- **External calls:** the chat post and the email are the same outbound roads as today (SSRF-checked webhook; Resend). The report makes no external call.

## Tests (same change)

- `src/server/__tests__/integrations.service.test.ts` (network mocked): toggle defaults to false and an old 6-key block still parses; weekly brief goes once per channel per week, not twice in the same week; a channel enabled later on Monday makes only itself due (no double post to the other); not sent before Monday 05:00 UTC, sent late on Monday, skipped after Tuesday 05:00; disabled or un-toggled channels skipped; company with no active project stamped but sent nothing; only the 30-second budget is used; card stays under the 28 KB cap at 12 projects; **writes no ActivityLog row and no Notification row**; email leg: only opted-in, active, non-EXTERNAL people; dormant email sends nothing and changes nothing; each person's email names only their own projects.
- `src/server/__tests__/briefs.service.test.ts`: the weekly progress line equals `projectBrief().progress` for the same project on the same fixed date (with a reopened task and a task created inside the window); "became late" and "gates opened" boundaries; the locked-phase sentence quotes the blocking phase's count (the 0-vs-9 fixture); the daily digest and header/Brief/dashboard give the same late figure for one fixture project.
- `src/server/__tests__/dashboard.service.test.ts`: each tile equals the length of the list its link opens; nothing late in Upcoming; "Due soon" equals the Upcoming list; `dueBucket` test for a completed old task.
- New `report.service.test.ts` (or equivalent): every number in the report data equals `projectBrief()`/Gantt/document counts for one fixture; `REPORT_EXPORTED` written once on success and never on refusal; the 11th request in a minute gets 429 with `Retry-After`; both formats return the right content type and a non-empty body.
- `src/server/__tests__/org-isolation.service.test.ts`: another company's project id on the report route is **not found** (never "forbidden"); company A's weekly brief and emails never name a company-B project or reach a company-B person; company-wide tiles never count another company's row.
- `src/server/__tests__/external-scoping.service.test.ts`: a contractor's report request is not found even for a project they hold work on; a contractor with `emailWeeklyBrief` true still gets no weekly email; their tiles count only their own work.

## Bilingual note

English-only app (house rule 6); no Arabic anywhere in the product, no i18n dictionary. Every new string is one English sentence in the component or builder that prints it. Dates carry the year ("30 Sep 2026"). Because the report files will be sent onward to people outside the company, keep them free of screen-only wording ("click here"). Report layout and the PDF font must not assume Latin-only text (project and task titles are typed by users and may contain other scripts): the library note must confirm non-Latin characters do not render as blanks, or that the limitation is stated to the owner.

## Done when (tick each)

- [ ] Admin → Integrations shows a "Weekly brief" switch, off for every existing channel, with the line "Sent once a week, early Monday morning UTC."
- [ ] With it on for a test channel, the first sweep after Monday 05:00 UTC posts one card; running the sweep again the same week posts nothing; the next Monday posts one more.
- [ ] The card's progress-vs-a-week-ago for a project equals the "Where we stand" panel on that project's Brief tab that same minute.
- [ ] A person with the weekly email switched on receives a plain-text email listing only their own projects; a person who is a contractor receives none.
- [ ] With email not set up, nothing is sent and nothing else looks different.
- [ ] A project header shows **Export** with PDF and PowerPoint; each downloads within a few seconds and opens in a normal PDF viewer / PowerPoint.
- [ ] The file has a timeline picture, the late list, who is blocking, and document status; the late, blocked and missing-document numbers match the project header, Brief tab and timeline on the same day.
- [ ] Pressing Export 11 times inside a minute shows the plain "wait a minute" message.
- [ ] Admin → Activity (or the project's activity list) shows "«Name» exported a status report … as PDF" once per successful export and nothing for the refused ones.
- [ ] As a contractor, there is no Export button, and typing the report address returns "not found".
- [ ] From another company's login, the address of a project in this company returns "not found".
- [ ] Every September finding is closed: tiles equal their lists; Upcoming has no past dates and "Late" is its own block; the Construction line quotes FEED's real open count; "Awaiting review" filters on the first click; an old completed task is not under "TODAY" and "This week" is not empty when work is due.
- [ ] The privacy page is unchanged, or mentions the weekly summary if the Microsoft-first step's wording did not.
- [ ] `docs/CONVENTIONS.md` is updated in the same change: the seventh toggle, the weekly brief paragraph, the new migration amendment, the report route in the route table, the new audit action, the count "six toggles" corrected where it appears.
- [ ] The full verify recipe passes (`npm ci`, `prisma generate`, `migrate deploy`, seed, seed check, lint, `tsc --noEmit`, `npm test`, `npm run build`) with more tests than before, and the build needs no new system package on Node 22.

## Build order (from the plan)

A (weekly brief), B (report) and C (fold-in) run in parallel on separate test databases. B and C both touch `briefs.ts`, so dev-lead pins the split first: the shared late helper, the extracted progress-since function and the exported document-count function go in **one small commit** everyone starts from; then B and C only add to `briefs.ts`, never reshape it. Fix-loop limit 2 rounds. Verify then review; review focus: no headless browser, contractor not-found on the report, and every report number equal to the dashboard's.

## Open questions (each with a default)

1. **Settled by the orchestrator (30 Sep 2026), no longer open:** the "email already sent this week" date lives on each person, `User.weeklyBriefEmailedAt`, the same pattern `microsoft-first.md` uses for the daily email. A company-level date cannot survive the sweep's 30-second budget stopping halfway through a large company.
2. **Should the report go to people who are not project managers?** *Default:* every member of the project who may already read the Brief (all internal members), since the Brief is open to them and the report is the same numbers. Alternative is managers/admins only.
3. **Should the weekly brief also be posted when nothing changed?** *Default:* yes — a project with no movement still shows its line ("64%, unchanged"), because a quiet week is information; a company with no active project at all gets nothing, as with the daily digest.
