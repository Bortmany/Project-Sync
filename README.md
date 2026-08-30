# Project Nexus — Oman LNG

Project Nexus is Oman LNG's internal coordination platform for multidisciplinary engineering work.
A **project** holds **main tasks**; each main task is delivered by **discipline tasks** (Mechanical,
Electrical, Instrumentation, Civil, Process, HSE, Reliability, Inspection) with their required
documents, dependencies, comments and a full audit trail. A main task's status and progress are
always calculated from its discipline tasks — never typed in by hand.

Since the Milestone 1 SaaS conversion it serves **many companies from one database** under the name
**Tielora**: a company signs itself up at `POST /api/auth/signup`, gets its disciplines from an
industry template and an administrator of its own, and adds everyone else from the Admin section.
No person of any role ever sees another company's data — that rule, and where it is enforced, is the
first section of `docs/CONVENTIONS.md`. The screens still say Project Nexus; the rebrand and the
signup pages are a later milestone.

Read [`docs/CONVENTIONS.md`](docs/CONVENTIONS.md) before changing anything — it is this repo's law.
Design tokens and screen patterns are in [`docs/design-notes.md`](docs/design-notes.md). Launch gates
and deployment steps are in [`docs/GO-LIVE.md`](docs/GO-LIVE.md).

## Screenshots

*(placeholders — drop the images into `docs/screenshots/` and the links below start working)*

| Screen | Image |
|---|---|
| Sign in | `docs/screenshots/login.png` |
| Dashboard | `docs/screenshots/dashboard.png` |
| Project with its main tasks | `docs/screenshots/project.png` |
| Main task and its discipline tasks | `docs/screenshots/main-task.png` |
| Timeline (Gantt) | `docs/screenshots/timeline.png` |

## Run it locally

**Prerequisites**

- **Node 22** (or newer).
- **Postgres 16** running locally, with the `pg_trgm` and `unaccent` extensions available (they ship
  with the standard `postgresql-contrib` package). Two databases: `nexus` and `nexus_test`.

**One-time setup, then one command**

```bash
cp .env.example .env      # local-dev values are already filled in — no secrets in this file
npm install
npm run verify            # generate → migrate → seed → seed check → lint → types → tests → build
npm run dev               # http://localhost:3000
```

If you just want the app up without the full check:

```bash
npx prisma generate && npx prisma migrate deploy && npm run seed && npm run dev
```

### Seed sign-in

`npm run seed` creates the eight engineering disciplines, a small demo project (`SUR-EXP`) and these
people. **Development only — never use them anywhere real.** The seed prints the password when it
runs.

| Email | Password | Role |
|---|---|---|
| `admin@omanlng.example` | `Nexus!Demo2026` | Administrator (full access) |
| `layla.alriyami@omanlng.example` | `Nexus!Demo2026` | Project manager |
| `khalid.alfarsi@omanlng.example` | `Nexus!Demo2026` | Discipline lead (Mechanical) |
| `john.carter@omanlng.example` | `Nexus!Demo2026` | Engineer (Mechanical) |

Fourteen demo people are created in all — the four above are the ones worth signing in as. Every
demo account shares the same password.

Run `SEED_RESET=1 npm run seed` to rebuild the demo project from scratch. `npm run seed` on its own
is safe to repeat — it refreshes the disciplines and people and leaves an existing demo project
alone. Accounts are created by an administrator inside the app; there is no signup page.

## Environment

Every variable the app reads is documented in [`.env.example`](.env.example), with no real secrets in
it. The four that must always be set: `DATABASE_URL`, `DATABASE_URL_TEST` (local and CI only),
`DATA_DIR`, `SESSION_SECRET` (32+ characters). Everything else is optional and dormant until set:
`SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_TRACES_SAMPLE_RATE`, `SWEEP_DISABLED`.

In production the app **refuses to start** if `SESSION_SECRET` is missing or shorter than 32
characters, or if `DATA_DIR` is unset or cannot be written to. The reason is printed in the logs.
`SESSION_SECRET` is needed for the build as well (building renders pages); `DATA_DIR` is checked
only when a server actually starts, because the hosting volume is not mounted during a build.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Development server on port 3000 |
| `npm run build` / `npm start` | Production build, then the production server |
| `npm run lint` | ESLint (includes the "no console.log" house rule) |
| `npm test` | Vitest — library rules and service tests (service tests need `DATABASE_URL_TEST`) |
| `npm run seed` | Disciplines, demo people and the demo project |
| `npm run seed:check` | Proves the seeded data still obeys the golden rule |
| `npm run verify` | The whole chain: generate → migrate → seed → seed check → lint → types → tests → build |

## Verify

Before any commit, run the **verify recipe in [`docs/CONVENTIONS.md`](docs/CONVENTIONS.md)** — it is
the authoritative list and runs in a fixed order, ending in a production build. `npm run verify`
chains the middle steps against your current `DATABASE_URL`. Anything red means "do not commit".

The same doc holds the golden rule this app exists to keep (a main task's status and progress are
always the truth of its discipline tasks, and no document revision or audit entry is ever altered or
lost) and the tests that prove it: `src/lib/__tests__/progress.test.ts` and the service tests under
`src/server/__tests__/`.

## Health

`GET /api/health` reports the database, whether the uploads folder is writable, whether each error
tracking channel is `configured` or `dormant` (`"sentry": {"server": ..., "browser": ...}` — the
server one is `SENTRY_DSN`, the browser one `NEXT_PUBLIC_SENTRY_DSN`), and how long the process has
been up. It answers `200` when
everything is well and `503` when it is not — that is the URL to point a hosting health check at.

## Where things live

- `prisma/schema.prisma` — the complete data model (frozen after Milestone 1).
- `src/lib/` — logger, rate limiter, uploads, database helpers, auth, boot guards, permissions,
  progress rules, error reporting and `zod-schemas.ts` (the shared contract for every DTO and input).
- `src/server/` — services (all the real work, inside transactions), server actions and the
  deadline sweep.
- `src/components/ui/` — the shared UI kit; `src/components/shell/` — sidebar and top bar.
- `src/app/` — routes: `(auth)` for sign-in, `(app)` for everything behind a session, `api/` for the
  read routes and uploads.
