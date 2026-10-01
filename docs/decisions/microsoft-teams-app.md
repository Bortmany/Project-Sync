# Microsoft pieces: how they should be built (Step 2a)

Status: **waiting for the owner's approval of the approach**, and the owner checklist at the end is
theirs to start. Written by the researcher agent for the October 2026 alignment round (30 Sep 2026).

**Two findings that change the plan**
- Tielora's sign-in cookie is `SameSite=Lax` (`src/lib/auth.ts:74`). Inside Teams, Tielora sits in a frame and the browser will not send that cookie. The tab needs its own session arrangement (Part 2).
- `next.config.ts` blocks all framing twice: `frame-ancestors 'none'` (line 51) and `X-Frame-Options: DENY` (line 64). Both must be relaxed for the tab route only.

**One change from the build plan (orchestrator's note):** the build plan had an admin *type* the company's Entra tenant id on the Microsoft card. This research recommends the admin instead does one Microsoft sign-in from Admin, and the app stores the tenant id from Microsoft's own token — so no admin can claim another company's tenant. The specs follow this safer version.

---
## Part 1 — Sign in with Microsoft

**What it is.** A "Sign in with Microsoft" button on the login page. A company's people use their normal work login. Tielora only lets them in if their company has been switched on for it and they already have a Tielora account.

**How it works for a person**
1. They press the button and go to Microsoft's sign-in page.
2. Microsoft tells us which company (tenant) they belong to, a permanent personal ID, and their work email.
3. We check that the company is switched on and that their email matches an account in that company.
4. If it matches, they are in. Two-factor still applies: Tielora's own code step runs before any session is created, exactly as with a password. Microsoft's own two-factor is a bonus, not a replacement.
5. If anything fails, they see the same words as a wrong password. Nobody learns whether the company, the tenant or the account was the problem.

**Setup facts**
- **Admin consent:** sign-in asks only for `openid profile email`, which ordinary users can approve. A company that has locked down consent shows "needs admin approval"; its Microsoft admin approves once with the admin-consent link from GO-LIVE section 6, scope `openid profile email`.
- **Second redirect address:** add `<APP_BASE_URL>/api/auth/microsoft/callback` (plus a localhost one for testing) to the existing registration. The existing `/api/integrations/microsoft/callback` stays for OneDrive.
- **Same registration, same client ID and secret.** Do not request `offline_access` or `Files.Read.All` at sign-in.

> **Technical notes for the builder**
> - Endpoint: `https://login.microsoftonline.com/organizations/v2.0/authorize` (work and school only). Authorization-code flow with PKCE, plus a random `state` and `nonce` bound to a short-lived cookie. Validate the ID token: signature against the JWKS, `aud` = client id, `nonce`, and `iss` equals `https://login.microsoftonline.com/{tid}/v2.0` with the token's own `tid` (the `/organizations/` metadata has a templated issuer).
> - Extend the SSRF host guard in `graph.ts` to cover the JWKS fetch (or reuse `login.microsoftonline.com`).
> - Trust **`tid` + `oid`** as the identity. Never authorise on `email` or `preferred_username` alone — the "nOAuth" flaw ([Microsoft guidance](https://learn.microsoft.com/en-us/entra/identity-platform/migrate-off-email-claim-authorization)).
> - Add optional claims `email` and `xms_edov` (Token configuration → ID token). Use the email for the first-time match only when `xms_edov` is true; otherwise refuse with the generic message. `preferred_username` is display-only.
> - Schema: `Organization.entraTenantId` (unique, nullable) and `User.microsoftOid` (nullable, unique together with the tenant). The admin sets the tenant by doing a Microsoft sign-in from Admin; we store the `tid` from the token. Never typed in.
> - Matching: lowercase the email; look up `User` where `orgId` = the org that owns that `tid`, email matches, active, not expired, not deactivated. Then pin `microsoftOid`. After the first sign-in match on `oid` only; a different `oid` on a pinned account is refused.
> - Reuse `createSession` after the existing two-factor step. Rate-limit the callback like the other auth routes. `LOGIN` audit row as password sign-in writes. Extend `org-isolation.service.test.ts`: a valid token from tenant B must never land in company A.
> - Contractors (EXTERNAL) follow the same path; expiry and deactivation checks already live in the session layer.

---
## Part 2 — The Teams app

**What it is.** One Tielora app package a company installs into Teams: a Tielora tab (their day, projects and tasks, inside Teams). Notifications stay as they are for now.

**Package:** `manifest.json` (current 1.2x schema, validated in the Teams Developer Portal); 192×192 colour and 32×32 outline PNG icons; a **personal tab** (`staticTabs`) opening Tielora's "your day" page — build this first. A **channel tab** (`configurableTabs`, pointing at one project) is a later follow-up.

**Sign-in inside the tab:** recommended **Teams single sign-on** — Teams hands the tab a token silently; our server checks it and looks the person up exactly as in Part 1. Fallback: a popup to our Microsoft sign-in (`authentication.authenticate`) that hands back a one-time code. The tab route's session cookie needs `SameSite=None; Secure; Partitioned`; everything else stays Lax. Tielora two-factor still shows its code prompt.

**Notifications — three options**
- (a) **Keep the Workflows webhook** for channel copies. Works today, no Azure resource, no install; posts to a channel, not a person.
- (b) **Bot with proactive messages** — real one-to-one messages; needs an Azure Bot resource, a bot secret, a public endpoint, and each person to install the app.
- (c) **Activity-feed notifications** (`TeamsActivity.Send`, admin consent, app installed per user) — the native bell; most fiddly.
- **Recommendation for this round: tab + the existing webhook (a).** Named follow-up: the bot (b) next round. (c) only if customers ask for bell alerts. **So no `teams_installations` migration this round.**

**Publishing:** pilots sideload the zip (tenant must allow custom apps); a customer's Teams admin uploads it to their org catalogue; Teams store later (weeks of validation; needs privacy, terms, support pages).

**Account the owner needs to test:** the free **Microsoft 365 Developer Program** sandbox tenant (Teams, Entra, test users, custom app upload on) — or any business Microsoft 365 tenant where the owner is Global and Teams admin. A personal Outlook.com/Hotmail account will not work.

> **Technical notes for the builder**
> - Manifest: current `manifestVersion`; `id` = app GUID (from env `TEAMS_APP_ID`); `developer` block with https URLs; `staticTabs: [{entityId, name, contentUrl: "<APP_BASE_URL>/teams/tab", scopes: ["personal"]}]`; `validDomains: [<our host only>]`; `webApplicationInfo: {id: <MS_GRAPH_CLIENT_ID>, resource: "api://<host>/<client id>"}`.
> - Azure for SSO: Application ID URI `api://<host>/<client id>`; scope `access_as_user`; pre-authorise the Teams clients `1fec8e78-bce4-4aaf-ab1b-5451cc387264` and `5e3ce6c0-2b1f-4285-8d4b-75ee78787346` (check on Learn, "Update manifest to enable SSO for tabs").
> - New route `/teams/tab` with its own layout. Only there: `frame-ancestors 'self' https://teams.microsoft.com https://*.teams.microsoft.com https://*.office.com https://*.microsoft365.com https://outlook.office.com https://*.cloud.microsoft` (confirm the list on Learn) and **no** `X-Frame-Options`. Everywhere else stays `'none'` / `DENY`. Verify with the curl recipe in GO-LIVE section 3.
> - `@microsoft/teams-js` bundled through npm (never a CDN — the CSP blocks it): `app.initialize()`, `authentication.getAuthToken()`, `app.notifySuccess()`.
> - Validate the Teams token server-side like the sign-in token (`aud` = `api://…`, `tid`, `oid`). It has no reliable verified email, so match on a pinned `oid`; otherwise fall back to the popup path for the first link.
> - Partitioned cookie (CHIPS) works in Chrome/Edge; Safari/Teams-web may block third-party storage — fallback is a short-lived signed token kept in memory. Test in Teams desktop, web and mobile.
> - Links to other pages from the tab use `app.openLink`.

---
## Part 3 — Outlook email

**Can Resend reach Microsoft 365 mailboxes reliably? Yes, once the sending domain is set up properly.**
- **SPF**, **DKIM** and **DMARC** on the sending domain. Resend supplies SPF and DKIM; DMARC is added by hand (start `p=none`, move to `quarantine` once reports are clean).
- Microsoft's 2025 bulk-sender rules (Outlook.com, over 5,000 a day) require all three aligned; Exchange Online filtering weighs the same signals, so treat them as mandatory.
- Send from a subdomain (`mail.<yourdomain>`) so brief traffic cannot hurt account emails.
- Briefs and alerts are bulk-style mail, so every one carries a working **one-click unsubscribe** per person.

> **Technical notes for the builder**
> - Resend's `/emails` endpoint takes a `headers` object ([docs](https://resend.com/docs/dashboard/emails/custom-headers)). On each brief/alert only (never invites, resets, verification): `List-Unsubscribe: <https://<host>/api/email/unsubscribe?t=TOKEN>` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click` (RFC 8058).
> - The URL accepts a `POST` with body `List-Unsubscribe=One-Click` and unsubscribes immediately, no login; a visible link in the body goes to a confirmation page. A miss shows the same neutral page.
> - Token: per person and per kind, reusable (not the single-use email token). Either an HMAC from `SESSION_SECRET` under a new purpose, or an `EmailToken` row with purpose `UNSUBSCRIBE` — the spec decides.
> - Extend `src/server/services/email.ts` to accept extra headers. Dormancy (`emailAvailable()`) unchanged. Public, rate-limited routes; the sender only emails that person's own data.

---
## Owner checklist (in order)

**[Local]** = needed to test on the Mac · **[Live]** = needed for launch.

1. **[Local]** Join the free Microsoft 365 Developer Program and create a sandbox tenant with two or three test users. Keep the admin login.
2. **[Local]** Sandbox Teams admin centre → Teams apps → Setup policies → Upload custom apps: on.
3. **[Local]** portal.azure.com → App registrations → the Tielora registration → Authentication → add Web redirect `http://localhost:3000/api/auth/microsoft/callback`.
4. **[Local]** Same registration → Token configuration → Add optional claim → ID token → tick `email` and `xms_edov` → accept the prompt.
5. **[Local]** API permissions: confirm `openid`, `profile`, `email` are listed.
6. **[Local]** Expose an API: Application ID URI `api://<test host>/<client id>`, scope `access_as_user`, pre-authorise the two Teams client IDs above.
7. **[Local]** Teams will not load `http://localhost` — a public HTTPS address is needed for the Teams tab test; add it as a redirect too.
8. **[Live]** Add `https://<live domain>/api/auth/microsoft/callback` as a redirect.
9. **[Live]** Confirm the registration is still multitenant (GO-LIVE section 6) and the client secret's expiry is in your calendar.
10. **[Live]** Update the Application ID URI and Teams manifest to the live domain; upload the zip to a pilot customer's Teams admin (or sideload for pilots).
11. **[Live]** Resend → Domains → add `mail.<yourdomain>`, copy the SPF and DKIM records to your DNS provider, wait for "Verified".
12. **[Live]** DMARC: `_dmarc.mail.<yourdomain>` TXT `v=DMARC1; p=none; rua=mailto:<your address>`; move to `p=quarantine` after two clean weeks.
13. **[Live]** Set `EMAIL_FROM` to an address on that subdomain in Railway, redeploy, send a test to a real Microsoft 365 mailbox, check the inbox and Outlook's "Unsubscribe".
14. **[Live]** For a customer whose Microsoft admin blocks user consent, send them the admin-consent link (scope `openid profile email`).
15. **[Later]** Azure Bot resource and secret (bot follow-up); Teams store submission.

Not verified on Learn: the exact current `frame-ancestors` host list and the current manifest schema number — the builder checks both before coding.

Sources: [Microsoft Learn: migrate off email claims](https://learn.microsoft.com/en-us/entra/identity-platform/migrate-off-email-claim-authorization), [Teams manifest schema](https://learn.microsoft.com/en-us/microsoft-365/extensibility/schema/), [Teams tab SSO manifest](https://learn.microsoft.com/en-us/microsoftteams/platform/tabs/how-to/authentication/tab-sso-manifest), [Resend custom headers](https://resend.com/docs/dashboard/emails/custom-headers).
