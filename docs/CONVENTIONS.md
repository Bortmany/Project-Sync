# Project Nexus — conventions (this repo's law)

Every agent and every session working in this repo reads this file first. It overrides the cross-repo
baseline in `Agents/docs/engineering-standards.md` wherever the two differ.

## What this app is

Project Nexus is Oman LNG's internal coordination platform for multidisciplinary engineering work: a
project holds main tasks, each main task is delivered by discipline tasks (Mechanical, Electrical,
Instrumentation, Civil, Process, HSE, Reliability, Inspection) with required documents, dependencies,
comments and a full audit trail. It is a private, admin-invite-only tool — there is no public signup.

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
12. **Privacy:** if a change starts storing a new piece of personal data, the privacy page is part of
    the same change (see the engineering standards, section 6). The privacy and terms pages are still
    to be written before the first real users — that is a launch gate, not a nice-to-have.

## Migration pattern

- Prisma with the `pg` driver adapter. Schema: `prisma/schema.prisma`; CLI config: `prisma.config.ts`
  (the datasource URL lives there and in `.env`, never in the schema — Prisma 7 requirement).
- Create migrations with `npx prisma migrate dev --name <short_name>`; apply with
  `npx prisma migrate deploy`. Raw-SQL migrations (like the trigram search indexes) are hand-written
  inside a `--create-only` migration folder. Never `prisma db push` in this repo.
- **The schema is FROZEN after Milestone 1.** Milestones 2–5 must not add, remove or alter a model,
  field, enum value or index. If something is genuinely missing, stop and ask the main session.

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
| `/api/tasks/[id]/activity` | GET | — | `ActivityItemDTO[]` |
| `/api/tasks/[id]/comments` | GET | — | `CommentDTO[]` |
| `/api/discipline-tasks/[id]` | GET | — | `DisciplineTaskDTO` |
| `/api/notifications` | GET | — | `NotificationDTO[]` |
| `/api/search?q=` | GET | `q` | `SearchResultsDTO` |
| `/api/dashboard` | GET | — | `DashboardDTO` |
| `/api/uploads` | POST | multipart: `file`, `projectId`, `mainTaskId?` \| `disciplineTaskId?`, `documentId?`, `requiredDocumentId?`, `title?`, `category?`, `note?` (validated by `UploadMeta`) | `DocumentVersionDTO` |
| `/api/documents/versions/[versionId]/download` | GET | — | file stream |
| `/api/auth/login` | POST | `LoginInput` | session cookie |
| `/api/auth/logout` | POST | — | `{ signedOut: true }` |
| `/api/auth/me` | GET | — | signed-in user |
| `/api/health` | GET | — | health JSON |

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
| `markNotificationRead` | `{ id }` | `ActionResult<NotificationDTO>` |
| `markAllNotificationsRead` | — | `ActionResult<{ count: number }>` |
| `createUser` | `CreateUserInput` | `ActionResult<UserDTO>` |
| `updateUser` | `UpdateUserInput` | `ActionResult<UserDTO>` |
| `deactivateUser` | `{ id }` | `ActionResult<UserDTO>` |
| `createDiscipline` | `CreateDisciplineInput` | `ActionResult<DisciplineDTO>` |
| `updateDiscipline` | `UpdateDisciplineInput` | `ActionResult<DisciplineDTO>` |
| `updateTaskDates` (Gantt drag) | `UpdateTaskDatesInput` | `ActionResult<MainTaskDTO \| DisciplineTaskDTO>` |

## Verify recipe (run in this order, all must pass)

```
npm ci
npx prisma generate
DATABASE_URL="$DATABASE_URL_TEST" npx prisma migrate deploy
npm run lint
npx tsc --noEmit
npm test
npm run build
```

`npm run verify` chains the middle steps against the current `DATABASE_URL`. (A seed check joins this
list in Milestone 2.)

## Review priorities for `code-reviewer`

1. **Golden-rule violations** — a status or progress value written by hand, a completion that skips a
   mandatory document or open dependency, an override without a recorded reason, an updated or
   deleted `DocumentVersion` / `ActivityLog` row.
2. **Missing server-side authorisation or scoping** — a route without `assertCan`, a query that is
   not limited to the signed-in person's projects.
3. **Unvalidated input** — a body, query or form read without a zod parse; an upload trusted by name.
4. **Audit-log gaps** — a mutation that does not append an `ActivityLog` row in the same transaction.
5. **Conventions drift** — redefined DTO types, raw `findMany` in a listing, `console.log`, new hex
   colours, a schema change after Milestone 1.
