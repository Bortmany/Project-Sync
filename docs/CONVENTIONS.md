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
  assigned, status changed, sent back for more work — are unaffected. **An announcement's fan-out
  carries the same filter** (`announcementRecipients()` in posts.ts), **and so do comment and
  mention fan-outs** (`notifiableRecipients()` in comments.ts — a contractor hears about a comment
  only on a discipline task assigned to them).
- **They have no noticeboard.** No Messages row in the sidebar, `/messages` answers "not found", and
  every announcement and board read or write in `posts.ts` refuses them not-found-style. Their daily
  brief keeps working with an empty announcements section.
- **Access can be given an end date.** `User.accessExpiresAt` is a contractor's last day; blank
  means no expiry, and no other role may carry one. Once it has passed, `getSessionUser()` and the
  login route refuse them **exactly as they refuse a deactivated account** — the same wording, the
  same status, never a word about why — and `getSessionUser()` deletes their `Session` rows as it
  goes, so a browser already open dies with the date. Nothing else changes: the account, its work
  and its audit trail all stay, and extending the date in Admin → Users lets them straight back in.
  "Expired" is derived from the date at read time (`isAccessExpired()` in
  `src/lib/access-expiry.ts`), never stored, and it is admin-screen data only — `UserDTO` carries it
  the way it carries `lastLoginAt`, so the directory and the pickers never do.
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
    - **Transactional email is per deployment and nothing else**: `RESEND_API_KEY` (a real secret)
      and `EMAIL_FROM`, plus `APP_BASE_URL`, which email needs the way Microsoft needs it. Unset
      means **no email is ever sent and nothing else changes**; `/api/health` reports
      `"email": "dormant"`. See "Transactional email" below.
    - **Delivery is best-effort and per-process**, the same accepted limitation rate limiting
      carries: one attempt, one retry on 429 respecting `Retry-After` (capped at ten seconds), then
      the message is dropped with a logged line. There is no queue table. In-app Notifications
      remain the source of truth. **Email follows exactly the same road.**
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

  - `20260831135208_external_access_expiry` (contractor access expiry. ONE nullable column,
    `User.accessExpiresAt` — the day an EXTERNAL contractor's access ends. Additive only: no
    existing model, field, enum value or index was changed, and null (which is what every existing
    account means) reads as "no expiry", so nobody who can sign in today loses access when it is
    applied. Only a contractor ever carries a date — `createUser`/`updateUser` clear it for every
    other role, and zod refuses one sent with an internal role — and **"expired" itself is never
    stored**: it is derived from the date at read time by `isAccessExpired()` in
    `src/lib/access-expiry.ts`, with the same one-day grace `isOverdue()` gives a deadline, so
    somebody whose access ends 30 Sep is still let in on 30 Sep. The generated migration's five
    trigram `DropIndex` lines were deleted by hand, and `pg_indexes` was checked on both databases
    afterwards.)

  - `20260831152239_email_tokens_and_verification` (transactional email. One new model, `EmailToken`
    — a single-use link sent to somebody by email: `userId` (cascading), `purpose`, a unique
    `tokenHash`, `expiresAt`, a nullable `usedAt`, `createdAt` and `@@index([userId, purpose])`;
    plus ONE nullable column, `User.emailVerifiedAt`. **Only the SHA-256 hash of the token is ever
    stored** — exactly what `Session.tokenHash` already does. The raw token leaves the server once,
    inside the email, and is never stored, never returned by a read, never written to an audit row
    and never logged, so a copy of the database hands nobody a working link. Plain SHA-256 rather
    than the HMAC a session uses, deliberately: an emergency `SESSION_SECRET` rotation should sign
    everyone out (which is the point) without also killing every invitation in flight, and 32 random
    bytes is what stops the token being guessed either way. **`purpose` is a plain string validated
    by zod** (`EmailPurposeSchema` — "INVITE", "RESET", "VERIFY"), not a Prisma enum, the same choice
    `OrgIntegration.kind` and `Post.kind` made, so a fourth kind of link needs no migration.
    **Cascade from `User` is deliberate**: these rows are worthless without the account they belong
    to and carry no audit value of their own — the `ActivityLog` row about the email is the record,
    and it stays. Additive only: no existing model, field, enum value or index was changed, and
    `emailVerifiedAt` null (which is what every existing account means) simply reads as "never
    verified", which restricts nobody — the app nudges, it never locks. The generated migration's
    five trigram `DropIndex` lines were deleted by hand, and `pg_indexes` was checked on both
    databases afterwards.)

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
| `/api/auth/forgot-password` | POST | `ForgotPasswordInput` | `{ sent: true }` — **the same body, status and bytes whatever the address was**: with an account, without one, deactivated, or a contractor whose access has run out. Public; `byIp` limited to 3 an hour **and** 3 an hour per address asked about. Answers the dormant sentence (503) while email is not set up, and sends nothing |
| `/api/auth/reset-password` | POST | `ResetPasswordInput` | `PasswordChangedDTO` — **no session, no cookie** (public; `byIp` limited to 10 an hour) |
| `/api/auth/set-password` | POST | `SetPasswordInput` | `PasswordChangedDTO` — accepting an invitation; also marks the address verified. **No session, no cookie** (public; `byIp` limited to 10 an hour) |
| `/api/auth/logout` | POST | — | `{ signedOut: true }` |
| `/api/auth/me` | GET | — | signed-in user |
| `/api/health` | GET | — | health JSON (adds `integrations` — how many companies have each chat kind switched on, numbers only: `{"slack": 0, "teams": 0}` when nobody has — `microsoft`: `{"status": "dormant"\|"configured", "connectedOrgs": n}`, and `email`: `"dormant"` or `"configured"`, a word and nothing else. `"configured"` means all three of `RESEND_API_KEY`, `EMAIL_FROM` and `APP_BASE_URL` are set, because an email with no link is no use) |
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
| `/api/posts/announcements` | GET | — | `PostDTO[]` (the announcements still running for this person's audiences — company-wide, their projects, their department(s) — newest first, 50 max, each flagged `dismissed`. Not found for a contractor) |
| `/api/posts/audiences` | GET | — | `PostAudienceDTO[]` (the noticeboard tabs this person may read, each with `canPost` / `canModerate`. An ADMIN gets every project and discipline of their OWN company) |
| `/api/posts/board` | GET | query: `tab` (`everyone` \| `project:<id>` \| `discipline:<id>`, default `everyone`) | `BoardPostDTO[]` (roots newest first, 50 max, each with its replies oldest first, 100 max; removed posts stay as tombstones. An audience this person does not belong to is **not found**) |

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
| `createComment` (`CreateCommentInput` now also carries an optional `disciplineMentions` — the departments mentioned, as plain discipline ids; the service folds them into the stored `mentions` array as `"d:"` tokens) | `CreateCommentInput` | `ActionResult<CommentDTO>` |
| `editComment` | `{ id, body }` | `ActionResult<CommentDTO>` |
| `deleteComment` | `{ id }` | `ActionResult<{ removed: true }>` (soft delete — the thread keeps a tombstone) |
| `softDeleteDocument` (ADMIN / PM; never deletes a revision) | `{ id }` | `ActionResult<{ deleted: true }>` |
| `markNotificationRead` (own notification only — someone else's is refused) | `{ id }` | `ActionResult<NotificationDTO>` |
| `markAllNotificationsRead` (the signed-in person's unread only) | — | `ActionResult<{ count: number }>` |
| `createUser` (always into the actor's own organisation; `CreateUserInput` and `UpdateUserInput` both now carry an optional, nullable `accessExpiresAt`, which zod refuses on any role but EXTERNAL and the service clears for one. `CreateUserInput` also carries an optional `mode` — `"PASSWORD"` (left out means this, and it is the only path while email is dormant) or `"INVITE"`, which creates the account with an unusable random password hash, mints an INVITE link in the same transaction and emails it after the commit. Zod refuses a password sent with `"INVITE"` and refuses `"PASSWORD"` with none) | `CreateUserInput` | `ActionResult<UserDTO>` |
| `updateUser` (an access end date sent for somebody who is no longer a contractor is cleared, exactly as `companyName` is; the audit row names "access end date" as a field that moved, never the date itself) | `UpdateUserInput` | `ActionResult<UserDTO>` |
| `deactivateUser` | `{ id }` | `ActionResult<UserDTO>` |
| `resendInvite` (ADMIN in their own company; only for somebody who has never signed in — `lastLoginAt` null — and only while email is configured. Re-issuing retires the link already in their inbox; audited with a second `EMAIL_SENT` row. Three a minute per person) | `ResendInviteInput` | `ActionResult<EmailSentDTO>` |
| `resendVerificationEmail` (the banner's action; your OWN address and nobody else's, three a minute per person. An address that is already verified answers the same `{ sent: true }` rather than an error) | — | `ActionResult<EmailSentDTO>` |
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
| `createPost` (`POST_ANNOUNCEMENT` / `POST_BOARD` by kind; exactly one audience; an announcement may carry an expiry and notifies its audience) | `CreatePostInput` | `ActionResult<PostDTO>` |
| `replyToPost` (BOARD only, one level deep — a reply's parent is always a root post; anybody who may READ that board may reply) | `ReplyToPostInput` | `ActionResult<PostDTO>` |
| `editPost` (author, or an ADMIN correcting one) | `EditPostInput` | `ActionResult<PostDTO>` |
| `deletePost` (author, or whoever moderates that board; soft delete — the feed keeps a tombstone) | `DeletePostInput` | `ActionResult<{ removed: true }>` |
| `dismissAnnouncement` (own dashboard only; **no audit row** — personal read state, like marking a notification read) | `DismissAnnouncementInput` | `ActionResult<{ dismissed: true }>` |
| `setBroadcastPolicy` (ADMIN in their own company; audited with `BROADCAST_POLICY_CHANGED`) | `SetBroadcastPolicyInput` | `ActionResult<BroadcastSettingDTO>` |

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
- **Dismissing an announcement writes no `ActivityLog` row either** — hiding a notice from your own
  dashboard is personal read state, exactly like marking a notification read. Posting, replying,
  editing, removing and changing the broadcast setting all append one, inside the same transaction.
- **Favorites and personal to-do items write no `ActivityLog` row either**, for exactly the same
  reason: starring a project and jotting a private reminder are personal preferences, not project
  work. Same documented exception, same rule — everything else in `src/server/services` still
  appends its audit row inside the transaction.
- **Dismissing the "verify your email" banner writes nothing at all** — not an audit row, not a
  database row of any kind. It is a `sessionStorage` flag that is gone at the next full sign-in.
  Everything the emailed links themselves do — sending one, resetting a password, accepting an
  invitation, verifying an address — appends its audit row inside the transaction, as always.
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
  - **The same locked pass also warns about contractor access running out**
    (`sweepAccessExpiryNotifications()` in `src/server/services/notifications.ts`): an EXTERNAL whose
    `accessExpiresAt` falls inside the next seven days earns one `DEADLINE_APPROACHING` notification
    to **the administrators of that contractor's own company** and nobody else — the tenant rule, in
    the one place the sweep picks recipients. Kept quiet by the same `type` + `linkUrl` trick and no
    new column: the link carries both the person and the date
    (`/admin/users?expiring=<userId>&on=<yyyy-mm-dd>`), so the same date never warns twice and
    extending the date earns exactly one fresh warning about the new one. It writes **in-app
    notifications only** — no chat copy, because a lockout date is an administrator's housekeeping
    rather than one of the six chat events, and `DEADLINE_APPROACHING`'s chat toggle means "a task
    deadline is near".
  - **Nothing depends on the sweep having run.** Overdue is still derived at read time everywhere
    (`isOverdue()`), and an expired contractor is refused at sign-in whether or not anybody was
    warned; a skipped run costs a nudge, never correctness.
  - `SWEEP_DISABLED=1` stops the scheduler (the tests set it). `runSweepOnce()` itself ignores the
    flag so tests can call it directly.

## Comments and mentions (people and whole departments)

> You may mention a person who is on the project, or a whole department that is on the project.
> Anything else is refused in the same plain English, and a refusal never says whether the person or
> the department exists somewhere else.

- **A department mention is stored in the SAME column, with no migration.** `Comment.mentions` is a
  `String[]` of user ids; a department is kept in it as the token `"d:<disciplineId>"`
  (`DISCIPLINE_MENTION_PREFIX`, `disciplineMentionToken()` and `disciplineMentionTarget()` in
  `src/lib/zod-schemas.ts`). The schema is frozen after Milestone 1, and a second array column would
  have been an additive change nobody needs: one list of "who was mentioned" is the honest shape,
  and the read side already treats it as opaque strings. **The prefix cannot collide with a person's
  id** because every id in this app is a cuid — letters and digits only, never a colon.
- **The input names the two things separately.** `CreateCommentInput` carries `mentions` (people, as
  plain ids) and an optional `disciplineMentions` (departments, as plain discipline ids). Neither
  may contain a colon, which is what stops a browser posting a ready-made `"d:..."` token: the
  prefix is written by `createComment()` alone, after the department has been checked, so a forged
  token can never skip the check. `CommentDTO.mentions` returns the stored array as it is — a reader
  tells the two apart with `disciplineMentionTarget()` and resolves the name from the project's own
  disciplines, which every screen showing a thread already has.
- **The department check mirrors the people check.** `assertDisciplinesAreOnProject()` is the twin
  of `assertMentionsAreMembers()`: the department must have a `ProjectDiscipline` row on THAT
  project, and the project is already the actor's company's by the time the loader has run. A
  department from another company is filtered out by `orgId` and then simply not named in the
  refusal, so a miss never reveals that the id is real elsewhere.
- **Who a department mention reaches**: the project's members who work in that department, through
  `notifiableRecipients()` — the same narrowing a person mention goes through, so **a contractor is
  left out exactly as they are today, except on the discipline task assigned to them**. The actor is
  never told, and somebody who is both named by name and in the department gets **one** notification,
  the personal one. It is an ordinary `MENTIONED`, so it maps to the `mention` chat toggle and
  reaches Slack or Teams through `notify()` like any other mention.
- **The department notification never names the department**: "Layla al-Riyami mentioned your
  department on "Flare tip replacement"." One comment may mention several departments and this is
  one message to everybody it reached, so naming them would tell a contractor on their own task the
  names of departments the project screen deliberately hides from them — and a notification body is
  the one door read scoping cannot close. The comment itself says which department it was, to
  everybody who may read it.
- The audit row counts both, separately: `metadata: { commentId, mentions, disciplineMentions }`.

**Any change touching this area adds or extends a test in
`src/server/__tests__/comments.service.test.ts` in the same change** — and the tenant and contractor
halves in `org-isolation.service.test.ts` and `external-scoping.service.test.ts`, which both probe
department mentions.

## The noticeboard (announcements and the department board)

> A post has exactly ONE audience — the whole company, one project, or one discipline — and you see
> the audiences you belong to. An audience you do not belong to is **not found**, never "forbidden".

- **The audience is the pair of nullable ids on `Post`**: neither set is company-wide, `projectId`
  set is that project, `disciplineId` set is that department. Both set at once is refused in
  `can()` *and* in the service — there is no combined audience, so nobody has to guess which rule
  applies. `Post.kind` ("ANNOUNCEMENT" or "BOARD") is a plain string validated by `PostKindSchema`,
  the same choice `OrgIntegration.kind` made.
- **Who may START a post** is `POST_ANNOUNCEMENT` / `POST_BOARD` in `src/lib/permissions.ts`, and the
  two answer identically in this round: an ADMIN anywhere in their own company; a PROJECT_MANAGER on
  a project they belong to; a DISCIPLINE_LEAD in a discipline they hold a seat for (read from their
  memberships — the only place the app records who leads what). An ENGINEER posts nowhere and an
  EXTERNAL is refused before every other rule, as always.
- **The company-wide audience is additionally gated by `Organization.broadcastPolicy`**
  ("ADMIN_ONLY" / "ADMIN_PM" — the default — / "ADMIN_PM_LEAD"), and the policy is **passed into
  `can()` on the context** (`ctx.broadcastPolicy`) rather than looked up there, so the permission
  rules stay pure and touch no database. `broadcastPolicyOf()` reads an unrecognised stored value as
  the default instead of breaking, the same defensiveness `dailyBrief` carries.
- **Reading is not gated by role at all** — it is gated by audience. Everybody in the company reads
  the company-wide board; `listAudiences()` gives each person the projects they are a member of and
  the discipline(s) they work in (an ADMIN gets every project and discipline **of their own
  company**, which is the tenant rule, not an exception to it).
- **Replying is not `POST_BOARD`.** Anybody who may read a board may reply on it — that is what makes
  it a board rather than a broadcast — and a reply is **one level deep, always**: its parent must be
  a root BOARD post, checked in the service rather than trusted from the browser.
- **Nothing is hard-deleted.** A removed post keeps its place as a "Post removed" tombstone so the
  replies under it still read, exactly like a comment. Moderation follows the audience: a project
  manager removes anything on their project's board, a lead on their department's, an administrator
  anywhere — and **the company-wide board is moderated by administrators only**, even by a manager
  who may post to it.
- **An announcement notifies its audience; a board post notifies nobody.** The fan-out excludes
  contractors (`role: { not: "EXTERNAL" }`, the same filter `projectAudience()` carries) and goes
  through `notify()`, so it cannot leave the company. **A direct reply notifies the post's author
  only**, borrowing `COMMENT_ADDED` — which maps to no chat toggle and therefore stays in the app,
  where a reply belongs. Only `ANNOUNCEMENT` reaches chat, through its own `announcements` toggle,
  **off by default**.
- **A contractor has no noticeboard at all.** Every read and every write answers "not found", the
  sidebar has no Messages row, `/messages` is a 404 for them, and their daily brief simply carries an
  empty announcements section.
- **"Running" is derived, never stored**: not removed, and either no expiry or an expiry still ahead.
  A dismissal hides an announcement from that one person's **dashboard strip** only — the Messages
  page still shows what is running, and nobody can see what anybody else has hidden.

**Any change touching this area adds or extends a test in
`src/server/__tests__/posts.service.test.ts` in the same change** — and the tenant and contractor
halves in `org-isolation.service.test.ts` and `external-scoping.service.test.ts`, which both probe
the noticeboard.

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
- **Only enabled + toggled events are delivered.** Each `NotificationType` maps to one of the six
  toggles (`taskAssigned`, `mention`, `statusChange`, `overdueReminder`, `gateOverride`,
  `announcements`); `DOCUMENT_UPLOADED` and `COMMENT_ADDED` map to nothing and stay in the app —
  which is also what keeps a noticeboard REPLY in the app, since a reply is a `COMMENT_ADDED`.
  `announcements` carries a zod `.default(false)` for the same reason `dailyBrief` does: a toggle
  map saved before announcements existed keeps parsing, and reads as "off" rather than silently
  switching a company's whole chat delivery off.
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

## Transactional email (invitations, password resets, verification)

> An emailed link is a **hashed, single-use, expiring** thing. The raw token leaves the server once,
> inside the email; the database only ever holds its SHA-256 hash, and the same link never works
> twice.

- **Dormant until keyed, like every other integration.** `emailConfigured()` in
  `src/server/services/email.ts` is true only when `RESEND_API_KEY` **and** `EMAIL_FROM` are both
  set; `emailAvailable()` additionally requires `APP_BASE_URL`, and that is the one every screen and
  `/api/health` should ask. Keys with no base address logs **one** line and behaves as dormant —
  every one of these emails is nothing but a link, so a link with nowhere to point is "not set up",
  not a broken email. Dormant means every send is a silent no-op returning `{ status: "dormant" }`
  and **nothing else in the app behaves differently**: tokens are still issued and consumed, so the
  flows on top can be built and tested before anybody buys a mail provider.
- **The audit row is written BEFORE the send, inside the calling service's transaction.** The
  `ActivityLog` row is the record of intent; the email is the copy. `appendEmailActivity()` writes
  `entityType: "Email"`, `action: EMAIL_SENT`, `entityId` = the recipient's user id and
  `metadata: { kind, userId }` — never the token, never the link, never the address (the address is
  already on the account, which is where it belongs). Writing it first means a mail provider that is
  down or rate limiting can never leave a reset with no trace of having been asked for, and it keeps
  house rule 1 whole. The send itself then happens **after the transaction commits and is never
  awaited** — `void sendPasswordResetEmail(...)` — exactly as `deliverToOrgWebhooks()` is called.
- **Delivery is best-effort and per-process**: one attempt, one retry when Resend answers 429
  respecting `Retry-After` (capped at ten seconds), then the message is dropped with a logged line.
  A failure line carries the purpose, the recipient's user id and what went wrong — never the API
  key, the from address, the recipient's address, the link or the token. Nothing here ever throws.
  There is no queue table and no SDK: a plain `fetch` to `https://api.resend.com/emails` with a
  plain-text body, which is the whole of the copy (there is no HTML template library and there must
  not be one).
- **Three purposes, three lifetimes** (`EMAIL_TOKEN_TTL_MS` in
  `src/server/services/email-tokens.ts`): `RESET` 1 hour, `VERIFY` 24 hours, `INVITE` 7 days.
  `issueEmailToken()` returns the raw token **once** and marks every earlier live token of the same
  purpose used, so the newest link in somebody's inbox is always the only one that works.
  `consumeEmailToken()` is a single conditional update on (hash + purpose + unused + unexpired), so
  two browsers racing the same link can only ever have one winner. `previewEmailToken()` is the
  read-only twin the pages render from — looking at a link never spends it.
- **A miss never says why.** Wrong, tampered with, expired, already used, wrong purpose, or
  belonging to a deactivated account all answer the same `null`, and the screens say "this link no
  longer works" and nothing more — the same discretion the external rule's "not found" carries.
- **Verification is a nudge, never a lock.** `User.emailVerifiedAt` null means "not verified" and
  restricts nothing anywhere in the app; no route, permission or read consults it.

### The four flows on top (`src/server/services/account.ts`)

- **A NO LINK EVER MINTS A SESSION.** `/api/auth/reset-password` and `/api/auth/set-password` both
  answer `PasswordChangedDTO` and set no cookie: the person signs in next, deliberately, on the
  page they are sent to. That is what keeps an **EXTERNAL contractor whose access has expired**
  out — they may reset a password like anybody else, and `getSessionUser()` and the sign-in route
  still turn them away on the strength of `accessExpiresAt`, exactly as they turn away a
  deactivated account. A link that signed somebody in would be a way past every one of those rules.
- **`/forgot-password` never says whether an address has an account** — and that means the WAIT as
  well as the bytes. Same body, same status, same bytes for a live account, a missing one, a
  deactivated one and an expired contractor; and the route **does not await the work**
  (`void requestPasswordReset(...).catch(...)`, the same road `deliverToOrgWebhooks()` takes), so a
  real account's whole transaction — retire the old links, write the new one, append the audit row
  — cannot make the answer arrive later than a missing address's single lookup. An identical body
  with a measurably different response time is still an account oracle. Two ceilings, both three an
  hour: the IP, and the address asked about, so rotating the forwarded IP buys nothing.
- **A failure line here carries a category and nothing else** —
  `{ reason: error instanceof Error ? error.name : "unknown" }`, never the raw error. A Prisma
  failure on a lookup keyed by email renders the address into its own message, which is exactly
  what this route exists not to say.
- **The request itself writes no `ActivityLog` row of its own** — it is unauthenticated, and there
  is no actor to name. What IS written, inside the same transaction as the token, is the ordinary
  `EMAIL_SENT` row through `appendEmailActivity()`, with **the recipient as the actor**: they asked
  for their own link, there is nobody else it could be, and `ActivityLog.actorId` is a real
  relation rather than a nullable system column.
- **A reset ends every session that account holds**, in the same transaction as the new password
  hash, the spent token and the `PASSWORD_RESET` audit row — the screen promises it, so the
  database keeps it. `INVITE_ACCEPTED` and `EMAIL_VERIFIED` are the other two new audit actions;
  none of the three ever carries a password, a token or a link.
- **An invitation creates an account nobody has a password for.** `createUser` with
  `mode: "INVITE"` writes an argon2 hash of 32 random bytes that are then thrown away
  (`unusablePasswordHash()`), so there is no first password to leak, to write down or to pass along
  a corridor. Accepting the invitation **marks the address verified** — the link only ever existed
  in that inbox, which is the whole of what verification asks.
- **Self-serve signup issues a VERIFY link inside its own transaction** and sends it after the
  commit, when email is available. Signing up is never blocked, slowed or failed by it in either
  direction: dormant means no token and no send, and a broken mail provider still leaves the
  company created and its administrator signed in.
- **The verification banner shows for any unverified account whenever email is configured** — an
  admin-created account with a temporary password included. That is deliberate rather than
  overlooked: a rule narrow enough to spare them (only the company's original self-serve
  administrator, say) is a rule nobody can predict from the screen, and the banner is a soft,
  dismissible line with a one-press resend. Dismissing it writes **nothing to the database** — a
  `sessionStorage` flag, gone at the next full sign-in. This is the fourth documented exception to
  house rule 1, and the smallest: hiding a nudge is not company work.
- **Every screen in this round reads one boolean, `emailAvailable()`, on the server.** The
  forgot-password page renders the dormant sentence instead of a form; the create-user dialog's
  invite toggle is simply absent and the dialog looks exactly as it always has; the banner is not
  mounted. No screen ever names a setting, a key or a provider — the same discretion
  `AdminMicrosoftCard` and the chat cards use.
- The public pages are `/forgot-password`, `/reset-password?token=`, `/set-password?token=` and
  `/verify-email?token=`, all server components on the `AuthSplit` shell. The first three render
  from `previewEmailToken()`, so **looking at a link never spends it**; `/verify-email` is the one
  that consumes on sight, because seeing it IS the confirmation, and it is `byIp` limited like any
  other anonymous entry point.
- **A mail scanner must not be able to burn a verification link.** Outlook Safe Links and Gmail's
  fetcher open every link in a message before the person does, and `/verify-email` spends its token
  on sight — so `verifyEmailWithToken()` answers a spent link by looking it up once: if it really
  was a VERIFY link, it really has been used, and that account really is verified now, the visitor
  is shown the success they earned. Nothing is revealed by saying so (they are holding the token,
  which is the only thing that could ever have proved it) and nothing changes — the moment of
  verification and its single `EMAIL_VERIFIED` row stay as they were. Every other miss still
  answers the same plain nothing. **The two password pages need none of this**: they preview on
  GET and consume only on submit, so a scanner following them changes nothing at all.

**Any change touching this area adds or extends a test in
`src/server/__tests__/email.service.test.ts` (the delivery half) or
`src/server/__tests__/email-flows.service.test.ts` (the flows on top) in the same change — and the
tests never touch the network: `global.fetch` is mocked.**

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
