# Project Nexus — conventions (this repo's law)

Every agent and every session working in this repo reads this file first. It overrides the cross-repo
baseline in `Agents/docs/engineering-standards.md` wherever the two differ.

## What this app is

Tielora is a multi-company coordination platform for multidisciplinary engineering work: a project
holds main tasks, each main task is delivered by discipline tasks (Mechanical, Electrical,
Instrumentation, Civil, Process, HSE, Reliability, Inspection — the set depends on the company's
industry template) with required documents, dependencies, comments and a full audit trail.

It was Project Nexus, one company's internal tool. Since the Milestone 1 SaaS conversion it serves
many companies from one database: a company signs itself up at `/api/auth/signup`, gets its
disciplines from an industry template and an administrator of its own, and adds everyone else from
the Admin section. The screens still say Project Nexus in places — the rebrand is a later milestone.

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
7. **Brand tokens from `src/app/globals.css` only.** No new hex values anywhere. The sail motif
   appears on the login page and empty states only.
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
| `/api/projects/[id]/gantt` | GET | — | `GanttDTO` |
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
| `/api/dashboard` | GET | — | `DashboardDTO` |
| `/api/uploads` | POST | multipart: `file`, `projectId`, `mainTaskId?` \| `disciplineTaskId?`, `documentId?`, `requiredDocumentId?`, `title?`, `category?`, `note?` (validated by `UploadMeta`) | `DocumentVersionDTO` |
| `/api/documents/versions/[versionId]/download` | GET | — | file stream |
| `/api/auth/signup` | POST | `SignupInput` | `SignupResultDTO` + session cookie (public; `byIp` limited to 5 an hour) |
| `/api/auth/login` | POST | `LoginInput` | session cookie |
| `/api/auth/logout` | POST | — | `{ signedOut: true }` |
| `/api/auth/me` | GET | — | signed-in user |
| `/api/health` | GET | — | health JSON |
| `/api/my-tasks` | GET | — | `MyTasksDTO` (everything assigned to the signed-in person: up to 200 open tasks by deadline **plus** the 50 most recently completed, read in two windows so history never crowds out live work, with `truncated`; `totals` counted in the database over all of it) |
| `/api/my-tasks/gantt` | GET | — | `GanttDTO` (only the signed-in person's discipline tasks, grouped under their main tasks; bounded — open work plus work whose deadline fell inside the last 90 days, 300 bars max) |
| `/api/favorites` | GET | — | `FavoriteDTO[]` (the signed-in person's own shortcuts, newest first, 50 max; deleted targets and anything in a project they may no longer see are skipped) |
| `/api/personal-tasks` | GET | — | `PersonalTaskDTO[]` (the signed-in person's own list, open items first, then by `sortOrder` so newly added lines lead, 200 max) |

Server actions live in `src/server/actions`. Each takes its `*Input` type and returns
`ActionResult<*DTO>`:

| Action | Input | Output |
|---|---|---|
| `createProject` | `CreateProjectInput` | `ActionResult<ProjectDTO>` |
| `updateProject` | `UpdateProjectInput` | `ActionResult<ProjectDTO>` |
| `upsertMember` | `UpsertMemberInput` | `ActionResult<ProjectMemberDTO>` |
| `removeMember` | `{ projectId, userId }` | `ActionResult<{ removed: true }>` |
| `upsertProjectDiscipline` | `UpsertProjectDisciplineInput` | `ActionResult<ProjectDisciplineDTO>` |
| `removeProjectDiscipline` | `{ projectId, disciplineId }` | `ActionResult<{ removed: true }>` |
| `createMainTask` | `CreateMainTaskInput` | `ActionResult<MainTaskDTO>` |
| `updateMainTask` | `UpdateMainTaskInput` | `ActionResult<MainTaskDTO>` |
| `overrideMainTaskStatus` | `OverrideStatusInput` | `ActionResult<MainTaskDTO>` |
| `clearOverride` | `{ id }` | `ActionResult<MainTaskDTO>` |
| `createDisciplineTask` | `CreateDisciplineTaskInput` | `ActionResult<DisciplineTaskDTO>` |
| `updateDisciplineTask` | `UpdateDisciplineTaskInput` | `ActionResult<DisciplineTaskDTO>` |
| `updateDisciplineTaskStatus` | `UpdateTaskStatusInput` | `ActionResult<DisciplineTaskDTO>` |
| `completeDisciplineTask` | `{ id }` | `ActionResult<DisciplineTaskDTO>` |
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

## Notifications and the deadline sweep

- **`notify()` (`src/server/services/notify.ts`) is the only way a Notification row is written by a
  person's action.** Every service already calls it *after* its transaction has committed, so a
  problem saving notifications can never undo the change that caused them — failures are logged and
  swallowed. It skips the actor, skips duplicates inside one call, and skips deactivated people.
- **Marking a notification read writes no `ActivityLog` row.** Read state is a personal preference,
  not project work; the audit trail records project work only. This is the one documented exception
  to house rule 1.
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
3. **Missing server-side authorisation or scoping** — a route without `assertCan`, a query that is
   not limited to the signed-in person's projects.
4. **Unvalidated input** — a body, query or form read without a zod parse; an upload trusted by name.
5. **Audit-log gaps** — a mutation that does not append an `ActivityLog` row in the same transaction.
6. **Conventions drift** — redefined DTO types, raw `findMany` in a listing, `console.log`, new hex
   colours, a schema change after Milestone 1.

## Notes

- `disciplineSummary[].requiredDocsTotal` / `requiredDocsSatisfied` count **mandatory** required
  documents only, so the "1/2 documents" hint on a discipline row always says the same thing as the
  completion gate. They are filled by two grouped queries per read (`requiredDocCountsFor()` in
  `src/server/services/tasks.ts`) — never one query per row.
