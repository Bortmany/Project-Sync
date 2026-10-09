# Spec: Pricing, October 2026 — flat Pro, contractors free, honest ceilings

App: Tielora (`Project-Sync`), branch `align-2026-10`. Build plan: Step 5 of
`Agents/.claude/worktrees/vision-plans/docs/visions/build/tielora.md`. Written 30 Sep 2026 by
product-manager. Read `docs/CONVENTIONS.md` first: THE TENANT RULE, THE EXTERNAL RULE, house rule 11,
"Plans and limits" and "Billing provider" are the parts this spec touches.

The decision is already made and is not reopened here: `docs/decisions/pricing.md` section 7, approved
in `docs/decisions/owner-answers-2026-09-30.md` item 1.

Backlog rows matched: none (`Agents/docs/backlog.md` has no pricing row; this comes straight from the
owner's 30 Sep 2026 decision sitting).

Prior art (Mobbin): **not pulled** — no Mobbin tool was available in this session and I will not invent
`mobbin_url` links. The written prior art is in `pricing.md` section 1: PlanRadar, Asana and Procore
already treat outside contractors and guests as free; Monday and Asana meter AI as a monthly pool.
`ui-designer` should attach 2–3 Mobbin flows of pricing pages with a "free guests" line and of a usage
meter approaching a limit, if it runs (see section 13).

## Standards note

| Question | Answer |
|---|---|
| New personal data? | **No.** Only counts and numbers change. Nothing new about any person is stored. `/privacy` does not change for this feature. (The AI step, Step 4, changes it for its own reasons.) |
| Touches the core guarantee? | **Yes, both tenant-side rules, lightly.** Counting people is per company (the tenant rule) and the new contractor count reads the EXTERNAL role (the external rule). So the spec REQUIRES tests in `org-isolation.service.test.ts` (one company's staff and contractors never count toward another's) and `external-scoping.service.test.ts` (see section 8). The golden rule (task progress) is not touched. |
| Mutations or external calls? | **No new ones.** The two existing mutations that now refuse differently, `createUser` and `updateUser`, keep the rate limits they already have. No new external call: Paddle is unchanged. Named in section 10. |

## 1. The problem, in the owner's words

"Keep Pro flat at $249 a month, one Paddle price, no seat syncing. Contractors never count as people.
Ceiling of 50 active contractors on Pro, 10 on Free. Pro is capped at 100 office staff. AI monthly cap:
$25 on Pro, $2 on Free."

In plain English: Tielora's selling point is that outside contractors are free. Today the code does not
say that. It counts every active contractor toward the Free plan's 10-person limit, and Pro has no
people ceiling at all ("unlimited"), which the September report advised against. This build makes the
one plan file, the refusal messages, the pricing pages and the Billing meters all say the same true
thing:

- **Office staff** are the people who count (anyone who is not a contractor, active, able to sign in).
- **Contractors are free** and never count as staff, but have a safety ceiling so "free" cannot be abused.
- **Pro is one flat price** and does not change when a company adds people.

## 2. The numbers (all live in `src/lib/plan-limits.ts`, nowhere else)

| Thing | Free | Pro | Notes |
|---|---|---|---|
| Projects | 1 | unlimited | unchanged |
| Documents (storage) | 500 MB | 10 GB | unchanged |
| **Office staff** (active, not a contractor) | 10 | **100** (was unlimited) | this is the existing `users` limit, now meaning staff only |
| **Contractors** (active, access not ended) | **10** (new) | **50** (new) | a separate ceiling; never added to the staff count |
| **AI allowance** (`aiMonthlyUsd`) | **2** | **25** | dollars per company per month; see the coordination note |
| Price | $0 | USD $249/month | `PRO_PRICE`, unchanged |

**Coordination with Step 4 (the AI step).** Step 4 adds the `aiMonthlyUsd` field, its rule that it may
never be `null`, and the meter. **This step only sets the final numbers, FREE = 2 and PRO = 25.** The
current file on this branch has no `aiMonthlyUsd` yet. If Step 4 has landed when this is built, this
step edits two numbers (Step 4's placeholder said PRO = 30; the owner's answer replaces it with 25, and
`ai-assistant.md` section 4.4 should be read that way). If it has not, this step adds the field exactly
as `ai-assistant.md` section 4.4 describes it (required number, not nullable, 0 means no allowance) so
the two never collide, and Step 4 adopts it. Either way the numbers 25 and 2 appear once, in this file.

**Shape.** `PlanLimitsDTO` (in `src/lib/zod-schemas.ts`, house rule 4) gains `contractors` (a positive
number or `null`, like the others). `PlanUsageDTO` gains `contractors`. The existing `users` field keeps
its name to avoid churn, but its meaning becomes "office staff" and its comment says so. `LimitKind`
gains `"contractors"`. `limitLabel` says "Office staff" and "Contractors"; `limitAmount` says "10 office
staff" and "10 contractors" (singular "1 contractor"); `limitShort` and `usagePct` need no change.

**What Pro at 100 means for `null`.** "`null` means unlimited" stays true for projects (Pro). Pro staff
is now a real number, 100. Free and Pro `contractors` are real numbers. `null` remains legal in the type
but nothing uses it for staff or contractors.

## 3. Who counts, exactly (`countUsers` becomes two counts in `billing.ts`, lines ~91–104)

- **Office staff** = active (`isActive`) and role is not `EXTERNAL`. (No expiry rule is needed: only a
  contractor can carry an access end date.)
- **Contractors** = active, role `EXTERNAL`, and access not run out — the identical
  `isAccessExpired()` rule the file uses today, including its one-day grace, written as the same OR
  query so a blank end date is never dropped.
- **Deactivated accounts count for neither** (unchanged: deactivation gives the place back).
- A contractor whose access has ended counts for neither, exactly as today.
- Both counts are per company (`orgId` from the actor), computed at read time. **Nothing new is
  stored.** The "no usage column" rule for people, projects and files is untouched.

## 4. What the user sees and does, screen by screen

### 4.1 Admin → Users: the refusals

No layout change. The places a person can be refused, all in the existing add/edit dialogs, shown in the
existing error banner exactly as the server writes them (as plans already work: the server writes the
whole sentence, the screen never re-words it):

1. **Creating an account** (password or emailed invite) — the role chosen decides which ceiling is
   asked. Staff roles ask the staff ceiling; Contractor asks the contractor ceiling.
2. **Reactivating** a deactivated account — asks the ceiling for that person's role.
3. **Extending a contractor's access** that had already run out (giving it a new future date, or
   clearing the date) — asks the contractor ceiling. Extending a date for a contractor who is still
   active changes nothing and is never refused.
4. **Changing someone's role between staff and contractor** — this moves them from one count to the
   other, so the destination ceiling is asked. (New; today a role change is never checked because the
   one shared count did not care. Contractor to engineer on a full staff plan is refused; engineer to
   contractor on a full contractor plan is refused.)

Not refused, ever: deactivating, editing a name, job title, discipline or company, resending an invite,
changing someone within the same group (engineer to project manager), shortening a contractor's date, a
person accepting an invitation they already hold, and every read.

### 4.2 The exact refusal wording

Written once in `limitRefusal()` in `plan-limits.ts`, keeping today's shape (sentence one says what the
plan holds; sentence two says what each plan includes; the last sentence points somewhere). Four cases
per group: Free administrator / Free anyone else / Pro administrator / Pro anyone else.

**Office staff**

- Free, administrator: "Your plan has room for 10 office staff. Free plans include 10 — upgrade to Pro
  for 100. Outside contractors don't count. See plans in Admin → Billing."
- Free, anyone else: "Your plan has room for 10 office staff. Free plans include 10. Outside
  contractors don't count. Ask your administrator to upgrade your plan."
- Pro, administrator: "Your plan has room for 100 office staff. Pro plans include 100. Outside
  contractors don't count. Deactivate someone who no longer needs to sign in to make room."
- Pro, anyone else: "Your plan has room for 100 office staff. Pro plans include 100. Outside
  contractors don't count. Ask your administrator to make room."

**Contractors**

- Free, administrator: "Your plan has room for 10 contractors. Free plans include 10 — upgrade to Pro
  for 50. Deactivated contractors, and ones whose access has ended, don't count. See plans in Admin →
  Billing."
- Free, anyone else: "Your plan has room for 10 contractors. Free plans include 10. Deactivated
  contractors, and ones whose access has ended, don't count. Ask your administrator to upgrade your
  plan."
- Pro, administrator: "Your plan has room for 50 contractors. Pro plans include 50. Deactivated
  contractors, and ones whose access has ended, don't count. Deactivate one you no longer work with, or
  let their access end, to make room."
- Pro, anyone else: "Your plan has room for 50 contractors. Pro plans include 50. Deactivated
  contractors, and ones whose access has ended, don't count. Ask your administrator to make room."

Notes for the builder: the "Pro plans include N" line reuses today's `includes` logic; the "upgrade to
Pro for N" clause appears only for an administrator on Free (as today); the Pro-administrator pointer no
longer says "See plans" because there is nowhere higher to go, and it says how to make room instead.
Projects and documents keep today's wording and behaviour (Pro projects has no ceiling, so it never
refuses).

The refusal never says how many people the company has now (the Billing meter shows that).

### 4.3 Admin → Billing: the meters (all read the one file)

Same style as today, in this order:

- **Projects** (unchanged)
- **Office staff**: "7 / 10", label changed from "People". Turns the existing amber
  (`--status-blocked`) with the existing over-limit line when above the ceiling. On Pro it now shows
  "37 / 100" with a bar; before, it was a bare count, because Pro staff is no longer unlimited.
- **Contractors**: "3 / 10" (Free) or "3 / 50" (Pro), same meter, same over-limit treatment. A small
  helper line under it: "Contractors don't count as office staff and are never charged for."
- **Documents** (unchanged)
- **AI this month** (from Step 4, shown only when the deployment has the AI key): dollars against
  `aiMonthlyUsd`, i.e. "$3.40 / $25" on Pro and "$0.10 / $2" on Free. This step adds nothing to it
  beyond the final numbers.

The "Includes" bullet list and the "Plans" comparison card are both built from `PLANS` and gain matching
rows: "Office staff — Up to 10 / Up to 100", "Contractors — Up to 10 / Up to 50", and (when the AI key
is set) "AI allowance — $2 / $25 of use a month". The existing over-limit wording under a meter ("You
have more than your plan's limit — nothing is at risk, but you can't add another until you're back
under, or you upgrade") stays; on Pro the "or you upgrade" part must not appear for staff or
contractors (there is no higher plan). The builder passes the plan into the meter for this.

The price row still reads `PRO_PRICE`. The dormant note ("Upgrading isn't turned on for this Tielora
yet") is unchanged. Nothing about renewal dates, invoices or cards is added: none of it is stored.

### 4.4 The public `/pricing` page

Built from `PLANS` and `PRO_PRICE` as today; nothing typed out.

- Free card list: "1 project", "Up to 10 office staff", "Up to 10 contractors", "500 MB of documents",
  then the existing "Every feature…" line.
- Pro card list: "Unlimited projects", "Up to 100 office staff", "Up to 50 contractors",
  "10 GB of documents".
- **New line on the Pro card**, under the price: "One flat price — it doesn't change when you add
  people." (True: one Paddle price at quantity 1.)
- **New reassurance line in the calm note at the bottom**: "Outside contractors never count as office
  staff and never cost extra." The last sentence of that note ("Free and Pro only differ in how much room
  you have: projects, people, and storage") becomes "projects, office staff, contractors, and storage".
- **AI line, only when the deployment has AI configured** (this page is already rendered per request, so
  it can ask): "Ask Tielora, our AI assistant, is included with a monthly allowance: $2 of use on Free,
  $25 on Pro." Numbers read from `aiMonthlyUsd`. With no AI key the page says nothing about AI, because
  promising a feature that is switched off would be untrue. (See open question 2.)

### 4.5 The landing page teaser

Still shows Free "$0" and Pro `{PRO_PRICE}`. The single addition is one short line under the Pro price:
"Flat price. Contractors are free." Nothing else changes. The teaser shows no limit number, so it can
never drift from the file. (If a `ui-designer` pass is skipped, keep the line in the same small text
style as the card captions.)

## 5. Grandfathering (the rule, with a required test)

**A company already over a new limit keeps everything. Reads are never blocked. Only new additions are
refused.**

Who this hits on day one: any existing company with more active accounts in a group than that group's
new ceiling. The realistic case is a FREE company with more than 10 active contractors; a Pro company
with more than 100 staff (possible only because Pro was "unlimited") is the same case.

What "keeps everything" means concretely:

- Every existing account keeps signing in. No session is ended. No account is deactivated. No role is
  changed. No contractor's access date is touched.
- Every list, project, task, document, download, dashboard, search and the directory work as before.
- Admin → Billing shows the amber meter and the "nothing is at risk" line.
- The company can still deactivate people, edit people, and resend invites. The moment enough are
  deactivated (or contractors' access ends) that they are back at or under the ceiling, adding works
  again, up to the ceiling and no further.
- A later downgrade (a Paddle cancellation drops a company to Free) is the same case and already
  covered by the existing rule.

The refusal in section 4.2 applies to a company over the limit exactly as to one at the limit: "used
plus one is above the ceiling" is refused, and nothing already there is touched.

**Required new test:** `src/server/__tests__/billing-grandfathering.service.test.ts` (new file, named
in section 9).

## 6. What is explicitly OUT of scope

- **Any change to Paddle.** No new price, no quantity update, no seat syncing, no new webhook event, no
  new environment variable, no change to `paddle.ts` or to `processBillingWebhook`. The checkout still
  sends one price at quantity 1. (A second, cheaper plan is a possible later step if small firms push
  back; it needs only one more Paddle price and is not built here.)
- **Storing or showing** any price, amount, invoice, renewal date or card. Not stored today, not stored
  after.
- A third plan, an annual option, per-seat pricing, or a "contact us" enterprise tier.
- Charging for AI beyond the allowance, buying extra AI credit, or an in-app alert at the AI cap (Step 4
  decided: no alert).
- Changing the project ceiling, the storage ceilings, or `PRO_PRICE`.
- Automatically deactivating, downgrading or warning anyone who is over a new limit (the Billing meter
  is the only signal, as before).
- Limiting how many projects a contractor may join.
- Arabic (section 12).
- Editing `docs/decisions/pricing.md` or `ai-assistant.md` (other people's files; this spec states the
  changes).

## 7. Choke points and the data touched

Three choke points remain, and only the middle one changes shape (`src/server/services/billing.ts`, called
from `src/server/services/admin.ts`):

- `createProject`: unchanged.
- `createUser`: `assertUserRoom(actor)` becomes `assertUserRoom(actor, role)`: it counts the matching
  group (staff or contractors) and asks the matching ceiling. The role is known from `input.role` before
  anything is written, so the check still runs first. Both the password path and the invite path go
  through it, as today.
- `updateUser`: today's "was not counted, will be counted" test (`countedBefore` / `countsAfter`) becomes
  "which group, if any, were they in before, and which after". If the group after exists and is different
  from the group before, or they were in no group before, ask that group's ceiling. That one rule covers
  reactivation, extending an expired contractor, and a role change between staff and contractor. It
  stays defined by the same `isAccessExpired()` the count uses so the two cannot drift (a test proves the
  two agree for every combination of role, active and date).
- `uploadDocumentVersion`: unchanged.

**Data touched, in plain terms:** nothing is added or changed in the database. Each company's people are
counted two ways instead of one. The plan file gains two numbers per plan (contractors) and, if Step 4
has not done it yet, the AI allowance. No column, no table.

**Migration: none expected.** `Organization.plan` is still a plain string; the limits are constants in a
file; the counts are worked out from the existing `User` rows. If the builder finds a reason to add a
column, that is a stop-and-ask, not a quiet migration (schema is frozen; CONVENTIONS "Migration
pattern"). Nothing to add to the "Main-session-approved amendments" list.

## 8. What a CONTRACTOR (EXTERNAL) sees

**Nothing changes for a contractor, and they never see the word "limit".** They see no Billing page
(ADMIN only), no meters, no refusal. Their own experience of the app is unchanged.

What does change, and the builder must respect it:

- A contractor is **never counted as office staff**. A company on Free with 10 staff and 8 contractors
  can add another contractor (up to 10) and cannot add an 11th staff person.
- A contractor whose access has ended, or who has been deactivated, counts for nothing.
- The refusal messages are only ever shown to whoever is adding a person (an administrator, since
  `MANAGE_USERS` is administrator-only), never to a contractor.
- Nothing about who is counted is sent to the browser except the two totals in `billingStatus()`
  (administrators only) — no names, no roster.
- A contractor's sign-in, sessions, task visibility and notifications do not depend on any count. A
  company over its contractor ceiling does not lock any contractor out.

**Tests to extend in `external-scoping.service.test.ts`:** a contractor is not counted as office staff
(add contractors up to the ceiling, then confirm a staff person can still be added, and the reverse); a
contractor whose access has ended is not counted, and re-extending is the thing that is refused when the
group is full; and `billingStatus` refuses a contractor (they lack `MANAGE_BILLING`).

## 9. Tests (the required list)

All tests use the harness's `makeOrg` (companies on PRO by default) and `setPlan()` to set the plan they
mean. No test reaches Paddle; `global.fetch` is stubbed as the existing provider tests do. Bulk data is
inserted directly with `createMany` so a 100-person case runs fast.

**`billing-limits.service.test.ts` (extend; update the three contractor tests near lines 440–500):**
1. Contractors no longer count toward the staff ceiling: 10 staff and 3 active contractors on Free is at
   10 staff, and the 11th staff is refused, the 4th contractor is allowed.
2. The contractor ceiling: at 10 active contractors on Free the 11th is refused with the exact
   contractor sentence (administrator version and non-administrator version, checked separately); the
   same at 50 on Pro.
3. Pro staff ceiling: 100 staff on Pro means the 101st is refused with the exact Pro sentence; 99 staff
   allows one more. Contractors are not part of that 100.
4. Exact wording: all eight sentences in section 4.2 compared as full strings, plus a check that every
   number in them is read from `PLANS`.
5. Every way in is asked: create with password, create with invite, reactivate, extend an expired
   contractor's access, change role contractor to staff, change role staff to contractor.
6. Not refused: deactivate, rename, resend invite, change role within a group, shorten a date, extend a
   still-active contractor's date.
7. Counts: deactivated and expired-contractor accounts count for neither; the one-day grace matches
   `isAccessExpired()`; a loop over role x active x date proves the count query and the `updateUser`
   before/after logic agree.
8. Upgrading FREE to PRO raises all the ceilings at once (10 to 100, 10 to 50, and the AI allowance
   2 to 25); an unrecognised plan reads as FREE's numbers.
9. `billingStatus` reports `usage.users` (staff) and `usage.contractors` correctly, and only the
   administrator may read it.
10. `PLANS` sanity: FREE and PRO `aiMonthlyUsd` are the numbers 2 and 25, never null.
11. A limit refusal writes no `ActivityLog` row (same as today).

**New: `billing-grandfathering.service.test.ts` (required):**
a. **Company over the staff limit:** 12 staff and 2 projects on Free (inserted directly). Every read
   still works: user list, directory, project list, task lists, `billingStatus` (shows over-limit).
   Nobody is deactivated, no session ends, no role or date changes (row values before equal after a
   full run of the reads).
b. **Every addition is refused:** create staff (password and invite), create contractor if that group is
   also over, reactivate, extend an expired contractor, contractor-to-staff role change.
c. **Not refused:** deactivate one person, edit a name, resend an invite.
d. **Recovery:** after deactivating enough people to be exactly at the ceiling, one more is refused; one
   fewer, one more is allowed. No further.
e. **Company over the contractor ceiling** (14 active contractors on Free, 3 staff): reads work, no
   contractor is signed out, adding a contractor is refused, adding staff is allowed (staff are under
   their own ceiling).
f. **The downgrade case:** a Pro company with 60 contractors and 105 staff, downgraded to Free via a
   signed webhook (the existing test helper): plan reads Free, everyone still signs in, reads work,
   additions are refused, and no row changes except `plan` and the plan-change audit row.

**`billing-provider.service.test.ts` (extend):** the checkout request body carries exactly one item, the
configured price id, quantity 1 (the "flat, no seat syncing" guarantee); no webhook handler path reads a
quantity; a replayed webhook still changes nothing (existing test must stay green); the `Organization`
and `BillingEvent` models contain only their documented columns (no price, card or amount field exists,
checked against the generated model's field list); and no test touches the network.

**`org-isolation.service.test.ts` (extend):** company A's staff and contractors never count toward
company B's ceilings (A full on staff, B still adds); reactivating in A never asks B's counts.

**`external-scoping.service.test.ts` (extend):** as section 8.

**`public-pages.test.tsx` (update):** the existing "Up to 10 people" and "Unlimited people" assertions
change to the new lines ("Up to 10 office staff", "Up to 100 office staff", "Up to 10 contractors", "Up
to 50 contractors"), read from `PLANS` rather than typed, plus the flat-price line, the contractors line
on the teaser, and (with the AI key stubbed on) the AI line; with it off, the AI line is absent.

Also must stay green: `npm run verify` (types, lint, the whole suite), `mutation-safety.test.ts`, and
`health.route.test.ts`.

## 10. What is RATE LIMITED

No new mutation and no new external call. Named so nobody wonders:

| Thing | Limit |
|---|---|
| `createUser`, `updateUser` (the two that can now refuse differently) | the limits they already have (`byUser`, applied before the service as in house rule 1); a refused attempt counts against the limit like any other |
| `startUpgrade`, `openBillingPortal` | unchanged: ten presses a minute per person |
| `/api/billing/webhook` | unchanged: `byIp`, 600 a minute |
| `/pricing` and the landing page | read-only, no session, no mutation |

## 11. What is AUDITED

- **A limit refusal writes no audit row** (unchanged; nothing happened). The new refusals (role change,
  reactivation, extension) follow the same rule.
- **The mutations that succeed** keep their existing rows (`USER_CREATED`, `USER_UPDATED`,
  `USER_REACTIVATED`); a role change between staff and contractor already lists "role" as a field that
  moved. No new audit constant.
- **Plan changes** stay `BILLING_PLAN_CHANGED` (no actor), untouched.
- Nothing in any audit row or log line contains a price, amount, card, token or key. No new key exists.

## 12. Bilingual note

Tielora is **English only** by the owner's decision (house rule 6: no i18n dictionary, strings in
components), so there is nothing to translate and no right-to-left layout. Two consequences for the
builder: the new refusal sentences and pricing lines are English and live in `plan-limits.ts` and the
pricing page; and if Arabic is added later, "office staff" and "contractors" need translating by a
person, because they carry the pricing promise. Not built now.

## 13. Recommendation: run `ui-designer` before building?

**A short pass, not a full design.** No new screens, but the Billing page gains two meter rows and a
helper line, the pricing cards gain lines, and the 44 px / brand-token / over-limit rules apply. If the
owner wants to skip it, the builder can extend the existing meter component unchanged: it is a straight
extension of the current pattern. Mobbin flows should come from `ui-designer` if it runs.

## 14. Docs that change in the same build

- **`docs/CONVENTIONS.md` — "Plans and limits":**
  - Replace "the three ceilings" with the four (projects, office staff, contractors, storage) plus the
    AI allowance (added by Step 4, numbers set here). Replace "The three ceilings are still the
    roadmap's placeholders" with the settled numbers: Free 1 / 10 / 10 / 500 MB, Pro unlimited / 100 / 50
    / 10 GB, AI $2 / $25, price $249, settled by the owner's answers of 30 Sep 2026, item 1.
  - "What is counted": office staff = active non-contractor; contractors = active, access not run out;
    each counted separately and neither adds to the other; deactivated and expired count for neither.
  - "GIVING A SEAT BACK IS TAKING A SEAT": generalise to "moving into a counted group is taking a
    place" and add the role-change case.
  - "`null` means unlimited": note that staff and contractors are real numbers on both plans and
    `aiMonthlyUsd` may not be `null`.
  - "GRANDFATHERING" bullet: add the contractor and Pro-staff cases and name the new test file.
  - The "Nothing about usage is stored" bullet is unchanged by this build (Step 4 amends it for AI).
  - "Test companies are on PRO": unchanged; add that `makeOrg` stays Pro so 100/50 never surprise an
    unrelated test.
  - Extend the closing test line to name `billing-grandfathering.service.test.ts`.
- **`docs/CONVENTIONS.md` — "Billing provider":** add one bullet: "**Pro is one flat price.** One price,
  `PADDLE_PRICE_ID_PRO`, quantity 1. There is no seat syncing, no quantity update and no second price;
  people and contractors never change what is charged. A second flat plan later would be one more price
  and one more variable, never seat syncing." State that no price, amount, card or seat count is stored
  (already true; now a recorded decision). Keep the Lemon Squeezy note true.
- **`docs/CONVENTIONS.md` — house rule 11:** the Payments bullet gains one sentence: "Pro is a single flat
  price; the deployment holds one price id." (No new variable. The count of four is unchanged.)
- **`docs/CONVENTIONS.md` — the action table:** the `createUser` and `updateUser` rows gain the new
  ceilings ("refused once the plan's office-staff or contractor ceiling is reached, by the role chosen";
  "a role change between staff and contractor is a move between counts and asks the ceiling it moves
  into"). The existing "deactivated accounts are not counted" text stays.
- **`docs/GO-LIVE.md` section 8:**
  - "What is live now": "The three limits — projects, people, storage" becomes "The limits — projects,
    office staff, contractors, storage — and the monthly AI allowance". Add "Contractors never count as
    office staff."
  - "Before launch — the owner's decisions": the real numbers are now decided (Free 1 project / 10 office
    staff / 10 contractors / 500 MB; Pro unlimited projects / 100 office staff / 50 contractors / 10 GB;
    AI $2 / $25). Replace the open "The real numbers" item with a ticked item dated 30 Sep 2026, noting
    it is an edit to `plan-limits.ts` and nothing else.
  - Step 3 of "Switching payments on" stays ("Make Paddle's price match the app's $249") and gains "one
    product, one price, no per-seat price".
  - Add a short "If a company says it is over a limit" paragraph: nothing is taken away; ask them to
    deactivate someone or let a contractor's access lapse; or upgrade.
  - Keep the Lemon Squeezy fallback and the caveats as they are.
- **`docs/decisions/pricing.md`** is the owner's decision record; the builder does not edit it.
- **`ai-assistant.md`** is not edited by this step; its PRO placeholder of 30 is superseded by 25 as
  stated in section 2.

## 15. Owner checklist (short)

Flat pricing means very little:

- [ ] **Confirm the $249/month price exists in Paddle sandbox** as a recurring monthly price on a
      "Tielora Pro" product, and that its id is what `PADDLE_PRICE_ID_PRO` holds in the sandbox setup.
- [ ] **Confirm the same in Paddle live**, when going live (new product and price id there, as GO-LIVE
      section 8, step 9 already says).
- [ ] Nothing else for Paddle: no new price, no second product, no webhook change, no new variable.

## 16. Done when (a checklist a non-developer can tick)

Sign in as the seeded administrator of a Free test company, then a Pro one.

- [ ] Admin → Billing (Free) shows meters for **Projects, Office staff, Contractors, Documents**. Office
      staff shows "n / 10", Contractors shows "n / 10".
- [ ] Admin → Billing (Pro) shows Office staff "n / 100" and Contractors "n / 50" (with bars), and the
      price row still says USD $249/month.
- [ ] The Plans table on that page has rows for Office staff and Contractors with Free and Pro columns.
- [ ] On a Free company with 10 office staff, adding an 11th (Engineer) is refused with the exact
      sentence in section 4.2 (Free, administrator). The non-administrator version is confirmed from
      the tests (only administrators can open Admin → Users).
- [ ] On the same company, adding a **Contractor** still works even though staff is full, up to 10.
      Adding an 11th contractor is refused with the contractor sentence.
- [ ] Deactivating a contractor and then trying to bring them back when the contractor group is full is
      refused; make room, and it works.
- [ ] Changing a contractor into an Engineer on a full staff company is refused with the staff sentence.
- [ ] On a Pro company with 100 office staff, the 101st is refused with the Pro sentence, which does
      **not** say "upgrade".
- [ ] **A company already over a limit keeps working:** set up a Free company with 12 people (use the
      test data helper); everyone can still sign in, every list opens, the directory works; the Billing
      meter is amber with "nothing is at risk"; adding is refused; deactivating is allowed; and nobody
      was removed or signed out.
- [ ] `/pricing` shows Free and Pro cards with "office staff" and "contractors" lines, "One flat price —
      it doesn't change when you add people.", and the reassurance line about contractors. With no AI key
      set, the page says nothing about AI.
- [ ] The landing page pricing teaser shows the same price and the one new line.
- [ ] Change **only** the number in `plan-limits.ts` for one limit, restart, and the Billing page,
      `/pricing` and the refusal sentence all change with it (proves one source).
- [ ] Press **Upgrade to Pro** in the Paddle sandbox (if keys are set): the Paddle checkout shows
      **one** item at USD 249, quantity 1.
- [ ] `/privacy` and `/terms` are **unchanged** by this feature.
- [ ] `npm run verify` passes, including the new grandfathering test file.

## 17. Open questions (each with my suggested default)

1. **What happens to an existing Free company that has more than 10 active contractors today?**
   *Default: grandfathered exactly as section 5 says — nothing is removed or blocked, only new
   contractors are refused until they are back under 10.* The alternative (a grace period or a warning
   email) needs new notification code and is not worth it while there are very few companies.
2. **Should the public `/pricing` page show the AI allowance in dollars, as a plain "included" line, or
   not mention it at all?** *Default: show one line, in dollars, only when the deployment has the AI key
   set ("$2 of use on Free, $25 on Pro").* Dollars match the Billing meter and are honest; customers see
   the same figure everywhere. If you would rather not advertise a spending figure, the fallback is
   "monthly allowance included" with no number, which is one line to change.
3. **Should the Pro-at-cap refusal (100 office staff, 50 contractors) also offer a way to ask for more,
   for example a contact address?** *Default: no — it tells the administrator to deactivate someone.*
   There is no sales contact in the app to point at yet, and inventing one would be a promise. If you
   want a "contact us for more" line later, it is one sentence in `limitRefusal()`.
