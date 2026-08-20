# Project Nexus — Oman LNG

Internal coordination platform for Oman LNG's multidisciplinary engineering work: projects hold main
tasks, each main task is delivered by discipline tasks with required documents, dependencies,
comments and a full audit trail.

Read [`docs/CONVENTIONS.md`](docs/CONVENTIONS.md) before changing anything — it is this repo's law.
Design tokens and screen patterns are in [`docs/design-notes.md`](docs/design-notes.md).

## Getting started (local)

Requires Node 22 and a local Postgres 16 with the `pg_trgm` and `unaccent` extensions available.

```bash
cp .env.example .env      # local-dev values are already filled in
npm install
npx prisma generate
npx prisma migrate deploy
npm run seed
npm run dev               # http://localhost:3000
```

**Demo sign-in (development only — never use these anywhere real):**

- Email: `admin@omanlng.example`
- Password: `Nexus!Demo2026`

The seed creates the eight engineering disciplines (Mechanical, Electrical, Instrumentation, Civil,
Process, HSE, Reliability, Inspection) and that one administrator. Accounts are admin-created; there
is no public signup.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build and server |
| `npm run lint` | ESLint (includes the "no console.log" house rule) |
| `npm test` | Vitest suites |
| `npm run seed` | Disciplines + demo administrator |
| `npm run verify` | generate → migrate deploy → lint → types → tests → build |

## Health

`GET /api/health` reports the database, whether the uploads folder is writable, and whether error
tracking is configured or dormant.

## Where things live

- `prisma/schema.prisma` — the complete data model (frozen after Milestone 1).
- `src/lib/` — logger, rate limiter, uploads, database helpers, auth, permissions, progress rules and
  `zod-schemas.ts` (the shared contract for every DTO and input).
- `src/components/ui/` — the shared UI kit; `src/components/shell/` — sidebar and top bar.
- `src/app/` — routes: `(auth)` for sign-in, `(app)` for everything behind a session.
