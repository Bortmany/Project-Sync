# Tielora — conventions (this repo's law)

Every agent and every session working in this repo reads this file first. It overrides the cross-repo
baseline in `Agents/docs/engineering-standards.md` wherever the two differ.

## What this app is

Tielora is a multi-company coordination platform for multidisciplinary engineering work: a project
holds main tasks, each main task is delivered by discipline tasks (Mechanical, Electrical,
Instrumentation, Civil, Process, HSE, Reliability, Inspection — the set depends on the company's
industry template) with required documents, dependencies, comments and a full audit trail.

It began as one company's internal tool. Since the Milestone 1 SaaS conversion it serves many
companies from one database: a company signs itself up at `/signup` (`POST /api/auth/signup`), gets
its disciplines from an industry template and an administrator of its own, and adds everyone else
from the Admin section. Milestone 2 rebranded the whole app to Tielora — there is no other name on
any screen.

## THE TENANT RULE (read this before the golden rule)

> No person, of any role, ever sees or changes anything belonging to another organisation. An ADMIN
> is the administrator of their OWN company only.

Three columns carry the whole thing — `User.orgId`, `Discipline.orgId`, `Project.orgId` — and every
other model reaches its organisation through one of them. In practice:

- `getSessionUser()` and every `ActorContext` carry `orgId`. It always comes from the session, never
  from a request body, a query string or a form.
- **The helpers in `src/lib/db.ts` take `orgId` as their first argument** and filter on it. A listing
  written through them cannot forget the tenant — the compiler asks for it.
- **`assertCan` refuses across organisations before it considers any role.** `PermissionContext`
  makes `orgId` mandatory whenever `projectId` is given, and the `orgId` passed is the TARGET row's,
  read from the row itself. Admins are refused like everyone else.
- Every service loader (`projectInOrg`, `loadMainTask`, `loadDisciplineTask`, `loadDocument`,
  `loadComment`, the comment target resolver) filters by the actor's organisation, so another
  company's row is **not found** rather than forbidden — an outsider never learns an id is real.
- `notify()` takes the actor and filters recipients by their organisation: a fan-out cannot leave it.
- The hourly sweep notifies a task's own assignee or owner, who is always a member of that task's
  project and therefore in the same organisation. Proved in `org-isolation.service.test.ts`.

**Any change touching this area adds or extends a test in
`src/server/__tests__/org-isolation.service.test.ts` in the same change.**

## THE EXTERNAL RULE (the tenant rule, one level in)

> An EXTERNAL contractor sees the discipline tasks assigned to them and the smallest amount of
> parent context needed to understand them — never another person's task, never the team roster,
> never a project they hold no work on. A miss is **not found**, never "forbidden".

- `Role.EXTERNAL` is answered in `can()` **before** every other rule and never falls through to
  them (`canExternal` in `src/lib/permissions.ts`). Their four actions —
  `UPDATE_DISCIPLINE_TASK_STATUS`, `COMPLETE_DISCIPLINE_TASK`, `UPLOAD_DOCUMENT`, `COMMENT` — each
  need `ctx.assigneeId === actor.userId`. `COMMENT` is therefore **tighter** than it is for a
  colleague, who may comment anywhere on a project they belong to.
- **A project role never widens a contractor.** `effectiveRole()` returns `EXTERNAL` whatever the
  `ProjectMember` row says, and `upsertMember`/`createProject` refuse to write any other project
  role for one (or that role for anybody else).
- `VIEW_PROJECT` is only half the answer: `assertCanViewProject()` additionally requires **at least
  one live discipline task assigned to them on that project**, checked before the permission rules
  so the refusal is always "not found".
- **The read side threads two helpers** — `isExternal(actor)` and `externalTaskScope(actor)` in
  `src/server/actor.ts` (plus `activeProjectsForExternal` in `src/lib/db.ts` and
  `projectsVisibleTo(actor)` in `projects.ts`) — through the project list and detail, main-task and
  discipline-task loaders, both Gantt reads, documents (listing, versions and download), search,
  the directory (empty for them), the dashboard, favorites and the comment/activity feeds. The
  project brief and the project- and main-task-level activity feeds are refused outright; the
  personal "your day" brief and My tasks are per-person already and work unchanged.
- **A project-wide fan-out leaves contractors out.** `projectAudience()` (tasks.ts and phases.ts)
  filters `role: { not: "EXTERNAL" }`: an override notification names work a contractor may not see,
  and a notification body is the one door read scoping cannot close. Their own notifications —
  assigned, status changed, sent back for more work — are unaffected.
- **The sign-off.** With `Project.externalSignoffRequired` on (the default), a contractor's
  completion becomes `AWAITING_REVIEW` with a `SUBMITTED_FOR_REVIEW` audit row and a notification to
  the discipline lead and the project's managers. `confirmDisciplineTaskReview()` runs the **real**
  `completeDisciplineTask()` — required documents, dependencies and the stage gate are all still
  judged — and `rejectDisciplineTaskReview()` returns it to `IN_PROGRESS` with a note of at least 5
  characters. **A contractor can never confirm or reject a review, including their own.** With the
  setting off, their completion behaves exactly like an engineer's, gate included.

**Any change touching this area adds or extends a test in
`src/server/__tests__/external-scoping.service.test.ts` in the same change** (and the tenant half in
`org-isolation.service.test.ts`, which now also probes from a contractor's seat).

## THE GOLDEN RULE (the core guarantee)

> A main task's status and progress are always the truth of its discipline tasks — completion can
> never bypass mandatory subtasks or mandatory documents except by a recorded, authorized override —
> and no document revision or audit entry is ever altered or lost.

In practice:

- `MainTask.status` and `MainTask.progressPct` are **derived and cached only**. They are recalculated
  from the live discipline tasks with `deriveMainTask()` in `src/lib/progress.ts` inside the same
  transaction as any change to a discipline task. Nothing else may write them.
- A discipline task may only be completed when `canCompleteDisciplineTask()` says so — mandatory
  required documents present, dependencies closed.
- The only legal bypass is `statusOverride`, which always records who, why (5 characters minimum) and
  when, writes an `OVERRIDE_APPLIED` activity row, and is limited to ADMIN / PROJECT_MANAGER.
- `DocumentVersion` and `ActivityLog` are **append-only**: insert only, never update, never delete.
  Documents are soft-deleted (`deletedAt`); their versions and audit rows stay.
- `OVERDUE` is never stored on a task. It is derived at read time with `isOverdue()`.

**Any change touching this area adds or extends a test in `src/lib/__tests__/progress.test.ts`
(or the service-level equivalent) in the same change.** A guarantee without a test is a hope.

## THE STAGE GATE (the golden rule, one level up)

> A project's phases run in order. A phase is locked while any phase before it still has a main task
> that is not complete, and work under a locked phase cannot be completed — except by a recorded,
> authorized override.

- **Locked is never stored.** It is derived at read time by `phaseLockedFor()` in
  `src/lib/phase-lock.ts` from one grouped query per project (`phaseStatesFor()` in
  `src/server/services/phases.ts`) — the same rule `OVERDUE` follows. There is no `locked` column and
  there must never be one.
- The **first phase is never locked**, an empty earlier phase gates nothing, and a **main task with
  no phase (`phaseId` null) is never gated**. Projects created before phases existed have no phases
  at all, so nothing about them changes.
- A main task counted as complete includes one completed by an authorised `statusOverride`: the
  effective status is the truth everywhere.
- **What a locked phase refuses, server-side in the services**: any discipline-task status
  transition under its main tasks (moving, completing, reopening) and a main-task `statusOverride`.
  **What it still allows**: creating and editing tasks, assigning people, moving work into or out of
  the phase, comments and document uploads. Teams prepare the next stage while the gate is shut.
- The refusal is a precondition, checked **before** any transition is attempted — exactly like
  `canCompleteDisciplineTask()`. `deriveMainTask()` remains the only writer of a main task's status.
- The only way through is `overridePhaseLock()`: ADMIN / PROJECT_MANAGER, a reason of at least 5
  characters, who / why / when written on the phase and a `PHASE_OVERRIDE_APPLIED` activity row in
  the same transaction. An overridden phase stays open permanently. It also **notifies the whole
  project** afterwards, exactly as `overrideMainTaskStatus` does — an `OVERRIDE_APPLIED`
  notification, sent after the transaction commits, so opening a gate is never a quiet act.
- Default phases come from the company's industry template (`PHASE_TEMPLATES` in
  `src/server/industry-templates.ts`) and are created inside `createProject`'s own transaction.

**Any change touching this area adds or extends a test in `src/lib/__tests__/phase-lock.test.ts` and
`src/server/__tests__/phases.service.test.ts` in the same change.**

## House rules

1. **Every mutation follows the same chain**, in this order:
   `zod parse` → `getSessionUser()` → `assertCan(actor, action, ctx)` → rate limit → service in
   `src/server/services` → **ActivityLog append inside the same transaction** → return a typed
   `ActionResult<T>`.
2. **Listings always go through the soft-delete helpers in `src/lib/db.ts`**
   (`activeProjects`, `activeProjectsForUser`, `activeMainTasks`, `activeDisciplineTasks`,
   `activeDocuments`, `activeComments`). Never call `prisma.<model>.findMany` directly for a listing.
3. **Scope every read to the signed-in person.** Non-admins only ever see projects they are a member
   of. `VIEW_PROJECT` is checked server-side, not in the UI.
4. **DTO and input type names come from `src/lib/zod-schemas.ts` only.** Never redefine a shape
   locally, never rename one. If a field is missing, extend the schema there.
5. **No `console.log` anywhere** — use `src/lib/logger.ts`. ESLint enforces this (`no-console`).
   Never log a password, token, cookie or secret; the logger redacts them, but do not rely on it.
6. **Plain-English user-facing text.** Sentence case, no jargon, no stack traces. Dates as
   "30 Sep 2026" via `Intl` — the app carries no date library. The app is English-only; there is no
   i18n dictionary, so strings live in the components.
7. **Brand tokens from `src/app/globals.css` only** (`--brand-primary`, `--brand-ink`,
   `--brand-mid`, `--brand-accent`, `--brand-text`, `--brand-gray`, `--brand-stone`). No new hex
   values anywhere.
8. **Server components for reads by default**; client components only where there is real
   interaction (forms, drag, popovers). TanStack Query lives in `src/app/(app)/providers.tsx`.
9. **Uploads:** always `validateUpload()` then `storeFile()` from `src/lib/upload.ts` — magic-number
   checked, 25 MB cap, random filename under `DATA_DIR`. Never trust the browser's content type.
10. **Rate limiting:** `src/lib/rate-limit.ts` on every auth route, every mutation and every upload —
    `byIp` for anonymous, `byUser` for signed-in. Deny with HTTP 429, a plain-English message and a
    `Retry-After` header. Limits are per-process until a Redis store is added behind
    `RateLimitStore`.
11. **Secrets in env only.** `SESSION_SECRET` must be 32+ characters; the app refuses to boot in
    production without it. New integrations stay dormant until their env var is set and are reported
    in `/api/health`.
    - **Chat integrations are the one thing configured per company rather than per deployment**: a
      Slack or Teams webhook address is pasted by that company's administrator in Admin →
      Integrations and stored on `OrgIntegration`. The rule is unchanged in spirit — nothing is
      switched on until somebody configures it, and `/api/health` reports it: `"integrations":
      {"slack": 0, "teams": 0}` while nobody has one enabled. `APP_BASE_URL` (optional, not a
      secret) only decides whether the link inside a chat message is clickable.
    - **A webhook address is a bearer secret.** It is written once and never read back: no API
      returns it, no `ActivityLog` row records it, no log line contains it (a failure is logged with
      the kind and the organisation id only), and the admin screen only ever sees scheme + host.
      Changing one means pasting it again. Only https, and only the per-kind host allowlist in
      `webhookUrlProblem()` — checked when it is saved **and again at delivery time**, which is the
      SSRF guard.
    - **Microsoft 365 file attachments are the other shape: per deployment AND per company.** The
      Azure app registration is the owner's, in env (`MS_GRAPH_CLIENT_ID`, `MS_GRAPH_CLIENT_SECRET`,
      optional `MS_GRAPH_REDIRECT_PATH`, and `APP_BASE_URL` for the callback address); each company's
      administrator then connects their own Microsoft tenant in Admin → Integrations. Unset env means
      **invisible**: no card, no upload tab, and every `/api/integrations/microsoft/...` route answers
      a plain "not set up". `/api/health` reports
      `"microsoft": {"status": "dormant" | "configured", "connectedOrgs": n}`.
    - **Delivery is best-effort and per-process**, the same accepted limitation rate limiting
      carries: one attempt, one retry on 429 respecting `Retry-After` (capped at ten seconds), then
      the message is dropped with a logged line. There is no queue table. In-app Notifications
      remain the source of truth.
12. **Privacy:** if a change starts storing a new piece of personal data, the privacy page (`/privacy`,
    alongside `/terms`) is part of the same change (see the engineering standards, section 6). Both
    pages are a template pending a real legal review before launch — see `docs/GO-LIVE.md` gate 1.

## Migration pattern

- Prisma with the `pg` driver adapter. Schema: `prisma/schema.prisma`; CLI config: `prisma.config.ts`
  (the datasource URL lives there and in `.env`, never in the schema — Prisma 7 requirement).
- Create migrations with `npx prisma migrate dev --name <short_name>`; apply with
  `npx prisma migrate deploy`. Raw-SQL migrations (like the trigram search indexes) are hand-written
  inside a `--create-only` migration folder. Never `prisma db push` in this repo.
- **The schema is FROZEN after Milestone 1.** Milestones 2–5 must not add, remove or alter a model,
  field, enum value or index. If something is genuinely missing, stop and ask the main session.
- Main-session-approved amendments so far:
  - `20260820180500_dependency_successor_index` (`@@index([successorId])` on TaskDependency —
    completion gating queries that direction).
  - `20260821070011_notification_sweep_lookup_index` (`@@index([type, linkUrl])` on Notification —
    the hourly sweep's "have I already sent this?" check filtered on those two columns with no
    index, i.e. a full scan of the fastest-growing table every hour).
  - `20260830090000_organizations_multi_tenant` (the SaaS conversion — the approved Milestone 1
    amendment. New `Organization` model (name, unique `slug`, `industryTemplate`); a required
    `orgId` with a cascading relation on `User`, `Discipline` and `Project`. Two constraints were
    **converted** from global to per-organisation — `Discipline.code` and `Project.code`
    (`@@unique([orgId, code])`) — so two companies may both run a "CIVIL" discipline or a "PH-1"
    project. `@@unique([orgId, name])` on Discipline is **brand new**: a discipline name was never
    unique before, and it now stops one company holding two disciplines both called "Civil".
    `User.email` stays globally unique on purpose: one address signs in to one company, so the
    sign-in form never has to ask which. `ActivityLog.projectId` was already nullable, which is what
    lets the organisation-level `ORG_CREATED` row exist. The generated diff's five trigram
    `DropIndex` lines were deleted by hand; the two that remain — `Discipline_code_key`,
    `Project_code_key` — are deliberate, being exactly the global uniqueness that became
    per-organisation. **On a populated install** the migration adds each `orgId` nullable, moves
    everything already there into one "Legacy workspace" organisation, then makes the columns
    required; an empty database creates no such organisation. The step that can still fail there is
    the new `@@unique([orgId, name])`: two disciplines sharing a name (or a code, or two projects
    sharing a code) were legal before and clash once they sit in the same legacy company, so those
    duplicates have to be cleaned up by hand before the migration will apply.)
  - `20260825075156_favorites_and_personal_tasks` (two new models for the sidebar: `Favorite` —
    a person's starred project / main task / discipline task, cascading from all four owners, with
    a hand-written `favorite_one_target` CHECK constraint so exactly one target column is ever set;
    and `PersonalTask` — a person's private to-do list. Both are personal preference data, owned by
    one person and read by nobody else. Additive only: no existing model, field, enum value or index
    was changed. The generated migration's five trigram `DropIndex` lines were deleted by hand.)
  - `20260831000716_project_phases_stage_gates` (the stage gates. New `ProjectPhase` model — a
    project's phases in `sortOrder`, cascading from `Project`, with the same three override columns a
    main task carries (`overriddenById`, `overrideReason`, `overriddenAt`), `@@unique([projectId,
    name])` and `@@index([projectId, sortOrder])`; plus one nullable `MainTask.phaseId` with an
    `onDelete: Restrict` relation. Restrict, not SetNull, on purpose: a phase may only be deleted
    once nothing references it, and the service says so in plain English before the database has to.
    **Locked is never a column** — it is derived at read time in `src/lib/phase-lock.ts`, exactly as
    `OVERDUE` is. Additive only: no existing model, field, enum value or index was changed, and on a
    populated install every existing main task simply stays unphased and ungated. The generated
    migration's five trigram `DropIndex` lines were deleted by hand.)

  - `20260831004624_org_integrations` (chat notifications. One new model, `OrgIntegration` — a
    company's Slack or Teams webhook: `orgId` (cascading), `kind`, `webhookUrl`, `enabled`,
    `eventToggles` (Json), a nullable `createdById` (`onDelete: SetNull`, the same shape a phase's
    override columns use) and `@@unique([orgId, kind])`, so one channel per kind per company.
    **`kind` is a plain string column, not a Prisma enum, deliberately**: it is validated by
    `IntegrationKindSchema` in zod, so a third chat tool later needs no migration. Additive only:
    no existing model, field, enum value or index was changed, and a company with no row here has no
    integration at all — dormant by default, and the seed deliberately does not create one. The
    generated migration's five trigram `DropIndex` lines were deleted by hand.)

  - `20260831032424_org_integration_daily_brief` (the daily brief digest. ONE nullable column,
    `OrgIntegration.dailyBriefSentAt` — when the digest last ran for that channel. It is a fact
    about delivery, not a derived state, and it is the only thing that keeps the digest to once a
    day while the sweep itself runs every hour; without it the hourly sweep would have no way of
    knowing it had already sent today's. Additive only: no existing model, field, enum value or
    index was changed, and null (which is what every existing row means) simply reads as "never
    sent". Nothing else about the digest is stored — every number in it is computed at send time.
    The generated migration's five trigram `DropIndex` lines were deleted by hand, and `pg_indexes`
    was checked on both databases afterwards.)

  - `20260831012133_microsoft_connection` (Microsoft 365 file attachments. One new model,
    `MicrosoftConnection` — a company's link to its own OneDrive / SharePoint: `orgId` **unique**
    (one Microsoft tenant per company, cascading), `tenantId`, a nullable `tenantDomain` shown on the
    admin card, a nullable `connectedById` (`onDelete: SetNull`, the same shape `OrgIntegration`
    uses), `connectedAt`, `refreshTokenEnc`, `accessTokenEnc`, `accessTokenExpiresAt` and a nullable
    `staleAt`. **The two token columns hold AES-256-GCM ciphertext under a key derived from
    `SESSION_SECRET` with HKDF** (`src/lib/secret-box.ts`) — never plaintext, never returned by a
    read, never in an audit row or a log line. `staleAt` records that Microsoft has stopped accepting
    the saved token, so the screens can ask for a reconnection instead of failing quietly; it is a
    fact, not a derived state, which is why it is stored. **Nothing about a file is stored here**: an
    attached file becomes an ordinary `DocumentVersion` through the existing
    `validateUpload` → `storeFile` path, so the append-only guarantee is untouched. Additive only:
    no existing model, field, enum value or index was changed, and a company with no row here has no
    connection at all. The generated migration's five trigram `DropIndex` lines were deleted by
    hand.)

  - `20260831073453_external_access_and_posts` (limited external access, plus the noticeboard's
    schema so the two builds share one migration). **Additive only** — nothing is dropped, renamed
    or made stricter, so it is safe on a populated database. `Role` gains `EXTERNAL` and
    `NotificationType` gains `ANNOUNCEMENT` (two `ALTER TYPE ... ADD VALUE` statements, safe inside
    the migration's transaction because neither new value is *used* in the same migration);
    `User.companyName` is nullable (a contractor's employer, shown as the badge beside their name —
    the privacy page was updated in the same change); `Project.externalSignoffRequired` defaults to
    **true**, the safe direction, so every existing project asks for a sign-off from day one; and
    `Organization.broadcastPolicy` defaults to `"ADMIN_PM"`. Two new models: `Post` (the
    noticeboard — `kind` is a **plain string validated by zod** (`PostKindSchema`), not a Prisma
    enum, the same choice `OrgIntegration.kind` made; cascading from `Organization`, `Project` and
    `Discipline`, a one-level self-relation for replies cascading from the parent post, an author
    relation that is **Restrict** exactly as a `Comment`'s is because nobody is ever hard-deleted,
    and indexes on `[orgId, kind, createdAt desc]`, `[orgId, disciplineId]`, `[orgId, projectId]`
    and `parentId`) and `PostDismissal` (`@@unique([postId, userId])`, cascading from both the post
    and the person). The generated migration's five trigram `DropIndex` lines were deleted by hand,
    and `pg_indexes` was checked on both databases afterwards.)

- **Careful with `prisma migrate dev`:** the trigram search indexes are hand-written raw SQL that the
  Prisma schema does not know about, so the generated migration will try to DROP them. Delete those
  `DropIndex` lines from the generated `migration.sql` before it goes anywhere near a real database.

## Route and DTO contract (Milestones 2–5)

Every route returns `{ ok: true, data }` or `{ ok: false, error, fieldErrors? }` — the `ActionResult`
shape. All types below come from `src/lib/zod-schemas.ts`.

| Route | Method | Input | Output |
|---|---|---|---|
| `/api/projects` | GET | — | `ProjectListItemDTO[]` |
| `/api/projects/[id]` | GET | — | `ProjectDTO` |
| `/api/projects/[id]/main-tasks` | GET | query: `status`, `disciplineId`, `assigneeId`, `priority`, `q` | `MainTaskListItemDTO[]` |
| `/api/projects/[id]/phases` | GET | — | `PhaseDTO[]` (gate order; `locked` and `lockedByPhaseName` derived at read time, never stored) |
| `/api/projects/[id]/brief` | GET | — | `ProjectBriefDTO` ("Where we stand" — progress now against seven days ago, current blockers, and the open work of the earliest phase with any; every member of the project may read it) |
| `/api/projects/[id]/gantt` | GET | — | `GanttDTO` (each main task carries its `phaseId`, so the project timeline can band the rows) |
| `/api/tasks/[id]` | GET | — | `MainTaskDTO` |
| `/api/tasks/[id]/gantt` | GET | — | `GanttDTO` |
| `/api/tasks/[id]/documents` | GET | — | `DocumentDTO[]` |
| `/api/tasks/[id]/activity` | GET | — | `ActivityItemDTO[]` (newest first; includes its discipline tasks' rows) |
| `/api/tasks/[id]/comments` | GET | — | `CommentDTO[]` (oldest first, each with an added `isDeleted` tombstone flag) |
| `/api/discipline-tasks/[id]` | GET | — | `DisciplineTaskDTO` |
| `/api/discipline-tasks/[id]/comments` | GET | — | `CommentDTO[]` (oldest first, each with an added `isDeleted` tombstone flag) |
| `/api/discipline-tasks/[id]/activity` | GET | — | `ActivityItemDTO[]` (newest first) |
| `/api/projects/[id]/activity` | GET | — | `ActivityItemDTO[]` (newest first, 100 max) |
| `/api/discipline-tasks/[id]/documents` | GET | — | `DocumentDTO[]` |
| `/api/projects/[id]/documents` | GET | — | `DocumentDTO[]` (live documents, 200 newest first) |
| `/api/documents/[id]/versions` | GET | — | `DocumentVersionDTO[]` (every revision, newest first) |
| `/api/disciplines` | GET | — | `DisciplineDTO[]` (the catalogue, any signed-in person) |
| `/api/users` | GET | query: `q` (optional name or email fragment) | `UserDTO[]` (active people, 50 max) |
| `/api/notifications` | GET | — | `NotificationDTO[]` (the signed-in person's own, newest first, 100 max, read and unread together) |
| `/api/notifications/unread-count` | GET | — | `{ unread: number }` (the bell's badge — its own tiny route so the topbar can poll it every 60 seconds without pulling the list) |
| `/api/search?q=` | GET | `q` | `SearchResultsDTO` |
| `/api/dashboard` | GET | — | `DashboardDTO` (adds `awaitingMySignoff` — the contractor work THIS person may sign off, empty for everybody who reviews nothing and always empty for a contractor) |
| `/api/uploads` | POST | multipart: `file`, `projectId`, `mainTaskId?` \| `disciplineTaskId?`, `documentId?`, `requiredDocumentId?`, `title?`, `category?`, `note?` (validated by `UploadMeta`) | `DocumentVersionDTO` |
| `/api/documents/versions/[versionId]/download` | GET | — | file stream |
| `/api/auth/signup` | POST | `SignupInput` | `SignupResultDTO` + session cookie (public; `byIp` limited to 5 an hour) |
| `/api/auth/login` | POST | `LoginInput` | session cookie |
| `/api/auth/logout` | POST | — | `{ signedOut: true }` |
| `/api/auth/me` | GET | — | signed-in user |
| `/api/health` | GET | — | health JSON (adds `integrations` — how many companies have each chat kind switched on, numbers only: `{"slack": 0, "teams": 0}` when nobody has — and `microsoft`: `{"status": "dormant"\|"configured", "connectedOrgs": n}`) |
| `/api/integrations/microsoft/connect` | GET | — | 302 to Microsoft's sign-in (ADMIN; signed `state` binds the attempt to this person and company) |
| `/api/integrations/microsoft/callback` | GET | query: `code`, `state` (or `error`) | 302 back to `/admin/integrations?microsoft=connected\|denied\|failed\|setup` |
| `/api/integrations/microsoft/status` | GET | — | `MicrosoftConnectionDTO` (404 "not set up" while dormant, which is how the upload tab stays hidden) |
| `/api/integrations/microsoft/drives` | GET | query: the upload target (`projectId` + one of `mainTaskId`/`disciplineTaskId`/`documentId`) | `MicrosoftDriveDTO[]` |
| `/api/integrations/microsoft/items` | GET | query: upload target + `driveId`, `itemId?` | `MicrosoftListingDTO` |
| `/api/integrations/microsoft/search` | GET | query: upload target + `driveId`, `q` | `MicrosoftListingDTO` |
| `/api/integrations/microsoft/attach` | POST | `AttachMicrosoftFileInput` (the upload meta plus `driveId`, `itemId`) | `DocumentVersionDTO` — a normal revision |
| `/api/my-tasks` | GET | — | `MyTasksDTO` (everything assigned to the signed-in person: up to 200 open tasks by deadline **plus** the 50 most recently completed, read in two windows so history never crowds out live work, with `truncated`; `totals` counted in the database over all of it) |
| `/api/my-tasks/brief` | GET | — | `BriefDTO` ("Your day" — due today, overdue with days over, newly unblocked in the last 24 hours, mentions in the last 24 hours, awaiting your review; every section capped at 10 with its true `total` beside it) |
| `/api/my-tasks/gantt` | GET | — | `GanttDTO` (only the signed-in person's discipline tasks, grouped under their main tasks; bounded — open work plus work whose deadline fell inside the last 90 days, 300 bars max) |
| `/api/favorites` | GET | — | `FavoriteDTO[]` (the signed-in person's own shortcuts, newest first, 50 max; deleted targets and anything in a project they may no longer see are skipped) |
| `/api/personal-tasks` | GET | — | `PersonalTaskDTO[]` (the signed-in person's own list, open items first, then by `sortOrder` so newly added lines lead, 200 max) |

Server actions live in `src/server/actions`. Each takes its `*Input` type and returns
`ActionResult<*DTO>`:

| Action | Input | Output |
|---|---|---|
| `createProject` | `CreateProjectInput` | `ActionResult<ProjectDTO>` |
| `updateProject` | `UpdateProjectInput` | `ActionResult<ProjectDTO>` |
| `setExternalSignoffRequired` (EDIT_PROJECT; audited like any other project setting) | `SetExternalSignoffInput` | `ActionResult<ProjectDTO>` |
| `upsertMember` | `UpsertMemberInput` | `ActionResult<ProjectMemberDTO>` |
| `removeMember` | `{ projectId, userId }` | `ActionResult<{ removed: true }>` |
| `upsertProjectDiscipline` | `UpsertProjectDisciplineInput` | `ActionResult<ProjectDisciplineDTO>` |
| `removeProjectDiscipline` | `{ projectId, disciplineId }` | `ActionResult<{ removed: true }>` |
| `createPhase` (ADMIN / PM; goes at the end of the sequence) | `CreatePhaseInput` | `ActionResult<PhaseDTO>` |
| `renamePhase` (ADMIN / PM) | `RenamePhaseInput` | `ActionResult<PhaseDTO>` |
| `reorderPhases` (ADMIN / PM; the FULL ordered id list, never a partial one) | `ReorderPhasesInput` | `ActionResult<PhaseDTO[]>` |
| `deletePhase` (ADMIN / PM; refused while any main task still references it) | `DeletePhaseInput` | `ActionResult<{ removed: true }>` |
| `overridePhaseLock` (ADMIN / PM; reason 5 characters minimum, writes `PHASE_OVERRIDE_APPLIED`, notifies the project with `OVERRIDE_APPLIED`) | `OverridePhaseLockInput` | `ActionResult<PhaseDTO>` |
| `setMainTaskPhase` (allowed even into a locked phase — only completing is refused) | `SetMainTaskPhaseInput` | `ActionResult<MainTaskDTO>` |
| `createMainTask` | `CreateMainTaskInput` | `ActionResult<MainTaskDTO>` |
| `updateMainTask` | `UpdateMainTaskInput` | `ActionResult<MainTaskDTO>` |
| `overrideMainTaskStatus` | `OverrideStatusInput` | `ActionResult<MainTaskDTO>` |
| `clearOverride` | `{ id }` | `ActionResult<MainTaskDTO>` |
| `createDisciplineTask` | `CreateDisciplineTaskInput` | `ActionResult<DisciplineTaskDTO>` |
| `updateDisciplineTask` | `UpdateDisciplineTaskInput` | `ActionResult<DisciplineTaskDTO>` |
| `updateDisciplineTaskStatus` | `UpdateTaskStatusInput` | `ActionResult<DisciplineTaskDTO>` |
| `completeDisciplineTask` | `{ id }` | `ActionResult<DisciplineTaskDTO>` |
| `confirmDisciplineTaskReview` (lead / PM / ADMIN, never an EXTERNAL; runs the real completion gate) | `ConfirmReviewInput` | `ActionResult<DisciplineTaskDTO>` |
| `rejectDisciplineTaskReview` (same people; note of 5 characters minimum, notifies the contractor) | `RejectReviewInput` | `ActionResult<DisciplineTaskDTO>` |
| `reopenDisciplineTask` | `{ id, reason }` | `ActionResult<DisciplineTaskDTO>` |
| `addDependency` | `AddDependencyInput` | `ActionResult<DisciplineTaskDTO>` |
| `removeDependency` | `AddDependencyInput` | `ActionResult<DisciplineTaskDTO>` |
| `createComment` | `CreateCommentInput` | `ActionResult<CommentDTO>` |
| `editComment` | `{ id, body }` | `ActionResult<CommentDTO>` |
| `deleteComment` | `{ id }` | `ActionResult<{ removed: true }>` (soft delete — the thread keeps a tombstone) |
| `softDeleteDocument` (ADMIN / PM; never deletes a revision) | `{ id }` | `ActionResult<{ deleted: true }>` |
| `markNotificationRead` (own notification only — someone else's is refused) | `{ id }` | `ActionResult<NotificationDTO>` |
| `markAllNotificationsRead` (the signed-in person's unread only) | — | `ActionResult<{ count: number }>` |
| `createUser` (always into the actor's own organisation) | `CreateUserInput` | `ActionResult<UserDTO>` |
| `updateUser` | `UpdateUserInput` | `ActionResult<UserDTO>` |
| `deactivateUser` | `{ id }` | `ActionResult<UserDTO>` |
| `createDiscipline` | `CreateDisciplineInput` | `ActionResult<DisciplineDTO>` |
| `updateDiscipline` | `UpdateDisciplineInput` | `ActionResult<DisciplineDTO>` |
| `updateTaskDates` (Gantt drag) | `UpdateTaskDatesInput` | `ActionResult<MainTaskDTO \| DisciplineTaskDTO>` |
| `toggleFavorite` (stars or un-stars in one press; only something you may see; no audit row) | `ToggleFavoriteInput` | `ActionResult<{ favorited: boolean }>` |
| `createPersonalTask` (own list only; no audit row) | `CreatePersonalTaskInput` | `ActionResult<PersonalTaskDTO>` |
| `togglePersonalTask` (own list only — someone else's item does not exist) | `TogglePersonalTaskInput` | `ActionResult<PersonalTaskDTO>` |
| `deletePersonalTask` (own list only; a private jotting has no audit trail to keep) | `DeletePersonalTaskInput` | `ActionResult<{ removed: true }>` |
| `saveIntegration` (ADMIN in their own company; the address is validated per kind and never returned) | `SaveIntegrationInput` | `ActionResult<OrgIntegrationDTO>` |
| `setIntegrationEnabled` (ADMIN; needs an address saved first) | `SetIntegrationEnabledInput` | `ActionResult<OrgIntegrationDTO>` |
| `setEventToggles` (ADMIN; all six events are saved together — the five notification copies plus the daily brief) | `SetEventTogglesInput` | `ActionResult<OrgIntegrationDTO>` |
| `sendTestMessage` (ADMIN; rate limited hard — five a minute per person, because each press posts into a real channel) | `IntegrationKindInput` | `ActionResult<IntegrationTestResultDTO>` |
| `deleteIntegration` (ADMIN; removes the address with the connection, audit rows stay) | `IntegrationKindInput` | `ActionResult<{ removed: true }>` |
| `disconnectMicrosoft` (ADMIN; deletes the stored tokens, audit row stays. Connecting is a browser journey to Microsoft, so only this half can be an action) | — | `ActionResult<{ removed: true }>` |

## Notifications and the deadline sweep

- **`notify()` (`src/server/services/notify.ts`) is the only way a Notification row is written by a
  person's action.** Every service already calls it *after* its transaction has committed, so a
  problem saving notifications can never undo the change that caused them — failures are logged and
  swallowed. It skips the actor, skips duplicates inside one call, and skips deactivated people.
- **Marking a notification read writes no `ActivityLog` row.** Read state is a personal preference,
  not project work; the audit trail records project work only. This is the one documented exception
  to house rule 1.
- **A daily brief writes nothing at all.** Both briefs are reads: no notification, no audit row, no
  stored snapshot. See "Chat delivery" below for the digest's own deviation.
- **Favorites and personal to-do items write no `ActivityLog` row either**, for exactly the same
  reason: starring a project and jotting a private reminder are personal preferences, not project
  work. Same documented exception, same rule — everything else in `src/server/services` still
  appends its audit row inside the transaction.
- **The sweep** (`src/server/sweep.ts`, started by `src/instrumentation.ts` in the Node runtime only,
  once per process — first run ~60 seconds after boot, then hourly) sends `DEADLINE_APPROACHING` for
  open tasks due inside 48 hours and `OVERDUE` for open tasks past their deadline: discipline tasks
  to their assignee, main tasks to their owner.
  - Every run takes a **Postgres advisory lock** (`pg_try_advisory_xact_lock`, key `728431001`) inside
    the transaction that does the work, and skips the run if another instance holds it. A
    transaction-scoped lock is always released when the transaction ends, which a session-scoped lock
    cannot promise behind a connection pool.
  - **Sent exactly once**, without a new column (the schema is frozen): a notification's `linkUrl`
    identifies the task, so the sweep looks for a row of the same type, for the same person, with the
    same link. `OVERDUE` is once per person per task, ever; `DEADLINE_APPROACHING` only counts a row
    created inside the current 48-hour window, so moving a deadline out earns a fresh warning.
  - **Nothing depends on the sweep having run.** Overdue is still derived at read time everywhere
    (`isOverdue()`); a skipped run costs a nudge, never correctness.
  - `SWEEP_DISABLED=1` stops the scheduler (the tests set it). `runSweepOnce()` itself ignores the
    flag so tests can call it directly.

## Chat delivery (Slack and Microsoft Teams)

- **Text somebody typed is never allowed to become a link in a chat channel.** A Slack mrkdwn field
  turns `<url|label>` into a link and a Teams Adaptive Card TextBlock renders `[label](url)`, so a
  task title is escaped on the way into both (`slackEscape` / `teamsEscape` in `webhooks.ts`) — the
  Slack fallback `text` included. Slack's `plain_text` header is deliberately not escaped: Slack
  never parses that field, so escaping it would only show people `&lt;`.
- **In-app notifications are the truth; a chat message is a copy.** `deliverToOrgWebhooks()`
  (`src/server/services/webhooks.ts`) is called from `notify()` **after** the notification rows are
  committed, and deliberately not awaited — nobody waits on Slack to see their own change go
  through. The hourly sweep's reminders take the same road: `sweepDeadlineNotifications()` returns
  the events it wrote and `runSweepOnce()` posts them once its transaction has committed, never
  inside it — capped at 20 per company per run **and** at a 30-second budget for the whole chat step
  (checked after each send, so one message always goes). Anything held back is a nudge; the
  notification rows are already committed.
- **Only enabled + toggled events are delivered.** Each `NotificationType` maps to one of the five
  toggles (`taskAssigned`, `mention`, `statusChange`, `overdueReminder`, `gateOverride`);
  `DOCUMENT_UPLOADED` and `COMMENT_ADDED` map to nothing and stay in the app.
- **The fan-out cannot leave the company**, for the same reason `notify()` cannot: the lookup is
  `where: { orgId, enabled: true }`, and the `orgId` is the actor's (or, in the sweep, the
  recipient's, who is always a member of that task's project).
- **The daily brief digest is chat-only, and off unless asked for.** A sixth toggle, `dailyBrief`,
  sits beside the five notification copies; it defaults to **off**, and it is deliberately NOT part
  of `TOGGLE_FOR_TYPE` — the digest is a summary of data the app already holds, not a fan-out of any
  `NotificationType`, and the compiler refuses to let a notification type map to it
  (`FanOutToggle` in `webhooks.ts`). Because a saved `eventToggles` written before the digest existed
  has only five keys, `dailyBrief` carries a zod `.default(false)`: an old row keeps parsing, and
  reads as "digest off", instead of silently switching a company's whole chat delivery off.
- **The digest writes no in-app notification.** This is the third documented exception to house
  rule 1, alongside marking a notification read and the favorites / personal to-do items: there is
  nothing new to record — every line of the digest is data the app already holds, and a notification
  would only be a second copy of a summary nobody asked to be notified about.
- **It goes out once a day, from the hourly sweep** (`postDailyDigests` in `src/server/sweep.ts`):
  the first run after **05:00 UTC** sends one compact card per connected, enabled, digest-toggled
  channel — one line per active project, with its progress, overdue count, blocked count and next
  gate. The admin card calls that "early morning UTC" in so many words rather than promising anybody
  a local time.
  - **Once a day, per channel.** `OrgIntegration.dailyBriefSentAt` is stamped after each company is
    dealt with, whether or not there was anything to say, so the other twenty-three runs do nothing;
    a company with no active project is sent nothing at all.
  - **Only the channels that were due are posted to.** The sweep chooses them and hands the ids to
    `deliverDailyBrief`, which posts to those and nothing else. If delivery looked them up for
    itself, a Teams channel switched on at nine in the morning would make the ten o'clock sweep post
    to Slack a second time — Slack was not due, but it was enabled.
  - **A late server sends late, not never.** The condition is "after 05:00 UTC and not yet sent
    today", not "at 05:00": a server that only comes up at 23:00 UTC sends that day's digest at
    23:00, and the next one the following morning. Missing a day entirely costs a summary, never
    anything the app depends on.
  - **Its own 30-second budget**, the same size as the reminders' and separate from it — the two
    steps run one after the other, so a slow chat tool cannot make the pair take longer than a
    minute. It is checked after each company, so one always goes, and the queue is ordered
    longest-waiting first (`dailyBriefSentAt` ascending, never-sent first) so a cut-short run serves
    the companies that missed out first next time.
- Payloads are Slack Block Kit and the Teams Adaptive Card envelope (version 1.4 pinned), both
  bounded by the 28 KB Teams cap — an oversized message is dropped rather than sent to be rejected.
  Links use `APP_BASE_URL`; unset, the message names the page instead.

**Any change touching this area adds or extends a test in
`src/server/__tests__/integrations.service.test.ts` in the same change — and the tests never touch
the network: `global.fetch` is mocked.**

## Microsoft 365 attachments (OneDrive and SharePoint)

- **An attached file is an ordinary upload.** `attachMicrosoftFile()` fetches the bytes and then
  walks the same road `/api/uploads` walks: size checked from Graph's metadata *before* anything is
  downloaded and again on what arrived, `validateUpload()` on the bytes (a renamed `.exe` is refused
  exactly as it is from a browser), `storeFile()` under a random name, then
  `uploadDocumentVersion()`. There is no second way to write a `DocumentVersion`, and the
  append-only guarantee is untouched. Where it came from is recorded in the revision's own `note`.
- **Browsing needs the permission an upload needs.** Every browse and attach route carries the
  upload target and calls `assertCanUploadTo()` (`src/server/services/documents.ts`) — the same
  function `uploadDocumentVersion` calls — before a single file name is returned. "Attach from
  OneDrive" can therefore never reach further than "upload a file" already does.
- **One connection per company, resolved from `actor.orgId` only.** `MicrosoftConnection.orgId` is
  unique and every lookup is `where: { orgId: actor.orgId }`, so another company's connection, drive
  id or file id is **not found**. Everyone in a company browses through the account its administrator
  connected; the admin card and the privacy page both say so plainly.
- **Two hosts, ever**: `graph.microsoft.com` and `login.microsoftonline.com`, checked on every
  outbound call in `src/server/services/graph.ts` (the SSRF guard, the same shape the chat webhooks
  carry). The one exception is a file download: `/content` answers 302 to a short-lived Microsoft
  content host, so the redirect is **never followed automatically** — the target is checked against
  the content-host allowlist in `src/lib/ms-graph.ts` and then fetched **without** our bearer token.
- **Tokens are encrypted at rest** (`src/lib/secret-box.ts`: HKDF from `SESSION_SECRET`, AES-256-GCM,
  keyed per purpose) and never returned, logged or written to an audit row. Microsoft retires a
  refresh token as it is used, so the new one is always saved; **one refresh is in flight per company
  at a time** (per process, like rate limiting), because racing refreshes are how a working
  connection breaks itself. A 401 buys exactly one forced refresh and one retry — then the connection
  is marked `staleAt` and the screens ask an administrator to reconnect.
- **No Microsoft JavaScript anywhere.** The picker is ours, fed by our own routes, so the strict
  Content-Security-Policy in `next.config.ts` needed no change at all.

**Any change touching this area adds or extends a test in
`src/server/__tests__/microsoft.service.test.ts` in the same change — and the tests never touch the
network: `global.fetch` is mocked.**

## Verify recipe (run in this order, all must pass)

```
npm ci
npx prisma generate
DATABASE_URL="$DATABASE_URL_TEST" npx prisma migrate deploy
npm run seed
npm run seed:check
npm run lint
npx tsc --noEmit
npm test
npm run build
```

`npm run verify` chains the middle steps against the current `DATABASE_URL`.

After any migration, check the trigram indexes really did survive on **both** databases:

```
psql "$DATABASE_URL"      -c "SELECT indexname FROM pg_indexes WHERE indexname LIKE '%trgm%';"
psql "$DATABASE_URL_TEST" -c "SELECT indexname FROM pg_indexes WHERE indexname LIKE '%trgm%';"
```

Five rows each: Project_name, MainTask_title, DisciplineTask_title, Document_title, User_name.

About the two seed steps:

- `npm run seed` is safe to run again and again. It refreshes the disciplines and the demo people,
  then stops if the demo project `SUR-EXP` is already there. `SEED_RESET=1 npm run seed` rebuilds that
  demo project from scratch — development data only, never against real data.
- `npm run seed:check` proves the seeded data still obeys the golden rule: the design review sits at
  60% and in progress, the inspection close-out at 100% and complete, the vendor review is overdue by
  derivation, the HAZOP override is recorded with who, why and when, and the project has a real audit
  trail. It fails loudly if any of that drifts.
- The service tests (`npm test`) run against `DATABASE_URL_TEST` and empty it between tests, so they
  never touch the seeded development data.

## Review priorities for `code-reviewer`

1. **Tenant leaks** — a query with no organisation filter, an `assertCan` given the actor's own
   `orgId` instead of the target row's, a loader that finds a row before checking whose it is, a
   listing that bypasses the helpers in `src/lib/db.ts`.
2. **Golden-rule violations** — a status or progress value written by hand, a completion that skips a
   mandatory document or open dependency, an override without a recorded reason, an updated or
   deleted `DocumentVersion` / `ActivityLog` row.
3. **External leaks** — a listing, loader or raw query reached by an `EXTERNAL` that is not narrowed
   by `externalTaskScope(actor)` (or an equivalent filter), and any refusal that answers "forbidden"
   where the external rule says "not found".
4. **Missing server-side authorisation or scoping** — a route without `assertCan`, a query that is
   not limited to the signed-in person's projects.
5. **Unvalidated input** — a body, query or form read without a zod parse; an upload trusted by name.
6. **Audit-log gaps** — a mutation that does not append an `ActivityLog` row in the same transaction.
7. **Conventions drift** — redefined DTO types, raw `findMany` in a listing, `console.log`, new hex
   colours, a schema change after Milestone 1.

## Notes

- **The briefs are computed, never stored** (`src/server/services/briefs.ts`). Two derivations are
  worth naming, because both replace a column somebody might otherwise be tempted to add:
  - **When a main task finished.** `MainTask` has no `completedAt` and must not gain one — the
    golden rule already says its status is the truth of its discipline tasks, so the moment it
    finished is the moment the LAST of them finished (`DisciplineTask.completedAt`), or the moment
    an authorised override was recorded (`MainTask.overriddenAt`). That is what "seven days ago"
    on the project brief is worked out from; a completion whose moment cannot be recovered counts
    as old, so progress is never overstated. Two things keep that comparison honest: only main
    tasks that **existed** seven days ago are in either number (`totalThen`), so adding work cannot
    make progress appear to fall; and work **reopened inside the week** counts as complete then,
    because it was — finishing it again is not fresh progress. The one case this understates is work
    finished for the first time inside the week and then reopened and finished again, which is the
    conservative direction.
  - **When a task became newly unblocked.** Derived from state that is already there: every live
    predecessor is complete and the most recent of those completions is inside the last 24 hours,
    or the task's phase is open now and its gate opened inside that window (the last main task
    before it finishing, or the phase override's own timestamp) **and nothing else is holding the
    task** — a gate opening frees nothing while a live predecessor is still open, and the app would
    refuse the work anyway. Nothing records "unblocked" and nothing needs to.
  - **Every digest number is counted in the database**, never off a capped scan: a cap with no
    ordering lets Postgres return whichever rows it likes, and a project with plenty of late work
    could have posted "0 overdue". Only the number of project LINES is capped, and the card says how
    many were left out.
- `disciplineSummary[].requiredDocsTotal` / `requiredDocsSatisfied` count **mandatory** required
  documents only, so the "1/2 documents" hint on a discipline row always says the same thing as the
  completion gate. They are filled by two grouped queries per read (`requiredDocCountsFor()` in
  `src/server/services/tasks.ts`) — never one query per row.
