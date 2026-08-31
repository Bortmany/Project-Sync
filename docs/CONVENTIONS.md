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
  every announcement and board read or write in `posts.ts` refuses them not-found-style. **The one
  door is opt-in, one notice at a time**: an announcement whose author ticked `includeExternals`
  appears on their own daily brief as a read-only "Notices" line — title, body, who posted it, when
  — and nothing else about the noticeboard opens up. No board, no reply, no dismissal, no
  Acknowledge button, and they are never counted in anybody's acknowledgement total. See "Contractor
  notices" under the noticeboard below.
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
  Documents are soft-deleted (`deletedAt`); their versions and audit rows stay. **One exception, and
  it is the workspace ending rather than the rule bending**: when a company's seven-day deletion
  grace period runs out, `src/server/services/workspace-deletion.ts` removes that company's rows
  along with everything else it owns. `mutation-safety.test.ts` allows that one file to DELETE them
  and still forbids UPDATE everywhere, including there — nothing in this app ever rewrites a
  revision or an audit row.
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
    - **Payments are per deployment and nothing else**: `PADDLE_API_KEY`, `PADDLE_WEBHOOK_SECRET`
      and `PADDLE_PRICE_ID_PRO` (the first two are real secrets), plus `APP_BASE_URL`, which
      checkout needs the way email needs it, and the optional `PADDLE_ENV`. With any of the four
      unset there are **no buttons at all** on Admin → Billing, both billing actions refuse in plain
      English, `/api/billing/webhook` answers "not set up", and `/api/health` reports
      `"billing": "dormant"`. Plans and limits carry on working exactly as they do today. See
      "Billing provider" below.
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

  - `20260831164409_posts_ack_attachments_externals` (the noticeboard's second round — **one
    migration for the whole phase**, the same way `external_access_and_posts` carried two builds at
    once). **Additive only**: nothing is dropped, renamed or made stricter, every new column has a
    default that means exactly what an existing post already was, and the new table starts empty, so
    it is safe on a populated database and no existing announcement changes in any way. Three
    nullable-or-defaulted columns on `Post` — `requiresAck` (default false: this announcement asks
    its audience to confirm they have read it), `includeExternals` (default false: this announcement
    also reaches contractors) and `documentId` (a board post pointing at one document that already
    exists, `onDelete: Restrict`). **Restrict, and it never bites**: documents in this app are
    soft-deleted (`deletedAt`) and never hard-deleted, so the row a post points at is always still
    there, and the chip is resolved through the reader's own visibility rather than the foreign key.
    One new model, `PostAck` — `postId` (Cascade), `userId` (Cascade), `createdAt`,
    `@@unique([postId, userId])` and `@@index([userId])`: **the exact shape `PostDismissal` has**,
    deliberately, because it is the same kind of row about the opposite kind of act (see "The
    noticeboard" below for why one is audited and the other is not). The generated migration's five
    trigram `DropIndex` lines were deleted by hand, and `pg_indexes` was checked on both databases
    afterwards.)

  - `20260831191909_workspace_deletion_grace` (workspace deletion, with its seven-day grace period.
    TWO nullable columns on `Organization` — `deleteRequestedAt` (when an administrator asked for
    the whole workspace to be deleted) and `deleteRequestedById`, a relation to `User` with
    `onDelete: SetNull`, **the same shape `OrgIntegration.createdById` uses**, so the request
    outlives the account that made it. Additive only: no existing model, field, enum value or index
    was changed, and null on both — which is what every existing workspace means — reads as "nobody
    has asked", so nothing changes for anybody when it is applied. **The deadline itself is never a
    column**: it is `deleteRequestedAt` plus the grace period, derived at read time exactly as
    OVERDUE and a locked phase are, so changing the grace period is a constant and never a
    migration. The generated migration's five trigram `DropIndex` lines were deleted by hand, and
    `pg_indexes` was checked on both databases afterwards — five rows each.)

  - `20260831204831_organization_plan_billing` (plans, limits and the payment provider's landing
    place — **ONE migration for the whole phase**, the same way `external_access_and_posts` and
    `posts_ack_attachments_externals` each carried two builds at once, so the provider half needs no
    second migration. **Additive only**: nothing is dropped, renamed or made stricter, every new
    column has a default or is nullable, and the new table starts empty, so it is safe on a
    populated database and no existing company changes in any way. THREE columns on `Organization`
    — `plan` (default `"FREE"`, which is what every existing company means; **a plain string
    validated by zod**, not a Prisma enum, the same choice `broadcastPolicy`, `OrgIntegration.kind`
    and `Post.kind` made, so a third plan needs no migration, and `planOf()` in
    `src/lib/plan-limits.ts` reads an unrecognised value as FREE — the safe direction, the same
    defensiveness `broadcastPolicyOf()` carries) and the nullable `billingCustomerId` /
    `billingSubscriptionId`, which are the company's identifiers at the payment provider and
    **never a key, a token or anything about a card** — no payment credential is stored anywhere in
    this app. One new model, `BillingEvent` — one webhook the provider has sent us: `provider`,
    `eventId`, `eventType`, a nullable `orgId` (`onDelete: SetNull`, **the same shape
    `OrgIntegration.createdById` and `Organization.deleteRequestedById` use**, so the delivery
    history outlives the company it was about), `processedAt`, and `@@unique([provider, eventId])`,
    which **is** the replay rule: a provider retries a webhook until it is acknowledged, so an
    event already recorded is recognised and ignored rather than upgrading or downgrading a company
    twice. **No limit and no usage figure is stored anywhere**: the three limits live in one file
    and every count is worked out at read time, exactly as OVERDUE and a locked phase are. The
    generated migration's five trigram `DropIndex` lines were deleted by hand, and `pg_indexes` was
    checked on both databases afterwards — five rows each.)

  - `20260831214639_billing_event_occurred_at` (putting out-of-order webhooks back in order. ONE
    nullable column, `BillingEvent.occurredAt` — **the provider's own `occurred_at`, which is not
    the same fact as `processedAt`**: one is when it happened, the other is when it reached us, and
    only the first can be compared with another event's without misfiring on two changes made
    seconds apart (see "Billing provider" below). Plus `@@index([orgId, occurredAt])`, which is the
    lookup every webhook now makes. Additive only: no existing model, field, enum value or index
    was changed, and null — which is what every row written before it means, and what an event
    whose payload carries no timestamp means — reads as "we cannot tell", which reorders nothing.
    The generated migration's five trigram `DropIndex` lines were deleted by hand, and `pg_indexes`
    was checked on both databases afterwards — five rows each.)

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
| `/api/uploads` | POST | multipart: `file`, `projectId`, `mainTaskId?` \| `disciplineTaskId?`, `documentId?`, `requiredDocumentId?`, `title?`, `category?`, `note?` (validated by `UploadMeta`) | `DocumentVersionDTO` — refused with the plan's plain-English storage message when the company's stored bytes plus this file would go past its cap. The Microsoft attach route is refused the same way, in the same place |
| `/api/documents/versions/[versionId]/download` | GET | — | file stream |
| `/api/auth/signup` | POST | `SignupInput` | `SignupResultDTO` + session cookie (public; `byIp` limited to 5 an hour) |
| `/api/auth/login` | POST | `LoginInput` | session cookie |
| `/api/auth/forgot-password` | POST | `ForgotPasswordInput` | `{ sent: true }` — **the same body, status and bytes whatever the address was**: with an account, without one, deactivated, or a contractor whose access has run out. Public; `byIp` limited to 3 an hour **and** 3 an hour per address asked about. Answers the dormant sentence (503) while email is not set up, and sends nothing |
| `/api/auth/reset-password` | POST | `ResetPasswordInput` | `PasswordChangedDTO` — **no session, no cookie** (public; `byIp` limited to 10 an hour) |
| `/api/auth/set-password` | POST | `SetPasswordInput` | `PasswordChangedDTO` — accepting an invitation; also marks the address verified. **No session, no cookie** (public; `byIp` limited to 10 an hour) |
| `/api/auth/logout` | POST | — | `{ signedOut: true }` |
| `/api/auth/me` | GET | — | signed-in user |
| `/api/health` | GET | — | health JSON (adds `integrations` — how many companies have each chat kind switched on, numbers only: `{"slack": 0, "teams": 0}` when nobody has — `microsoft`: `{"status": "dormant"\|"configured", "connectedOrgs": n}`, and `email`: `"dormant"` or `"configured"`, a word and nothing else. `"configured"` means all three of `RESEND_API_KEY`, `EMAIL_FROM` and `APP_BASE_URL` are set, because an email with no link is no use — and `billing`: `"dormant"` or `"configured"`, a word about this deployment's own set-up and nothing about anybody's money, plan or balance) |
| `/api/billing/webhook` | POST | the provider's raw JSON body, with a `Paddle-Signature` header | `{ received: true }` — **public, and nobody signs in for it**: the signature IS the authentication, checked over the raw body before anything is parsed and before any database read. 200 for anything handled, recorded or already seen (an unknown company included — never a 404); 400 for a signature that is missing, wrong or stale; 503 while the provider is not set up; 500 on anything unexpected, so the provider retries. `byIp` limited generously (600 a minute) because webhooks arrive in bursts |
| `/api/integrations/microsoft/connect` | GET | — | 302 to Microsoft's sign-in (ADMIN; signed `state` binds the attempt to this person and company) |
| `/api/integrations/microsoft/callback` | GET | query: `code`, `state` (or `error`) | 302 back to `/admin/integrations?microsoft=connected\|denied\|failed\|setup` |
| `/api/integrations/microsoft/status` | GET | — | `MicrosoftConnectionDTO` (404 "not set up" while dormant, which is how the upload tab stays hidden) |
| `/api/integrations/microsoft/drives` | GET | query: the upload target (`projectId` + one of `mainTaskId`/`disciplineTaskId`/`documentId`) | `MicrosoftDriveDTO[]` |
| `/api/integrations/microsoft/items` | GET | query: upload target + `driveId`, `itemId?` | `MicrosoftListingDTO` |
| `/api/integrations/microsoft/search` | GET | query: upload target + `driveId`, `q` | `MicrosoftListingDTO` |
| `/api/integrations/microsoft/attach` | POST | `AttachMicrosoftFileInput` (the upload meta plus `driveId`, `itemId`) | `DocumentVersionDTO` — a normal revision |
| `/api/my-tasks` | GET | — | `MyTasksDTO` (everything assigned to the signed-in person: up to 200 open tasks by deadline **plus** the 50 most recently completed, read in two windows so history never crowds out live work, with `truncated`; `totals` counted in the database over all of it) |
| `/api/my-tasks/brief` | GET | — | `BriefDTO` ("Your day" — due today, overdue with days over, newly unblocked in the last 24 hours, mentions in the last 24 hours, awaiting your review, the announcements running for you, and **waiting for your acknowledgement** (the running announcements that asked this person to confirm and that they have not — always empty for a contractor); every section capped at 10 with its true `total` beside it. **For a contractor the announcements section is their "Notices"**: the running announcements somebody explicitly included them in, each line carrying the notice itself in `body` and an empty `linkUrl`, because there is no page they may open) |
| `/api/my-tasks/gantt` | GET | — | `GanttDTO` (only the signed-in person's discipline tasks, grouped under their main tasks; bounded — open work plus work whose deadline fell inside the last 90 days, 300 bars max) |
| `/api/favorites` | GET | — | `FavoriteDTO[]` (the signed-in person's own shortcuts, newest first, 50 max; deleted targets and anything in a project they may no longer see are skipped) |
| `/api/personal-tasks` | GET | — | `PersonalTaskDTO[]` (the signed-in person's own list, open items first, then by `sortOrder` so newly added lines lead, 200 max) |
| `/api/posts/announcements` | GET | — | `PostDTO[]` (the announcements still running for this person's audiences — company-wide, their projects, their department(s) — newest first, 50 max, each flagged `dismissed`, plus `requiresAck`, this person's own `acked` / `ackedAt`, and `ackProgress` — the "N of M" and the outstanding names, **sent only to the post's author and to an administrator**, `null` for everybody else. Not found for a contractor) |
| `/api/posts/audiences` | GET | — | `PostAudienceDTO[]` (the noticeboard tabs this person may read, each with `canPost` / `canModerate`. An ADMIN gets every project and discipline of their OWN company) |
| `/api/admin/export/status` | GET | — | `WorkspaceExportStatusDTO` (ADMIN only; where this company's export has got to, derived at read time from the audit trail and the file on disk. Carries the raw download token when one is ready, which is why it is only ever answered to an administrator of that company) |
| `/api/admin/export/download` | GET | query: `token` | the ZIP stream (`Content-Disposition: attachment`, `Cache-Control: private, no-store`). **Two keys, not one**: the token AND a signed-in ADMIN of the company whose data it is. Consumes nothing — the same link works until it expires |
| `/api/account/export` | GET | — | one person's own data as a JSON file (`PersonalExportDTO`, streamed as an attachment). Any signed-in person, contractors included; three a day per person, refused with 429 and a `Retry-After` |
| `/api/posts/board` | GET | query: `tab` (`everyone` \| `project:<id>` \| `discipline:<id>`, default `everyone`) | `BoardPostDTO[]` (roots newest first, 50 max, each with its replies oldest first, 100 max; removed posts stay as tombstones. Each root carries `attachment` — the one document it points at, resolved through **this** reader's own visibility and `null` when there is none or when they may not see it. An audience this person does not belong to is **not found**) |

Server actions live in `src/server/actions`. Each takes its `*Input` type and returns
`ActionResult<*DTO>`:

| Action | Input | Output |
|---|---|---|
| `createProject` (refused in plain English once the company's plan has no room for another live project — see "Plans and limits") | `CreateProjectInput` | `ActionResult<ProjectDTO>` |
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
| `createUser` (always into the actor's own organisation; `CreateUserInput` and `UpdateUserInput` both now carry an optional, nullable `accessExpiresAt`, which zod refuses on any role but EXTERNAL and the service clears for one. `CreateUserInput` also carries an optional `mode` — `"PASSWORD"` (left out means this, and it is the only path while email is dormant) or `"INVITE"`, which creates the account with an unusable random password hash, mints an INVITE link in the same transaction and emails it after the commit. Zod refuses a password sent with `"INVITE"` and refuses `"PASSWORD"` with none. **Both paths are refused once the plan's people limit is reached** — an invitation and a first password both end in one more account that can sign in; deactivated accounts are not counted) | `CreateUserInput` | `ActionResult<UserDTO>` |
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
| `createPost` (`POST_ANNOUNCEMENT` / `POST_BOARD` by kind; exactly one audience; an announcement may carry an expiry and notifies its audience. `CreatePostInput` also carries three optional flags, each meaning "no" when left out: `requiresAck` — announcements only, and only from an ADMIN or PROJECT_MANAGER; `includeExternals` — announcements only, company-wide or one project, never a department and never a board; and `documentId` — BOARD root posts on a PROJECT board only, checked through the documents service's own loader so a miss is not-found) | `CreatePostInput` | `ActionResult<PostDTO>` |
| `replyToPost` (BOARD only, one level deep — a reply's parent is always a root post; anybody who may READ that board may reply) | `ReplyToPostInput` | `ActionResult<PostDTO>` |
| `editPost` (author, or an ADMIN correcting one) | `EditPostInput` | `ActionResult<PostDTO>` |
| `deletePost` (author, or whoever moderates that board; soft delete — the feed keeps a tombstone) | `DeletePostInput` | `ActionResult<{ removed: true }>` |
| `dismissAnnouncement` (own dashboard only; **no audit row** — personal read state, like marking a notification read. Refused, in plain English, while an announcement that requires acknowledgement has not been acknowledged by that person) | `DismissAnnouncementInput` | `ActionResult<{ dismissed: true }>` |
| `acknowledgePost` (any INTERNAL member of the announcement's audience who may read it; one row per person per post, pressing it twice is the same acknowledgement; **writes one `POST_ACKNOWLEDGED` audit row** — the deliberate opposite of a dismissal. Not found for a contractor, for a non-member, and for an announcement that never asked) | `AcknowledgePostInput` | `ActionResult<PostDTO>` |
| `setBroadcastPolicy` (ADMIN in their own company; audited with `BROADCAST_POLICY_CHANGED`) | `SetBroadcastPolicyInput` | `ActionResult<BroadcastSettingDTO>` |
| `startWorkspaceExport` (ADMIN, `EXPORT_ORG`; five presses a minute per person **and** one export per company per 24 hours, the second enforced in the service against the last `EXPORT_STARTED` audit row. Writes `EXPORT_STARTED`, then fires the build off and returns immediately) | — | `ActionResult<WorkspaceExportStatusDTO>` |
| `deleteMyAccount` (any signed-in person, contractors included; **no id and no `assertCan`** — the only account it can reach is the session's. Typed confirmation `"DELETE"`. Anonymises in one transaction, ends every session, writes one name-free `ACCOUNT_DELETED` row. Refused for an ADMIN who is their company's last active one. Three presses a minute) | `DeleteMyAccountInput` | `ActionResult<AccountDeletedDTO>` |
| `requestWorkspaceDeletion` (ADMIN, `DELETE_ORG`; the workspace's own name typed exactly. Sets `deleteRequestedAt` / `deleteRequestedById`, writes `WORKSPACE_DELETION_REQUESTED` and notifies every other administrator in-app) | `RequestWorkspaceDeletionInput` | `ActionResult<WorkspaceDeletionDTO>` |
| `billingStatus` (a READ rather than an action, called by `/admin/billing` the way `workspaceExportStatus` is: ADMIN of their own company, `MANAGE_BILLING`. Plan, usage and limits — every number counted at read time — plus `provider`: whether the four environment variables are set, whether we hold a subscription id, and whether the last payment signal we were sent was a failure. No price, no card, no invoice, no renewal date: none of that is stored here) | — | `BillingStatusDTO` |
| `startUpgrade` (ADMIN, `MANAGE_BILLING`; no input at all. Asks the provider for a checkout, audits `BILLING_CHECKOUT_STARTED` **without the address**, and returns the address for the browser to navigate to. Refused in plain English while the provider is dormant, when the company is already on Pro, and when the provider hands back an address it does not host itself. Ten presses a minute per person) | — | `ActionResult<BillingRedirectDTO>` |
| `openBillingPortal` (ADMIN, `MANAGE_BILLING`; no input. Mints a FRESH single-use portal address every press — never cached, never stored — audits `BILLING_PORTAL_OPENED` without it, and returns it. Refused plainly while dormant and while no subscription is on file. Ten presses a minute per person) | — | `ActionResult<BillingRedirectDTO>` |
| `cancelWorkspaceDeletion` (ANY ADMIN of that company during the grace period; no typed confirmation — undoing a dangerous thing should be the easiest press on the screen. Clears both columns, writes `WORKSPACE_DELETION_CANCELLED`, notifies the administrators) | — | `ActionResult<WorkspaceDeletionDTO>` |

## Notifications and the deadline sweep

- **`notify()` (`src/server/services/notify.ts`) is the only way a Notification row is written by a
  person's action.** Every service already calls it *after* its transaction has committed, so a
  problem saving notifications can never undo the change that caused them — failures are logged and
  swallowed. It skips the actor, skips duplicates inside one call, and skips deactivated people.
  - **It takes exactly one option, `{ chatCopy: false }`**, which writes the in-app rows and posts
    nothing to Slack or Teams. Two callers use it: the contractors' half of an announcement that
    included them, which is the same news with a different link (see "Contractor notices") — the
    chat channel is the company's own and has already had that announcement once — and the two
    workspace-deletion messages to a company's administrators, which borrow `ANNOUNCEMENT` for
    their shape but are not noticeboard news, so the `announcements` chat toggle must not carry
    them.
- **Marking a notification read writes no `ActivityLog` row.** Read state is a personal preference,
  not project work; the audit trail records project work only. This is the one documented exception
  to house rule 1.
- **A daily brief writes nothing at all.** Both briefs are reads: no notification, no audit row, no
  stored snapshot. See "Chat delivery" below for the digest's own deviation.
- **Dismissing an announcement writes no `ActivityLog` row either** — hiding a notice from your own
  dashboard is personal read state, exactly like marking a notification read. Posting, replying,
  editing, removing and changing the broadcast setting all append one, inside the same transaction.
  **Acknowledging one DOES append a row** (`POST_ACKNOWLEDGED`), and the contrast is the point:
  a dismissal is your own view of a notice, an acknowledgement is an attestation the person who
  posted it relies on. Same table shape (`PostDismissal` / `PostAck`), opposite kind of act.
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
  - **The same locked pass also carries out workspace deletions whose seven days have run out**
    (`sweepWorkspaceDeletions()` in `src/server/services/workspace-deletion.ts`). It is the one
    thing on this list that is irreversible, which is exactly why it sits inside the advisory lock:
    two copies of the app must never both be deleting the same company. The rows go inside the
    transaction; the FILES are removed by `removeDeletedWorkspaceFiles()` after it commits, the same
    road the chat copies take. A late sweep deletes late, never never.
  - **Nothing else depends on the sweep having run.** Overdue is still derived at read time everywhere
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
- **A contractor has no noticeboard.** Every read and every write answers "not found", the sidebar
  has no Messages row, and `/messages` is a 404 for them. Their daily brief is no longer always
  empty, though: it carries the announcements an author **explicitly included them in** and nothing
  else — see "Contractor notices" below. That is one read, added deliberately and opt-in; every
  other door stays exactly as shut as it was.
- **"Running" is derived, never stored**: not removed, and either no expiry or an expiry still ahead.
  A dismissal hides an announcement from that one person's **dashboard strip** only — the Messages
  page still shows what is running, and nobody can see what anybody else has hidden.

### Acknowledgements ("please confirm you have read this")

> An announcement can ask its audience to confirm they have read it. **Asking is an ADMIN's or a
> PROJECT_MANAGER's call; confirming is for anybody internal who may read it.** A dismissal is
> private read state and writes nothing; an acknowledgement is an attestation and IS audited.

- **Who may ASK.** `CreatePostInput.requiresAck` is valid on an `ANNOUNCEMENT` only, and only when
  the author's own role is ADMIN or PROJECT_MANAGER — a DISCIPLINE_LEAD whom the company's
  `broadcastPolicy` allows to announce may still only tell people, never demand a signature.
  **Enforced in the service, not in `can()`**, deliberately: `can()` answers "may you post to this
  audience", which is a question about the audience, and there is no honest way to fold "and may you
  also require a signature" into that shape. It is the same reasoning that keeps replying out of
  `POST_BOARD`. The composer's checkbox is simply **absent** for anybody else — never greyed out.
- **Who may CONFIRM.** Any INTERNAL member of the post's audience who may read it, exactly as
  replying on a board works. A miss — somebody else's project or department, another company's post,
  an announcement that never asked for one, or a removed one — is **not found**. An EXTERNAL
  contractor is refused here with everything else on the noticeboard: they have no announcements
  surface, no Acknowledge button, and they are never counted in anybody's total.
- **The audit row is deliberately UNPROJECTED and name-free.** `acknowledgePost` writes its
  `POST_ACKNOWLEDGED` row with `projectId: null` and the summary "An announcement was acknowledged".
  That is not an oversight, it is the promise above being kept: both project activity feeds read
  `ActivityLog` **by `projectId`** (`listActivity` in comments.ts and `recentActivityForProjects` on
  the dashboard) and both render `summary` and `actorName`, so a projected row naming the person
  would show "so-and-so acknowledged an announcement" to every member of the project — exactly the
  thing `ackProgress`, this section and the privacy page all say only the author and an
  administrator see. Nothing is lost from the trail: `actorId` holds who, `entityId` holds which
  announcement, `createdAt` holds when. It is the same nullable `projectId` that lets the
  organisation-level `ORG_CREATED` row exist.
- **One row, ever, and one audit row with it.** `PostAck` is unique on `[postId, userId]`; pressing
  the button twice, or in two tabs at once, is the same acknowledgement. `acknowledgePost` appends
  exactly one `POST_ACKNOWLEDGED` `ActivityLog` row inside the same transaction as the row itself.
  **This is the deliberate contrast with the dismissal exception above**: hiding a notice from your
  own dashboard is personal read state and writes nothing, while confirming you have read it is
  something the person who posted it relies on and may be asked to show. Same table shape, opposite
  kind of act.
- **Acknowledging is not dismissing, and cannot be confused with it.** An announcement that requires
  acknowledgement **cannot be dismissed until it has been acknowledged** — the service refuses it in
  plain English, and the card does not draw the ✕ at all until then, so nothing is ever offered that
  would be refused. Afterwards, dismissing behaves exactly as it does for any other announcement.
  Dismissing can therefore never make a requirement quietly disappear, and the daily brief's
  "Waiting for your acknowledgement" section names it either way.
- **"N of M", and who sees it.** `M` is the **INTERNAL audience of the post at read time** and comes
  from the same derivation the fan-out uses (`audienceMembers()`, which `announcementRecipients()`
  is now a thin wrapper around, so who was told and who is counted can never drift): company-wide is
  the active internal people of that company, a project is its internal members, a department is the
  active internal people who work in it. **Contractors are never in M**, even on an announcement
  that included them, and neither is a deactivated account — `notify()` skips both, and counting
  somebody who can never confirm would make a total nobody could ever finish. `ackProgress` is sent
  **only to the post's author and to an administrator of that company** and is `null` for everybody
  else, the same server-computed shape `canEdit` and `canDelete` take: a colleague sees their own
  state and never anybody else's. The outstanding names are capped at 20 (`OUTSTANDING_ACK_LIMIT`)
  with the true total beside them, the same capping convention every brief section follows.
- **Nothing about it is stored twice.** "Has this person acknowledged", "how many have" and "who has
  not" are all counted from `PostAck` at read time — there is no counter column and there must not
  be one, exactly as `OVERDUE` and a locked phase are derived. The daily brief's new section is the
  same data filtered to this person, computed and never stored.

### Board attachments ("point at a document instead of describing it")

> A board post can point at **one** document that already exists. It is a pointer, never a copy —
> and whether the chip appears at all is decided **when the card is read**, by the reader's own
> visibility, not when it was attached.

- **Where it is offered: a PROJECT board, on the post that starts a conversation, and nowhere else.**
  `CreatePostInput.documentId` is valid only for `kind: "BOARD"`, only with a project audience, and
  never on a reply (`ReplyToPostInput` carries no such field at all, so there is nothing to smuggle
  in). An announcement is told rather than browsed, so it carries none either.
- **Company-wide and department boards deliberately offer NO attachment this round.** The UI spec
  drew a search picker for them; picking a document with no project to scope from means searching
  across every project a person can see, which is a **new tenant-sensitive read surface** — a
  "documents I can see anywhere" route that does not exist today and that the roadmap does not need.
  It was left unbuilt rather than half-built, and the composer simply does not offer the affordance
  there, the same way nothing else in this app is ever offered greyed out.
- **The write is checked through the documents service's own loader**, not a second query:
  `documentForBoardPost()` in `documents.ts` runs `loadDocument` (live, and in the actor's company),
  proves the document is on **that** project, then `assertCanViewProject()` and
  `assertExternalMaySeeDocument()`. Another company's id, another project's id, a removed document
  and one on a project the author is not a member of all answer the same `NotFoundError` — so
  attaching can never reach further than opening already does, and no miss ever confirms an id.
- **The read is per-reader and all-or-nothing.** `visibleDocumentChips()` resolves a batch of ids
  against the reader's own visible projects (and, for a contractor, their own tasks). A document that
  has been soft-deleted since, or that sits on a project this reader is not on, simply has **no
  entry**, and `BoardPostDTO.attachment` is `null`: no placeholder, no "restricted" state, no title.
  "Nothing was attached" and "you may not see what was" are deliberately indistinguishable. A removed
  post loses its attachment with its text, exactly as it loses its title.
- **Nothing about the chip is stored.** `Post.documentId` is the whole record; the title, the
  revision number and the link are all worked out at read time, so a document renamed or revised
  after the post was written shows its truth, not a stale copy. The audit row records the id only.
- `Post.documentId` is `onDelete: Restrict` and it never bites: documents here are soft-deleted and
  never hard-deleted.

### Contractor notices (`includeExternals`)

> A contractor still has no noticeboard. What they have is a **read-only list of the announcements
> somebody chose to include them in**, on the brief page they already open every morning.

- **Who it is valid on.** `CreatePostInput.includeExternals` is an `ANNOUNCEMENT` flag, valid only on
  the **company-wide** or a **PROJECT** audience. Never a department — a contractor works on a
  project and for the company, never inside one of its departments, so there is no honest meaning
  for it there — and never a board, which reaches nobody by design. Refused in the service, in plain
  English, the same place `requiresAck` is refused and for the same reason: `can()` answers "may you
  post to this audience", not "and may you also widen who reads it". Left out means **no**, and off
  is byte-for-byte today's behaviour.
- **Who it reaches.** `externalAudienceMembers()` in `posts.ts`, kept **deliberately separate** from
  `audienceMembers()`: that one is the single derivation behind who is told AND the "M" in "N of M",
  and a contractor must never appear in the second. Company-wide reaches the company's active
  contractors; a project reaches only the contractors holding **live assigned work on that project**
  — exactly what `assertCanViewProject()` demands of them before it shows them the project at all.
  Being a `ProjectMember` is not enough, here as everywhere else.
- **The link never sends them somewhere they may not go.** Colleagues get the ordinary
  `ANNOUNCEMENT` notification pointing at `/messages?tab=…`; contractors get the **same type, the
  same words, and `/my-tasks/brief`** instead, because `/messages` is a 404 for them and a
  notification body is the one door read scoping cannot close. That is two `notify()` calls, and the
  second passes `{ chatCopy: false }` — the company's own Slack or Teams channel has already had the
  announcement once, and a second copy differing only in its link would be noise. `chatCopy` is the
  only option `notify()` takes and this is the only caller that uses it.
- **Acknowledgement never involves them.** A notice may carry both flags; a contractor still sees a
  plain read-only card, is never offered the button, is refused not-found if they ask for one anyway,
  and is never in `M`. `toPostDTO()` computes `requiresAck`, `canEdit` and `canDelete` **false for an
  EXTERNAL on the server**, rather than trusting a screen to hide them.
- **Their read surface is one function and one section.** `listNoticesForExternal()` is the only post
  read an EXTERNAL is ever answered, and `briefs.ts` puts it in the brief's existing announcements
  section. The screen relabels that section **"Notices"** for them — "announcement" implies the
  reply / dismiss / acknowledge apparatus they never get. The line carries the whole notice (title,
  body, who posted it, when) and `linkUrl` is **empty**, so the title draws as plain text rather than
  a link into a wall; `BriefItemDTO.body` exists for exactly that case and is null on every task line.
- **Nothing new is stored and nothing personal is collected.** "Included" is one boolean on the post;
  who sees it is computed at read time from work that is already recorded. The privacy page needed no
  change.

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

## Data rights, part 1: taking a copy out

> Every company can take a full copy of its own data, and every person can take a copy of their
> own. An export never crosses a company boundary, never reaches further than the person asking
> already reaches, and never carries a password, a token or a webhook address.

**Part 1 is the two exports.** Deleting an account or a workspace is part 2 below, on the same two
screens — `/admin/data-privacy` and `/account` — in the red-tinted danger section under each export
card.

### No migration, and no new table

Nothing about an export is stored in a column of its own — the schema stays frozen. Three things
already in the app carry the whole feature:

- **The audit trail is the record.** `EXPORT_STARTED` is written when an administrator presses the
  button, `EXPORT_READY` when the archive is finished. Both are organisation-level
  (`entityType: "Organization"`, `entityId` the org id, `projectId: null`, the same shape
  `ORG_CREATED` has). "Working", "ready" and "failed" are **derived at read time** from those two
  rows plus the file on disk, exactly as `OVERDUE` and a locked phase are.
- **`EmailToken` is the download bearer.** `EmailPurposeSchema` gains a fourth value, `"EXPORT"`
  (24-hour lifetime, `EMAIL_TOKEN_TTL_MS.EXPORT`), and it is the one purpose that is **never
  emailed**: it is handed to the administrator on the screen they are already looking at. The
  compiler says so — `EMAIL_LINK_PATH`, `emailLink()` and the email audit input all take
  `EmailedPurposeName` (`Exclude<EmailPurposeName, "EXPORT">`), so an export token cannot reach an
  inbox by accident. Everything else about the row is unchanged: only the SHA-256 hash is stored,
  a new one retires that person's earlier live one, and a miss answers the same plain nothing.
- **The archive is named after its own `EXPORT_STARTED` row id** (`DATA_DIR/exports/<id>.zip`).
  That is how the download route finds the file again **without any path ever being written into an
  audit row** — the row records who asked and when, and nothing else. `appendActivity()` now returns
  the id of the row it wrote, which is the only change that reaches outside this feature.

### What is in a workspace export, and what is deliberately not

One JSON file per model, holding **that organisation's rows only**: organization, users,
disciplines, projects, phases, members, project disciplines, main tasks, discipline tasks,
dependencies, required documents, documents, document versions, comments, posts, acknowledgements,
dismissals, notifications, the whole activity log, and the chat integrations. Plus `files/` — every
uploaded file of that company's document versions, under its stored name — and a plain-English
`README.txt` saying what is in the archive and what is not.

**Deliberately absent, and the README says so:**

- `User.passwordHash`. An argon2 hash is still a credential, and an export is a file that gets
  emailed around and left on laptops.
- Every `Session` and every `EmailToken` row. The same reason, one step stronger: these are live
  keys to an account.
- `OrgIntegration.webhookUrl`. A webhook address is a bearer secret (house rule 11), so the export
  shows exactly what the admin screen shows — **scheme and host** via `maskWebhookUrl()`.
- The whole `MicrosoftConnection`. Its tokens can be exchanged for new credentials; a partial row
  would be a new place to leak them, so it is left out entirely rather than half-included.
- Personal preference data — favorites and private to-do lists. They belong to the person rather
  than the company, and each person exports their own from Your account.

**Soft-deleted rows ARE included**, with their `deletedAt`: a removed document or project is still
part of the record the company is asking for a copy of, and the permanence rule already says the
history stays.

### How it is built, and what it costs

- **Fire-and-forget, in this process, like a chat webhook.** `startWorkspaceExport` writes the audit
  row and returns; the build runs after it. **Surviving a restart is not a requirement**: a lost job
  is one press of the button. An `EXPORT_STARTED` row with no `EXPORT_READY` row after
  `EXPORT_STALE_MS` (30 minutes) reads as **failed**, which is what stops a lost job showing
  "preparing…" forever, and a failed attempt does not spend the day's export.
- **Nothing is ever buffered.** `src/lib/zip.ts` is a hand-written **store-only (no compression) ZIP
  writer**: entries are written straight through to the file with backpressure respected, and the
  sizes and CRC follow the data (the ZIP "data descriptor", general-purpose bit 3) so a table can be
  written as JSON without first building the whole string. Only the central directory is held in
  memory — one small record per entry. Tables are read in id-ordered pages of 500. It is the same
  spirit `readBounded()` carries in `graph.ts`.
- **Why hand-written rather than a dependency:** the app needs exactly one thing — files side by
  side in a container every computer can already open — which is a 30-byte header, the bytes, a CRC
  and a directory. Two hundred lines and no supply chain, proved by `src/lib/__tests__/zip.test.ts`
  and by the service tests, which unzip the real archive and check every checksum. **Nothing ever
  shells out to a `zip` binary** — the deploy image has none.
- **A plain 4 GB limit**, and 65,535 files. This is deliberately 32-bit ZIP, not ZIP64: those are
  the format's own ceilings. Whether the company fits is checked **before a byte is written**, and
  one that does not is told so in plain English rather than handed a broken file. A ceiling reached
  part-way through anyway (the JSON tables are not weighed in advance) throws `ZipLimitError`, which
  `buildExport` treats exactly as it treats a `ServiceError`: its wording reaches the screen, because
  "export it in parts" is something an administrator can act on and "something went wrong" is not.
- **A write that fails is a failed export, never a crashed server.** `ZipWriter` attaches its
  `error` listener in the constructor, before a byte is written: a Node write stream with no
  listener turns a full disk or a revoked permission into an *unhandled* `error` event, which takes
  the whole process down — every request in flight with it, for a background job nobody was waiting
  on. The failure is recorded and re-thrown from the next `push()` or `finish()`, so the job's own
  try/catch sees it like anything else and the screen offers "try again".
- **The export is not a listing**, so it does not use the helpers in `src/lib/db.ts` (house rule 2):
  it includes soft-deleted rows and reads in pages. Every query is still anchored to the
  organisation through `User.orgId`, `Discipline.orgId` or `Project.orgId`, which is what the tenant
  rule actually asks.

### The download

- **Two keys, not one.** `/api/admin/export/download?token=…` needs the token **and** a signed-in
  ADMIN of the company whose data it is (`EXPORT_ORG`, then `holder.orgId === actor.orgId`). Another
  company's administrator holding a perfectly valid token is answered **not found**, like every
  other cross-company miss: a bearer never walks past the tenant rule.
- **A GET consumes nothing.** `previewEmailToken()` is used, not `consumeEmailToken()`, so a dropped
  download can simply be started again until the link expires. It is a large file behind a session
  as well as a token, and a link that died on the first byte would be worse than useless.
- **The raw token is never stored.** The one this process minted is cached in memory; after a
  restart the next status read mints a fresh one for whichever administrator is looking, and a link
  copied before the restart stops working. That is the honest trade for storing no secret, and it
  costs a copied link, never the archive.
- **The cache is keyed per export AND per administrator** (`${exportId}:${userId}`), not per export
  alone. An `EmailToken` belongs to the person it was minted for and dies with their account, so a
  shared cache entry would hand the company's second administrator a link minted for the first —
  and the moment that first administrator was deactivated or deleted their own account, every
  download would answer "not found" while the screen went on showing a link that looked fine for
  the rest of the day. One small row each removes the whole class of problem.
- **Cleanup.** `sweepExportFiles()` runs on the hourly sweep, after its transaction (the same place
  the chat copies go), and deletes archives older than 48 hours. A finished export also deletes the
  company's earlier ones, so only the newest copy is ever on disk. Nothing depends on it having run:
  a file left behind costs disk, never correctness.

### The personal export

- **Immediate, not a job**: one person's rows, JSON rather than files, and capped at 5,000 per
  section (the sections that hit the cap are named in `truncated`). `downloadMyData()` in
  `src/server/services/personal-export.ts` builds it and the route streams it as an attachment.
- **A route rather than a server action**, for the same reason the document download is one: a
  server action returns a value to React, and this has to arrive in a downloads folder as a file.
- **Their own reach and no further.** Their profile (never a hash), their project memberships, the
  tasks assigned to them, the comments they wrote, their notifications, their favorites, their
  private list and the announcements they acknowledged or dismissed. **A contractor's copy is
  narrowed exactly as every other read of theirs is**: `externalTaskScope(actor)` on their comments,
  and a project only when they hold live work on it — being left a `ProjectMember` is not enough,
  here as everywhere else.
- **Three a day per person**, `byUser`, refused with 429 and a `Retry-After`. The ceiling lives in
  the service (`personalExportThrottle`) so the tests can prove it.
- **One `PERSONAL_EXPORT` audit row per download**, naming the person and nothing that was in the
  file.

**Any change touching this area adds or extends a test in
`src/server/__tests__/exports.service.test.ts` in the same change** — and the tenant half in
`org-isolation.service.test.ts`, which unzips one company's archive and proves the other company's
ids appear nowhere in its bytes.

## Data rights, part 2: deleting

> A person can delete themselves, and a company can delete itself. **One is anonymisation and the
> other is removal**, and the difference is deliberate: one person's profile is theirs, but the work
> they did belongs to the company's project record — while a company's whole workspace belongs to
> nobody but that company, so when it asks for all of it to go, all of it goes.

Both live on the two screens part 1 built, in a red-tinted danger section under the export card:
`/account` and `/admin/data-privacy`.

### Deleting your own account (`src/server/services/account-deletion.ts`)

- **Any signed-in person, contractors included, and only ever themselves.** `deleteMyAccount()`
  takes no id and calls no `assertCan`: the only account it can reach is `actor.userId`, which comes
  from the session and from nowhere else. The confirmation is the fixed word `DELETE`, checked in
  zod **and** again in the service, because a service never assumes its caller parsed.
- **What goes.** In ONE transaction: `name` → `"Former member"`, `email` → `deleted+<id>@tielora.invalid`
  (a `.invalid` address by RFC 2606, so nothing can ever be delivered to it, carrying the id so the
  column's global uniqueness still holds), `passwordHash` → an argon2 hash of 32 random bytes that
  are thrown away (`unusablePasswordHash()`'s idea, reused), `jobTitle` / `companyName` /
  `disciplineId` / `accessExpiresAt` / `emailVerifiedAt` cleared, `isActive` false. Then every
  `Session` and `EmailToken`, and the personal-preference rows: `Favorite`, `PersonalTask`,
  `PostDismissal`.
- **What stays, and why.** Comments, completed tasks, uploaded `DocumentVersion` rows, `Post`s and
  the whole `ActivityLog`. **`PostAck` stays too**: a dismissal is private read state and an
  acknowledgement is an attestation somebody relied on (see "Acknowledgements" above) — the same
  contrast, applied one more time.
- **The rename does every screen at once, and this was checked rather than assumed.** Every DTO that
  carries a person's name resolves it through a live join off the `User` row — `authorName`,
  `assigneeName`, `uploadedByName`, `ownerName`, `createdByName`, `completedByName`,
  `overriddenByName`, `leadName`, `userName`, `actorName`, `requestedByName`, `connectedByName`. **No
  snapshot column exists anywhere**, which is what makes "Former member" true everywhere without a
  backfill.
- **`ActivityLog.summary` keeps the name it was written with, and the screens say so.** The audit
  trail is a record of what happened; rewriting it is exactly what the golden rule forbids. So the
  promise everywhere — the danger card, its modal, `/privacy` and `/terms` — is the same two
  sentences: your work shows "Former member", and entries already recorded in the activity trail
  keep the name they were written with. **Do not let one of those four drift into "nobody will ever
  see your name again"**, which is not true and is not fixable without rewriting history.
- **`Notification` is the one place a name IS frozen into stored text** — its `title` and `body` are
  sentences written at the time, e.g. "Layla al-Riyami mentioned you". So the deletion removes the
  person's notifications **in both directions**: the rows addressed to them (their own inbox) and
  the rows where they were the actor. A notification is a nudge, never a record; the audit trail is
  the record, and it stays.
- **The audit row is name-free on purpose.** `ACCOUNT_DELETED`, organisation-level
  (`projectId: null`), actor = themselves, summary "A member deleted their own account". It is
  written in the same transaction that takes the name away, so repeating the name would put it
  straight back. The OLDER audit rows keep the name they were written with — that is history, not a
  profile, and the privacy page says so in as many words.
- **The sole-administrator refusal, and the lock that makes it hold.** An ADMIN who is the last
  active administrator of their company is refused in plain English ("make someone else an
  administrator first"), server-side — the same rule `updateUser` keeps when an administrator
  demotes or deactivates the last one. **Counting them outside the transaction would be a
  check-then-act race**: a company's two administrators pressing the button in the same second
  would both count two, both pass, and leave the company with nobody able to run it and no way back
  in. So the deleting transaction opens with `SELECT id FROM "Organization" WHERE id = $1 FOR
  UPDATE` and asks again behind that lock; the second one waits, counts one, and is refused. The
  lock is transaction-scoped, so it is always released — the same reasoning the sweep's
  `pg_try_advisory_xact_lock` follows. The cheap pre-transaction count stays as well, purely so an
  obvious refusal is instant and never pays for an argon2 hash first.
  The screen shows the guidance **before** anybody types the word, computed at page load, and the
  button is never greyed out — nothing in this app is offered disabled.

### Deleting the whole workspace (`src/server/services/workspace-deletion.ts`)

- **Seven days, and the deadline is never stored.** `Organization.deleteRequestedAt` +
  `deleteRequestedById` are the whole record; `deletesOn` and `daysLeft` are derived at read time
  exactly as OVERDUE and a locked phase are, so the grace period is a constant
  (`WORKSPACE_DELETION_GRACE_MS`) and never a migration.
- **`DELETE_ORG` is its own permission**, ADMIN-only, beside `EXPORT_ORG`. Requesting needs the
  workspace's own name typed exactly; **cancelling needs nothing at all** and is open to any
  administrator of that company, not only the one who asked.
- **Nobody is locked out during the grace period.** The workspace works exactly as before. Every
  administrator is notified in-app the moment it is requested (an `ANNOUNCEMENT`-type notification
  with `{ chatCopy: false }` — see the notifications section) and sees a red, **non-dismissible**
  banner on every page, with "cancel" inline in the sentence. Non-administrators see nothing: they
  are affected, but a countdown you cannot act on is anxiety rather than news.
- **The hard delete runs inside the sweep's advisory-locked transaction** (`runSweepOnce`), so
  however many copies of the app are running, only one can ever be deleting a company. It never
  depends on having run on time: a late sweep deletes late.
- **The order is the whole trick, and it was discovered from the schema rather than guessed.**
  Deleting the `Organization` row alone does NOT work. Organization cascades to `User`,
  `Discipline`, `Project`, `OrgIntegration`, `MicrosoftConnection` and `Post` — and those cascades
  then hit foreign keys that RESTRICT: `Project.createdById`, `MainTask.createdById`,
  `Document.uploadedById`, `DocumentVersion.uploadedById`, `Comment.authorId`, `Notification.userId`,
  `ProjectMember.userId` and `Post.authorId` all pin a `User` (Prisma's default for a REQUIRED
  relation is Restrict, and only an OPTIONAL one defaults to SetNull), `MainTask.phaseId` pins a
  phase, and `Post.documentId` pins a document. So every dependent table is emptied by hand, in one
  transaction, in this order: post acks → post dismissals → posts → notifications → activity log →
  comments → required documents → document versions → documents → task dependencies → discipline
  tasks → main tasks → phases → project members → project disciplines → favorites → personal tasks →
  email tokens → sessions → **projects** → disciplines → chat integrations → Microsoft connection →
  **users** → the organisation.
- **The audit trail goes with the workspace.** GO-LIVE promises an append-only trail *within a
  living workspace*; it was never a promise to keep one company's history after that company asked
  for all of it to be deleted. This is the one documented exception to the append-only half of the
  golden rule (see THE GOLDEN RULE above), and `mutation-safety.test.ts` names the single file
  allowed to delete those rows and still forbids updating them anywhere.
- **Files are dealt with around the transaction, never inside it.** The `DocumentVersion`
  `storedFilename`s and the export archives (named after their own `EXPORT_STARTED` audit row ids,
  which is exactly why they must be read before the activity log is emptied) are collected BEFORE
  the deletes; the bytes are removed AFTER the transaction commits. A transaction that rolls back
  must not have taken anybody's documents with it, and a file that will not delete is **logged and
  left** — no row points at it any more, so an orphan costs disk space, never correctness. One log
  line per workspace, counts only: no names, no addresses, no file names.
- **Nothing is soft about it.** No archive, no tombstone, no undo. The seven days ARE the undo, and
  "Download everything" sits on the same screen — the danger card, the privacy page and the terms
  page all say to use it first.

**Any change touching this area adds or extends a test in
`src/server/__tests__/deletion.service.test.ts` in the same change** — and the tenant half in
`org-isolation.service.test.ts`. The critical one is already there: a workspace is deleted with a
second company sitting beside it, every table is asserted empty for the first and unchanged for the
second, and the second company's files are still on disk.

## Plans and limits

> A plan decides how much MORE a company may add, and nothing else. Nothing already there is ever
> hidden, locked or taken away — a company over its limit reads, opens, downloads and works exactly
> as it did the day before.

- **ONE FILE HOLDS THE NUMBERS.** `src/lib/plan-limits.ts` carries `PLANS` (the three ceilings per
  plan), `planOf()`, the plain-English helpers and the refusal wording. There is no second copy in a
  component, a message, a route or a database column — changing a limit is an edit to that one file,
  and the screens and the services both change with it. **The numbers there are the roadmap's
  placeholders, and so is the `$29/month` on the Billing page (`PRO_PRICE` in
  `admin-billing-view.tsx`): the owner sets the real numbers and the real price at the pause point
  before launch.** The screen says so under the plans table until they do.
- **`null` means unlimited** — never 0 and never a very large number, so "no ceiling" can never be
  confused with "a ceiling nobody has reached yet".
- **An unrecognised plan reads as FREE.** `planOf()` is the same defensiveness `broadcastPolicyOf()`
  carries, pointed in the safe direction: a value from a newer build, a typo or a blank can never
  hand a company limits nobody paid for.
- **Three choke points, and nowhere else** (`src/server/services/billing.ts`, called before the
  mutation in each case): `createProject`, `createUser` — **both the password and the invite path,
  because both end in one more account that can sign in** — and `uploadDocumentVersion`, which every
  upload in the app walks through, the browser's dropzone and a Microsoft 365 attachment alike. No
  other service has to know that plans exist.
- **What is counted.** Live projects (a soft-deleted project frees its place). People who can still
  sign in — **a deactivated account does not count**, deliberately: an administrator who deactivated
  somebody has given the seat back, and the account, its work and its audit trail all stay where
  they are. **Nor does a contractor whose access has run out**: `getSessionUser()` and the sign-in
  route turn them away exactly as they turn away a deactivated account, so charging a company for
  that seat would be charging for a door nobody can open. The count uses the same rule
  `isAccessExpired()` uses, written as an OR (not a contractor, or no end date, or an end date still
  inside its one-day grace) — a NULL end date under a negated comparison would quietly drop
  everybody who has none. And **every stored byte, including the revisions of soft-deleted
  documents**: nothing in
  this app ever deletes a revision or its file, so counting only the live ones would let a company
  remove a document, upload it again and use the same disk twice.
- **GIVING A SEAT BACK IS TAKING A SEAT.** `updateUser` asks for room whenever somebody who was not
  counted will be afterwards — reactivating a deactivated account, or extending an expired
  contractor's access. Without it, deactivating ten people, adding ten more and switching the first
  ten back on would leave a ten-seat company with twenty people who can sign in. The question is
  asked with the same definition of "counts" that the count itself uses, so the two can never drift.
- **Nothing about usage is stored.** Every number is counted at read time from the rows themselves,
  exactly as OVERDUE and a locked phase are. There is no usage column and there must not be one.
- **The storage cap is checked BEFORE the bytes reach disk, and again in the service.** The upload
  route judges it on the browser's own `file.size` before `storeFile()`, and `attachMicrosoftFile`
  judges it on Microsoft's declared size before a byte is fetched — the same place each already
  refuses an oversized file. `uploadDocumentVersion` checks it again on what actually arrived, as
  the backstop that no upload path can go around. Checking only in the service would still refuse
  the upload, but the file would already be on disk with no revision pointing at it: nothing in this
  app deletes an orphan, so every refused attempt would cost real space.
- **The storage sum is one aggregate query per upload, and that cost is accepted rather than
  cached.** Uploads are already rate limited (30 a minute per person), and the alternative is a
  stored total that can drift from the truth — the precise thing this app keeps refusing to add.
- **A LIMIT CHECK IS A READ FOLLOWED BY A WRITE, and here is exactly how far that is trusted.**
  Projects are checked twice: once cheaply, so an obvious refusal is instant, and **again inside
  `createProject`'s own transaction behind `SELECT id FROM "Organization" … FOR UPDATE`** — the same
  transaction-scoped lock the sole-administrator rule takes, for the same reason, so two people
  pressing "Create project" in the same second cannot both get through. **People and storage are
  deliberately left as read-then-write**: two simultaneous requests can overshoot by exactly one
  seat or one file, which is a rounding error against a ceiling, self-corrects the moment anything
  else is added, and is not worth serialising every upload in the app for. Projects get the lock
  because their ceiling is the smallest — one, on a free plan — so an overshoot is the one anybody
  would actually see.
- **GRANDFATHERING is the rule, not an exception.** Reads are never blocked. A company already over
  a limit — after a future downgrade, say — is refused only from adding MORE. Three projects on a
  free plan means three readable projects and a refused fourth, and that exact case is a test.
- **The refusal is written server-side, in full, and shown exactly as it arrives.** It is
  role-branched by the server the way everything else is decided by the server: an ADMIN is pointed
  at Admin → Billing, everybody else is told to ask their administrator. The pointer is words rather
  than a link because a refusal travels as a plain string from the service to `ErrorBanner` — the
  moment a component turned part of it into a link it would be re-wording the server.
  `new-project-dialog.tsx` used to hardcode its own banner sentence and now renders `{error}` like
  every other dialog in the app.
- **A limit refusal writes NO `ActivityLog` row.** It is an ordinary validation failure, like a
  duplicate project code or a missing password, and those have never been audited: the trail records
  work that happened, and nothing happened. Reading the Billing page is a read and audits nothing
  either.
- **The Billing page is `/admin/billing`**, the fifth ADMIN_NAV row, gated by its own
  `MANAGE_BILLING` permission (ADMIN-only, beside `EXPORT_ORG` and `DELETE_ORG`). `billingStatus()`
  supplies plan, usage and limits; the meters turn `var(--status-blocked)` when a company is over
  one, and that single amber meter is **the only place in the app that says so** — no badge on the
  project list, the directory or the documents table.
- **No provider is set up yet, so there are no buttons at all** — not greyed out, not disabled with
  a tooltip, simply absent, the same discipline `AdminMicrosoftCard` follows. The dormant line says
  upgrading is not turned on and that nothing else about the plan changes meanwhile.
- **Test companies are on PRO** (`makeOrg` in the test harness), deliberately: a plan limit must
  never quietly decide the result of a test about phases, comments or documents. The billing tests
  set the plan they mean with `setPlan()`.

**Any change touching this area adds or extends a test in
`src/server/__tests__/billing-limits.service.test.ts` in the same change** — and the tenant half in
`org-isolation.service.test.ts`, which proves one company's projects, people and files never count
towards another company's limits.

## Billing provider (taking the money)

> Every fact about the payment provider lives in ONE file. Nothing happens at all until four
> environment variables are set. No payment credential is stored anywhere in this app, ever.

- **ONE MODULE HOLDS THE PROVIDER.** `src/server/services/paddle.ts` carries everything this app
  knows about Paddle: `billingConfigured()` / `paddleConfig()`, the two hosts, the plain `fetch`
  with `Authorization: Bearer` (no SDK, no new dependency), minting a checkout, minting a portal
  link, the webhook signature check, reading a payload, and which event names mean what. Every
  other file — `billing.ts`, the route, the screens — only ever hears "there is a provider", "here
  is one address to navigate to" and "this webhook means ACTIVATE, DEACTIVATE or NONE". Swapping to
  the Lemon Squeezy fallback (docs/GO-LIVE.md, section 8) is a rewrite of that one file.
- **Dormant until configured** (house rule 11), and it takes all four: `PADDLE_API_KEY`,
  `PADDLE_WEBHOOK_SECRET`, `PADDLE_PRICE_ID_PRO` and `APP_BASE_URL`. `PADDLE_ENV` chooses
  `sandbox-api.paddle.com` (the default, and what anything unrecognised reads as — the safe
  direction) or `api.paddle.com`. Unset means: **no buttons at all** on Admin → Billing, both
  actions refuse in plain English, the webhook answers 503 "not set up", and `/api/health` reports
  `"billing": "dormant"`. Setting the four variables is the whole activation — no migration, no code
  change, no schema change.
- **The API key never leaves the server.** It is read in that one module, sent in one header, and
  never returned by a read, put in an error message, written to an audit row or logged. **A checkout
  address and a portal address are treated the same way**: minted for one press, handed to the one
  administrator who pressed the button, never stored, never logged, never in an `ActivityLog` row.
  A portal link is single-use and short-lived at the provider, so it is minted fresh on every press.
- **THE CHECKOUT IS A REDIRECT, AND NO THIRD-PARTY JAVASCRIPT IS LOADED ANYWHERE.** `startUpgrade`
  asks the provider to create a checkout server-side and hands back the address; the browser makes
  an ordinary top-level navigation to it. **The Content-Security-Policy in `next.config.ts` needs
  nothing added for this** — `script-src`, `frame-src` (still `'none'`) and `connect-src` are all
  untouched, because no CSP directive governs navigating away to another site. The overlay
  alternative, and the CSP entries it would cost, is written up in GO-LIVE section 8 for activation
  day; it is deliberately not built.
  - The address the provider returns is **checked to be a Paddle-hosted one** before anybody is sent
    there. If it is not — which is what a live account without hosted-checkout approval looks like —
    the administrator is refused in plain English rather than dropped on a page that would need
    Paddle's JavaScript.
- **THE WEBHOOK'S ORDER OF OPERATIONS IS THE SECURITY**, and it never changes
  (`processBillingWebhook` in `src/server/services/billing.ts`, behind `POST /api/billing/webhook`):
  1. **Configured?** No secret means nothing to verify against: 503, and nothing is touched.
  2. **Signature, over the RAW body, before anything is parsed and before any database read.**
     HMAC-SHA256 of `` `${ts}:${rawBody}` `` against the `h1` in `Paddle-Signature`, compared in
     constant time, then a timestamp inside five minutes. The route reads `request.text()` and
     nothing re-serialises anything — re-serialised JSON is different bytes and a different
     signature. **A request that fails this leaves no row in any table**, which is what the test
     asserts rather than trusting the reading order.
  3. **Idempotency.** The event's own id goes into `BillingEvent` **inside the same transaction as
     the plan change**. `@@unique([provider, eventId])` IS the replay rule: the provider retries
     until it is acknowledged, and a second delivery loses the race, rolls back and is answered 200.
  4. **The company** comes from `custom_data`, and one we do not recognise is **recorded and
     answered 200** — never 404, which would turn the endpoint into a way of asking whether a
     company id is real. The same status, the same body, for a real company and an invented one.
  5. **The plan moves**, and the move is audited in the same transaction.
  Anything unexpected throws, the route answers 500, and the provider retries — which is exactly
  what the idempotency key is for. While dormant the 503s are retried and eventually marked failed
  at the provider, which is the honest outcome: nothing is set up here.
- **A DELIVERY THAT OVERTOOK A NEWER ONE CHANGES NOTHING.** Webhooks do not arrive in order, and a
  delayed `subscription.updated: active` landing after a cancellation would put a cancelled company
  back on Pro and leave it there. So every event carries the provider's own `occurred_at` into
  `BillingEvent.occurredAt`, and one stamped earlier than the newest thing that company has already
  been told about is **recorded and acted on in no other way** — the delivery history is still the
  record that it arrived.
  - **The comparison is provider clock against provider clock, and it has to be.** `processedAt` is
    OUR clock — when the delivery reached us — so comparing an event's `occurred_at` against it
    would throw away a perfectly good event whenever a company changed something twice in quick
    succession: the second event genuinely happened before the first one finished arriving. That is
    why the column exists at all rather than reusing the one already there.
  - **Undatable events are never reordered.** A payload with no `occurred_at`, or a company with no
    dated event yet, behaves exactly as it did before the rule existed. The check runs inside the
    same transaction as the claim and ignores the row it just wrote.
  - **"Is there a payment problem right now?" is answered by the same clock.** `providerStatusFor()`
    picks the newest of the payment-signal events (`transaction.payment_failed`,
    `transaction.completed`, `subscription.activated`) by `occurredAt`, nulls last, falling back to
    `processedAt` only among rows that carry no provider timestamp. Ordering by arrival would let a
    delayed failure that happened BEFORE a successful payment land afterwards and show an
    administrator a warning that was already out of date — the plan half and the payment half of
    this page must agree about what "newest" means.
- **What each event means** is a list in the one module: `subscription.activated` /
  `subscription.created` → PRO; `subscription.canceled` / `expired` / `paused` → FREE;
  `subscription.updated` reconciles on the status it carries (`active`/`trialing` → PRO,
  `canceled`/`expired`/`paused` → FREE); **`past_due` and `transaction.payment_failed` move
  nothing** — the provider is still trying and the company keeps Pro through the dunning. An event
  type this build does not recognise is recorded and changes nothing.
- **The `BillingEvent` row is the record that a delivery ARRIVED; the `ActivityLog` row
  (`BILLING_PLAN_CHANGED`) is the record that the company MOVED.** A webhook that changes nothing
  writes only the first — the same reasoning that keeps a limit refusal out of the audit trail.
  The audit row carries the old plan, the new plan and the provider's event id and **nothing from
  the payload**, and it is the one row in this app written with **no actor**: nobody here pressed
  anything. `startUpgrade` and `openBillingPortal` write `BILLING_CHECKOUT_STARTED` and
  `BILLING_PORTAL_OPENED`, both without any address.
- **WHAT IS DELIBERATELY NOT STORED.** No card, no token, no API key, no price, no invoice, no
  amount, no renewal date, no subscription status column and no "past due" flag. The three columns
  the plan migration added — `plan`, `billingCustomerId`, `billingSubscriptionId` — are the whole
  footprint, and the two ids are identifiers at the provider and nothing more. They are **kept after
  a cancellation** on purpose: that is how "Manage billing" still works and how a resubscription is
  recognised as the same customer.
  - Which means **the screen cannot honestly show a renewal date, and does not**. It says the
    provider holds the next payment date, the invoices and the card, and points at Manage billing.
  - **"A payment did not go through" is derived, not stored**: the newest `BillingEvent` for that
    company among the payment-signal events, exactly as OVERDUE and a locked phase are derived. It
    is only ever as good as the last webhook that arrived, and the copy says nothing more than that.
  - **A cancelled-but-still-inside-the-paid-period state is not modelled**, because nothing we store
    could know the period end. A cancellation drops the company to FREE when the webhook says so.
- **The Billing page stays a server component**; the only client code on it is
  `admin-billing-actions.tsx` — the two buttons and the strip shown on returning from checkout. That
  strip is honest about the lag: the plan flip arrives by webhook a moment after the browser does,
  so while the company still reads FREE it says "payment received, waiting for the final
  confirmation", asks the page to re-render itself every five seconds (the page is already a server
  read, so refreshing it keeps one source of truth rather than adding a second), and after two
  minutes stops and softens the wording. **It never says "you're on Pro" before the database does.**
  A cancelled or abandoned checkout shows nothing at all.

**Any change touching this area adds or extends a test in
`src/server/__tests__/billing-provider.service.test.ts` in the same change** — `global.fetch` is
stubbed and every webhook body is crafted and signed with a test secret, so no test ever reaches a
real payment provider — and the tenant half in `org-isolation.service.test.ts`, which proves a
verified webhook only ever moves the company its payload names.

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
