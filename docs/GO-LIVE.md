# Project Nexus — going live

Everything that must be true before real Oman LNG people use this app, and the steps to put it on
Railway. Written in plain English on purpose: the person running these steps is not a developer.

Keep this file true to the code. If a step here stops matching what the app does, fix it in the same
change that moved the code.

---

## 1. Launch gates — none of these are optional

| # | Gate | State today |
|---|---|---|
| 1 | **Privacy policy and terms pages written and linked** | ❌ **Not written.** This is a hard gate — see below. |
| 2 | Production secrets set and strong (`SESSION_SECRET` 32+, `DATABASE_URL`, `DATA_DIR`) | ✅ The app refuses to start without them |
| 3 | Security headers and a Content-Security-Policy on every response | ✅ Verified against a running production build |
| 4 | Error tracking decided: Sentry keyed, or knowingly left dormant | ✅ Dormant by default, one env var away |
| 5 | Database automatic backups turned **on** in Railway **and one restore actually tested** | ❌ Do this before launch (section 5) |
| 6 | `DATA_DIR` on a mounted volume, and a copy-out routine agreed | ❌ Do this at deploy time (section 4) |
| 7 | Health check pointed at `/api/health` | ❌ Set during deploy (section 3) |
| 8 | Demo/seed accounts removed from the production database | ❌ Never run `npm run seed` against production |
| 9 | The golden-rule tests green on the deployed commit (`npm run verify`) | ✅ Part of every change |

### Gate 1 — privacy and terms (still to be written)

**The app must not take real users until the privacy and terms pages exist.** Oman's Personal Data
Protection Law (Royal Decree 6/2022) applies. The pages must describe what this app *actually*
stores, which today is:

- **People:** name, work email, job title, role, discipline, password (hashed with argon2 — never
  readable), whether the account is active.
- **Sessions:** a hashed session token, the IP address and browser user-agent of each sign-in, and
  when the session expires.
- **Work:** projects, tasks, comments, uploaded documents and every revision of them, plus an
  append-only audit trail of who did what and when. Audit entries and document revisions are never
  edited or deleted — say so plainly, because staff have a right to know their actions are recorded
  permanently.
- **Notifications:** what each person was alerted about and whether they have read it.

The pages carry the honest note that they are a template pending professional review. Because this
is an internal tool for employees, "download my data" and "delete my account" are handled by an
administrator rather than self-service — state that on the privacy page, and name who to ask.

**Rule that outlives this file:** if a change starts storing a new piece of personal information, the
privacy page changes in the *same* change.

---

## 2. Secrets checklist

Set these in the Railway service's Variables tab — never in the repo, never in a commit.

| Variable | Required | Notes |
|---|---|---|
| `SESSION_SECRET` | **Yes** | 32 characters minimum. Generate with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`. **Needed at build time as well as at run time** — the build renders pages, which loads the session code, so a build with no secret fails. Changing it signs everyone out — that is the intended emergency action if it ever leaks. |
| `DATABASE_URL` | **Yes** | Railway's Postgres connection string. Use the pooled one if the app is ever run on more than one instance. |
| `DATA_DIR` | **Yes** | `/data` — must match the mounted volume (section 4). **Run time only:** it is not checked during the build, because no volume is mounted then. A running server refuses to start if it is unset or unwritable, and `/api/health` answers `503`. |
| `SENTRY_DSN` | Optional | Server-side error tracking. Leave unset and it stays completely inert (`/api/health` reports `"sentry": {"server": "dormant", ...}`). Set it and server errors go to Sentry (`"server": "configured"`). **Set it before the build**, because the Content-Security-Policy that lets the browser reach Sentry is baked into the build. |
| `NEXT_PUBLIC_SENTRY_DSN` | Optional | Only if you also want errors from people's browsers. Inlined at build time, and reported separately as `"sentry": {..., "browser": "configured"}`. |
| `SENTRY_TRACES_SAMPLE_RATE` | Optional | `0` by default — errors only, no tracing quota spent. |
| `SWEEP_DISABLED` | Optional | `1` switches off the hourly "due soon / overdue" notification sweep. Safe: nothing depends on the sweep having run, because overdue is always worked out fresh when a page is read. Useful as a kill switch, or on extra instances. |
| `DATABASE_URL_TEST` | No | Local and CI only. Never set it in production — the tests empty that database. |

Never paste a secret into a commit, a log or a chat. If one leaks: rotate it in Railway, redeploy,
and (for `SESSION_SECRET`) accept that everyone is signed out.

---

## 3. Deploying to Railway (the house pattern)

1. **Create the project** in Railway and connect this repository, deploying from `main`.
2. **Add a Postgres 16 database** to the same project. Railway sets `DATABASE_URL` for you — check
   the app service actually references it.
3. **Extensions:** the search migration turns on `pg_trgm` and `unaccent` itself. Only if that
   migration fails on permissions, run this once from Railway's database query console and deploy
   again: `CREATE EXTENSION IF NOT EXISTS pg_trgm; CREATE EXTENSION IF NOT EXISTS unaccent;`
4. **Add the variables** from section 2.
5. **Add a Volume** mounted at `/data`, and set `DATA_DIR=/data` (section 4). Do this *before* the
   first real upload.
6. **Set the pre-deploy command** to `npx prisma migrate deploy`. This repo uses Prisma migrations —
   never `prisma db push` here, unlike some of the other apps.
7. **Build and start**: `npm run build` and `npm start` (Railway's Next.js defaults). Railway sets
   `PORT`; Next picks it up.
8. **Point the health check** at `/api/health`. It answers `200` when the database is reachable and
   the uploads folder is writable, `503` otherwise.
9. **First deploy checks**, in order:
   - `https://<domain>/api/health` returns `{"ok":true,...}` and the `sentry` line reads what you
     expect — it names both channels separately, for example
     `"sentry":{"server":"configured","browser":"dormant"}`.
   - The same answer carries a `sweep` line about the hourly deadline sweep in that copy of the app,
     for example `"sweep":{"scheduled":true,"lastRunAt":"…","lastResult":"nothing to send"}`. It is
     information only: the sweep sends reminders, and "overdue" is worked out fresh on every screen,
     so a skipped or failed sweep never makes the app unhealthy. `lastRunAt` stays `null` for the
     first minute after a deploy, and `"skipped — another instance"` is the normal, correct answer
     on every copy but one when the app runs on several.
   - The deploy logs contain no "Project Nexus cannot start in production" line. If they do, the
     message names exactly which variable is wrong.
   - `curl -sD - -o /dev/null https://<domain>/login` shows `Content-Security-Policy`,
     `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`,
     `Permissions-Policy` and `Strict-Transport-Security`.
   - Sign in as the first administrator, then create the real people from Admin → Users.
10. **Do not run `npm run seed` against production.** It is development data. Create the first
    administrator by running the seed's user creation against an empty production database only if
    you intend to delete that account immediately afterwards.

### Security headers, and what to do if a page breaks

Every response carries a Content-Security-Policy. The app is fully self-contained — no CDN, no
external fonts, no analytics — so the policy is `'self'` almost everywhere. Two allowances are
deliberate and documented in `next.config.ts`: inline scripts (Next.js streams page data through
inline `<script>` tags and this repo has no middleware to mint a nonce) and inline styles.
`'unsafe-eval'` is added **in development only**, where the bundler needs it.

Be honest about what this buys: while inline scripts are allowed, the policy is defence in depth —
it blocks things like loading code or sending data to another domain, but it does **not** stop
cross-site scripting. Escaping and validating what users type is what stops that.

If a future change adds anything loaded from another domain (a font, a map, an embedded viewer), the
page will silently fail until that domain is added to the policy. Add it in `next.config.ts`, then
re-verify against a running production build — reading the config is not verification:

```bash
npm run build && npx next start -p 3199
curl -sD - -o /dev/null http://localhost:3199/login   # headers land
# open http://localhost:3199 in a browser and check the console for CSP errors
```

---

## 4. Uploaded files: the single-copy risk

Documents people upload live on disk under `DATA_DIR` (`/data/uploads`), not in the database.

- **Without a Railway Volume mounted at `/data`, every redeploy wipes every uploaded document.**
  The database rows would survive and point at files that no longer exist.
- **A volume is one copy.** Railway volumes are not backed up with the database. A deleted volume, a
  deleted service or a corrupted disk loses every document revision — and this app promises that
  document revisions are never lost.

**Copy-out step (do this monthly, and always before a risky deploy):**

```bash
# From your machine, with the Railway CLI linked to the project:
railway run tar -czf - -C /data uploads > nexus-uploads-$(date +%Y-%m-%d).tar.gz
```

Keep the archive somewhere that is not Railway (the owner's own encrypted drive or cloud storage).
To put files back: extract the archive into `/data` on the volume, keeping the `uploads/` folder name
and the filenames exactly as they are — the database points at those names.

Moving files to object storage (S3-style) is a bigger change and an owner decision, worth taking when
the document count makes the copy-out awkward.

---

## 5. Database backups and restore

**Turn backups on, confirm on the Railway dashboard — never assume.**

1. Open the Postgres service in Railway → **Backups** → turn on automatic daily backups and set the
   retention (14 days is a sensible starting point).
2. Take one manual backup now, so there is something to test with.

**A backup that has never been restored is not a backup.** Test it before launch, then every 90 days:

1. Create a second, scratch Postgres database in Railway (call it `nexus-restore-test`).
2. Restore the backup into the scratch database — Railway's own restore, or from a downloaded dump:
   `pg_restore --clean --if-exists -d "<scratch DATABASE_URL>" nexus-backup.dump`
3. Check the crown jewels are all there, against the scratch database:
   ```bash
   psql "<scratch DATABASE_URL>" -c 'select count(*) from "ActivityLog";'
   psql "<scratch DATABASE_URL>" -c 'select count(*) from "DocumentVersion";'
   psql "<scratch DATABASE_URL>" -c 'select count(*) from "MainTask";'
   ```
   The audit trail and document revisions matter most — they are the two things this app promises are
   never lost. Numbers should be close to production's.
4. Delete the scratch database. Write the date of the test somewhere you will find it again; a
   restore test older than 90 days counts as untested.

**Never run a restore drill against the production database.**

**If production is actually lost:** restore the latest backup into a fresh database, point
`DATABASE_URL` at it, redeploy, then restore the uploads archive (section 4) onto the volume. Check
`/api/health` and open one project, one task and one document before telling people the app is back.

---

## 6. What is deliberately not built

Named here so nobody assumes otherwise:

- **Privacy and terms pages** — gate 1 above, still to be written.
- **Self-service "download my data" / "delete my account"** — this is an internal staff tool with
  admin-created accounts; an administrator deactivates a person, and the audit trail stays by design.
  If the app ever takes non-staff users, both become required.
- **Browser-side error reporting** — off unless `NEXT_PUBLIC_SENTRY_DSN` is set at build time. Server
  errors are always logged, and go to Sentry when `SENTRY_DSN` is set. `/api/health` reports the two
  channels separately, so neither can be mistaken for the other.
- **Shared rate limiting** — limits are counted per process (`src/lib/rate-limit.ts`). Fine on one
  instance; if the app is ever scaled to several, add the Redis store behind `RateLimitStore`.
- **Email or SMS notifications** — notifications live in the app only.
