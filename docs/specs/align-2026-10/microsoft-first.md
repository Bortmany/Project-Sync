# Tielora — Microsoft first: sign in with Microsoft, Microsoft leads Integrations, alerts and briefs by email

Status: SPEC, build-ready. Branch `align-2026-10`. Build plan: "Step 2b — Microsoft first" in `Agents/.claude/worktrees/vision-plans/docs/visions/build/tielora.md`. Research this follows: `docs/decisions/microsoft-teams-app.md` Parts 1 and 3 (its technical notes are binding where this spec does not say otherwise).
Written 30 Sep 2026 by the product manager. The owner's decision of 30 Sep 2026 retires the "no task, comment or deadline is ever emailed" rule; this spec is the build that makes the docs and the product agree again.

**What I read.** `docs/CONVENTIONS.md` (tenant rule, external rule, house rules 1, 10, 11, 12, "Notifications and the deadline sweep", "Chat delivery", "Microsoft 365 attachments", "Transactional email", "The four flows on top", "Two-factor sign-in", the route table), `docs/GO-LIVE.md` sections 1, 2, 3, 6 and 9, the research note, and this code: `src/lib/auth.ts`, `src/lib/ms-graph.ts`, `src/server/services/{microsoft,email,email-tokens,notify,webhooks}.ts`, `src/server/sweep.ts`, `src/app/api/auth/login/route.ts`, the login page and form, Admin → Integrations (page, view, Microsoft card), Your account (page), the privacy page and the Prisma `User`/`Organization` models. I did **not** open `integrations.ts`, `account.ts` (services), the Users admin screens or any test files; the builder re-reads them before touching them.
**Backlog:** `Agents/docs/backlog.md` has no Tielora section; nothing to name. The owner's file is untouched.
**Prior art (Mobbin):** I have no Mobbin tool in this session and will not invent links. `ui-designer` pulls 2–3 flows each for "Sign in with Microsoft button on a login screen", "email notification preferences card" and "one-click unsubscribe confirmation page" and cites them by `mobbin_url`.
**Sibling specs this touches:** `briefs-and-status-report.md` (weekly brief; reads `emailWeeklyBrief` and its unsubscribe link from this build — see "Handshakes" at the end), `ai-assistant.md` (it also rewrites a privacy-page sentence — this build owns the "ever emailed" sentence), and the Teams app step (Step 2c), which reuses `Organization.entraTenantId` and `User.microsoftOid` from this build.

## Standards flags (engineering standards sections 6–8, and house rules 10–12)

- **New personal data: YES — the privacy page changes in the same build.** Each person's Microsoft identity (the permanent Microsoft id and their company's Microsoft tenant id), three email preferences, and a "last daily email" date. The company's Microsoft tenant id is company configuration, not personal data, but is listed too. See "Privacy".
- **Touches the core guarantee: the tenant rule, directly.** A Microsoft login is the first way into the app that starts from an outside party's claim about "which company". It must never land in another company. `org-isolation.service.test.ts` is extended in this change (see "Tests"). It also touches the external rule (contractors are emailed, and can sign in with Microsoft) so `external-scoping.service.test.ts` is extended too. The golden rule (task status/progress, append-only rows) is untouched — nothing here writes a task, a document revision or an audit row's content.
- **Adds mutations and external calls: YES.** Mutations: switch Microsoft sign-in on/off, change email preferences, unsubscribe. External calls: Microsoft (sign-in, key set), Resend (more mail than before). Every one is rate limited — see "Rate limited".
- **Backups (section 8):** no new stored files; nothing changes in the backup story.

## The problem, in the owner's words

Staff already have a Microsoft work login. Making them remember a second password for Tielora is friction, and the Integrations page should lead with the Microsoft tools the customers actually use. Also, the app only tells people about work while they have Tielora open; people live in Outlook. Alerts (you were assigned, you were mentioned, something is overdue) and a morning summary should be able to land there, only for people who ask for them, with one click to stop.

## Decisions made in this spec (the owner can overrule any of them)

| # | Decision | Why |
|---|---|---|
| D1 | The company's Microsoft tenant is captured from an administrator's own Microsoft sign-in, never typed (per the research). The administrator's Microsoft account must also have a **Microsoft-verified email that equals their own Tielora email** before the company is linked. | Stops someone linking a company to a Microsoft tenant they merely know the id of; and stops a person who is an employee of company X from registering a Tielora workspace and quietly claiming X's tenant under an unrelated email. |
| D2 | Switching Microsoft sign-in **off** clears every person's Microsoft link in that company and forgets the tenant. Switching on again starts fresh (email first-match). | One simple rule, and it is also the recovery path for "someone's Microsoft account was recreated and their link no longer matches". A per-person "unlink" button is out of scope. |
| D3 | Unsubscribe token is a **signed value (HMAC)**, not an `EmailToken` row. Reasons below. | The link must keep working in an inbox for months and be the same in every email; `EmailToken` is single-use, expiring and retires older tokens. |
| D4 | Email alerts and briefs are sent **only to a verified address** (`emailVerifiedAt` set). | Otherwise a mistyped address receives task titles. Verification is otherwise only a nudge; this is the one place it is consulted, and it locks nobody out of anything in the app. |
| D5 | **New accounts default: alerts ON, daily brief OFF, weekly brief OFF. Existing people: all three OFF.** | New people were either invited by email (so email demonstrably works for them and they verify by accepting) or signed up themselves; alert emails are about their own assignments and the unsubscribe is one click. The two briefs are digests, which is bulk-style mail, so they are opt-in for everybody. Existing people never agreed to any email of this kind, so nothing changes for them until they choose. |
| D6 | The company's chat toggles (Slack/Teams) have **no effect on email at all**. The email copy is a personal choice. The seven notification types that have a chat toggle are the only ones that can ever be emailed. | Owner's rule: "only for the six chat-toggle events" and "`emailAlerts` off means no email whatever the chat toggles say". I read the reverse as also true: a company with chat switched off can still have people who want email. |
| D7 | `notify(..., { chatCopy: false })` now suppresses **both** copies (chat and email). | The two callers of that option are the contractor half of an announcement and the workspace-deletion messages to administrators; neither may be carried by the announcements toggle, and the second would otherwise email "announcement" wording for something that isn't one. The option keeps its name; CONVENTIONS says "copies". |
| D8 | The daily brief email is each person's own "Your day" (the same content as their brief page), sent to internal people only. | It is personal, already scoped to what that person may see, and needs no new data shape. A contractor never gets it (see "What a contractor sees"). |

## What the user will see and do, screen by screen

### 1. Sign in with Microsoft

**A. Login page (`/login`).**
- While `MS_GRAPH_CLIENT_ID` / `MS_GRAPH_CLIENT_SECRET` are unset: **the page is byte-for-byte what it is today.** No button, no line of text, no extra markup, and a `?microsoft=…` address parameter is ignored. This is a tested requirement.
- When they are set: below the password form, a divider "or" and a secondary-styled full-width button **"Sign in with Microsoft"**, with one small grey line under it: "Works once your company's administrator has switched it on." That line names no company and is the same for everybody. The button is an ordinary link to `GET /api/auth/microsoft` (not a fetch): Microsoft's pages need a full navigation, and this keeps the strict Content-Security-Policy unchanged. No Microsoft script is loaded. (The button shows for every visitor on a configured deployment, because the page cannot know which company someone belongs to — that is the price of not revealing which companies use Tielora.)
- Everything a person can get wrong lands them back on `/login` showing **exactly** "Incorrect email or password." — the same constant the password route uses (export it from one place; do not retype it). Wrong company, company not switched on, no matching account, deactivated, contractor whose access has ended, a different Microsoft account than the one linked, an unverified Microsoft email, a cancelled Microsoft screen, an expired attempt, a tampered attempt, Microsoft returning an error: one sentence, one status, no hint which.
- A company whose Microsoft administrator has locked user consent sees Microsoft's own "needs admin approval" page — that appears at Microsoft, before Tielora is involved. The owner's checklist item 14 (admin-consent link, scope `openid profile email`) covers it; GO-LIVE section 6 gets that sentence.

**B. The journey.** Press the button → Microsoft's sign-in → back to Tielora → in, on the same home page a password sign-in would reach (`homePathFor(role)`; a contractor lands on My tasks). If the person has Tielora two-factor on, the login page swaps to the six-digit step exactly as it does after a password: **Microsoft sign-in never skips Tielora's own second factor**, and no session, cookie, `LOGIN` audit row or `lastLoginAt` exists until the code is accepted. Microsoft's own two-factor is a bonus, not a substitute.
- The two-factor ticket is handed to the login page in the address **fragment** (`/login#…`, which browsers never send to any server or put in a Referer) and the page removes it from the address at once. It never travels in a query string, a log line or a cookie the page can read. The builder may choose a short-lived httpOnly cookie instead if the fragment proves awkward; either way it must not appear in a query string.
- The ticket for this path is a **new never-emailed purpose, `TWOFA_PENDING_MICROSOFT`** (five minutes, no migration — `purpose` is a plain string), so the second-step route can write the truth in the audit row (`method: "microsoft"`). `EmailedPurposeName` excludes it alongside `EXPORT` and `TWOFA_PENDING`, and `retireSignInTickets()` retires both ticket kinds.

**C. Who gets in (server rules, in order).** Validate everything about the Microsoft answer first; only then look at Tielora data.
1. The attempt: a signed `state` plus `nonce` and a PKCE verifier kept in a short-lived (10 minute) httpOnly, `SameSite=Lax`, path-limited cookie that is deleted on the way back. Missing, expired or mismatching → refuse.
2. The ID token (research Part 1 notes, binding): endpoint `login.microsoftonline.com/organizations/v2.0/authorize`; scopes `openid profile email` only (no `offline_access`, no `Files.Read.All` at sign-in); code + PKCE; check the signature against Microsoft's published keys (fetched from `login.microsoftonline.com` — the existing host guard already allows it, no new host), `aud` = our client id, `nonce`, not expired, and `iss` = `https://login.microsoftonline.com/{tid}/v2.0` using the token's **own** `tid`. `tid` must look like a GUID. No new dependency unless the builder justifies one (Node's own crypto can verify an RS256 key).
3. Identity is **`tid` + `oid`**. Never authorise on `email` or `preferred_username` alone.
4. The company: the one organisation whose `entraTenantId` equals that `tid`. None → refuse.
5. The person, already linked: `User` where (`microsoftTenantId`, `microsoftOid`) = (`tid`, `oid`). It must belong to the company from step 4 (check it; do not assume). After the first sign-in **only `oid` is used**; the email is not consulted again.
6. The person, first time: only when the token carries the `email` claim **and** `xms_edov` is true, take the lowercased email, find the `User` in **the company from step 4 only** (email is globally unique, so also confirm `orgId` matches), active, not a contractor past their end date, with **no link yet** (`microsoftOid` null). Then link in one conditional write (`WHERE microsoftOid IS NULL`) so two simultaneous first sign-ins cannot both win. An account already linked to a different `oid` is refused.
7. Write, in one transaction: the session, `lastLoginAt`, the `LOGIN` audit row (`metadata: { reportedIp, twoFactor: false, method: "microsoft" }`) and, on a first link, a `MICROSOFT_IDENTITY_LINKED` row (see Audited). Cookie set after commit, exactly as the password route does. Add `method: "password"` to the password route's and the two-factor route's `LOGIN` rows so the trail says which door was used for every sign-in.
- A person's password keeps working. Microsoft sign-in is an extra door, never a replacement (open question 3).

**D. Switching it on for a company (Admin → Integrations → Microsoft 365 card).**
- The card has two labelled parts: **"Sign in with Microsoft"** (new, top) and **"OneDrive and SharePoint files"** (today's card content, unchanged). Each part has its own status badge and works without the other.
- Part 1 when off: a sentence "Let your people sign in with the Microsoft work account they already use. They still need a Tielora account — this does not create one." and a button **"Switch on"**. Pressing it goes to Microsoft; the administrator signs in **as themselves**; back on the card the outcome banner reads "Sign in with Microsoft is on for your company (contoso.com)." Refusal banners, plain English: cancelled ("The Microsoft sign-in was cancelled, so nothing was changed."); the Microsoft email doesn't match ("Sign in with the Microsoft account that uses the same email address as your Tielora account, then try again."); the company is already used elsewhere ("That Microsoft company is already linked to another Tielora workspace. If that is a mistake, contact Tielora support."); this workspace is already linked to a different company ("Switch it off first, then switch it on with the Microsoft account you want."); anything else ("Microsoft could not complete that. Try again.").
- Part 1 when on: shows the Microsoft domain (from the sign-in), who switched it on, the count of people already linked ("12 people have signed in with Microsoft"), and a ghost button **"Switch off"** opening a confirmation: "People will sign in with their password again, and each person's Microsoft link is removed. Nobody is signed out. You can switch it on again at any time." (Sessions are untouched: nothing about who anyone is has changed.)
- Enabling also links the administrator's own Microsoft account to their own Tielora account (they proved both at once), so they can use the button straight away.
- The domain shown and the "who/when" are read from the audit row and the token at the time; no new column beyond `entraTenantId` (a domain is not stored for this part; show the domain from the enable outcome and thereafter "Microsoft company linked" plus the linker's name and date read from the latest `MICROSOFT_SIGNIN_ENABLED` audit row). The builder may store nothing else.
- The whole card is absent while the Azure app is unregistered (as today). If `APP_BASE_URL` is unset the card says so (as today) and the button is absent.
- If the company's Microsoft administrator has not approved the app, they see Microsoft's approval page; the same admin-consent link applies.

**E. Contractors.** They follow the same rules, no special path. A contractor can only use Microsoft sign-in if they hold an account **inside the company's own Microsoft tenant** (a guest signing in from their employer's tenant has a different `tid` and is refused with the generic sentence). That is intended, and most contractors will keep using their password. Expiry and deactivation are checked exactly as at password sign-in.

### 2. Integrations page order

Admin → Integrations lists **Microsoft 365 first, then Microsoft Teams, then Slack**, then the noticeboard card as today. The card order is fixed in the view (do not rely on database order). While Microsoft is unregistered the first card is simply absent and the list is Teams, then Slack. The intro line becomes: "Connect the Microsoft tools your team already uses, and send a copy of your notifications to a chat channel. Notifications inside Tielora carry on either way — these are extra copies, not replacements." (Email is per person and is not on this page.) Microsoft first means first in the list: nothing else on these cards changes.

### 3. Email: alerts and the daily brief

**A. Your account → new "Email" card** (between two-factor and the danger zone). Hidden entirely while email is not set up (`emailAvailable()` false) — invisible means invisible, as with the verify banner.
- Three switches, each saved the moment it is pressed with a toast ("Saved."), described in plain English:
  - **Alerts** — "An email for things that need you: a task assigned to you, a mention, a status change on your work, a deadline coming up or passed, a gate opened by an override, and company announcements. One email for each notification you'd see in the app."
  - **Daily brief** — "Your day each morning (early morning UTC): what is due, overdue, newly unblocked, and what needs your review. Nothing is sent on a day when there is nothing to say."
  - **Weekly brief** — shown **only when the weekly-brief build has landed** (that build adds the row; here it exists as a stored preference and nothing else).
- If the address is not verified: the switches are disabled with "Confirm your email address first — we only send these to an address you've confirmed." and a **"Send me a confirmation email"** button that calls the existing `resendVerificationEmail`.
- A contractor sees the card with the **Alerts** switch only.
- A footer line: "Every email has a one-click unsubscribe link." Turning the daily brief on says "Your first one arrives tomorrow morning." (The sweep stamps today so it isn't sent this afternoon.)
- **Run `ui-designer` before building** (this card, the Microsoft card's two-part layout, the login button and its phone layout, the unsubscribe page and the emails' plain-text layout).

**B. The alert email.**
- Sent by `notify()` **after** the notification rows are committed, **not awaited**, never throws, one retry when Resend answers 429 (the existing `sendEmail` rule), then dropped with a logged line carrying the purpose and user id only. In-app notifications stay the truth.
- **One email per notification row.** The recipient list `notify()` already builds (active, same company, actor skipped, duplicates removed) gains three fields read in that same query (`email`, `emailAlerts`, verified-or-not). An email goes only to a recipient with `emailAlerts` true, a verified address, for a type that has a chat toggle (`toggleForType(type) !== null`: ASSIGNED, MENTIONED, STATUS_CHANGED, DEADLINE_APPROACHING, OVERDUE, OVERRIDE_APPLIED, ANNOUNCEMENT — `DOCUMENT_UPLOADED` and `COMMENT_ADDED` never), and only when `chatCopy` is not false (D7).
- **Built from the notification row and nothing wider.** Subject = the row's title. Body = the row's body sentence + "Open it in Tielora: <APP_BASE_URL + the row's link>" + the footer. No task list, no project roster, no other people's names beyond what that sentence already says, no data fetched to "enrich" it.
- **Text somebody typed must not become a link.** The email is plain text, and Outlook turns any bare web address into a clickable link — so a task titled "Sign in at https://evil.example" would arrive from Tielora's trusted sender with a live link. In the email copy (never in the in-app row), any `http://`, `https://` or `www.` run inside the title or body is replaced by "[link removed]". Newlines and control characters are stripped from the subject; body capped at 1,200 characters like chat. (Same defence `slackEscape`/`teamsEscape` give chat.)
- Every alert carries the two unsubscribe headers and a visible unsubscribe link (below).
- **The hourly sweep's reminders** (`DEADLINE_APPROACHING`, `OVERDUE`) are emailed on the same road after the sweep transaction commits, with a per-recipient list the sweep now also returns (the existing chat events are one per task per company and carry no recipient, so a separate per-person list is needed), inside the same 30-second delivery budget style as chat (own budget, checked after each send, one always goes). **The sweep's contractor-access-expiry warnings to administrators and the workspace-deletion messages are never emailed** — they are housekeeping, written without a chat copy today and given none here.
- **A flood guard:** at most 20 alert emails per person per hour, counted in the process like rate limiting; the 21st is dropped (the in-app row exists). A person mass-assigned 50 tasks gets 20 emails, not 50. Logged as "held back", never with an address.

**C. The daily brief email.**
- Runs in the same hourly sweep, **after** the chat digest, in its own function (call it `sendDailyBriefEmails`) — **not inside the chat digest's early exit.** `postDailyDigests` returns early when no company has a chat channel with the digest on; the email must still run for a company with no chat channel at all. This is the trap in the current code (`sweep.ts`, `if (wanted.size === 0) return`).
- Recipients: active, internal (not EXTERNAL), verified, `emailDailyBrief` on, and whose `dailyBriefEmailedAt` is null or before today's 05:00 UTC line (`digestBoundary()`, the same line as the chat digest: "after 05:00 UTC and not yet sent today", so a late server sends late, not never). Ordered longest-waiting first.
- Content: that person's **own** "Your day" (`personBrief` for that person's own actor). Sections and per-section cap (10 with "and N more") as on their screen. Lines carry titles and dates exactly as the brief shows this person; nothing wider. **If every section is empty, no email is sent** but the date is stamped.
- **Once a day, per person.** `User.dailyBriefEmailedAt` is stamped after each attempt, empty or not, success or failure (same "stamped after the attempt" rule as chat). A per-person date, not a per-company one: the weekly spec's question 1 assumed a company-level date, but a company-level date cannot survive the 30-second budget stopping halfway through a large company (either the rest are never sent or the first half are sent twice). A per-person date resumes exactly where it stopped.
- Its own 30-second budget, checked after each person, one always goes. Never awaited by anything a user is waiting on (it is the sweep). Dormant email → the whole step is a no-op and **stamps nothing**.
- Writes **no** notification row and **no** audit row (a read, plus the stamp) — the same documented exception the chat digest has.
- Time: one send line for everybody, "early morning UTC", which is a reasonable morning in Oman and the Gulf and an odd hour in the Americas. Per-person times are out of scope.

**D. Unsubscribe.**
- Every alert and brief email carries `List-Unsubscribe: <https://<host>/api/email/unsubscribe?t=TOKEN>` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click` (RFC 8058), **on those emails only** — never invitations, resets or verification. `email.ts` gains an optional headers argument; dormancy (`emailAvailable()`) is unchanged. The body's last lines: "Stop emails like this one: <link to /unsubscribe?t=TOKEN>" and "Or change all your email settings in Your account: <APP_BASE_URL>/account".
- `POST /api/email/unsubscribe?t=` (what a mail client sends when someone presses Outlook's own "Unsubscribe"): turns off **that kind** for **that person** (alerts, daily or weekly — the token names both), answers 200 with the neutral page. `GET` on the same address does nothing except redirect (303) to `/unsubscribe?t=` — mail scanners open links, and a GET must never unsubscribe anyone.
- `GET /unsubscribe?t=` is a public page on the `AuthSplit` shell with one button, "Unsubscribe", posting to the address above. The wording is identical for a valid token, a tampered one, an old one and none: "Stop these emails? Press the button to confirm." After the press: "Done. If that link was still valid, those emails have stopped. You can review all your email settings in Your account." **Same page, same status, same length whatever the token** (compare tokens in constant time; do the same amount of work for a miss).
- **HMAC, not an `EmailToken` row (D3).** The token is the person's id, the kind and a signature made with a key derived from `SESSION_SECRET` for a new purpose (`"email.unsubscribe"`, `src/lib/secret-box.ts` `deriveKey`, the same way the OAuth `state` is signed). No expiry: an unsubscribe link in a two-month-old email must still work. Why not `EmailToken`: it is single-use (a second click would fail), it expires, issuing one retires all earlier ones of that purpose (which would kill the link in every older email), the raw token is unrecoverable from its hash (so every email would need its own new row), and it would add a row per email sent. **Known cost, stated in GO-LIVE:** rotating `SESSION_SECRET` (an emergency action) makes unsubscribe links in existing inboxes stop working; the neutral page still points to Your account, which always works. This is the same cost the Microsoft file tokens and two-factor secrets already accept.
- A valid token for a deactivated or anonymised account changes nothing and shows the same page. A change that actually flips a value writes one audit row (below); a link used twice writes one.

### 4. What replaces the retired "never emailed" rule

The docs (CONVENTIONS house rule 11, "Transactional email", the digest section, GO-LIVE section 9 and the secrets table, the privacy page) are rewritten in this same change so no sentence says the old thing. Exact list in "Docs and privacy".

## What a CONTRACTOR sees

- **Login:** the same button as everybody, and it works only if they hold an account inside the company's own Microsoft tenant; otherwise the generic sentence. Nothing else about their sign-in changes; expiry and deactivation refuse them exactly as at password sign-in.
- **Email:** only the **Alerts** switch appears on Your account. They are emailed **only what their own notification row already says** — title, sentence, link — and only for the rows a contractor already receives (assigned to them, a status change on their work, a send-back, a deadline on their own task, an announcement someone explicitly included them in). Every fan-out that excludes contractors today (project-wide override notices, comment and mention fan-outs on tasks not theirs, announcements without `includeExternals`) produces no row for them and therefore no email. The contractor half of an announcement is written with `chatCopy: false` and so gets **no email** (D7): it is the same news as the noticeboard post, delivered in-app on their brief page.
- **Never:** a daily brief email, a weekly brief email, an email built from anything other than their own row, a contractor-access-expiry warning (those go to administrators, in-app only). Their preference for the daily or weekly brief cannot be set (the switches are absent) and, if a value were ever there, the sender ignores it for EXTERNAL people.
- Unsubscribe pages and links work the same for them.

## What is AUDITED

- `LOGIN` — as today, now with `method: "password" | "microsoft"`; a Microsoft sign-in that needs the second step writes it only after the code is accepted (via the existing two-factor route), with `twoFactor: true` and `method: "microsoft"`.
- `MICROSOFT_SIGNIN_ENABLED` — an administrator switched it on: actor, the company, `metadata: { tenantId }` (a company identifier, not a person's) and the Microsoft domain in the summary.
- `MICROSOFT_SIGNIN_DISABLED` — `metadata: { peopleUnlinked: n }`.
- `MICROSOFT_IDENTITY_LINKED` — a person's first Microsoft sign-in linked them: actor = that person, `metadata` **empty of identifiers** (no `oid`, no `tid`, no email). The audit trail can never be edited or deleted, so it must not hold a personal identifier that the person's account deletion is supposed to clear.
- `EMAIL_PREFERENCES_CHANGED` — one row when a value actually changes, from Your account or from an unsubscribe link: actor = the person, `metadata: { changed: { emailAlerts: false }, via: "account" | "unsubscribe-link" }`. Never a token. Consent changes are worth a record; this is deliberately not another exception to house rule 1.
- **Not audited:** a refused Microsoft sign-in (unauthenticated, no actor — logged with a category and the person's id when known, never the email, `oid` or token), alert and brief emails themselves (they are copies of in-app rows or reads, exactly like chat copies and the chat digest; `EMAIL_SENT` remains for link emails only), viewing either page.
- Add the constants to `ACTIVITY` in `activity.ts`. `mutation-safety.test.ts` is unaffected (inserts only).

## What is RATE LIMITED

All via `src/lib/rate-limit.ts`, 429 with a plain sentence and `Retry-After` (house rule 10).
| Where | Limit |
|---|---|
| `GET /api/auth/microsoft` (start) | `byIp`, 20 a minute |
| `GET /api/auth/microsoft/callback` | `byIp`, 10 a minute (the login route's number), **plus** a failures-only counter per IP, 10 failures per 15 minutes |
| `GET /api/auth/microsoft/enable` (admin start) | `byUser`, 5 a minute |
| `disableMicrosoftSignIn` | `byUser`, 10 a minute |
| `setEmailPreferences` | `byUser`, 30 a minute |
| `/api/email/unsubscribe` (POST) and `/unsubscribe` page | `byIp`, 300 a minute — deliberately generous: Gmail and Outlook send one-click requests on behalf of many people from a few shared addresses, and a refused one-click leaves the person subscribed |
| Two-factor step after Microsoft | the existing three limiters, unchanged and shared |
| Alert emails | 20 per person per hour (in-process) |
| Sweep email steps | 30-second budget each, checked after each send |
A failed Microsoft sign-in does **not** count against the per-account password counter (`login-account:<email>`): the attempt has no password to guess and must not let anyone lock the real owner out.

## Privacy (the same build)

New personal data: the person's Microsoft id and their company's Microsoft tenant id; three yes/no email preferences; a "last daily email" date. `/privacy` changes in this diff:
- **"What is stored"**: add "your Microsoft sign-in link, if you use it: a permanent identifier Microsoft gives us for your work account and the identifier of your company's Microsoft directory — kept so we recognise you next time — and, for each company that switches it on, its Microsoft directory identifier"; and "your email choices (alerts, daily brief, weekly summary) and the date of your last daily email".
- **"The emails we send you"** is rewritten. It no longer says "only three" or "no task… is ever emailed". New text: the three account emails (as now), plus — only if you switch them on, or for alerts if you were newly added — an email for each in-app alert, a daily brief and a weekly summary; that an alert email contains what the in-app notification says and nothing else; that they go only to an address you have confirmed, through Resend; that every one carries an unsubscribe link; and how to change it (Your account). Contractors: alerts only.
- **New short section "Signing in with Microsoft"**: what we get from Microsoft at sign-in (which company, a permanent id, your work email), that we ask only for the basic sign-in permissions, that we do not read your mailbox, files or contacts for sign-in, and that Tielora's own second step still applies. Its data-inventory wording lines up with GO-LIVE gate 1.
- Also: `ai-assistant.md` rewrites the "only information that leaves" sentence in its own build; this build owns "ever emailed". Neither may leave a sentence that is no longer true.
- **Data rights (same diff):** deleting your account clears `microsoftOid`, `microsoftTenantId`, `dailyBriefEmailedAt` and sets all three preferences to off (add to the anonymisation in `account-deletion.ts` and its test); the personal export (`personal-export.ts`) includes the three preferences and a yes/no "signed in with Microsoft" — not the identifier; the workspace export (`workspace-export.ts`) includes the three preferences per person and the company's `entraTenantId`, and not any person's `oid`. Deleting a workspace removes everything (cascade, unchanged).

## Data touched (plain terms)

- Each person can carry a link to their Microsoft work account (two fields), and three yes/no email choices plus the date their last daily email went out.
- Each company can carry the id of its Microsoft directory once an administrator switches sign-in on.
- Nothing about a Microsoft token is stored for sign-in: we exchange the code, read who they are, and keep nothing but the identifiers above. (The OneDrive/SharePoint connection is a separate thing and unchanged.)
- No email content, subject or copy of any email is stored. No new table.

## Migrations (both additive; delete the five trigram `DropIndex` lines by hand and check `pg_indexes` on both databases afterwards, five rows each)

1. **`microsoft_sign_in`** — `User.microsoftOid String?`, `User.microsoftTenantId String?`, `@@unique([microsoftTenantId, microsoftOid])` (Postgres allows many rows where both are empty, so unlinked people don't clash), `Organization.entraTenantId String? @unique`. Null means "not linked / not switched on", which is what every row means today.
2. **`email_preferences`** — `User.emailAlerts Boolean @default(false)`, `User.emailDailyBrief Boolean @default(false)`, `User.emailWeeklyBrief Boolean @default(false)`, `User.dailyBriefEmailedAt DateTime?`. The database default is false, so every existing person is off. **New accounts get `emailAlerts: true` from the code that creates them** (`createUser` in both modes, the sign-up that creates a company's first administrator), not from the column default — so the migration can never switch anyone on.
Add both to the CONVENTIONS amendments list with the usual reasoning (additive, nothing dropped, null/false = today's behaviour). Note the two-part naming: `microsoft_sign_in` is also what Step 2c (Teams) reuses.

## Route and action additions (add to the CONVENTIONS tables)

| Route / action | Notes |
|---|---|
| `GET /api/auth/microsoft` | 302 to Microsoft; unset env → plain "not set up" (404 JSON), no redirect. Public, `byIp`. |
| `GET /api/auth/microsoft/callback` | Public. Success → 302 to the home page (or `/login` with the two-factor ticket in the fragment); every refusal → 302 `/login?microsoft=failed`. |
| `GET /api/auth/microsoft/enable` | ADMIN with `MANAGE_INTEGRATIONS`; same callback, state carries `purpose: "enable"` plus the admin's user and company; callback re-checks the current session is that admin. Outcome → `/admin/integrations?microsoftSignIn=enabled\|denied\|mismatch\|taken\|switchOffFirst\|failed`. |
| `disableMicrosoftSignIn` (action) | ADMIN, own company only, no id in the input. Audited, rate limited. → `ActionResult<{ removed: true }>` |
| `setEmailPreferences` (action) | The signed-in person's own; no id and no `assertCan` (the deleteMyAccount precedent — the only account it can reach is the session's); zod rejects unknown fields; ignores `emailDailyBrief`/`emailWeeklyBrief` for EXTERNAL people. Input `EmailPreferencesInput` (three optional booleans, at least one), output `EmailPreferencesDTO` (three flags, `verified`, `available`). |
| `POST/GET /api/email/unsubscribe`, page `/unsubscribe` | as above. |
| `/api/health` | `microsoft` gains `signInOrgs: n` (a count only). |
DTO and input names live in `src/lib/zod-schemas.ts` (house rule 4).

## Out of scope

- Microsoft-only enforcement (forcing a company's people off passwords), auto-creating accounts from a Microsoft login, importing people from Entra, group/role mapping, SCIM.
- A per-person "unlink my Microsoft account" button (switching the company off and on is the reset).
- Marking an email address "verified" because Microsoft vouched for it.
- The Teams tab and Teams single sign-in (Step 2c) — it reuses the fields added here.
- Personal Microsoft accounts (outlook.com/hotmail) — work and school accounts only.
- Per-person send times or time zones; more than one daily brief; the content of the weekly brief (its own spec); HTML or branded emails (plain text only, no template library); attachments; reply-to-act; push or SMS.
- Emailing every notification type (uploads and ordinary comments stay in the app), email for administrator housekeeping (contractor expiry warnings, workspace deletion), and any queue for email (same one-attempt-one-retry road as chat).
- Changing what the chat toggles do, or moving the daily chat digest.
- Bounce and complaint handling from Resend (a bounced address is not marked bad). Named follow-up if complaints appear.

## Bilingual note

Tielora is English-only (house rule 6): no Arabic strings, no i18n dictionary, and nothing here adds one. Two things still matter because people type in Arabic: (1) names, task titles and announcement text arrive in emails as typed, so emails are sent as UTF-8 and the "[link removed]" replacement must not damage right-to-left text around it (test with an Arabic title containing a link); (2) Microsoft returns names in the person's own script — never used for matching, only display. No date in any email uses a locale other than the app's "30 Sep 2026" form via `Intl`.

## Docs and privacy — exact rewrite list (same change)

`docs/CONVENTIONS.md`
- **House rule 11, "Transactional email…" bullet:** retitle to "Email is per deployment and nothing else"; say it now carries account links **and, opt-in per person, alert and brief emails**; unset still means no email is ever sent and nothing changes; `/api/health` unchanged. Add a bullet: **Sign in with Microsoft is per deployment AND per company** — the same `MS_GRAPH_*` registration as file attachments; unset means invisible (no button, login page unchanged, routes answer "not set up"); each company's administrator switches it on; `/api/health` reports `signInOrgs`.
- **"Transactional email" section:** rename to "Email (account links, alerts and briefs)"; keep the link-token rules for the three link purposes; add: alert emails (from `notify()`, the seven types, one per row, built from the row, plain text, URL neutralising, flood guard), the daily brief email and its per-person stamp, `chatCopy: false` suppresses both copies, verified-address rule, unsubscribe (headers, HMAC, neutral page, GET never acts), which emails are audited (link emails: `EMAIL_SENT` before the send; alerts/briefs: not, like chat copies), and the retired sentence. Add the test line: any change here extends `email.service.test.ts` **and** `integrations.service.test.ts`.
- **"Notifications and the deadline sweep":** the `notify()` bullet ("exactly one option") now says copies; `notify.ts`'s own comment "Email delivery, if it is ever added…" is updated in code; the sweep bullet lists the email step and that access-expiry warnings are in-app only.
- **"Chat delivery":** the daily-brief-digest bullet "chat-only" is corrected to "the chat digest is chat-only; the daily brief also exists as a per-person email, see Email"; the "documented exceptions to house rule 1" counting is kept true (the email digest is another read, no audit row, one stamp).
- **New section "Sign in with Microsoft"** (after "Two-factor sign-in"): the seven server rules above, the four rules (identity is `tid`+`oid`; a miss never says why; two-factor is never skipped; a login never lands in another company), the enable/disable rules, `TWOFA_PENDING_MICROSOFT`, and the test line naming `org-isolation`, `external-scoping`, `microsoft-signin.route.test.ts`.
- **"Two-factor sign-in":** one paragraph noting the Microsoft door leads to the same second step and the second purpose that is never emailed.
- **Route and DTO tables and `/api/health` row:** additions above. **Amendments list:** the two migrations. **"Data rights" sections:** the deletion and export lines above.
`docs/GO-LIVE.md`
- **Gate 1 bullets:** add Microsoft sign-in identity, email preferences and the last-daily-email date to the data inventory.
- **Section 2 (secrets table):** `MS_GRAPH_CLIENT_ID`/`SECRET` notes now also say they power sign-in and that a company sees nothing until an administrator switches it on; `RESEND_API_KEY`/`EMAIL_FROM` notes say they now also carry alerts and briefs (person by person), need a verified sending domain with SPF, DKIM and DMARC, and recommend a `mail.` subdomain; `APP_BASE_URL` note adds unsubscribe links; the **rotation paragraph** adds a fourth knock-on: unsubscribe links in existing inboxes stop working (people use Your account), and Microsoft sign-in itself is unaffected (no stored token).
- **Section 3 first-deploy checks:** add a Microsoft sign-in check (button visible only once the two variables are set; a test company switches it on; a wrong account sees the password-wrong sentence) and a "send yourself an alert and a daily brief, check Outlook shows its own Unsubscribe" check. Owner checklist items 3, 4, 5, 8, 11, 12, 13, 14 of the research note map onto this.
- **Section 6:** retitle to cover sign-in as well; add the second redirect address `<APP_BASE_URL>/api/auth/microsoft/callback`, the optional claims `email` and `xms_edov`, permissions `openid profile email`, and that the **admin-consent link for sign-in uses scope `openid profile email`**.
- **Section 9 "Email or SMS notifications"** (the "never emailed… and there is no plan to" bullet) is replaced: "Alert and brief emails exist, per person, off unless chosen (new accounts start with alerts on for a confirmed address); only what the in-app notification says; no SMS is ever sent. The retired rule: the owner's decision of 30 Sep 2026." Also keep the "A queue behind email" bullet and add that bounces aren't handled; adjust "One Microsoft sign-in per person" so it is clearly about file browsing, not sign-in; add "Microsoft-only sign-in" as deliberately not built.
`src/app/(public)/privacy/page.tsx` — as above. `docs/user-testing/research.md` cites the old rule (claim #76, question 5); note in the hand-off that it is a dated research record and is not edited here.

## Tests (extended or added in the same change; network mocked, `global.fetch`)

**`org-isolation.service.test.ts`** — a valid Microsoft token from tenant B (claimed by company B) **never** produces a session for company A, including when the token's email equals a company-A person's exact address; a token from an unclaimed tenant is refused; company A's administrator switching sign-in on with a tenant company B already holds is refused and B is unchanged; `disableMicrosoftSignIn` clears only its own company's links; `notify()` with a company-B person in the list sends no email to them even with their alerts on; the daily brief email run for company A contains no company-B project and reaches no company-B person; an unsubscribe token for one person changes only that person's row.
**`external-scoping.service.test.ts`** — a contractor with alerts on is emailed exactly their own row (title, sentence, link identical) and nothing else; a project-wide override, a comment fan-out on someone else's task and an announcement without `includeExternals` produce no email to them; the `chatCopy: false` contractor announcement half produces none; a contractor with a (forced) daily/weekly preference gets neither; an expired contractor and a deactivated contractor are refused at Microsoft sign-in with the generic sentence; a live contractor from the company tenant lands as EXTERNAL and on My tasks.
**`integrations.service.test.ts`** — alert email only for the seven types; none for `DOCUMENT_UPLOADED`/`COMMENT_ADDED`; alerts off means none whatever the chat toggles say; chat toggles off with alerts on still emails (D6); unverified address gets none; exactly one email per notification row and per recipient; `notify()` resolves even if the mail call hangs or fails (not awaited); 429 retried once then dropped; dormant email sends nothing and changes nothing; `chatCopy: false` sends none; access-expiry warnings and workspace-deletion messages send none; typed links neutralised in title and body (including around Arabic text) and control characters stripped from the subject; unsubscribe headers present on alerts and briefs and **absent** on invite, reset and verification; the 21st alert in an hour is held back; sweep reminders email the right person only within the budget; daily brief email: once a day per person, stamped after the attempt, empty day sends nothing but stamps, budget cut resumes with the not-yet-sent, opting in stamps today, runs when the company has no chat channel, dormant stamps nothing, contractors skipped, and writes no notification row and no audit row.
**New `microsoft-signin.route.test.ts` (or `microsoft.service.test.ts` additions)** — token validation: bad signature, wrong audience, wrong nonce, expired, `iss` not matching the token's own `tid`, missing `oid`/`tid`, malformed `tid`; first link needs `email` and `xms_edov` true; a linked person signs in by `oid` with no email claim; a different `oid` on a linked account is refused; two simultaneous first sign-ins → one link; refusal text is byte-identical to the password route's and the same status; unset env → login page contains no "Microsoft" text and no link to `/api/auth/microsoft` and ignores `?microsoft=failed`, and the routes answer "not set up"; enable requires the Microsoft email to equal the admin's Tielora email; enable when already linked to another tenant → switch-off-first; disable clears links, leaves sessions, audits.
**`two-factor-signin.route.test.ts`** — a Microsoft sign-in for a person with two-factor on creates no session, no cookie, no `LOGIN` row and no `lastLoginAt` until the code is accepted; then one `LOGIN` row with `method: "microsoft"`, `twoFactor: true`; the ticket is never in a query string; changing a password or disabling two-factor retires Microsoft tickets too.
**New `email-preferences.service.test.ts` / `unsubscribe.route.test.ts`** — defaults: existing rows off, new invitee/created/signed-up accounts alerts on and both briefs off; toggles audit only when a value changes; unverified people cannot be sent to even when switched on; unsubscribe: POST with the one-click body flips only that kind, GET never does, valid/tampered/old/deactivated tokens return the identical page (same status and body), constant-time compare used, the rate-limit ceiling; the card's server data shows nothing while email is dormant.
**Existing files extended:** `account-deletion` test (identifiers and preferences cleared), personal-export and workspace-export tests (preferences in, `oid` out), the health-route test (`signInOrgs`), and the login page test (unset = unchanged).
The full verify recipe passes with more tests than before.

## Done when (tick each — a non-developer can check)

- [ ] With the Microsoft app settings **not** set, the login page looks exactly as it does today: no Microsoft button, no extra line. Admin → Integrations has no Microsoft card, and the list is Teams then Slack.
- [ ] With them set, the login page shows "Sign in with Microsoft" and the small grey line, and the page still works on a phone.
- [ ] An administrator presses **Switch on** in the Microsoft 365 card, signs in to Microsoft, and lands back with "Sign in with Microsoft is on for your company". Trying with a Microsoft account whose email differs from their Tielora email shows the plain "use the same email" message and changes nothing.
- [ ] A colleague with a Tielora account and the same work email presses the button, signs in at Microsoft, and is in. A person with no Tielora account, a deactivated person, and a person from a different company's Microsoft all see exactly "Incorrect email or password." — the same words as a wrong password.
- [ ] A colleague who has Tielora two-factor on is still asked for their six digits after Microsoft.
- [ ] The Activity trail shows the sign-in as a Microsoft sign-in; it never shows a Microsoft id.
- [ ] Switching it off shows the confirmation, removes everyone's Microsoft link, signs nobody out, and the button then gives the plain wrong-password sentence again.
- [ ] From company B's Microsoft account, you cannot get into company A, even if you type company A's person's exact email address in your Microsoft profile.
- [ ] Admin → Integrations lists Microsoft 365, then Microsoft Teams, then Slack.
- [ ] With email set up, Your account has an "Email" card: alerts, daily brief (and, later, weekly). Existing people are all off; a newly invited person has alerts on and the briefs off. With email not set up, the card is not there.
- [ ] A person with alerts on and a confirmed address is assigned a task by a colleague and gets one email with the same title and sentence as the in-app notification and a link back. A person with alerts off gets none, even if their company's chat has "task assigned" on.
- [ ] A comment on a task, or a document upload, sends no email.
- [ ] A task titled "Sign in at https://example.com" arrives in the email with "[link removed]" and is unchanged in the app.
- [ ] A person with an unconfirmed address sees "Confirm your email address first" and gets nothing until they do.
- [ ] A person with the daily brief on gets one email the next morning after 05:00 UTC listing their own day, none on a day with nothing to say, and never two in a day; a company with no Slack or Teams still gets them.
- [ ] Outlook shows its own "Unsubscribe" on an alert and a brief; pressing it turns that one email kind off with no sign-in. The link at the bottom of the email opens a page with one button; opening the link alone changes nothing. A mangled link shows the same page.
- [ ] Invitation, reset and verification emails have no unsubscribe link.
- [ ] A contractor has only the alerts switch, gets an email only for things assigned to them, and never a daily brief; a contractor whose access has ended cannot get in with Microsoft.
- [ ] Deleting an account clears its Microsoft link and email choices; the personal download shows the choices.
- [ ] The privacy page describes Microsoft sign-in and the alert and brief emails, and no page or document says task alerts are never emailed. `docs/CONVENTIONS.md` and `docs/GO-LIVE.md` are updated as listed, including the two migrations in the amendments list.
- [ ] `/api/health` still reports email `"dormant"` when not set up, and the Microsoft line shows how many companies have sign-in on (a number only).

## Handshakes with the other specs

- **Weekly brief (`briefs-and-status-report.md`):** it reads `emailWeeklyBrief` and uses the `WEEKLY` unsubscribe kind built here. Its open question 1 proposed a company-level "already sent" date; this build chose a **per-person** date for the daily email for the reason given above, and dev-lead should make the weekly email use `User.weeklyBriefEmailedAt` (added in its own `weekly_brief` migration) rather than `Organization.weeklyBriefEmailedAt`. The weekly build also adds the weekly row to the Email card. Its privacy check ("if this step's wording says only daily brief and alerts, add weekly summary") is already satisfied here.
- **Teams app (Step 2c):** may assume `Organization.entraTenantId`, `User.microsoftOid`/`microsoftTenantId` exist and are filled by the rules above; its token validation reuses this build's validator, and the SSO tab matches on a linked `oid`.
- **AI assistant:** independent; only the shared privacy page needs a merge check.

## Build order

1. `microsoft_sign_in` migration, ID-token validator (pure, unit-tested), start/callback/enable routes, login page + form, Microsoft card two-part layout, integrations order, `disableMicrosoftSignIn`, health.
2. `email_preferences` migration, preference action + Your account card, `email.ts` headers argument, unsubscribe token/route/page, `notify()` email copy, sweep email steps, daily brief email.
3. Docs and privacy page, then tests are written alongside each step (not at the end).
Run `ui-designer` first (screens above). Review focus for `code-reviewer`: tenant leaks first (a Microsoft login must never land in another company; email lookup always scoped to the company that owns the `tid`), then token handling (state, nonce, PKCE, ID-token checks, nothing sensitive logged or audited), then the contractor wall on email.

## Open questions (each with my default)

1. **Should new accounts start with alerts ON (D5)?** *Default:* yes, alerts on for newly invited, created or signed-up people (sent only once their address is confirmed), briefs off, everyone existing off. *Alternative:* everything off for everybody, with people opting in themselves — the safest, but few will ever find the switch.
2. **What is in the daily brief email?** *Default:* each person's own "Your day" (what is due, overdue, unblocked, needs review), internal people only, skipped on empty days. *Alternative:* a company/project-level digest like the Slack card, limited to the person's projects (bigger, and it repeats the weekly brief's job).
3. **Should password sign-in keep working for everybody once Microsoft sign-in is on?** *Default:* yes — both doors work, and enforcing Microsoft-only is out of scope for this round (it needs a break-glass route for administrators locked out of Microsoft). *Alternative:* a per-company "Microsoft only" switch later.
