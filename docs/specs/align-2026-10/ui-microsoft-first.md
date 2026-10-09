# Tielora — UI spec: Sign in with Microsoft, Integrations order, Teams app card, Email preferences, unsubscribe page, email layouts, Teams tab

Companion to `microsoft-first.md` and `teams-app.md` (behaviour, server rules and refusal sentences live there; this file only decides how it looks). Same conventions as `ui-export-report.md` and `ui-ask-tielora.md`.
Rules followed: `CONVENTIONS.md` house rules 6-8 (plain English, dates like "30 Sep 2026", brand tokens from `src/app/globals.css` only, no new hex) and THE EXTERNAL RULE (a contractor sees the smallest possible version of everything below). Builders copy from the live code, not `docs/design-notes.md`.

**Mobbin references:** pulled by the orchestrator on 30 Sep 2026 — listed under "Prior art" at the bottom of this file. They inform, they do not replace the app's styling.

**Proposed additions to the design system: two, both small.**
1. A **Microsoft logo file** (`public/brand/microsoft-logo.svg`, the four-square mark, 21x21) used only on the sign-in button. See the flagged conflict in 1.1.
2. A **download icon** in `src/components/shell/icons.tsx` (same stroke style; the Export button in `ui-export-report.md` needs the same one, so add it once).
No other new colours, fonts or components. Reused: `Button`, `Card`, `Badge`, `Field`, `Input`, `Modal`, `ErrorBanner`, `Spinner`, `SkeletonRows`, `useToast`, `CalmStrip` look (from `account/two-factor-card.tsx`), `GoodNews` and `AuthSplit` (`src/app/(auth)/auth-split.tsx`), the `<details>` steps pattern (`admin-integrations-view.tsx` `SetupSteps`), the checkbox-row pattern (`EventToggleList`), and the dl layout in `admin-microsoft-card.tsx`.

**Rules for every control below.** Anything tappable is at least **44px** tall (`min-h-11`; the shared `Button` is only about 36px, so add the class). Text sizes used: 12, 14, 16, 20 only. Anything a person must read is `--brand-text` or darker; `--brand-gray` is for placeholders, dividers and disabled looks only. Long text uses `break-words min-w-0`. Focus ring is the existing `--brand-accent` outline. The app has no dark theme, so skeletons are the existing grey pulse; if a dark theme is ever added they keep using `--brand-gray` at 30%.

---

## 1. Login page

Files: `src/app/(auth)/login/login-form.tsx` (all new UI lives here, inside phase 1), `login/page.tsx` (passes two yes/no values, only when the deployment is set up).

### 1.1 The button and Microsoft's brand rules
Microsoft's sign-in button rules (light style): white button, thin grey border, the four-colour Microsoft logo on the left, the exact words **"Sign in with Microsoft"**, logo not altered, recoloured or animated, at least 41px tall, ~12px between logo and text. Applied here:

| Part | Microsoft asks | Tielora uses | Note |
|---|---|---|---|
| Wording | "Sign in with Microsoft" | exactly that | never shortened, never "Sign in with Office" |
| Logo | four-colour squares, 21x21, unaltered | the SVG file, 21x21, `aria-hidden` | **CONFLICT, see below** |
| Background | white | `--surface` (white) | same |
| Border | 1px mid grey (#8C8C8C) | 1px `--brand-gray` | close; the nearest allowed token |
| Text | dark grey (#5E5E5E), Segoe UI, semibold | `--brand-text`, the app's font stack, 14px semibold | Segoe UI is already second in the stack; 14px keeps the app's size scale (Microsoft shows 15px) |
| Height | 41px minimum | 44px | thumb rule and Microsoft rule agree |
| Shape | square-ish | the app's 6px radius | fine |

**CONFLICT with house rule 7 (no new hex anywhere).** The Microsoft logo is four fixed colours (#F25022, #7FBA00, #00A4EF, #FFB900) that Microsoft forbids changing. Resolution: the logo is a **picture file, not a style**. The four colours live inside the SVG (like a photograph), never in `globals.css`, a component or a class. No token is added and no CSS uses those hex values. **The owner should confirm this reading of the rule** (design call 1). The alternative is a text-only button, which breaks Microsoft's brand terms.

### 1.2 Placement and the "or" divider (only when the deployment is set up)
Order in the form panel, top to bottom: heading "Sign in" -> subline -> (refused strip, if any) -> email -> password -> "Forgot password?" -> **Sign in** (existing, unchanged) -> **divider "or"** -> **Sign in with Microsoft** -> grey line -> (existing) "Setting up a new company? Create a workspace." -> Privacy / Terms.
- Password stays first and primary (blue): it is what everybody has today. Microsoft is the second door, in a white button so it never competes with the blue one.
- Divider: a `--border` hairline on each side of a centred "or" (12px, `--brand-text`), 24px above it, 16px below. Decorative (`aria-hidden`); the button beneath says everything a screen reader needs.
- Button: full width of the form column, 44px, logo left, text centred in the rest. 8px under it, one line (12px, `--brand-text`, `break-words`): **"Works once your company's administrator has switched it on."** The same line for every visitor; it names no company.
- Hover hint (`title`): "Sign in with your Microsoft work account".
- It is a real link (`<a href="/api/auth/microsoft">`), not a fetch, so a full navigation happens. Keyboard: Tab order is email, password, Forgot password, Sign in, Microsoft button, Create a workspace.
- Button states: default; hover `--page-bg` fill; pressed `--border` fill; focus ring; **loading after the press**: logo stays, text becomes "Opening Microsoft…", button ignores further presses (`aria-busy="true"`, `pointer-events-none`). If the person comes back with the browser's Back button the page restores from memory, so reset this state on `pageshow`. No disabled state exists (it is there or it is not).
- **Phone (390px):** the form column is 390 minus 64px padding = 326px wide; hero band (192px) sits above. The Microsoft button ends roughly 700px down, so on a short phone it sits just below the fold. That is accepted: it is the second door. If the owner's customers are mostly Microsoft companies, moving it above the password form is a one-block change (design call 2).
- **Laptop (1440px):** `AuthSplit` is unchanged: hero 45% (648px) left, form column centred in the right half at `max-w-sm` (384px). The button is that 384px wide. The extra screen is the hero's job, as today; nothing stretches.

### 1.3 Dormant: byte for byte unchanged
While the two Microsoft settings are unset the page renders **no divider, no button, no grey line, no wrapper element, no extra class, no extra text**, and the `?microsoft=failed` parameter is ignored (no message). The two new props are simply absent, and the block is written as `{available ? <MicrosoftBlock /> : null}` at the very end of phase 1, so the existing markup is not re-wrapped. Nothing above is drawn "hidden" or greyed.

### 1.4 Refused state
Any Microsoft failure returns to `/login?microsoft=failed`. The page shows the **same strip as a wrong password**, with exactly **"Incorrect email or password."** (import the one shared constant; do not retype it). Same look as the existing alert (`--status-blocked` tint, `role="alert"`). One difference in position only: because the person has just left the page, the strip sits **directly under the subline, above the email field**, so it is on screen on a phone without scrolling (the existing password strip stays above the Sign in button). Nothing tells them which Microsoft step failed. Email and password fields are empty and focus is not moved (a phone keyboard would hide the message). After showing it, remove the parameter from the address (`history.replaceState`) so a refresh shows the ordinary page.

### 1.5 Two-factor step after Microsoft
Microsoft says yes, the person has Tielora two-factor on -> they arrive at `/login#<ticket>`.
- The form reads the fragment once, removes it from the address at once, and shows the **existing phase 2** (six-digit code, recovery-code link, "This step expires in 5 minutes.", "Verify and sign in", "← Back"). Nothing new to build except the subline, which reads **"Microsoft accepted your sign-in. Enter the code from your authenticator app to finish."** (the password path keeps its existing subline).
- To avoid a one-frame flash of the password form, only when the deployment is set up, hold the form area empty until the first client render has checked for a ticket. Dormant pages never do this (byte-for-byte rule).
- "← Back" drops the ticket and shows the ordinary form. A wrong code, a 429 and an expired ticket use the existing strips and words. A refresh loses the ticket (it was removed from the address), so the person simply signs in again; that is intended.

---

## 2. Admin → Integrations

Files: `src/components/admin/admin-integrations-view.tsx`, `admin-microsoft-card.tsx`, new `admin-teams-app-card.tsx`.

### 2.1 Card order (fixed in the view; never database order)
1. **Microsoft 365** (sign-in + files)
2. **Microsoft Teams app** (new)
3. **Microsoft Teams channel** (today's "Microsoft Teams" chat card; see rename below)
4. **Slack**
5. **AI** (designed in `ui-ask-tielora.md` section 5; **that file's placement "before the Microsoft card" is superseded by this order**)
6. **Company noticeboard** (today's broadcast card)

Cards that are dormant are simply absent and the rest close up: no Azure app -> 1 and 2 vanish (list is 3, 4, 5, 6); no `TEAMS_APP_ID` -> only 2 vanishes; no AI key -> only 5 vanishes.
- **Phone:** one column in that order.
- **Laptop (1440px):** the existing two-column grid; row 1 = Microsoft 365 | Teams app, row 2 = Teams channel | Slack, row 3 = AI | Noticeboard. The two Microsoft cards sit side by side, which is what the "link Microsoft first" notice needs. **Add `items-start` to the grid** so a short card is not stretched to the height of the tall Microsoft 365 card (no empty white boxes).
- Page intro (14px): "Connect the Microsoft tools your team already uses, and send a copy of your notifications to a chat channel. Notifications inside Tielora carry on either way — these are extra copies, not replacements."
- **Rename (small, needed):** two cards both titled "Microsoft Teams" would confuse. The chat card's **title** becomes **"Microsoft Teams channel"**; the new one is **"Microsoft Teams app"**. Toasts and other strings keep `KIND_LABEL` as is (design call 3).
- Give the Microsoft 365 card `id="microsoft-365"` so the Teams app card can link to it.

### 2.2 Microsoft 365 card: two labelled parts
Card title **"Microsoft 365"**, no badge in the card header (each part carries its own). Two sections separated by a `--border` hairline and 16px padding; each section has a header row: heading (14px semibold `--brand-ink`) left, badge at the **reading end**.

**Part 1 — "Sign in with Microsoft"** (new, top). Badge: **On** (accent fill, ink text) / **Off** (`--brand-mid`).
- *Outcome banner* (top of the part, from `?microsoftSignIn=`): good = the accent-tint strip used today (`role="status"`), bad = `ErrorBanner`. Texts exactly as `microsoft-first.md` 1.D: enabled "Sign in with Microsoft is on for your company (contoso.com)."; denied "The Microsoft sign-in was cancelled, so nothing was changed."; mismatch "Sign in with the Microsoft account that uses the same email address as your Tielora account, then try again."; taken "That Microsoft company is already linked to another Tielora workspace. If that is a mistake, contact Tielora support."; switchOffFirst "Switch it off first, then switch it on with the Microsoft account you want."; failed "Microsoft could not complete that. Try again." Remove the parameter from the address once shown.
- *Off:* text (14px `--brand-text`): "Let your people sign in with the Microsoft work account they already use. They still need a Tielora account — this does not create one." Small line (12px `--brand-text`): "You will sign in to Microsoft with your own work account. Use the same email address you use here." Button **Switch on**: a link (`<a href="/api/auth/microsoft/enable">`) styled exactly like today's "Connect" link (primary look) plus `min-h-11`. Hint (`title`): "Sign in to Microsoft to link your company". After pressing: "Opening Microsoft…", ignores repeat presses (as 1.2).
- *On:* a dl in today's style (label 14px semibold ink, value beside it, wraps on phone: `flex flex-wrap gap-x-2`):
  - "Microsoft company:" **contoso.com** if the latest audit row carries the domain, otherwise "Linked" (the domain is not stored on the company; design call 4).
  - "Switched on by:" "Salma Al Hinai on 30 Sep 2026" (or "Someone who has since left").
  - "People signed in with Microsoft:" "12" (plain sentence form: "12 people have signed in with Microsoft so far." / "Nobody has signed in with Microsoft yet.").
  - Ghost button **Switch off** (44px). Hint: "Switch off Sign in with Microsoft for everyone".
- *Confirm dialog* (`Modal` size `sm`; first focus on Cancel). Title **"Switch off Sign in with Microsoft?"**. Body: "Everyone will sign in with their password again. Each person's Microsoft link is removed (12 people at the moment), so if you switch it back on, people link again the first time they sign in. Nobody is signed out right now. Anyone who has forgotten their password can use “Forgot password?” on the sign-in page." (Drop the last sentence when email is not set up.) Buttons: **Cancel** (ghost) and **Switch off** (primary, loading while saving). Escape, the X and Cancel change nothing.
- *Outcomes:* success toast "Sign in with Microsoft is off. Everyone signs in with their password again." and the part flips to Off. Failure: `ErrorBanner` "Couldn't switch that off. Try again." Rate limit: the server's plain sentence.
- If the site's own web address is not set (`callbackReady` false), the part shows today's `APP_BASE_URL` paragraph and no button.

**Part 2 — "OneDrive and SharePoint files"** — today's card content unchanged (its status badge, text, banners, dl, steps, Connect/Disconnect, dialog). Only two edits: heading moves into the section header, and the "Connect" / "Connect again" links get `min-h-11`. The two parts work without each other.

### 2.3 Microsoft Teams app card (new, administrators only)
Title **"Microsoft Teams app"**. Badge: **Ready** (accent) when Microsoft sign-in is on for the company, otherwise **Needs Microsoft sign-in** (grey default).
Top to bottom:
1. Intro (14px): "Put Tielora inside Teams. Your people get a “Your day” tab in the Teams sidebar. Channel messages are set up separately, in the Teams channel card, and are not changed by this."
2. *If Microsoft sign-in is not on*, a calm strip (accent tint, `CalmStrip` look, `role="status"`): "People cannot sign in inside Teams until you switch on Sign in with Microsoft. Do that first, in the Microsoft 365 card." followed by a link **"Go to that card"** (44px tap area, jumps to `#microsoft-365`). The download button below still works.
3. Button **Download Tielora for Teams** (primary, download icon + words, 44px). Hint: "Save the Tielora app file to upload into Teams". It is a button that fetches the file, not a bare link, so errors can be shown: *loading* "Preparing…" (spinner, disabled, fixed width); *success* the browser saves `tielora-teams-app.zip` and a success toast says "Tielora for Teams is ready. Check your downloads."; *errors* as a red line under the button (`role="alert"`, 14px `--status-blocked`): 429 "You have downloaded this a lot just now. Please wait a minute."; anything else "We could not prepare the file. Please try again."
4. Helper (12px, `--brand-text`): "This file is the same for everyone at your company. It contains no passwords or secrets."
5. **"How to add it to Teams"** — a `<details>` in the existing steps style; the summary row is at least 44px tall, hint "Step-by-step instructions for adding Tielora to Teams". Inside (12px steps, `break-words`), three short groups:
   - *Just to try it (only for you):* "In Teams choose Apps, then Manage your apps, then Upload an app, then Upload a custom app, and pick the file. If you do not see “Upload a custom app”, your Teams administrator has switched that off. Use the next route."
   - *For everybody at your company:* "Your Teams administrator opens the Teams admin centre, then Teams apps, then Manage apps, then Upload new app, and picks the file. Optionally they add it to a setup policy so it appears pinned for everyone."
   - *First time in the tab:* "Each person may see a Microsoft approval screen once. If it says it needs administrator approval, your Microsoft administrator approves Tielora once for the company."
   - Closing line: "You will know it worked when Tielora appears in Teams with a tab called Your day."
- **Phone:** everything stacks; the button is full width. **Laptop:** the card is half-width (about 600px) beside Microsoft 365; the button is its natural width, left-aligned.
- Loading/skeleton: none (server-rendered with the page). Not shown to non-administrators or contractors at all.

---

## 3. Your account: the "Email" card

File: new `src/components/account/email-preferences-card.tsx`, mounted in `src/app/(app)/account/page.tsx` **between `TwoFactorCard` and `DeleteAccountCard`** (inside the existing `max-w-2xl` column). Read on the server like two-factor, so it is right on first paint (no skeleton, no flicker).

**Dormant (email not set up): the card is not drawn at all** (no gap, no explanation), matching the "Verify your email" banner. Reason: a signed-in person cannot fix it, and an explanation would advertise a feature that does not exist here.

### 3.1 Layout
- Card title **"Email"**, no badge. Intro (14px): "Choose which emails Tielora sends to **name@company.com**." (address `break-words`).
- Rows in the existing checkbox-row pattern (whole row `min-h-11`, checkbox enlarged to 20px, bold label 14px `--brand-ink`, helper 12px `--brand-text`). The spec calls them switches; they are drawn as checkbox rows for consistency with Integrations rather than inventing a new component (design call 5). Each saves the moment it is pressed; the group is disabled while saving.
  - **Alerts** — "An email for things that need you: a task assigned to you, a mention, a change to your work, a deadline coming up or missed, a gate opened, and company announcements. One email for each notification you would see in Tielora."
  - **Daily brief** — "Your day, each morning (early morning UTC): what is due, overdue, newly unblocked and waiting for your review. Nothing is sent on a day when there is nothing to say."
  - **Weekly brief** — drawn only when the weekly-brief build is present: "A summary of your projects, early each Monday morning UTC. Nothing is sent when there is nothing to say."
- Footer line (12px `--brand-text`): "Every email has a one-click unsubscribe link."
- Hover hints (`title`) on each row repeat its label plus "You can change this any time".
- **Outcome toasts** (success): Alerts on "Alert emails are on. We will email you when something needs you." / off "Alert emails are off." Daily on "Daily brief is on. Your first one arrives tomorrow morning." / off "Daily brief is off." Weekly on "Weekly brief is on. The first one arrives next Monday." / off "Weekly brief is off." Failure: the box reverts and an error toast says "Couldn't save that. Try again." A 429 shows the server's sentence.

### 3.2 States
| State | What they see |
|---|---|
| Confirmed address | Normal, as above |
| **Address not confirmed** | Above the rows, a calm strip (`role="status"`): **"Confirm your email address first — we only send these to an address you have confirmed."** and a secondary 44px button **"Send me a confirmation email"** (loading "Sending…"; on success the strip becomes "We have sent a link to name@company.com. Check your inbox."). The rows show their stored values but are **disabled and greyed**, so a new account's "Alerts: on" is visible and understood as starting once confirmed. |
| Contractor | Only the **Alerts** row, with its own helper: "An email for work assigned to you: a new task, a change to it, a deadline coming up or missed, or work sent back for more." (No announcements: contractors are not emailed those.) No daily or weekly row, no space where they would be. Unconfirmed strip behaves the same. |
| Saving | Rows disabled, the pressed one shows a 16px `Spinner` next to its label |

- **Phone:** one column, rows full width, button full width. **Laptop:** unchanged, the card stays in the 672px column; the extra space is left empty like every other account card.
- Keyboard/screen reader: real `<input type="checkbox">` in a `<fieldset>` with legend "Email preferences" (visually hidden); the strip is announced politely.

---

## 4. Unsubscribe page and the emails

### 4.1 The page (`/unsubscribe?t=…`, public)
File: new `src/app/(auth)/unsubscribe/page.tsx` on `AuthSplit` (same hero and form column as sign-in, so it feels like Tielora). Tab title "Unsubscribe — Tielora"; not indexed. **Identical for a valid, tampered, old or missing token** (same words, layout, length).
- **Before:** heading "Stop these emails?" (`text-xl`, `--brand-ink`), line (14px): "Press the button to confirm." Button **Unsubscribe** (primary, full width, 44px, loading "Working…", ignores repeat presses). It is a plain form post, so it works with scripts blocked. Under it the quiet link "Back to sign in" (`BackToSignIn`).
- **After** (a `GoodNews` strip, not celebratory, not red): "Done. If that link was still valid, those emails have stopped. You can review all your email settings in Your account." then a link **"Go to Your account"** (44px; signed-out people are sent to sign in first) and "Back to sign in".
- **Too many tries (429):** calm strip "Too many tries just now. Wait a minute and press the button again." Network failure: red strip "We could not reach the server. Check your connection and try again."
- Phone: form column full width minus padding; laptop: 384px column beside the hero. Nothing else on the page. No name, no email, no company, no hint which kind of email it was.

### 4.2 The emails are plain text (spec decision), so "look" means layout
`microsoft-first.md` sets plain-text-only emails and the repo has no HTML email or email theme (`ui-ask-tielora.md` section 6 assumed one; see design call 6). Layout, identical skeleton for all three:
```
Tielora — <kind>                      <- header line: "Tielora — Alert" / "Tielora — Your day" / "Tielora — Your week"

<body>

Open it in Tielora:
<APP_BASE_URL + link>

--
Stop emails like this one: <APP_BASE_URL>/unsubscribe?t=…
Change all your email settings: <APP_BASE_URL>/account
Sent by Tielora because you asked for these emails.
```
- **Alert:** subject = the notification title. Body = the notification's own sentence only, then the link. Typed web addresses show as "[link removed]". No other content.
- **Daily brief:** subject "Your day — 30 Sep 2026 (2 due today, 1 overdue)" (counts, empty parts left out). Body: one block per non-empty section in the page's order (Due today, Overdue, Newly unblocked, Mentions, Awaiting your review, Announcements, Waiting for your acknowledgement), each headed "DUE TODAY (2)" and listing up to 10 lines "- Task title (SUR-EXP) — 12 Sep 2026 — 5 days over", then "and 3 more — open Tielora to see them". Link "Open your day in Tielora". No email when every section is empty.
- **Weekly brief:** subject "Your week — week of 5 Oct 2026". Body layout as the daily: a short heading per project the person may see with its progress, late, blocked lines as written in the briefs spec; same footer.
- Footer wording is fixed across all three so both links are always visible without scrolling in the email client; the two unsubscribe headers make Outlook show its own Unsubscribe as well. Invitation, reset and verification emails keep their current footer (no unsubscribe lines).
- Dates always "30 Sep 2026"; UTF-8 so Arabic titles read correctly; no emoji, no images.

---

## 5. Teams tab (`/teams/tab`, inside Teams)

Files: `src/app/teams/tab/page.tsx` (+ client parts), `src/app/teams/auth-end/page.tsx`. **No sidebar, top bar or footer**: Teams supplies the frame. Background `--page-bg`; page padding 16px (phone) / 24px (laptop). Light theme only (design call 7). Reuse `BriefView`'s `Section` and row look, with two changes: each row is at least **44px** tall and wholly tappable; every link opens Tielora in the browser (Teams' open-link) and carries a hint "Opens in Tielora in your browser" plus visually hidden text "(opens in your browser)".

**States**
1. **Checking (silent sign-in in progress):** title "Your day" and `SkeletonRows` (6 rows), text "Signing you in…" (14px). This is also the loading state after sign-in while the brief loads.
2. **Signed in:** title "Your day" (`text-xl`, `--brand-primary`, same as the page in Tielora), then the sections exactly as the browser page (each capped at 10, "N more not shown."). Contractors see their own tasks and "Notices" rows with body text and no link. Bottom line: link **"Open Tielora in your browser"** (44px, `--brand-primary`, opens `/my-tasks/brief`). No forms, no sign-out, nothing that changes anything. Empty day: the page's existing sentence, unchanged. Load failure: `ErrorBanner` "Couldn't put your day together. Try again." with Retry.
   - **Phone (~390px):** one column, sections stacked, full width.
   - **Laptop / wide Teams (~1000-1400px):** content `max-w-5xl`, sections in **two columns** (`lg:grid-cols-2 items-start`) so a long day is not a long scroll; the "Open Tielora in your browser" link stays at the bottom, at the start edge.
3. **Not signed in:** a centred card (`max-w-sm`, white, `--border`, 6px radius, 24px padding, vertically near the top third): heading "Sign in to see your day" (16px semibold ink), line "Use your work Microsoft account." (14px), one primary full-width 44px button **Sign in with Microsoft** (same logo-button rules as 1.1, since Microsoft's terms apply to every Microsoft sign-in button; white style). While the Microsoft window is open: button shows spinner "Waiting for Microsoft…", disabled, plus "Finish signing in in the Microsoft window." If the person closes it, the card returns to default with no error. **Failure** (any reason): red strip `role="alert"` under the button: "We could not sign you in with Microsoft. Ask your Tielora administrator if this keeps happening." (same sentence every time).
4. **Two-factor:** same card: heading "Enter your code", the login page's phase-2 markup and words (Verification code field with placeholder 123456, "Use a recovery code instead", "This step expires in 5 minutes.", **Verify and sign in**, same one-sentence failure and 429 strip, "← Back"). Numeric keypad on phones (`inputMode="numeric"`, `autoComplete="one-time-code"`).
5. **Cookies blocked:** the same card with heading "Open Tielora in your browser", text "Your browser is blocking Tielora inside Teams. Open Tielora in your browser instead." and a primary **Open Tielora** button (44px, opens `/login`). Never a blank screen or spinner that does not end.
6. **Not set up:** the page answers "not found" (framing allowed, nothing shown), as in the spec.

**The Microsoft window (`/teams/auth-end`):** a plain centred page on `--page-bg`: `Spinner` and "Signing you in…" (14px), closes itself. Not framable.

**Accessibility:** the page title is the `h1`; state changes (signed in, error) are announced via a polite live region; the sign-in button has visible text; focus goes to the card heading when a state appears. Use start/end spacing utilities, not left/right.

**Teams package icons** (from `teams-app.md`): colour icon 192x192 = the Tielora mark on `--brand-ink`, mark in white with an `--brand-accent` detail; outline icon 32x32 = the mark in a single white stroke on transparent. Pixel files, so their colours live in the files, not the styles (same reasoning as the Microsoft logo). Manifest accent colour = `--brand-primary`.

---

## Builder checklist
- Dormant sign-in: diff the login page HTML before and after; identical. Same check for Integrations (no card, no gap) and Your account (no Email card) when email is off.
- Microsoft logo is one SVG file; no Microsoft hex appears in any `.css`, `.tsx` or class name.
- All new tappable things `min-h-11`; no new icon-only control (the Modal's own X is 24px; raising it to 44px, as `ui-ask-tielora.md` already suggests, matters for the Switch-off dialog).
- Every action answers with a visible outcome (banner, toast or changed state), never only a press.
- Contractor: Email card = Alerts only; no Export/AI; Teams tab shows Notices without links.

## Decisions for the owner's taste
1. **Microsoft's four-colour logo vs the "no new hex" rule.** I read the rule as being about styles and used the logo as a picture file. Confirm, or accept a text-only button (which breaks Microsoft's brand terms).
2. **Microsoft button below the password form (chosen)** vs above it. Below keeps the current sign-in first; above suits companies that are all-Microsoft.
3. **Renaming the chat card's title to "Microsoft Teams channel"** so it is not confused with the new "Microsoft Teams app" card.
4. **Showing the linked Microsoft domain after the first day.** It is not stored on the company; the card shows it only if the audit record has it, otherwise "Linked". Showing it always needs a stored field, which the spec did not approve.
5. **Checkbox rows vs a true on/off switch** for the Email card. I reused the Integrations checkbox pattern; a real switch would be a new component.
6. **Plain-text emails (spec) vs branded HTML.** HTML would look like Tielora but needs a template approach the spec excludes; it would also make the AI summary box in `ui-ask-tielora.md` section 6 possible (in plain text that summary must be a labelled paragraph instead).
7. **Teams tab is light-only.** Teams users on its dark theme will see a light page, because the brand has no dark colours and I may not invent them.

## Prior art (Mobbin, pulled 30 Sep 2026)

- [Calendly — log in](https://mobbin.com/screens/275fcd1b-1caf-4143-b676-f09542baeef7): Microsoft as a full-width outlined button with the four-square logo, under an "OR" divider below the main form — the same order this spec chose.
- [Dropbox Dash — log in or sign up](https://mobbin.com/screens/e1fe4ed5-8c62-49bc-b5fb-c9e1768cde88): the opposite order (providers above the email field). Confirms both are common; we keep password first because most Tielora people today have a password.
- [Square — sign in](https://mobbin.com/screens/d5fc5fdc-5ddb-4ba7-94ae-acd65518671a): the "or continue with email" divider wording and weight.
- [Dropbox Dash — notification settings](https://mobbin.com/screens/35c1f067-cebc-44cb-a378-ff72de217319): "Email me about:" with plain checkbox rows including a weekly digest — backs the checkbox-row choice for the Email card.
- [Basecamp — notification settings](https://mobbin.com/screens/15b94fd3-04f9-4fec-9dc2-c04df782c4b9): each checkbox carries one line of helper text saying exactly when email arrives — the pattern for our three rows.
- [GetYourGuide — notifications](https://mobbin.com/screens/89119dbf-6465-4fd0-a096-f968a1c66702): shows "Your notifications are sent to: <address>" beside the switches — worth one line on our card so people see which address gets the mail.

**Changed after prior-art review:** the Email card shows one line "Emails go to <your address>." above the three rows.
