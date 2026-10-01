# Tielora — going live

Everything that must be true before real companies use this app, and the steps to put it on
Railway. Written in plain English on purpose: the person running these steps is not a developer.

Keep this file true to the code. If a step here stops matching what the app does, fix it in the same
change that moved the code.

---

## 1. Launch gates — none of these are optional

| # | Gate | State today |
|---|---|---|
| 1 | **Privacy policy and terms pages written and linked** | ✅ `/privacy` and `/terms`, linked from the login page, the public footer on every page a visitor can reach, and every signed-in page footer — see below |
| 2 | Production secrets set and strong (`SESSION_SECRET` 32+, `DATABASE_URL`, `DATA_DIR`) | ✅ The app refuses to start without them |
| 3 | Security headers and a Content-Security-Policy on every response | ⚠️ In place and verified against a running production build — but the CSP is **nonce-less** and allows inline scripts today (`script-src 'unsafe-inline'`), so it limits where code and data can go rather than stopping cross-site scripting. Adding a per-request nonce is a later hardening, not a launch blocker; see "Security headers" in section 3 |
| 4 | Error tracking decided: Sentry keyed, or knowingly left dormant | ✅ Dormant by default, one env var away |
| 5 | Database automatic backups turned **on** in Railway **and one restore actually tested** | ❌ Do this before launch (section 5) |
| 6 | `DATA_DIR` on a mounted volume, and a copy-out routine agreed | ❌ Do this at deploy time (section 4) |
| 7 | Health check pointed at `/api/health` | ✅ Checked into `railway.json`; confirm it in the dashboard on first setup (section 3) |
| 8 | Demo/seed accounts removed from the production database | ✅ Guarded automatically: with `NODE_ENV=production` the seed refuses to run at all and prints why. The only way past it is setting `SEED_ALLOW_PROD=1` on purpose — never do that on a real database |
| 9 | The golden-rule tests green on the deployed commit (`npm run verify`) | ✅ Part of every change |
| 10 | **Sign-up is invitation-only until the paywall is live — set `SIGNUP_INVITE_CODES` before launch** | ❌ In production, `/signup` is **closed** until you set something: with `SIGNUP_INVITE_CODES` set it is **invite-only** (a new company needs one of your codes), and only `SIGNUPS_OPEN=true` opens it to everybody. Nothing set means nobody can create a company — the safe default, but not the one you want on launch day, so set the codes (section 2) and confirm `/api/health` reads `"signups":"invite"`. Joining an existing company (an administrator's invitation from Admin → Users) is a different door and is unaffected. The rest stands: five sign-ups an hour per address, ten wrong codes per fifteen minutes per address, each company sealed off from every other (the tenant rule). |

### Gate 1 — privacy and terms (written)

The app has a real privacy notice at `/privacy` and terms of use at `/terms` — plain server pages,
publicly reachable with no sign-in, following what this app *actually* stores:

- **People:** name, work email, job title, role, discipline, password (hashed with argon2 — never
  readable), whether the account is active.
- **Sessions:** a hashed session token, the IP address and browser user-agent of each sign-in, and
  when the session expires.
- **Two-factor sign-in (only for people who switch it on):** the authenticator secret, encrypted at
  rest and never readable again; when it was switched on; a marker of the last code used, which is
  what stops a code being replayed; and the eight recovery codes as SHA-256 hashes only. All of it
  goes when two-factor is switched off, reset by an administrator, or the account is deleted.
- **Work:** projects, tasks, comments, uploaded documents and every revision of them, plus an
  append-only audit trail of who did what and when. Audit entries and document revisions are never
  edited or deleted — the pages say so plainly, because staff have a right to know their actions are
  recorded permanently.
- **Notifications:** what each person was alerted about and whether they have read it.
- **A personal to-do list**, added in the last UI round — private to each person, no audit trail
  (documented deviation), and now covered in the data inventory above.
- **Emailed links**, once email is switched on: for each invitation, password reset or verification
  we store a hashed, single-use, expiring link (never the link itself), whose account it belongs to,
  when it expires and when it was used — plus whether an address has been verified, and when. The
  privacy page lists both.
- **A Microsoft 365 connection**, if a company's administrator sets one up: the Microsoft work
  domain, who connected it and when, and that account's sign-in tokens, encrypted at rest and never
  shown to anybody. The privacy page has its own section explaining it, including that everybody
  browses through the one connected account.
- **A Microsoft sign-in link**, for each person who uses "Sign in with Microsoft": the permanent
  identifier Microsoft gives their work account and the identifier of their company's Microsoft
  directory — kept so we recognise them next time. The person's own identifiers are never in an
  audit row or a log line, never in either export (the personal copy says only "yes, signed in
  with Microsoft"), and cleared when the account is deleted or the company switches the feature
  off. And, for each company that switches it on, that company's Microsoft directory identifier —
  company configuration, not personal data — which IS recorded (with the domain) in the
  `MICROSOFT_SIGNIN_ENABLED` audit row and appears in the company's own workspace export. No
  Microsoft token is stored for sign-in.
- **Email choices**: each person's three yes/no choices — alert emails, the daily brief, the weekly
  summary — and **the date their last daily brief email was attempted**. Every existing person
  starts with all three off; a new account starts with alerts on and both briefs off. No email
  content, subject or copy of any email is stored.

Both pages carry an honest note that they are a template pending professional review, and are not yet
reviewed by a lawyer — do that before relying on them for real launch. **Data rights are now
self-service, both halves.** Anybody signed in downloads their own copy and can delete their own
account from Your account; an administrator downloads the whole workspace's copy and can delete the
whole workspace from Admin → Data & privacy. See section 7 below and the two "Data rights" sections
of `docs/CONVENTIONS.md`. Both pages say what deleting really does — an account is anonymised and
its work stays; a workspace is gone for good after seven days.

**Rule that outlives this file:** if a change starts storing a new piece of personal information, the
privacy page changes in the *same* change.

---

## 2. Secrets checklist

Set these in the Railway service's Variables tab — never in the repo, never in a commit.

| Variable | Required | Notes |
|---|---|---|
| `SESSION_SECRET` | **Yes** | 32 characters minimum. Generate with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`. **Needed at build time as well as at run time** — the build renders pages, which loads the session code, so a build with no secret fails. Changing it signs everyone out — that is the intended emergency action if it ever leaks. **Rotating it also silently switches off everyone's two-factor sign-in**, because the authenticator secrets are encrypted under a key derived from it: each person is told in the app the next time they sign in and re-enrols from Your account in about a minute, and nobody is ever locked out by it. The same rotation makes every company reconnect Microsoft 365. |
| `DATABASE_URL` | **Yes** | Railway's Postgres connection string. Use the pooled one if the app is ever run on more than one instance. |
| `DATA_DIR` | **Yes** | `/data` — must match the mounted volume (section 4). **Run time only:** it is not checked during the build, because no volume is mounted then. A running server refuses to start if it is unset or unwritable, and `/api/health` answers `503`. |
| `SENTRY_DSN` | Optional | Server-side error tracking. Leave unset and it stays completely inert (`/api/health` reports `"sentry": {"server": "dormant", ...}`). Set it and server errors go to Sentry (`"server": "configured"`). **Set it before the build**, because the Content-Security-Policy that lets the browser reach Sentry is baked into the build. |
| `NEXT_PUBLIC_SENTRY_DSN` | Optional | Only if you also want errors from people's browsers. Inlined at build time, and reported separately as `"sentry": {..., "browser": "configured"}`. |
| `SENTRY_TRACES_SAMPLE_RATE` | Optional | `0` by default — errors only, no tracing quota spent. |
| `APP_BASE_URL` | Optional | The address this deployment answers on, e.g. `https://tielora.up.railway.app`, with no trailing slash. Makes the link inside a Slack or Teams message clickable, and is **required** for Microsoft 365 attachments (it is what the callback address is built from) **and for email** (an invitation or reset email is nothing but a link, and every alert and daily brief email carries its "open it" link and its one-click **unsubscribe links**, which are built from this address — so with this unset no email is sent at all, whatever the two variables below say). It is also what the "Sign in with Microsoft" return address is built from. Unset is safe for chat: messages name the page instead of linking to it. **It is also the address the public pages publish**: `/robots.txt`, `/sitemap.xml` and the social preview (`og:image`) are all built from it, and both of the first two read it fresh on every request. Unset, they answer with `http://localhost:3000`, which is harmless locally and wrong on a real domain — so set it before you hand the address to anybody, and set it **before the build** as well, since the prerendered pages resolve their preview image at build time. Not a secret. |
| `RESEND_API_KEY` | Optional | **A real secret.** The API key from resend.com. It carries the three account emails (invitation, password reset, verification) **and, person by person, the alert and daily brief emails** people choose on Your account. Leave it unset and no email is ever sent: the forgot-password page tells people to ask their workspace administrator, the "email them an invite link" option is absent from Admin → Users, the Email card is absent from Your account, and `/api/health` reports `"email":"dormant"`. Nothing else in the app changes. |
| `EMAIL_FROM` | Optional | The address emails come from, e.g. `Tielora <no-reply@mail.yourdomain>`. Must be on a domain you have **verified in Resend with SPF, DKIM and DMARC all set up** (Resend gives you the SPF and DKIM records; DMARC you add by hand — start at `p=none`, move to `p=quarantine` after two clean weeks). Now that alerts and briefs go out too, Outlook and Microsoft 365 weigh all three, so treat them as required. **Send from a `mail.` subdomain** (for example `mail.yourdomain`) so brief and alert traffic can never hurt the reputation of your main domain. Not a secret, but email stays dormant until it and the key are **both** set. |
| `MS_GRAPH_CLIENT_ID` | Optional | The Application (client) ID of the Azure app registration (section 6). It powers **both** Microsoft features: OneDrive/SharePoint attachments and **Sign in with Microsoft**. Not a secret, but both stay completely dormant until it and the secret below are both set: no card, no tab, **no button on the login page**, and every Microsoft route answers "not set up". Even once set, **no company sees Sign in with Microsoft work until its own administrator switches it on** in Admin → Integrations. `/api/health` reports `"microsoft": {"status": "dormant", "connectedOrgs": 0, "signInOrgs": 0}` until then; `signInOrgs` is how many companies have switched sign-in on. |
| `MS_GRAPH_CLIENT_SECRET` | Optional | **A real secret.** The client secret Value from the same Azure app registration, shown once when it is created. Client secrets expire — set a calendar reminder before the date you chose, because when it expires every company's attachments **and every Microsoft sign-in** stop working until it is replaced (passwords keep working throughout). |
| `MS_GRAPH_REDIRECT_PATH` | Optional | Defaults to `/api/integrations/microsoft/callback`, which is the path to register in Azure. Only change it if something in front of the app rewrites that path. |
| `TEAMS_APP_ID` | Optional | A GUID you generate **once** (any GUID — for example run `uuidgen` in Terminal, or use a GUID generator website). It names the Tielora app inside Teams; it is **not a secret**. The Teams app is **dormant** until it is set **and** `APP_BASE_URL` is an https address **and** the Azure app above is registered: no "Microsoft Teams app" card in Admin → Integrations, the download and the `/teams/tab` page say "not found", and `/api/health` reads `"teams_app":"dormant"`. See section 6b. |
| `TEAMS_SSO_AUDIENCE` | Optional | Leave unset. The Teams sign-in token is accepted only if its audience is exactly the Azure app's client ID (what a version-2 token carries). If a real token from your Microsoft 365 test company shows a different audience — the `api://<host>/<client id>` address — put **that one value** here. Never both. See section 6b. |
| `PADDLE_API_KEY` | Optional | **A real secret.** The server-side API key from the Paddle dashboard (section 8). Sandbox and live have separate keys and one does not work against the other's host. Leave it unset and payments stay completely dormant: no buttons on Admin → Billing, both billing actions refuse plainly, `/api/billing/webhook` answers "not set up", and `/api/health` reports `"billing": "dormant"`. Plans and limits carry on working exactly as they do today. |
| `PADDLE_WEBHOOK_SECRET` | Optional | **A real secret.** The notification destination's own secret (`pdl_ntfset_…`), copied from Dashboard → Developer tools → Notifications → your destination. It is what proves a webhook really came from Paddle; without it nothing is trusted and the webhook answers 503. Each destination has its own — the sandbox one and the live one are different. |
| `PADDLE_PRICE_ID_PRO` | Optional | The price id (`pri_…`) of the Pro subscription price. Not a secret. Sandbox and live have different ids. |
| `PADDLE_ENV` | Optional | `sandbox` (the default, and what anything unrecognised reads as) or `live`. It chooses `sandbox-api.paddle.com` or `api.paddle.com`. Sandbox is deliberately the default: a sandbox key cannot charge anybody. |
| `SIGNUP_INVITE_CODES` | **Yes, before launch** | **Treat as a secret.** Comma-separated invite codes, each 8+ characters (shorter ones are ignored), e.g. two codes made with `node -e "console.log(require('crypto').randomBytes(12).toString('base64url'))"`. While this is set and `SIGNUPS_OPEN` is not `true`, creating a new company at `/signup` needs one of these codes; hand a code to each company you invite. **Rotate by editing the list** — remove a code and it stops working at the next request, no redeploy of code needed (Railway restarts the service when a variable changes). The codes never appear in a log, a response or `/api/health`, which reports only `"signups":"invite"`. Leave it unset in production and sign-up is **closed** — nobody can create a company. |
| `SIGNUPS_OPEN` | Optional | Exactly `true` opens `/signup` to everybody, with or without codes — the state for once the paywall is live. Anything else (including unset) means the codes decide. Not a secret. |
| `PRIVACY_CONTACT_EMAIL` | Optional | The operator's contact address, printed on `/privacy` and `/terms` as "Contact the operator" (a mailto link) beside the existing "your workspace administrator" wording. Leave it unset and the pages show the owner's own address, `naeljam@hotmail.com`. Set it if you would rather a shared or business inbox answered privacy questions. Not a secret — it is on a public page. |
| `DB_POOL_MAX` | Optional | How many database connections **each copy of the app** keeps open. Defaults to `10`, which is right for one instance on Railway's Postgres. If the app is ever run on several instances, set this so `instances × DB_POOL_MAX` stays comfortably under the database's own `max_connections` (Railway's default is 100) — or point `DATABASE_URL` at the pooled connection string instead. |
| `TRUST_PROXY` | **Yes, on Railway** | Set it to `1`. Railway sits in front of the app and appends the real visitor address to `X-Forwarded-For`; with this on, the rate limiter keys on the **last** address in that header — the one Railway added — so nobody can dodge a sign-in or signup limit by forging the front of it. Leave it unset anywhere the app faces the internet directly, and the header is ignored. Not a secret. |
| `SWEEP_DISABLED` | Optional | `1` switches off the hourly "due soon / overdue" notification sweep. Safe: nothing depends on the sweep having run, because overdue is always worked out fresh when a page is read. Useful as a kill switch, or on extra instances. |
| `DATABASE_URL_TEST` | No | Local and CI only. Never set it in production — the tests empty that database. |

Never paste a secret into a commit, a log or a chat. If one leaks: rotate it in Railway, redeploy,
and (for `SESSION_SECRET`) accept four knock-on effects, all of them intended: everyone is signed
out, every company has to reconnect Microsoft 365, **everyone who had two-factor sign-in on has
it switched off** — each person is notified in the app and sets it up again in a minute, which is far
better than a workspace full of people locked out by a secret they never saw — and **the unsubscribe
links in emails already sitting in people's inboxes stop working**: they are signed with a key made
from this secret. The page they open still points to Your account, where anybody can switch their
emails off, and every new email carries a fresh working link. **Sign in with Microsoft itself is
not affected** — no Microsoft token is stored for it, only who each person is, so it carries on
exactly as before (somebody half-way through a Microsoft sign-in at that exact moment just presses
the button again, and a person with two-factor on re-enrols, as above).

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
     `microsoft` line reads `{"status":"dormant","connectedOrgs":0,"signInOrgs":0}` until the Azure app in section 6
     is registered, and `"configured"` afterwards.
   - The same answer's `signups` line reads `"invite"` once `SIGNUP_INVITE_CODES` is set, `"open"`
     only with `SIGNUPS_OPEN=true`, and `"closed"` with neither — in which case nobody can create a
     company and `/signup` says "Sign-up is closed for now." Then open `/signup` in a private window
     and confirm the **Invite code** field is there, that a wrong code is refused with "Sign-up is by
     invitation. Enter a valid invite code.", and that one of your real codes creates a workspace.
   - The same answer's `email` line reads `"dormant"` until `RESEND_API_KEY`, `EMAIL_FROM` **and**
     `APP_BASE_URL` are all set, and `"configured"` once they are. Dormant is a supported way to
     run: no invitation, password-reset or verification email is sent, and administrators set
     people's first passwords by hand exactly as they do today. If you set the two mail variables
     and it still reads `"dormant"`, `APP_BASE_URL` is the missing one — the deploy log says so in
     one line.
   - **When that line reads `"configured"`, check the forgot-password journey end to end**, because
     it is the one part of the app nobody signed in can test for you: open
     `https://<domain>/forgot-password`, enter the address of a real account, and confirm you get
     the "Check your email" panel, that the email arrives with a link back to your own domain, that
     the link opens "Choose a new password", and that the new password signs you in while any other
     browser you had open is signed out. Then enter an address that has **no** account and confirm
     the screen says exactly the same thing — that identical answer is the whole point of the page.
     While the line reads `"dormant"` the page says resets by email are not available and asks
     people to contact their administrator, which is a supported way to run.
   - **When email is `"configured"`, send yourself an alert and a daily brief** and look at them in
     Outlook (or any Microsoft 365 mailbox). On Your account, confirm your address if the Email card
     asks you to, and switch **Alerts** and **Daily brief** on. Have a colleague assign you a task:
     one email arrives with the same headline and sentence as the in-app notification and a link
     back to your own domain. The next morning after 05:00 UTC, your "Your day" email arrives (none
     on a day with nothing in it). **Check Outlook shows its own "Unsubscribe" button** at the top of
     both — that is the one-click header working — and that pressing it switches that one kind of
     email off with no sign-in, which Your account then shows. Also check an invitation or
     password-reset email has **no** unsubscribe link. If the emails land in junk, the sending
     domain's SPF, DKIM or DMARC is the first thing to check (section 2, `EMAIL_FROM`).
   - **Sign in with Microsoft**, once section 6 is done. Before the two `MS_GRAPH_*` variables are
     set, the login page must look exactly as it always has — **no Microsoft button at all**. Once
     they are set and you have redeployed, the login page shows "Sign in with Microsoft" under the
     password form, and `/api/health`'s `microsoft` line carries `"signInOrgs":0`. Then, as the
     administrator of a **test company**, open Admin → Integrations → Microsoft 365 → Sign in with
     Microsoft → **Switch on**, sign in to Microsoft with the account whose email matches your
     Tielora email, and confirm the card says it is on and `signInOrgs` reads `1`. Sign out and use
     the button: you should land on your home page. Finally, try it with a Microsoft account that has
     **no** Tielora account in that company (or from another company's Microsoft): you must see
     exactly **"Incorrect email or password."** — the same words as a wrong password, and nothing
     that hints at why.
   - The deploy logs contain no "Tielora cannot start in production" line. If they do, the
     message names exactly which variable is wrong.
   - `curl -sD - -o /dev/null https://<domain>/login` shows `Content-Security-Policy`,
     `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`,
     `Permissions-Policy` and `Strict-Transport-Security`.
   - **Open `https://<domain>/` while signed out.** You should get the landing page — headline,
     the five feature sections, the honesty band and the pricing teaser — with a working nav to
     `/pricing`, `/privacy`, `/terms`, `/login` and `/signup`. Signed in, the same address still
     takes you straight to your own home page, exactly as it always did. Check `/robots.txt` and
     `/sitemap.xml` answer, and that the sitemap names those six addresses and nothing else.
   - **Drop the two images in when they are ready — they are optional.**
     `public/landing-hero.webp` (the hero photograph) and `public/og.png` (1200×630, the social
     preview) are not in the repository. Without them the hero renders as the brand's ink gradient
     with the words still white and readable, and a link shared on social shows no preview
     thumbnail: nothing is broken, no image icon is ever shown, and **nothing is even requested** —
     the hero asks the file system before it draws, so a visitor's console stays clean. Add either
     file to `public/` and redeploy — there is no code change and no setting.
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

Every response carries a Content-Security-Policy. It is **nonce-less** — it allows inline scripts today, and a per-request nonce is a later hardening. The app is fully self-contained — no CDN, no
external fonts, no analytics — so the policy is `'self'` almost everywhere. Two allowances are
deliberate and documented in `next.config.ts`: inline scripts (Next.js streams page data through
inline `<script>` tags and this repo has no middleware to mint a nonce) and inline styles.
`'unsafe-eval'` is added **in development only**, where the bundler needs it.

**One page is deliberately framable: `/teams/tab`** (the Tielora tab inside Microsoft Teams). It alone
answers with `frame-ancestors 'self'` plus an explicit list of Microsoft Teams hosts and **no**
`X-Frame-Options`; every other page and every API route stays `frame-ancestors 'none'` with
`X-Frame-Options: DENY`. A test (`security-headers.test.ts`) walks every route and fails if a second
one ever gains a frame permission. The Microsoft hosts in the list are a working starting list;
confirm them in a real Teams window (see section 6b).

Be honest about what this buys: while inline scripts are allowed, the policy is defence in depth —
it blocks things like loading code or sending data to another domain, but it does **not** stop
cross-site scripting. Escaping and validating what users type is what stops that.

If a future change adds anything loaded from another domain (a font, a map, an embedded viewer), the
page will silently fail until that domain is added to the policy. Add it in `next.config.ts`, then
re-verify against a running production build — reading the config is not verification:

```bash
npm run build && npx next start -p 3199
curl -sD - -o /dev/null http://localhost:3199/login   # headers land: X-Frame-Options: DENY and frame-ancestors 'none'
curl -sD - -o /dev/null http://localhost:3199/teams/tab   # the Teams list in frame-ancestors, and NO X-Frame-Options line
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

## 6. Microsoft 365 attachments and Sign in with Microsoft — registering the Azure app (owner's one-off setup)

This one registration switches on **two** things: "Attach from OneDrive or SharePoint" in the upload
box, and the "Sign in with Microsoft" button on the login page. Until you do it, both are invisible
to everybody — the login page looks exactly as it does today — and nothing else in the app changes.
You need a Microsoft account that can create app registrations; it does **not** have to be a
customer's. There is no second registration and no second secret for sign-in.

You register the app **once**, for the whole product. Each customer company's own administrator then
presses Connect (files) and/or Switch on (sign-in) inside Tielora and signs in with their own
Microsoft account — you never touch their tenant. The two work independently: a company can have
either, both or neither.

1. Go to **portal.azure.com** → search **"App registrations"** → **New registration**.
2. Name it **Tielora**. Under **Supported account types**, choose **"Accounts in any organizational
   directory (Any Microsoft Entra ID tenant – Multitenant)"**. This is the setting that lets any
   customer company connect, not only your own.
3. **Redirect URI**: choose platform **Web** and enter your live callback address — your site
   address plus `/api/integrations/microsoft/callback`, for example
   `https://tielora.up.railway.app/api/integrations/microsoft/callback`. It must match `APP_BASE_URL`
   exactly, including https and no trailing slash. (You may add a `http://localhost:3000/...` one for
   development; remove it before launch if you prefer.)
   **Then add a second Web redirect for sign-in** (Authentication → Add URI):
   `<APP_BASE_URL>/api/auth/microsoft/callback`, for example
   `https://tielora.up.railway.app/api/auth/microsoft/callback` (plus
   `http://localhost:3000/api/auth/microsoft/callback` if you test on your Mac). Both addresses
   stay — the first is for files, the second for signing in.
4. Click **Register**. On the **Overview** page copy the **Application (client) ID** — that is
   `MS_GRAPH_CLIENT_ID`. It is not a secret.
5. Go to **Certificates & secrets** → **New client secret** → pick an expiry (24 months is a
   sensible start) → **copy the Value immediately**, it is shown once and never again. That is
   `MS_GRAPH_CLIENT_SECRET`. Put both into Railway's Variables tab, never into the repo.
   *Microsoft recommends a certificate instead of a secret for production; it is more secure but
   more work to run. A secret is fine to start with — write the expiry date in your calendar,
   because when it lapses every company's attachments and every Microsoft sign-in stop until you
   replace it. Passwords keep working throughout.*
6. Go to **API permissions** → **Add a permission** → **Microsoft Graph** → **Delegated
   permissions** → add `Files.Read.All` and `offline_access` for files, and make sure **`openid`,
   `profile` and `email`** are all listed — those three are **the only permissions sign-in ever
   asks for** (who you are, and nothing else: sign-in never asks for your files or keeps any
   Microsoft token). `openid` and `profile` are usually there by default; add `email` if it is
   not. **Do not** press "Grant admin consent" for your own tenant — each customer's own
   administrator approves for their company when they press Connect or Switch on.
7. **Token configuration → Add optional claim → ID token → tick `email` and `xms_edov`** → accept
   the prompt. Sign-in needs both: `email` finds a person the very first time they use the button,
   and `xms_edov` is Microsoft saying that email's domain really belongs to their company. Without
   them, nobody who has not already been linked can get in with Microsoft (they see the ordinary
   "Incorrect email or password." sentence), and no administrator can switch sign-in on.
8. Redeploy so the new variables are picked up, then check `https://<domain>/api/health` reads
   `"microsoft":{"status":"configured","connectedOrgs":0,"signInOrgs":0}`, and that the login page
   now shows "Sign in with Microsoft".
9. Sign in as a company administrator, open **Admin → Integrations**, and the Microsoft 365 card is
   now first in the list, in two parts. **"OneDrive and SharePoint files"**: pressing **Connect**
   goes to Microsoft, comes back, and the card shows the connected work domain, who connected it
   and when. **"Sign in with Microsoft"**: pressing **Switch on** sends the administrator to sign in
   to Microsoft **as themselves**, with the Microsoft account whose email is the same as their
   Tielora email; the company's Microsoft directory is captured from that sign-in (nobody ever
   types an id), and the card then shows it is on, who switched it on, and how many people have
   used it. **Switch off** removes every person's Microsoft link in that company and signs nobody
   out — people simply use their password again.

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

**For sign-in, the same lock shows the same "needs admin approval" page** — at Microsoft, before
Tielora is involved, both for the administrator pressing Switch on and for their people pressing
the login button. The sign-in approval asks for less, so it is a different link, with **scope
`openid profile email`**: send their Microsoft administrator
`https://login.microsoftonline.com/organizations/v2.0/adminconsent?client_id=<your client
id>&scope=openid%20profile%20email&redirect_uri=<APP_BASE_URL>/api/auth/microsoft/callback` once,
after which Switch on and the login button both work for that company. A company that uses both
features needs both approvals.

---

## 6b. Teams app — publishing (owner's one-off setup, after section 6)

The Tielora app for Microsoft Teams is one small package with one **personal tab, "Your day"**:
the same brief as Tielora's own Your day page, read-only, inside Teams. Every row opens Tielora in
the person's browser. Channel notifications (the Teams webhook card) are separate and unchanged.
Until you do the steps below **nothing exists**: no card, no package, no tab page.

**What you need first:** section 6 done (the Azure app registered, `APP_BASE_URL` set to an **https**
address) and at least one company with **Sign in with Microsoft switched on** (the tab identifies
people by their Microsoft company and personal id, exactly like that sign-in — it never matches on
email).

1. **Make the app's ID.** Generate a GUID once and put it in Railway as **`TEAMS_APP_ID`**. It is
   not a secret, but keep it the same forever: changing it makes Teams treat it as a different app.
2. **In the existing Azure registration → Expose an API.**
   - Set the **Application ID URI** to `api://<your host>/<client id>` — for example
     `api://tielora.up.railway.app/0b7c9a52-…` (the host is `APP_BASE_URL` without `https://`).
   - **Add a scope** named **`access_as_user`** ("Admins and users" can consent).
   - Under **Authorized client applications**, add these two Microsoft Teams clients and tick the
     `access_as_user` scope for each: **`1fec8e78-bce4-4aaf-ab1b-5451cc387264`** (Teams desktop and
     mobile) and **`5e3ce6c0-2b1f-4285-8d4b-75ee78787346`** (Teams web). *Re-check both ids on
     Microsoft Learn ("Update manifest to enable SSO for tabs") — they are Microsoft's to change.*
3. **The registration must issue version-2 tokens.** In the registration's **Manifest**, set
   `"accessTokenAcceptedVersion": 2` and save. (Tielora refuses a token that is not version 2.)
4. **Redirect address for the popup.** The sign-in window reuses the sign-in address you already
   registered in section 6 (`<APP_BASE_URL>/api/auth/microsoft/callback`) — nothing new to add. If
   you test on a preview address (next item), add that address's callback as another Web redirect.
5. **Redeploy**, then open `https://<domain>/api/health` while signed in: it must read
   **`"teams_app":"configured"`**. If it reads `"dormant"`, one of `TEAMS_APP_ID`, https
   `APP_BASE_URL`, `MS_GRAPH_CLIENT_ID` or `MS_GRAPH_CLIENT_SECRET` is missing.
6. **Download the package.** As a company administrator, open **Admin → Integrations → Microsoft
   Teams app → Download Tielora for Teams**. You get `tielora-teams-app.zip` with exactly three files
   (a manifest and two small pictures). It is the same for every company and holds no secret. (An
   administrator whose company has not switched on Sign in with Microsoft sees a notice on the card;
   the download still works.)
7. **Check the package before anybody else sees it.** In **dev.teams.microsoft.com → Apps → Import
   app**, pick the zip: the validation screen must say no errors. *Compare day: the manifest uses
   schema version 1.17 (still accepted); if the portal asks for a newer one, change the constant in
   `src/lib/teams-manifest.ts` and bump `TEAMS_APP_VERSION`.*

**Testing.** You need a **Microsoft 365 work or school tenant** — the free **Microsoft 365 Developer
Program** sandbox is ideal (Teams, test users, and custom app upload switched on). A personal
Outlook or Hotmail account cannot work. **Teams will not load `http://localhost`**: test through a
public **https** address (`/phone-preview`, or the Railway preview) and set `APP_BASE_URL` to it
for the test. Upload the zip in Teams (Apps → Manage your apps → Upload an app → **Upload a custom
app**); a Tielora icon appears with a **Your day** tab. Try it on desktop, in the Teams web
browser, and on a phone: each shows the day, or shows "Open Tielora in your browser" — never a
blank screen. A second sandbox tenant with no Tielora company must see the sign-in state and the
same one failure sentence, never anybody's data.

**How people get it.**
- *Pilots (sideload):* each person (or you) uploads the zip as a custom app. Needs custom-app upload
  switched on in that company's Teams.
- *A whole company:* that company's Teams administrator opens the **Teams admin centre → Teams apps
  → Manage apps → Upload new app**, picks the zip, and optionally adds it to a setup policy so it
  appears pinned for everyone. The first time, a person may see a Microsoft approval screen; if it
  says **"needs admin approval"**, their Microsoft administrator approves it once with the link in
  section 6 (scope `openid profile email` **plus** `api://<host>/<client id>/access_as_user`).
- *The Teams Store:* later — weeks of Microsoft review, and it needs the privacy, terms and
  support pages checked. Not part of this round.

**If you change the web address** (for example moving from the Railway address to a custom domain)
the Application ID URI, the redirect addresses **and the Teams package** all contain it: update the
Azure Application ID URI and redirects, set the new `APP_BASE_URL`, bump `TEAMS_APP_VERSION` in
`src/lib/teams-manifest.ts`, download a fresh zip, and re-upload it everywhere it was installed.
Until then the old tab points at the old address.

**If the tab shows blank in Teams:**
1. `https://<domain>/api/health` (signed in) must say `"teams_app":"configured"`.
2. `curl -sD - -o /dev/null https://<domain>/teams/tab` must show a `frame-ancestors` line naming the
   Teams hosts and **no** `X-Frame-Options`. A `DENY` there means Teams cannot show it.
3. In the browser's console inside the Teams web app, a line starting "Refused to frame…" names the
   host Teams loaded it from. *Compare day:* add that host to the list in `next.config.ts`
   (`TEAMS_FRAME_ANCESTORS`) — **never** a bare `*` — and re-run the security-headers test.
4. If the tab says "Your browser is blocking Tielora inside Teams", that browser (often Safari or
   Teams on an iPhone) refuses the tab's sign-in cookie. That is the intended fallback: the button
   opens Tielora in the browser. (A memory-only fallback is deliberately not built.)

**Compare-day checks (need your Microsoft tenant, cannot be proved from code):** the manifest passes
the Developer Portal; the real token's audience matches (`TEAMS_SSO_AUDIENCE` if not); the exact
frame-ancestors host list is enough for Teams desktop, web and mobile; the signing in popup closes
and fills the tab; two-factor is still asked.

---

## 7. Deleting an account, and deleting a workspace

Both live on the two data-rights screens, beside the exports, in a red-tinted danger section.

**Deleting your own account** (Your account → Delete my account; any signed-in person, contractors
included). It is **anonymisation, not removal**: the person is signed out on the spot and can never
sign in again, their name becomes "Former member" and their email address becomes a tombstone that
is not an address, their job title, employer, department and access end date are cleared, their
password is replaced with one nothing can match, and every session, one-time link, starred shortcut,
private to-do item, dismissal and notification of theirs is deleted. **Their work stays** —
comments, completed tasks, uploaded document revisions, acknowledgements and the audit trail — and
every screen shows "Former member" against it, because names are read live off the account rather
than copied onto the work. **The one exception, said plainly on every screen that mentions it**:
entries already recorded in the activity trail keep the name they were written with, because that
trail is a record of what happened and is never rewritten. One `ACCOUNT_DELETED` audit row is
written and it deliberately does not name them. **The one refusal**: an administrator who is the
last one who can sign in is told to make somebody else an administrator first, so no company can be
locked out of its own Admin section — and that count is taken behind a lock on the company's own
row, so two of a company's last two administrators pressing at the same moment cannot both get
through.

**Deleting the whole workspace** (Admin → Data & privacy → Danger zone; an administrator types the
workspace's name).

- **Seven days' grace.** The request is recorded with who asked and when; every administrator is
  notified in the app and sees a red, non-dismissible banner on every page until it is resolved.
  **Any** administrator can cancel with one press, and cancelling asks for no confirmation.
- **Nothing is locked during those seven days.** The workspace works exactly as before. That is
  deliberate: everybody who could stop it has been told, and a week of half-working software would
  punish the people who had no say.
- **Then it is permanent.** The hourly sweep deletes every row that company owns — accounts,
  projects, tasks, documents and every revision, comments, the noticeboard, notifications, chat and
  Microsoft connections **and the workspace's whole activity log** — and then every uploaded file
  and every export archive on disk. There is no undo, no archive, no soft delete.
- **The copy-out reminder.** "Download everything" is on the same screen, one press, and it is the
  only way to keep anything. The danger card, the privacy page and the terms page all say so. Once
  the seven days pass there is nothing left to export.
- The append-only promise is unchanged in meaning: no revision or audit row is ever altered or lost
  **inside a living workspace**. Deleting the workspace is that workspace ending, and its history
  ends with it. `mutation-safety.test.ts` allows exactly one file to remove those rows and still
  forbids updating them anywhere.

---

## 8. Billing — plans and limits

**All built, and switched off until you set four variables.** The plan model and the limits are in
and working; taking a payment is built on top of them and is completely dormant until the keys are
set — see "Switching payments on" below.

**What is live now**

- Every company is on **FREE** until something changes it, and FREE is what an unrecognised plan
  value reads as, so nothing can accidentally hand a company more than it paid for.
- The three limits — **projects, people, storage** — are enforced server-side at three points only:
  creating a project, adding a person (a first password or an emailed invitation alike) and any
  upload (the browser's and Microsoft 365's both). Everything else is untouched.
- **Nothing already there is ever blocked.** A company over a limit reads, opens, downloads and
  works exactly as before; only adding more is refused, in plain English, with an administrator
  pointed at Admin → Billing and everybody else told to ask their administrator.
- **Admin → Billing** shows the plan, what it includes, and three live usage meters. Over a limit,
  that one meter turns amber and says so — it is the only place in the app that mentions it.
- **Until the provider's keys are set, the page draws no buttons at all** and says upgrading is not
  turned on yet. With them set, a Free company gets "Upgrade to Pro" and a Pro company gets
  "Manage billing", and nothing else on the screen changes.

**Before launch — the owner's decisions, still open**

- [ ] **The real numbers.** The FREE limits (1 project, 10 people, 500 MB) and the PRO storage cap
      (10 GB) are placeholders in `src/lib/plan-limits.ts`. Setting the real ones is an edit to that
      one file — no migration, no re-wording, no test rewrite.
- [x] **The real price — DONE, 1 September 2026.** Pro is **USD $249/month**: `PRO_PRICE` in
      `src/lib/plan-limits.ts`, beside the limits. It is shown in three places — Admin → Billing,
      the public `/pricing` page and the landing page's teaser — and all three read that one
      constant, so the change was that one line. The Billing screen's asterisk and "placeholder
      price" footnote have been removed with it.
- [ ] Whether Pro ever gets an annual option (out of scope so far). The public pricing page exists:
      `/pricing`, built from `PLANS` and `PRO_PRICE`.

**Taking the money is built, and it is switched off**

The payment provider is **Paddle**, and it is completely dormant until you set four variables
(section 2). Until then the Billing page draws no buttons at all, both billing actions refuse in
plain English, `/api/billing/webhook` answers "not set up", and `/api/health` reports
`"billing": "dormant"`. Nothing about plans, limits or any existing company changes in the meantime.

Everything the app knows about Paddle is in ONE file, `src/server/services/paddle.ts`. That is what
makes the fallback at the end of this section a small job rather than a rebuild.

**Why Paddle:** it is the **merchant of record**. That means Paddle, not you, is the legal seller to
each customer worldwide: it works out and charges the right VAT / GST / sales tax for the buyer's
country, issues the compliant invoice, handles the currency conversion and card rules, and pays you
the net amount. You do not register for VAT in every buyer's country. **It does not remove your own
Omani tax obligations on the money you receive** — talk to a local accountant about how Paddle
payouts should be treated in your own filings.

### Switching payments on (your one-off setup)

1. **Open a Paddle account** at paddle.com and choose **Oman** as your country.
   **⚠️ VERIFY AT ACTIVATION — caveat 1 of 3.** Paddle publishes a list of *unsupported* seller
   countries rather than an allow-list, and Oman is not on it, so a sole proprietor in Oman should
   be able to sell. That was read from search results rather than from Paddle's own page, so
   **confirm it before spending any more time**: start the signup, pick Oman, and see whether it
   goes through. If it is refused, jump to the Lemon Squeezy fallback below.
   - As a sole trader you go through **identity verification** (a personal ID check, usually a few
     minutes; a manual review takes 2–4 working days), not the business check a registered company
     gets.
   - Separately, **domain review**: your site must be live, on HTTPS, and show Terms, a Privacy
     policy and a Refund policy before Paddle approves it for live checkout. Tielora has `/terms`
     and `/privacy` already — **a refund policy is the one thing you may still need to write**
     (gate 1 above). Most submissions auto-approve; a manual review takes 5–7 working days.
2. **Work in the sandbox first.** Paddle's sandbox is a completely separate account with its own
   dashboard, its own keys and its own product and price ids. Nothing there is a real charge.
3. **Create the product and the price.** Dashboard → Catalog → Products → a "Tielora Pro" product,
   then a recurring monthly price on it. Copy the price id (`pri_…`) — that is
   `PADDLE_PRICE_ID_PRO`. **Make Paddle's price match the app's**: the Billing page shows
   `USD $249/month` (`PRO_PRICE`, see the checklist above), so the recurring monthly price you
   create here must be the same number.
4. **Create the API key.** Dashboard → Developer tools → Authentication → new API key. That is
   `PADDLE_API_KEY`. It is a real secret and is shown once.
5. **Register the webhook.** Dashboard → Developer tools → Notifications → new destination, pointed
   at `https://<your domain>/api/billing/webhook`. Subscribe it to `subscription.activated`,
   `subscription.created`, `subscription.updated`, `subscription.canceled`, `subscription.expired`,
   `subscription.paused`, `transaction.completed` and `transaction.payment_failed`. **Subscribe to
   all of them** — the app acts on each one, and `subscription.expired` in particular is how a
   subscription that simply lapsed drops the company back to Free. Leaving it off would keep a
   company on Pro forever after it stopped paying. Then **Edit destination → copy the
   secret** (`pdl_ntfset_…`) — that is `PADDLE_WEBHOOK_SECRET`. The sandbox destination and the live
   one have **different** secrets.
6. **Turn on local currencies** (Business account → Currencies → select all) so buyers see their own
   currency while you price once in USD. Nothing in Tielora has to change for it.
7. **Set the four variables in Railway** — `PADDLE_API_KEY`, `PADDLE_WEBHOOK_SECRET`,
   `PADDLE_PRICE_ID_PRO` and `PADDLE_ENV=sandbox` — plus `APP_BASE_URL` if it is not already set,
   because checkout needs somewhere to send people back to. Redeploy, then check
   `https://<domain>/api/health` reads `"billing": "configured"`.
8. **Walk it through in the sandbox, as a real administrator would.** Sign in as a company
   administrator, open **Admin → Billing**, press **Upgrade to Pro**, pay with one of Paddle's test
   cards, and watch: you come back to `/admin/billing?billing=success`, the strip says the payment
   is received and it is waiting for confirmation, and within about a minute the card flips to PRO
   on its own. Then press **Manage billing** and check it opens your subscription at Paddle. Then
   cancel it there and watch the company drop back to Free.
9. **Only then go live**: repeat steps 3–5 in the live account (new product, new price id, new API
   key, new webhook destination and secret), swap all three values in Railway, set
   `PADDLE_ENV=live`, redeploy, and check `/api/health` again.

### ⚠️ The two things to re-check on activation day

These were flagged by the research because they could not be read first-hand — the sources were
search results, not the pages themselves. Both are handled defensively in the code, so a surprise
ends in a plain refusal rather than a broken screen, but both are worth five minutes.

- **Caveat 2 — will Paddle actually hand us a hosted checkout?** Tielora sends the administrator to
  Paddle by an ordinary redirect and loads **no Paddle JavaScript at all**, which is why the strict
  Content-Security-Policy in `next.config.ts` needed nothing added. The research says Paddle's
  fully hosted checkout is available on **all sandbox accounts**, but on **live** accounts is
  "limited to approved mobile app companies" and has to be requested from support. So: the sandbox
  walkthrough will work; before going live, **email Paddle support and ask for hosted-checkout
  approval for Tielora**.
  The code already refuses safely if it is not granted: it checks that the address Paddle hands back
  is on a `paddle.com` host, and if it is not, the administrator sees "Checkout isn't ready on this
  Tielora yet" instead of being dropped somewhere that needs Paddle's JavaScript.
  **If approval is refused**, the alternative is Paddle's **overlay checkout**, and it is not built
  on purpose. It would cost: loading `https://cdn.paddle.com/paddle/v2/paddle.js` on the Billing
  page, and three additions to the CSP — `script-src https://cdn.paddle.com`, a `frame-src` entry
  for the checkout iframe host (**likely `buy.paddle.com` / `sandbox-buy.paddle.com`, but read the
  real hostname off the browser's network tab rather than guessing**, since `frame-src` is currently
  `'none'`), and a `connect-src` entry for the calls the script makes. Everything else — the
  webhook, the plan flips, the audit rows, the screens — would be unchanged, and the "waiting for
  confirmation" strip works identically for an overlay. The other alternative is Lemon Squeezy,
  below, whose hosted link genuinely needs no CSP change at all.
- **Caveat 3 — does `subscription.created` ever arrive before the money does?** Tielora treats both
  `subscription.activated` and `subscription.created` as "this company is on Pro now". The research
  notes that for some flows `created` can arrive before the first payment. During the sandbox
  walkthrough, watch the order the two events arrive in (Dashboard → Developer tools →
  Notifications shows every delivery). **If `created` can land before payment, delete that one
  string** from `ACTIVATING_EVENTS` in `src/server/services/paddle.ts` — that is the whole fix.
- A smaller one, safe either way: the exact field names in Paddle's responses are read defensively
  (several plausible names are tried, and an answer we cannot read ends in a plain refusal rather
  than a guess). If either button refuses with "we couldn't reach the payment page" while Paddle's
  own dashboard shows the request succeeding, the response shape is the thing to look at.

### What a company sees, and what we keep

- **No payment credential is stored anywhere in this app.** No card, no token, no price, no invoice,
  no amount. Three columns hold the whole footprint: the plan, and the company's customer and
  subscription **ids at Paddle** — identifiers and nothing more. The API key and both minted
  addresses (checkout and portal) never appear in a log line, an audit row or any API answer.
- **Checkout:** "Upgrade to Pro" sends the administrator to Paddle, carrying the company's id so the
  webhook knows who paid. They come back to `/admin/billing?billing=success`.
- **The plan flip lags the redirect by seconds, and the page is honest about it**: it says the
  payment is received and it is waiting for the final confirmation, updates itself when the webhook
  lands, and after two minutes says "still confirming" rather than spinning for ever. It never
  claims Pro before the database says Pro.
- **A cancelled or abandoned checkout shows nothing at all** — the Free card is simply still there.
- **A failed payment does not downgrade anybody.** Paddle retries (dunning) and the company keeps
  Pro throughout; the Billing page says "your last payment didn't go through, we're trying again
  automatically" and points at Manage billing. That note comes from the last webhook we were sent,
  so it is only ever as fresh as that.
- **A cancelled or lapsed subscription drops the company to Free** when Paddle says so, and
  **nothing is taken away**: every project, person and file is still there, readable and workable —
  only adding more is refused. That is the grandfathering rule the limits already follow.
- **We cannot show a renewal date**, because we do not store one, so the screen does not pretend to:
  it says the next payment date, the invoices and the card live at the provider, and Manage billing
  is the way to them. Manage billing mints a fresh single-use link on every press.
- **Refunds, disputes and dunning all happen at Paddle**, in Paddle's dashboard. Tielora has no
  screen for them and is not meant to.

### If Paddle does not work out: the Lemon Squeezy fallback

Lemon Squeezy is also a merchant of record, also lists Oman as an eligible seller country, also
supports sole traders, and — unlike Paddle — its hosted checkout link is **genuinely just a link**,
so the redirect road needs no approval and no CSP change ever.

Switching to it is **a rewrite of `src/server/services/paddle.ts` and nothing else**: the plan
flips, the webhook order of operations, the audit rows, the actions and every screen stay exactly as
they are, because none of them knows a Paddle field name. Four environment variables would replace
the four above — `LEMONSQUEEZY_API_KEY`, `LEMONSQUEEZY_STORE_ID`, `LEMONSQUEEZY_WEBHOOK_SECRET`,
`LEMONSQUEEZY_VARIANT_ID_PRO` (plus its per-store "test mode" toggle instead of a separate sandbox
host). Inside that one file, four things differ: the signature is an `X-Signature` header holding a
plain HMAC-SHA256 of the raw body with no timestamp; the event name arrives in `meta.event_name` and
the company id in `meta.custom_data`; there is **no single event id**, so the replay key would be
built from the subscription id plus the event name plus the record's `updated_at`; and the customer
portal is a pre-signed URL already sitting on the subscription record rather than something you mint
per press.

## 8b. Ask Tielora and AI-written briefs — switching the AI on (owner's one-off setup)

Everything here is optional. With no `ANTHROPIC_API_KEY` the AI is completely invisible and the app
is exactly as it was (`/api/health` says `"ai": "dormant"`). Do these in order before you set a key
on a real deployment:

1. **Create the key.** In the Anthropic console create an API key, then add it to the Railway
   service's Variables as `ANTHROPIC_API_KEY`. Never put it in the repo, a commit or a chat. After
   the redeploy `/api/health` says `"ai": "configured"` and shows no part of it.
2. **Set a spend limit in the Anthropic console.** The app caps each company per month (Free $2,
   Pro $25, in `src/lib/plan-limits.ts`), but that is the first fence. The console limit is the
   second, and the only thing that bounds a bug in the first.
3. **Check retention settings** on your Anthropic account for API inputs and outputs, and confirm
   they are what you are happy to tell customers.
4. **Add Anthropic to your sub-processor list** (the privacy page now has one; keep it in step with
   any list you give customers).
5. **Privacy review.** Have the privacy and terms wording reviewed, including the new Ask Tielora
   sections. **Confirm against Anthropic's current commercial terms before launch** what Anthropic
   does with API inputs and outputs (training, retention, where it is processed). The pages
   deliberately say only that Anthropic is a sub-processor handling the text to produce the answer
   under its commercial terms, with no retention period and no location, because those were not
   verified when the pages were written. Add them only once you have checked.
6. **Nothing turns on by itself.** Even with the key set, each company's administrator must switch
   Ask Tielora and/or AI-written briefs on in Admin → Integrations. Contractors never see either.

---

## 9. What is deliberately not built

Named here so nobody assumes otherwise:

- **A legal review of the privacy and terms pages** — gate 1 above is written and linked, but it is a
  template. Have a lawyer review the actual wording before relying on it.
- **Overlay checkout** — the Billing page loads no payment JavaScript at all and never has. Paying
  is a plain redirect to the provider's own page and back, which is why the Content-Security-Policy
  needed nothing added for it. What the overlay would cost, and when you would need it, is in
  section 8, caveat 2.
- **Anything about money on our screens** — no price beyond the one placeholder on the plans table,
  no invoice, no receipt, no refund button, no renewal date, no card. All of it lives at the payment
  provider, and "Manage billing" is the door to it.
- **Browser-side error reporting** — off unless `NEXT_PUBLIC_SENTRY_DSN` is set at build time. Server
  errors are always logged, and go to Sentry when `SENTRY_DSN` is set. `/api/health` reports the two
  channels separately, so neither can be mistaken for the other.
- **Shared rate limiting** — limits are counted per process (`src/lib/rate-limit.ts`). Fine on one
  instance; if the app is ever scaled to several, add the Redis store behind `RateLimitStore`.
- **SMS notifications, and emailing every kind of notification** — alert and brief emails exist,
  **per person, off unless chosen** (new accounts start with alerts on, sent only once their address
  is confirmed); an alert email says only what the in-app notification says, and only for the seven
  kinds that have a chat toggle — uploads and ordinary comments stay in the app. No SMS is ever
  sent. All of it, the three account emails included, is dormant until `RESEND_API_KEY`,
  `EMAIL_FROM` and `APP_BASE_URL` are set (section 2). *The retired rule*: this list used to say no
  task, comment or deadline would ever be emailed; the owner's decision of 30 Sep 2026 retired it.
- **A queue behind email** — the same one-attempt, one-retry, then-dropped shape chat delivery has,
  for the same reason: the audit trail records that the app meant to send a link, and an alert or
  brief is a copy of something already in the app, so a dropped email costs somebody a link they
  can ask for again or a nudge they will see in the app — never a record. Someone who never receives
  an invitation is given a password by their administrator instead, exactly as before email
  existed. **Bounces and complaints are not handled either**: Resend's reports of an address that
  bounced or marked Tielora as spam are not read, and a bouncing address is not marked bad. Named
  follow-up if complaints appear.
- **Other alphabets in the PDF status report** — the PDF shows only Latin letters; text in any other
  script (Arabic, Chinese, and so on) appears as "?". The report
  is built with two small code libraries, `pdfkit` and `pptxgenjs`: no browser and no system package
  is needed, so nothing extra has to be installed on Railway.
- **A queue behind chat delivery** — a Slack or Teams message is attempted once, retried once if the
  chat tool says "too many requests", and otherwise dropped with a logged line. Delivery state lives
  in the process, not in a table, exactly like rate limiting. In-app notifications are always written
  either way, so a dropped card costs a nudge and never the record.
- **A Microsoft file picker in the browser** — the picker is ours, served by our own routes. No
  Microsoft JavaScript is loaded, which is why the strict Content-Security-Policy needed no change.
- **Per-person Microsoft connections for file browsing** — for OneDrive and SharePoint files, a
  company connects **once**, by an administrator, and everyone browses through that account.
  Per-person file connections would show each person exactly their own OneDrive; that is a bigger
  piece of work, and the card says plainly whose access is being shared. Attaching is still limited
  by Tielora's own permissions: you can only attach to a task you could already upload to. (This is
  about browsing files only. **Signing in** with Microsoft is per person — see the next item.)
- **Microsoft-only sign-in** — Sign in with Microsoft is an extra door, never a replacement:
  everybody's password keeps working, and there is no per-company switch forcing people off
  passwords. Enforcing it would need a break-glass way in for an administrator locked out of
  Microsoft, so it is deliberately not built this round. Nor are: creating Tielora accounts
  automatically from a Microsoft sign-in, importing people or groups from Microsoft, a per-person
  "unlink my Microsoft account" button (switching the company off and on again is the reset),
  treating an address as confirmed because Microsoft vouched for it, and personal Microsoft
  accounts (Outlook.com / Hotmail) — work and school accounts only.
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
