# Tielora pricing research (Step 1) - as of 30 Sep 2026

Status: **waiting for the owner's decision.** Written by the researcher agent for the October 2026
alignment round; prices were checked on the web on 30 Sep 2026, and anything that could not be
checked is marked "unverified".

## 1. What competitors charge
| Tool | Model | Entry price | Guests / contractors | AI packaging | Source |
|---|---|---|---|---|---|
| Procore | Yearly fee based on your construction volume; quote only | about $375/mo at the very smallest, $15-30K/yr typical (unverified estimates) | Unlimited users, including subcontractors, at no extra charge (Procore's own words) | Top-tier only, in the "Helix" bundle (unverified detail) | [procore.com/pricing](https://www.procore.com/pricing) |
| Monday.com | Per seat, 3-seat minimum | $9 / $12 / $19 per seat/mo (yearly billing); monthly billing costs more | Standard: 2 guests per paid user; Pro: unlimited guests | Credits pool: 1,000 / 2,000 / 3,000 a month by plan; extra credits about $0.01 each | [monday support](https://support.monday.com/hc/en-us/articles/35277848309394-The-pricing-model-for-monday-AI-portfolio) |
| Asana | Per seat | Starter $10.99, Advanced $24.99 per user/mo (yearly billing) | Guests free and unlimited | A monthly credit allowance for the whole account (50K Starter, 75K Advanced); more credits for sale | [Capterra](https://www.capterra.com/p/184581/Asana-PM/pricing/) |
| Smartsheet | Per member | Business about $19 (yearly) or $24 (monthly) per member, 3+ members; Pro is capped at 10 members | Contributors free; outside guests free on Business | Unverified | [smartsheet.com/pricing](https://www.smartsheet.com/pricing) |
| Oracle Aconex | Custom quote | Reported about $3K/yr for 1 user, about $15K/yr for 10 (unverified) | Not published (unverified) | Not published | [TrustRadius](https://www.trustradius.com/products/oracle-aconex/pricing) |
| PlanRadar | Per in-house user | $49 / $159 / $239 per user/mo (an earlier report found lower numbers, so treat as unverified) | Subcontractors and watchers unlimited and free; you pay for in-house users only | Included in every plan, with a usage limit | [PlanRadar help](https://help.planradar.com/hc/en-gb/articles/12634288569501-Pricing-and-Subscription) |
| Fieldwire | Per user | Free (5 users, 3 projects); Pro $39, Business $64, Business Plus $89 per user/mo (yearly billing) | Not stated on the pricing page (unverified) | Not stated (unverified) | [fieldwire.com/pricing](https://www.fieldwire.com/pricing/) |

Our earlier report listed Fieldwire Business at $59. The live page says $64, so use $64.

## 2. Three options for Tielora
**A. Per seat.** $19 per person a month, 3-person minimum. A 10-person firm pays $190 and a 30-person firm pays $570.
- Pros: revenue grows with each firm.
- Cons: it punishes exactly what you sell, which is adding more people and outside companies. It needs the most code.
- Paddle: one price, with the quantity set to the head count. The app must change the quantity whenever someone is added, removed, deactivated, reactivated, or a contractor's access runs out. If that update fails, billing drifts from real use.

**B. Flat.** $249 a month, unlimited people, as today.
- Pros: simple to explain, nothing to keep in step, and it fits the "contractors are free" story.
- Cons: small firms may find it steep, and there is no extra revenue from very large firms.
- Paddle: no change. One price, `PADDLE_PRICE_ID_PRO`, quantity 1.

**C. Mixed.** $79 a month covers 5 office staff. Each extra person is $12. Contractors are free. A 10-person firm pays $139, a 20-person firm $259, a 40-person firm $499.
- Pros: cheap to start, and it scales.
- Cons: it still needs seat syncing.
- Paddle: two prices in one subscription (a base at quantity 1 and an "extra person" price at quantity = office staff minus 5). The same quantity-update code as A applies.

## 3. Contractor rule
**Contractors (role EXTERNAL) never count toward seats.**
- PlanRadar, Asana and Procore already work this way, and it is Tielora's main selling point.
- Today's code already skips contractors whose access has expired, but it counts active ones toward the free plan's 10-person limit (`src/server/services/billing.ts:92-104`).
- Change it to skip all EXTERNAL accounts.
- Add a safety ceiling of 50 active contractors per company on Pro and 10 on Free, so the "free" rule can't be abused.

## 4. AI allowance
Rough cost, assuming a mid-range Claude model at about $3 per million tokens read and $15 per million written. This is an estimate, not a quoted price; the build step takes real prices from the `claude-api` reference.
- One "what's blocking?" question costs about $0.03.
- One daily or weekly brief costs about $0.06.

| Plan | Monthly AI cap per company | What it buys |
|---|---|---|
| FREE (all options) | $2 | About 60 questions, or weekly briefs plus about 30 questions |
| Flat Pro ($249) | $25 (about 10% of revenue) | About 400 questions, or about 1 brief a day plus about 200 questions |
| Mixed | $8 base plus $1 per extra person | Grows with the firm |
| Per seat | $2 per seat, at least $6 | Grows with the firm |

When the cap is reached, the AI says so in plain words and the rest of the app carries on as normal.

## 5. Where $249 flat sits
For a 10-person team a month: Monday Pro about $190; Smartsheet Business about $190; Asana Advanced about $250; Fieldwire Business about $640; PlanRadar Starter about $1,590 (unverified); Procore about $1,250-2,500 (from the yearly estimate).

So $249 is mid-range at 10 people and clearly cheaper above about 15. It is expensive for a 3-5 person shop, but the Free plan covers small teams for now.

## 6. What changes
**Paddle** — Flat: nothing. Per seat or mixed: create the new price(s), and add code in `src/server/services/paddle.ts` to change the subscription quantity, plus a check that the count matches. Any option: a sandbox test of the new Paddle prices before going live.

**`src/lib/plan-limits.ts`** (flat) — add the AI cap numbers ($2 FREE, $25 PRO); exclude EXTERNAL accounts from the people count, with a separate contractor ceiling; give Pro a real people ceiling (for example 100), as the 1 Sep report advised. Right now it is "unlimited".

## 7. Recommendation (one yes/no)
**Keep Pro flat at $249 a month (one Paddle price, no code change to billing). Contractors never count as people, with a ceiling of 50 active contractors on Pro and 10 on Free. Add a monthly AI spending cap of $25 on Pro and $2 on Free. Pro is capped at 100 office staff.**

If small firms push back on price later, add a second flat plan at about $99 for up to 10 people. That needs only one more Paddle price, not seat syncing.
