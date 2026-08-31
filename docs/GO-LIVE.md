# Tielora — going live

Everything that must be true before real companies use this app, and the steps to put it on
Railway. Written in plain English on purpose: the person running these steps is not a developer.

Keep this file true to the code. If a step here stops matching what the app does, fix it in the same
change that moved the code.

---

## 1. Launch gates — none of these are optional

| # | Gate | State today |
|---|---|---|
| 1 | **Privacy policy and terms pages written and linked** | ✅ `/privacy` and `/terms`, linked from the login page and every signed-in page footer — see below |
| 2 | Production secrets set and strong (`SESSION_SECRET` 32+, `DATABASE_URL`, `DATA_DIR`) | ✅ The app refuses to start without them |
| 3 | Security headers and a Content-Security-Policy on every response | ✅ Verified against a running production build |
| 4 | Error tracking decided: Sentry keyed, or knowingly left dormant | ✅ Dormant by default, one env var away |
| 5 | Database automatic backups turned **on** in Railway **and one restore actually tested** | ❌ Do this before launch (section 5) |
| 6 | `DATA_DIR` on a mounted volume, and a copy-out routine agreed | ❌ Do this at deploy time (section 4) |
| 7 | Health check pointed at `/api/health` | ✅ Checked into `railway.json`; confirm it in the dashboard on first setup (section 3) |
| 8 | Demo/seed accounts removed from the production database | ❌ Never run `npm run seed` against production |
| 9 | The golden-rule tests green on the deployed commit (`npm run verify`) | ✅ Part of every change |
| 10 | **Signup is open on purpose — an owner decision, not an oversight** | ⚠️ Anybody who reaches `/signup` can create their own company. That is what this product is; it is not a private tool with signups left open by mistake. It is limited to five signups an hour per address, each company is sealed off from every other (the tenant rule), and no company can be reached without signing in. If you would rather launch by invitation only, say so before launch — the change is to `/signup`, not to anything else. |

### Gate 1 — privacy and terms (written)

The app has a real privacy notice at `/privacy` and terms of use at `/terms` — plain server pages,
publicly reachable with no sign-in, following what this app *actually* stores:

- **People:** name, work email, job title, role, discipline, password (hashed with argon2 — never
  readable), whether the account is active.
- **Sessions:** a hashed session token, the IP address and browser user-agent of each sign-in, and
  when the session expires.
- **Work:** projects, tasks, comments, uploaded documents and every revision of them, plus an
  append-only audit trail of who did what and when. Audit entries and document revisions are never
  edited or deleted — the pages say so plainly, because staff have a right to know their actions are
  recorded permanently.
- **Notifications:** what each person was alerted about and whether they have read it.
- **A personal to-do list**, added in the last UI round — private to each person, no audit trail
  (documented deviation), and now covered in the data inventory above.
- **A Microsoft 365 connection**, if a company's administrator sets one up: the Microsoft work
  domain, who connected it and when, and that account's sign-in tokens, encrypted at rest and never
  shown to anybody. The privacy page has its own section explaining it, including that everybody
  browses through the one connected account.

Both pages carry an honest note that they are a template pending professional review, and are not yet
reviewed by a lawyer — do that before relying on them for real launch. Because each company runs its
own workspace, "download my data" and "delete my account" are handled by **your workspace
administrator** rather than self-service — the privacy page says so by name.

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
| `APP_BASE_URL` | Optional | The address this deployment answers on, e.g. `https://tielora.up.railway.app`, with no trailing slash. Makes the link inside a Slack or Teams message clickable, and is **required** for Microsoft 365 attachments (it is what the callback address is built from). Unset is safe for chat: messages name the page instead of linking to it. Not a secret. |
| `MS_GRAPH_CLIENT_ID` | Optional | The Application (client) ID of the Azure app registration (section 6). Not a secret, but the feature stays completely dormant until it and the secret below are both set: no card, no tab, and every Microsoft route answers "not set up". `/api/health` reports `"microsoft": {"status": "dormant", "connectedOrgs": 0}` until then. |
| `MS_GRAPH_CLIENT_SECRET` | Optional | **A real secret.** The client secret Value from the same Azure app registration, shown once when it is created. Client secrets expire — set a calendar reminder before the date you chose, because when it expires every company's attachments stop working until it is replaced. |
| `MS_GRAPH_REDIRECT_PATH` | Optional | Defaults to `/api/integrations/microsoft/callback`, which is the path to register in Azure. Only change it if something in front of the app rewrites that path. |
| `DB_POOL_MAX` | Optional | How many database connections **each copy of the app** keeps open. Defaults to `10`, which is right for one instance on Railway's Postgres. If the app is ever run on several instances, set this so `instances × DB_POOL_MAX` stays comfortably under the database's own `max_connections` (Railway's default is 100) — or point `DATABASE_URL` at the pooled connection string instead. |
| `SWEEP_DISABLED` | Optional | `1` switches off the hourly "due soon / overdue" notification sweep. Safe: nothing depends on the sweep having run, because overdue is always worked out fresh when a page is read. Useful as a kill switch, or on extra instances. |
| `DATABASE_URL_TEST` | No | Local and CI only. Never set it in production — the tests empty that database. |

Never paste a secret into a commit, a log or a chat. If one leaks: rotate it in Railway, redeploy,
and (for `SESSION_SECRET`) accept that everyone is signed out.

---

## 3. Deploying to Railway (the house pattern)

The repo carries a checked-in `railway.json` — Nixpacks build, `npm start`, the `/api/health` health
check, restart-on-failure, and the `npx prisma migrate deploy` pre-deploy command are all already
declared there, so Railway picks them up on its own instead of needing to be typed into the dashboard
by hand. `npm install` now also runs `prisma generate` itself (a `postinstall` script), which is what
lets a clean Nixpacks checkout build at all — the generated Prisma client lives in gitignored
`src/generated/` and previously only existed after someone had manually run `prisma generate` or
`npm run verify` locally.

1. **Create the project** in Railway and connect this repository, deploying from `main`.
2. **Add a Postgres 16 database** to the same project. Railway sets `DATABASE_URL` for you — check
   the app service actually references it.
3. **Extensions:** the search migration turns on `pg_trgm` and `unaccent` itself. Only if that
   migration fails on permissions, run this once from Railway's database query console and deploy
   again: `CREATE EXTENSION IF NOT EXISTS pg_trgm; CREATE EXTENSION IF NOT EXISTS unaccent;`
4. **Add the variables** from section 2.
5. **Add a Volume** mounted at `/data`, and set `DATA_DIR=/data` (section 4). Do this *before* the
   first real upload.
6. **Confirm the pre-deploy command** reads `npx prisma migrate deploy` in the Railway dashboard — it
   comes from `railway.json`, but check it landed on first setup. This repo uses Prisma migrations —
   never `prisma db push` here, unlike some of the other apps.
7. **Build and start**: Railway runs `npm run build` and `npm start` per `railway.json`. Railway sets
   `PORT`; Next picks it up.
8. **Confirm the health check** reads `/api/health` in the dashboard — also from `railway.json`. It
   answers `200` when the database is reachable and the uploads folder is writable, `503` otherwise.
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
   - The same answer's `integrations` line reads `{"slack":0,"teams":0}` on a fresh install — those
     are counts of how many companies have switched a chat channel on, and nothing else. The
     `microsoft` line reads `{"status":"dormant","connectedOrgs":0}` until the Azure app in section 6
     is registered, and `"configured"` afterwards.
   - The deploy logs contain no "Tielora cannot start in production" line. If they do, the
     message names exactly which variable is wrong.
   - `curl -sD - -o /dev/null https://<domain>/login` shows `Content-Security-Policy`,
     `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`,
     `Permissions-Policy` and `Strict-Transport-Security`.
   - Open `https://<domain>/signup` and create the first company. Signing up creates the
     organisation and the disciplines that come with the industry template you pick, and makes the
     person who signed up that company's administrator. (Phases arrive later, per project, from the
     same template.) Then add the real people from
     Admin → Users. Every company that joins later does exactly the same thing — there is no
     "create a workspace" button anywhere in the dashboard, and no account creates itself.
10. **Do not run `npm run seed` against production.** It is development data — demo people, a demo
    company and a demo project. Production gets its first company from `/signup` (step 9), which
    never needs the seed.

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
railway run tar -czf - -C /data uploads > tielora-uploads-$(date +%Y-%m-%d).tar.gz
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

1. Create a second, scratch Postgres database in Railway (call it `tielora-restore-test`).
2. Restore the backup into the scratch database — Railway's own restore, or from a downloaded dump:
   `pg_restore --clean --if-exists -d "<scratch DATABASE_URL>" tielora-backup.dump`
3. Check the crown jewels are all there, against the scratch database:
   ```bash
   psql "<scratch DATABASE_URL>" -c 'select count(*) from "ActivityLog";'
   psql "<scratch DATABASE_URL>" -c 'select count(*) from "DocumentVersion";'
   psql "<scratch DATABASE_URL>" -c 'select count(*) from "MainTask";'
   psql "<scratch DATABASE_URL>" -c 'select count(*) from "Organization";'
   ```
   The audit trail and document revisions matter most — they are the two things this app promises are
   never lost. Numbers should be close to production's. `Organization` is there because every other
   row in the database belongs to one of those companies: if that count is wrong, the restore is
   wrong no matter how healthy the rest looks.
4. Delete the scratch database. Write the date of the test somewhere you will find it again; a
   restore test older than 90 days counts as untested.

**Never run a restore drill against the production database.**

**If production is actually lost:** restore the latest backup into a fresh database, point
`DATABASE_URL` at it, redeploy, then restore the uploads archive (section 4) onto the volume. Check
`/api/health` and open one project, one task and one document before telling people the app is back.

---

## 6. Microsoft 365 attachments — registering the Azure app (owner's one-off setup)

This is what switches on "Attach from OneDrive or SharePoint" in the upload box. Until you do it,
the whole feature is invisible to everybody and nothing else in the app changes. You need a
Microsoft account that can create app registrations; it does **not** have to be a customer's.

You register the app **once**, for the whole product. Each customer company's own administrator then
presses Connect inside Tielora and signs in with their own Microsoft account — you never touch their
tenant.

1. Go to **portal.azure.com** → search **"App registrations"** → **New registration**.
2. Name it **Tielora**. Under **Supported account types**, choose **"Accounts in any organizational
   directory (Any Microsoft Entra ID tenant – Multitenant)"**. This is the setting that lets any
   customer company connect, not only your own.
3. **Redirect URI**: choose platform **Web** and enter your live callback address — your site
   address plus `/api/integrations/microsoft/callback`, for example
   `https://tielora.up.railway.app/api/integrations/microsoft/callback`. It must match `APP_BASE_URL`
   exactly, including https and no trailing slash. (You may add a `http://localhost:3000/...` one for
   development; remove it before launch if you prefer.)
4. Click **Register**. On the **Overview** page copy the **Application (client) ID** — that is
   `MS_GRAPH_CLIENT_ID`. It is not a secret.
5. Go to **Certificates & secrets** → **New client secret** → pick an expiry (24 months is a
   sensible start) → **copy the Value immediately**, it is shown once and never again. That is
   `MS_GRAPH_CLIENT_SECRET`. Put both into Railway's Variables tab, never into the repo.
   *Microsoft recommends a certificate instead of a secret for production; it is more secure but
   more work to run. A secret is fine to start with — write the expiry date in your calendar,
   because when it lapses every company's attachments stop until you replace it.*
6. Go to **API permissions** → **Add a permission** → **Microsoft Graph** → **Delegated
   permissions** → add `Files.Read.All` and `offline_access` (`openid` and `profile` are already
   there by default and are what tell us which company connected). **Do not** press "Grant admin
   consent" for your own tenant — each customer's own administrator approves for their company when
   they press Connect.
7. Redeploy so the new variables are picked up, then check `https://<domain>/api/health` reads
   `"microsoft":{"status":"configured","connectedOrgs":0}`.
8. Sign in as a company administrator, open **Admin → Integrations**, and the Microsoft 365 card is
   now there. Pressing **Connect** goes to Microsoft, comes back, and the card shows the connected
   work domain, who connected it and when.

**What each customer's administrator should know before pressing Connect:** everyone in their
company browses through the account that connects, so they should use an account whose file access
they are happy to share. Nobody can attach a file to a task they could not already upload to, and
the file itself is copied into Tielora as an ordinary revision — it stays even if the Microsoft
original is later moved or deleted.

**If a company's Microsoft administrator has locked consent down**, the sign-in comes back with
"needs admin approval". Their Microsoft administrator can approve the app for the whole company by
visiting `https://login.microsoftonline.com/organizations/v2.0/adminconsent?client_id=<your client
id>&scope=https://graph.microsoft.com/Files.Read.All%20offline_access&redirect_uri=<your callback
address>` once, after which the ordinary Connect button works.

---

## 7. What is deliberately not built

Named here so nobody assumes otherwise:

- **A legal review of the privacy and terms pages** — gate 1 above is written and linked, but it is a
  template. Have a lawyer review the actual wording before relying on it.
- **Self-service "download my data" / "delete my account"** — this is an internal staff tool with
  admin-created accounts; an administrator deactivates a person, and the audit trail stays by design.
  If the app ever takes non-staff users, both become required.
- **Browser-side error reporting** — off unless `NEXT_PUBLIC_SENTRY_DSN` is set at build time. Server
  errors are always logged, and go to Sentry when `SENTRY_DSN` is set. `/api/health` reports the two
  channels separately, so neither can be mistaken for the other.
- **Shared rate limiting** — limits are counted per process (`src/lib/rate-limit.ts`). Fine on one
  instance; if the app is ever scaled to several, add the Redis store behind `RateLimitStore`.
- **Email or SMS notifications** — notifications live in the app, with an optional copy to a Slack or
  Teams channel (Admin → Integrations). No email is ever sent.
- **A queue behind chat delivery** — a Slack or Teams message is attempted once, retried once if the
  chat tool says "too many requests", and otherwise dropped with a logged line. Delivery state lives
  in the process, not in a table, exactly like rate limiting. In-app notifications are always written
  either way, so a dropped card costs a nudge and never the record.
- **A Microsoft file picker in the browser** — the picker is ours, served by our own routes. No
  Microsoft JavaScript is loaded, which is why the strict Content-Security-Policy needed no change.
- **One Microsoft sign-in per person** — a company connects **once**, by an administrator, and
  everyone browses through that account. Per-person sign-ins would show each person exactly their
  own OneDrive; that is a bigger piece of work, and the card says plainly whose access is being
  shared. Attaching is still limited by Tielora's own permissions: you can only attach to a task you
  could already upload to.
- **Browsing SharePoint sites the connected account does not already have** — Tielora asks only for
  `Files.Read.All`, so the picker lists the libraries that account can already reach. Listing every
  site in a company would need the broader `Sites.Read.All` permission, which is deliberately not
  requested.
- **A "Connect Slack" install button** — an administrator pastes the webhook address for both tools.
  The OAuth install flow Slack now prefers needs a Slack app published from our side; that is a
  separate piece of owner setup and is on the roadmap, not in this round.
- **Hiding whether an email address already has an account** — public signup answers a duplicate
  address with "that email address already has a Tielora account", so a caller can learn that an
  address is registered somewhere on the product. That is an accepted round-one tradeoff of one
  address signing in to one company: the alternative (always claiming success) leaves a real person
  who forgot they had signed up with no way forward. It is limited to five signups an hour per IP
  address, and no company name, person or data is revealed with it. Revisit if signup ever gets an
  email-confirmation step, which would let the answer move into the inbox.
