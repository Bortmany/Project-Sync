# Tielora — who the users are and what they will want (2026-09-07)

This research run pulled together 83 individual claims, and the honest headline is: **we know a lot about what Tielora itself decided to build, and very little independently-verified about what real buyers in this market actually want, complain about, or would pay.** Of the 83 claims, 25 are [Certain] (mostly repo-doc: what's actually shipped, what the docs contradict, what pricing was set), 11 are [Likely] (mostly an earlier internal competitor report's summary of real reviews — real, but one step removed from the original review sites), and 47 — well over half — are [Guessing] (unsourced model reasoning, produced only because live web search was exhausted before a single query ran). The single most important, best-evidenced finding is a genuinely strong one: no researched competitor (Procore, Aconex, PlanRadar, Fieldwire, Asana, ClickUp, monday.com, Autodesk Construction Cloud) offers a first-class, no-extra-seat, time-boxed way for another company to work inside one project [61][Certain] — that is Tielora's real structural edge. But right next to that strength sits a live contradiction the research surfaced: Tielora is marketed as "self-serve," yet production signup is currently invite-only [74][75][Certain] — a gap between story and reality worth fixing before this research is used externally. Everything about the external-contractor persona, GCC/Arabic localization facts, and real user complaints about the Excel/email status quo remains unverified guesswork and should be treated as hypotheses to test, not facts to build on.

## 1. Who this user really is

### Persona A — Rashid, the GM/Project Manager (buyer + power user)
**Bio:** Runs project delivery at a 20-200 person engineering/contracting firm; personally accountable to the client for the schedule.
- **Job hired for:** Functional — stop discovering a missed discipline deliverable in a client meeting. Emotional — relief from personal exposure ("my name is on this schedule") [1][Guessing]. Social — look competent and in-control in front of the client's engineer [1][Guessing].
- **Anxieties:** Being the one blamed for a slip nobody told him about; migrating off years of Excel trackers and email threads and losing history in the process [6][Guessing]; being "out of the loop" while traveling between site visits [9][Guessing].
- **Trigger:** A missed deliverable or version mix-up on the current project (implicit in the product's own framing) [42][Certain], compounded by "chasing" people for status updates [20][Guessing].
- **First-session moment that must happen:** Seeing one main task's full discipline breakdown (Mechanical/Electrical/Instrumentation/etc.) auto-populate from an industry template within minutes — proof the tool understands his domain, not a generic PM tool tour [18][Guessing]. The dashboard's KPI tiles (Total / In progress / Completed / Blocked / Overdue / Due soon) are built to deliver exactly this at-a-glance read [48][Certain].
- **What brings him back tomorrow:** A daily brief that proactively tells him what changed overnight, removing the need to chase anyone [20][Guessing][4][Guessing].
- **What builds trust:** Visible audit trail / version history one click from any document [7][Guessing]; transparent flat pricing instead of a quote-gated sales process like Procore's [63][Likely]; security/reference signals visible before signup [21][Guessing].
- **What makes him abandon it:** An ambiguous upload/stage-gate confirmation that looks like it might have failed [8][Guessing]; discovering "self-serve" isn't actually self-serve at signup time [74][Certain].

### Persona B — Fatima, the Discipline Lead / Engineer (daily doer)
**Bio:** Owns Mechanical, Electrical, Instrumentation, Civil, Process, HSE, Reliability, or Inspection deliverables inside a main task; uploads documents and closes tasks.
- **Job hired for:** Functional — get her discipline's work marked done without friction. Emotional — not feel like data entry exists purely for the PM's benefit [2][Guessing]. Social — not be "the red item," the named blocker holding up another discipline [12][Guessing].
- **Anxieties:** Closing a task and not being sure it "took" [8][Guessing]; being buried in notifications until she stops reading them [15][Guessing][66][Likely]; document version control that doesn't feel legally solid enough to stand behind [13][Guessing].
- **Trigger:** A dependency unblocks, or a required document comes due.
- **First-session moment that must happen:** Opening her task page and seeing exactly one dominant action — "Mark Complete" — disabled with a plain-English reason (missing doc / open dependency) when it isn't ready yet [59][Certain]. That single clear action is the product's actual, shipped design, not a guess.
- **What brings her back tomorrow:** My-tasks / daily brief that separates "blocking others" from ordinary open work, so she can self-prioritize what creates real exposure for her [12][Guessing].
- **What builds trust:** An append-only audit trail she can point to — versions can never be deleted, only whole documents soft-deleted by an admin/PM [53][Certain] — which maps to the QA/HSE document-control standards (ISO 9001-style) she already expects [7][Guessing].
- **What makes her abandon it:** Notification fatigue [15][Guessing]; no mobile/offline path when she's on a site with poor connectivity [10][Guessing][65][Likely].

### Persona C — Ahmed, the External Collaborator (time-limited contractor)
**Bio:** A subcontractor or client reviewer given time-boxed access to one project, then removed.
- **Job hired for:** Functional — submit his piece of the work and be done. Emotional — not get locked out mid-submission. Social — not be seen as the company that "lost access to the client's system."
- **Anxieties:** Being locked out without warning; accidentally seeing or touching data outside his scope [3][Guessing]. This persona has almost no independently-sourced evidence anywhere in this corpus — every claim about him is a low-confidence guess, not a verified finding.
- **Trigger:** Being invited onto a project by a partner firm's PM.
- **First-session moment that must happen (guess):** Understanding immediately what he can and can't see, and how long he has.
- **What brings him back tomorrow (guess):** A visible "access expires in N days" indicator with a self-service extension request, rather than a silent cutoff [3][Guessing].
- **What builds trust (guess):** An audit trail/version export his own company's legal or QA team would accept as evidence, the way Aconex or PDF-over-email currently is treated as a "neutral, contractually-defensible record" [13][Guessing].
- **What makes him abandon it:** No first-class, no-extra-seat model to invite him into is the one thing Tielora is confirmed to do *better* than every named competitor [61][Certain] — but nothing here confirms contractors actually experience it that way in practice.

## 2. What the market does

Direct search on competitor pricing/features/sentiment was unavailable this run (session's web-search budget was exhausted before any query returned a result, and direct fetches to competitor sites were blocked). The table below is built entirely from what an earlier internal competitor-analysis report (repo-doc, dated 2026-09-01) already found — real research, but one step removed from the original sources, so marked [Likely] rather than [Certain], plus a few [Guessing] rows this run could not upgrade.

| Product | Offers | Price (as researched) | Onboarding | Phone experience | Loved for | Hated for |
|---|---|---|---|---|---|---|
| **Procore** | Field/site construction management; unlimited users at scale | Quote-only/ACV, opaque [63][Likely] | Demo-gated sales cycle [75][Likely] | Not detailed in this corpus | Unlimited-user value at 100+ users [63][Likely] | Steep learning curve; opaque quote-only sales — "the single biggest complaint in the Procore world right now" [63][Likely] |
| **PlanRadar** | Field/site inspection & punch-list management | Not sourced this run | Reported onboarding overload [64][Likely] | Strong — praised mobile field workflow, 4.3★ weighted [64][Likely] | Mobile field workflow [64][Likely] | Onboarding overload; slows down at scale [64][Likely] |
| **Fieldwire** | Field/site task & drawing management | Not sourced this run | Simple/fast to learn [65][Likely] | Strong offline mode [65][Likely] | Ease of learning; offline capability [65][Likely] | Clunky web-to-mobile sync; no time tracking [65][Likely] |
| **Aconex (Oracle)** | Enterprise EDMS/document control for megaprojects | High-cost, per-project, contractor-configured [24][Guessing] | Heavy, IT/PMO-led [24][Guessing] | Not sourced | Seen as a neutral, contractually-defensible record between companies [13][Guessing] | Not a fit for a single 20-200 person firm's buying motion [24][Guessing] |
| **Asana** | Generic work management | Enterprise ~$3K+ tier needed for guest admin controls [62][Likely] | Guest/external onboarding "not straightforward" [62][Likely] | Not detailed | Flexibility, ecosystem | Any invited guest can invite further guests with zero admin control below Enterprise [62][Likely] |
| **monday.com** | Generic work management | 3-seat minimum [66][Likely] | Trial friction from seat minimum [66][Likely] | Not detailed | Visual/flexible boards | Notification overload by default [66][Likely]; 3-seat minimum blocks small trials [66][Likely] |
| **ClickUp** | Generic work management + AI add-ons | Per-seat AI add-on cost regardless of use [67][Likely] | Not detailed | Not detailed | Feature breadth | "Learning Curve" is the most-cited G2 complaint (1,752+ mentions); lag/sync conflicts at scale [67][Likely] |
| **Autodesk Construction Cloud** | Field/site construction management | Custom enterprise quotes [25][Guessing] | Not sourced | Not sourced | Not sourced | Not sourced |
| **Jira Work Management** | Generic work management (software-engineering-rooted) | Not sourced | Poorly suited to non-technical PMs [40][Guessing] | Not detailed | Familiar to software-adjacent teams | Seen as "a developer tool" by non-technical engineering PMs [40][Guessing] |
| **Smartsheet** | Spreadsheet-native PM/tracker | Not sourced | No-developer-setup, spreadsheet-familiar [41][Guessing] | Not detailed | Zero-setup familiarity for Excel users [41][Guessing] | Lacks discipline/document-version/stage-gate domain modeling [41][Guessing] |
| **Oracle Primavera / e-Builder / CMiC / InEight / Bentley AssetWise** | Enterprise EPC/megaproject & asset-lifecycle suites | Not publicly listed; sales-led [81][82][83][Guessing] | Multi-week, PMO-dependent [81][Guessing] | Not sourced | Depth for megaprojects | Poor fit for a firm without a dedicated PMO [81][Guessing] |

**Where Tielora is different:**
- No named competitor gives another company first-class, no-extra-seat, time-boxed access to one project only — Tielora's structural bet, confirmed against 8 researched tools [61][Certain].
- Tielora bakes in document versioning + discipline structure + stage gates as pre-built domain modeling, where the generic tools (Asana/ClickUp/monday/Wrike/Jira) require teams to hand-roll naming conventions and bolt on SharePoint or spreadsheets [19][26][Guessing].
- Pricing is flat and transparent ($249/month Pro, confirmed shipped [69][Certain]) versus Procore's opaque quote-gated ACV model [63][Likely] and monday's seat-minimum friction [66][Likely] — though see Section 7 on the "self-serve" claim that doesn't yet match production reality.

## 3. What users say

No independent review-site or forum evidence could be gathered this run (search budget was exhausted and competitor domains were blocked at the network level for direct fetch). What follows are paraphrases carried over from the internal competitor report's own summary of external reviews — real complaints, but read secondhand, so graded [Likely] rather than [Certain]. Nothing marked [Guessing] below is a real quote; it is reconstructed reasoning and should not be presented to the owner as user testimony.

**Theme: "The sales process is worse than the product" — [Likely], repo-doc-sourced**
- Procore: users repeatedly cite a steep learning curve and an opaque, quote-only sales process as "the single biggest complaint in the Procore world right now" [63].

**Theme: "Guest/external access is an afterthought" — [Likely], repo-doc-sourced**
- Asana: any invited external guest can invite further guests with zero admin control, unless the company pays for the ~$3K+ Enterprise tier; onboarding external contractors is reported as "not straightforward" [62].

**Theme: "Notification overload" — [Likely] for monday.com specifically, [Guessing] as a general principle**
- monday.com: notification overload by default is a repeated complaint, alongside a 3-seat trial-minimum that blocks small teams from even trying it [66].
- General principle (unverified): notification fatigue is a well-documented enterprise-SaaS abandonment driver once volume exceeds perceived relevance [15][Guessing].

**Theme: "It's powerful but hard to learn" — [Likely], repo-doc-sourced**
- ClickUp: "Learning Curve" is its single most-cited G2 complaint (1,752+ mentions), compounded by lag/sync-conflict reliability issues at scale and per-seat AI add-on costs regardless of use [67].

**Theme: "Field/mobile use is genuinely valued" — [Likely], repo-doc-sourced**
- PlanRadar: praised for mobile field workflow (4.3★ weighted), though onboarding overload and slowdown at scale are recurring complaints [64].
- Fieldwire: praised as simple/fast to learn with a strong offline mode; complaints center on clunky web-to-mobile sync and no time tracking [65].

**Theme: "Excel/email fatigue drives the switch" — [Guessing], never independently verified**
- The claim that GMs/PMs at 20-200 person firms cite Excel+email tracking as their top pain is consistent with the product's own framing [33][Guessing] but was never confirmed against a real forum, review, or LinkedIn post this run. This is the single most important gap in the whole corpus: the product is positioned directly against this pain, and it has never been independently checked.

## 4. Local facts that change the design

This product's lens is global B2B (English, desktop-first office + field engineers), with Oman/GCC origin. Every fact below is [Guessing] — model-prior knowledge with no live source check, several explicitly flagged by the research itself as needing verification before being used for design or pricing decisions. Treat this whole section as a "go verify before you build on it" list.

| Fact | Source | Date | Design consequence |
|---|---|---|---|
| Oman/GCC observes a Friday-Saturday weekend (Sun-Thu working week) vs. Mon-Fri elsewhere [29] | Model-prior, unsourced | n/a | Daily brief, deadline reminders, and stage-gate due-date logic should be configurable per company/region rather than assuming one global calendar. |
| Ramadan commonly shortens Gulf working hours (~6 hrs/day, or a ~2-hr reduction per some accounts) [30][80] | Model-prior, unsourced — two internally inconsistent guesses about the exact reduction | n/a | Expect (and consider surfacing) a seasonal dip in task throughput/engagement during Ramadan rather than reading it as an adoption failure; needs a real Oman Ministry of Labour source before being built into scheduling logic. |
| Field sites (offshore, remote pipeline routes) often have intermittent/low-bandwidth connectivity; site devices are often mid-range Android, not the latest iPhones [31] | Model-prior, unsourced | n/a | Document upload/task-closure flows for field users need offline queuing/retry, and should be tested on mid-range Android over a throttled connection, not just desktop Chrome. |
| Oman applies 5% VAT (introduced 2021) to B2B services incl. software; UAE is 5%, Saudi is 15% [35][78][79] | Model-prior, unsourced, explicitly flagged as needing a Tax Authority check | n/a | Paddle billing needs to issue itemized, VAT-compliant invoices per country rather than one flat GCC assumption — a missing tax invoice can block a finance department from approving payment. |
| Microsoft 365 (Outlook/Teams/SharePoint) dominates the office stack in Gulf/international engineering firms far more than Google Workspace [34] | Model-prior, unsourced | n/a | The dormant Microsoft 365 integration should stay prioritized over any Google Workspace integration once activated. |
| Stage-gate/FEL/Gate 0-5 terminology is the standard vocabulary oil & gas owner-operators and EPC contractors use for phase approval, distinct from generic Kanban stages [36] | Model-prior, unsourced | n/a | Templates should offer industry-standard stage-gate/FEL naming (configurable per client) instead of generic labels, so PMs recognize the model immediately. |
| HSE is often a veto-holding, hard-blocking discipline under Oman's oil & gas safety-case/permit-to-work regimes [37] | Model-prior, unsourced | n/a | Stage-gate logic should support configuring HSE as a hard blocking gate, not just one more parallel discipline — check whether this already exists (see Section 5). |
| Gulf engineering workforces are multilingual but English is the standard contract/documentation language [38] | Model-prior, unsourced | n/a | English-only is reasonable for this lens now; revisit only if expanding into government-facing or majority-Arabic-workforce segments. |
| RTL/bidirectional text handling is a known failure point when Arabic mixes with Latin document codes/numbers [16] | Model-prior, unsourced | n/a | If/when Arabic support is added, embedded codes, dates, and numbers need explicit bidi isolation — a broken layout here is an immediate credibility hit. |

**No modality ran a single Arabic-language or GCC-localized search this run**, despite the product's Omani origin. Every fact above should be independently verified (Oman Tax Authority for VAT, Oman Ministry of Labour for Ramadan hours, real GCC forum/review sentiment) before it drives a product or pricing decision.

## 5. Feature wishlist, ranked (Kano)

"Built?" is my best read of the product description in the brief; "check" means the description doesn't say enough to be sure.

### Must-have (they leave without it)
1. **Replace the Excel/email tracking loop with one system of record for discipline deliverables** — evidence: [1][33][42] (3 sources, incl. 1 Certain). Persona: GM/PM. Built: **yes** (this is the core product).
2. **Every discipline task has exactly one clearly-surfaced accountable owner** — evidence: [11][20] (2 sources). Persona: Discipline lead/engineer. Built: **check** (roles exist; whether ownership is visually prominent on the task page isn't confirmed).
3. **Audit trail / version history one click from any document, versions never deletable** — evidence: [7][53] (2 sources, 1 Certain). Persona: Discipline lead/engineer. Built: **yes**, confirmed shipped.
4. **Immediate, explicit confirmation after any upload or stage-gate action (not just a spinner)** — evidence: [8] (1 source). Persona: all. Built: **check**.
5. **Self-service, visible "access expires in N days" indicator + extension request for external collaborators** — evidence: [3][13] (2 sources). Persona: External contractor. Built: **check** (time-limited access exists; visible countdown UX is unconfirmed).
6. **A documented Excel/prior-system import path for onboarding** — evidence: [6][39] (2 sources). Persona: GM/PM. Built: **check**, likely missing.

### Expected (they assume it)
1. **A daily brief / my-tasks view that separates "blocking others" from ordinary open work** — evidence: [4][12][20] (3 sources). Persona: GM/PM and Discipline lead. Built: **check** (daily brief and my-tasks exist; the "blocking others" distinction is unconfirmed).
2. **Notification filtering by relevance ("affects me" vs. "FYI")** — evidence: [15][66] (2 sources, 1 Likely). Persona: Discipline lead/engineer. Built: **check**.
3. **A lightweight mobile/phone view of the daily brief and blockers** — evidence: [9][17] (2 sources). Persona: GM/PM, engineer. Built: **check**, likely no (product is described as desktop-first).
4. **2FA and role-based access** — evidence: [14][21] (2 sources). Built: **yes** (explicitly in the product description).
5. **HSE configurable as a hard blocking gate, not just a parallel discipline** — evidence: [37] (1 source). Persona: Discipline lead (HSE). Built: **check**.

### Delighter (they tell a friend)
1. **Industry template auto-populates a main task's full discipline breakdown in the first session** — evidence: [5][18] (2 sources). Persona: GM/PM. Built: **yes** (industry templates are in the product description).
2. **Exportable, timestamped audit trail a contractor's own legal/QA team would accept as evidence** — evidence: [13] (1 source). Persona: External contractor. Built: **check**.
3. **Offline queuing for document/photo upload in the field** — evidence: [10][31][65] (3 sources, 1 Likely). Persona: Engineer (field). Built: **no**, confirmed gap versus Fieldwire/PlanRadar.
4. **Per-person Microsoft 365 / SharePoint sign-in and sync (not just one shared org connection)** — evidence: [34][72] (2 sources). Persona: GM/PM, IT-conscious buyer. Built: **no** — dormant and explicitly scoped as org-wide-only for v1 [73][Certain].

## 6. What they will ask to change

Predicted change requests on the *existing* product, phrased as the user would say them. These will be reconciled against real user-testing findings in the synthesis step.

1. **"Why can't I just import my Excel tracker instead of retyping the whole project?"** — Reason: loss aversion/switching-cost resistance to rebuilding project structure from scratch [6], plus a broadly expected import path in this category [39]. Suggested response: ship a documented CSV/Excel import for main tasks, discipline tasks, and current document revisions as part of onboarding.
2. **"Why do I need my laptop just to see if something's overdue while I'm at a site meeting?"** — Reason: GMs/PMs check status from a phone between site visits even though planning stays desktop-first [9][17]. Suggested response: ship a fast, read-only mobile view of the daily brief and blockers before investing in a full native app.
3. **"How do I know my upload actually went through?"** — Reason: ambiguous confirmation states are a known abandonment trigger [8]. Suggested response: add an explicit, unmissable success state to every upload/version/stage-gate action.
4. **"How many days do I have left before I lose access to this project?"** — Reason: external collaborators are anxious about silent lockout [3][13]. Suggested response: add a persistent "expires in N days" badge with a self-service extension request.
5. **"Why don't I get an email or text when something's overdue?"** — Reason: no task/comment/deadline is ever emailed by design [76], but field engineers relying on reminders from other tools may expect one. Suggested response: explain this is deliberate (to avoid the notification fatigue seen elsewhere [15][66]), and consider an optional daily digest email as a middle ground.
6. **"Why is Microsoft 365 only connected once for the whole company, not for me personally?"** — Reason: this is a known, deliberate v1 scope choice, not a bug [72][73]. Suggested response: confirm to the buyer this is intentional (one admin connects once, everyone browses through it) and that per-person sign-in is a scoped future item.
7. **"Can I get the audit trail as a report I can hand to my own QA team or the client?"** — Reason: contractors currently trust Aconex/email-PDF because it feels like a "neutral, contractually-defensible record" [13]. Suggested response: check whether a one-click exportable audit-trail report exists; if not, add it — it directly answers a named trust gap.
8. **"Why can't my project manager add a new user without going through Admin?"** — Reason: PM has only read-only visibility into Disciplines; only Admin gets the Users tab [56]. Suggested response: this is an intentional role boundary; revisit only if it becomes a real onboarding bottleneck.
9. **"Why is there no offline mode for uploading site photos?"** — Reason: field connectivity is often intermittent [31], and Fieldwire/PlanRadar are praised specifically for offline/mobile strength [65][64]. Suggested response: acknowledge this as a known, accepted gap for now; flag for roadmap if field-heavy buyers push back.
10. **"Why isn't there a Gantt chart with dependency arrows?"** — Reason: explicitly deferred/out-of-scope for this version [57]. Suggested response: confirm this was a deliberate scope decision, not an oversight, and revisit only on buyer demand.
11. **"The site says self-serve, so why did I need an invite code to sign up?"** — Reason: production signup is currently invite-only (`SIGNUP_INVITE_CODES`), while marketing calls the model self-serve [74][75]. Suggested response: either flip signup open, or change the marketing language to "request access" until it is.
12. **"Why do I keep getting notified about things that don't need my attention?"** — Reason: notification fatigue is a well-documented enterprise-tool abandonment driver [15], and monday.com is criticized for exactly this by default [66]. Suggested response: add "affects my task" vs. "FYI" filtering to the notification stream.
13. **"Is there supposed to be a lead sign-off step before a discipline task closes, or not?"** — Reason: the product's own docs contradict themselves — one section says "Mark Complete" closes a task directly with no mandatory review gate [49], another still describes a Lead-confirmation/"Send back" step [50]. Suggested response: this is a docs bug, not a live product ambiguity — clarify internally that there is no mandatory review gate, and clean up the stale spec language.
14. **"Can HSE actually block everything else from closing, the way it does on our real projects?"** — Reason: HSE is typically a hard, veto-holding gate in Gulf oil & gas governance [37]. Suggested response: check if the stage-gate model already supports a mandatory blocking discipline; if not, this is a credible, high-trust feature to add.

## 7. What the repo already believed vs. what we found

**Got right (repo-doc, [Certain]):**
- The core structural bet — no per-seat friction, and a first-class way for another company to work inside one project only — is a genuine, confirmed differentiator against 8 researched competitors [61].
- The pricing recommendation ($149-249/month flat) [68][Likely] was actually adopted: Pro shipped at $249/month [69][Certain] — a rare case of an internal recommendation being acted on and independently re-confirmed here.
- The single shared Microsoft 365 connection and the no-email/no-SMS-notifications rule are both documented as deliberate v1 scope choices, not oversights [73][76][Certain] — worth defending as intentional design, not apologizing for as gaps.
- Deferring Gantt dependency arrows was a stated, accepted scope decision [57][Certain], not something this research contradicts.

**Got wrong or stale (repo-doc, [Certain]):**
- Three internal contradictions sit unresolved in `ui-spec.md`: (a) whether AWAITING_REVIEW is a mandatory lead-confirmation gate or not [49][50]; (b) whether a 25MB upload limit is enforced or "not yet defined" [51][52]; (c) whether deleting a document's Latest revision promotes the previous one, or whether individual versions can never be deleted at all [53][54]. All three read as leftover draft text, not real product ambiguity — but they will confuse the next person who builds against these docs.
- `design-notes.md`'s blanket claim that Admin nav is visible to Admin/GM and PM alike is contradicted by the actual, narrower access rule: only Admin gets the Users tab; PM's Disciplines view is read-only [56].
- The Candara font stack and `--olng-*` brand tokens are explicitly OLNG-fleet-specific leftovers that should not survive the Tielora rebrand for a global B2B audience [58][45] — the docs themselves flag this as superseded.
- The "self-serve" positioning claim in the competitor report [75] does not match the production reality of invite-only signup [74] — a real discrepancy to reconcile before this claim is used in external marketing.

**Never considered (gap, not a contradiction):**
- The external contractor's actual lived experience — not what Tielora built for him, but how he experiences *any* time-limited access system — has essentially no evidence anywhere in this corpus.
- No GCC/Arabic-specific research was ever run with real sources: Ramadan working-hour rules, the Oman VAT rate, and RTL/bidi UX expectations are all unverified guesses, despite the product's Omani origin.
- The actual, real-world pain of tracking discipline deliverables in Excel and email was never independently checked against a forum, review, or complaint thread — it is only ever restated from the product's own framing.

## 8. Sources

Evidence-type/confidence key: repo-doc + high → **Certain**; repo-doc/model-prior + medium → **Likely**; model-prior + low → **Guessing** (per the mapping rule, all "low" confidence claims are downgraded to Guessing regardless of stated evidence type, since the underlying research runs could not complete live search or fetch).

| # | Claim (short) | Evidence type | Confidence | Source title | Host | URL / file:line | Date |
|---|---|---|---|---|---|---|---|
| 1 | GM/PM persona: functional/emotional/social job to be done | model-prior | Guessing | model prior knowledge (unsourced) | n/a | n/a | n/a |
| 2 | Discipline leads experience uploads as compliance overhead, not help | model-prior | Guessing | model prior knowledge (unsourced) | n/a | n/a | n/a |
| 3 | External collaborators anxious about silent lockout | model-prior | Guessing | model prior knowledge (unsourced) | n/a | n/a | n/a |
| 4 | Habit-loop framework (cue/routine/reward) applies to daily brief | model-prior | Guessing | model prior knowledge (unsourced) | n/a | n/a | n/a |
| 5 | "Aha moment" PLG concept — one fast value-confirming state | model-prior | Guessing | model prior knowledge (unsourced) | n/a | n/a | n/a |
| 6 | Loss aversion/switching-cost resistance to migrating off Excel | model-prior | Guessing | model prior knowledge (unsourced) | n/a | n/a | n/a |
| 7 | Audit trail as a trust anchor for regulated-industry engineers | model-prior | Guessing | model prior knowledge (unsourced) | n/a | n/a | n/a |
| 8 | Ambiguous upload/approval flow is an abandonment trigger | model-prior | Guessing | model prior knowledge (unsourced) | n/a | n/a | n/a |
| 9 | GM/PM desktop-first but checks status from phone | model-prior | Guessing | model prior knowledge (unsourced) | n/a | n/a | n/a |
| 10 | Field engineers face inconsistent connectivity; competitors differentiate on offline | model-prior | Guessing | model prior knowledge (unsourced) | n/a | n/a | n/a |
| 11 | Clear single ownership per task drives completion | model-prior | Guessing | model prior knowledge (unsourced) | n/a | n/a | n/a |
| 12 | Stage gates create "blocked on me" social pressure | model-prior | Guessing | model prior knowledge (unsourced) | n/a | n/a | n/a |
| 13 | External relationships run on Aconex/email as "defensible record" | model-prior | Guessing | model prior knowledge (unsourced) | n/a | n/a | n/a |
| 14 | 2FA/time-limited access: trust signal for admins, friction for occasional contractors | model-prior | Guessing | model prior knowledge (unsourced) | n/a | n/a | n/a |
| 15 | Notification fatigue drives enterprise tool abandonment | model-prior | Guessing | model prior knowledge (unsourced) | n/a | n/a | n/a |
| 16 | RTL/bidi text handling is a known GCC UX challenge | model-prior | Guessing | model prior knowledge (unsourced) | n/a | n/a | n/a |
| 17 | Phone-first behavior common among GCC field/site users | model-prior | Guessing | model prior knowledge (unsourced) | n/a | n/a | n/a |
| 18 | PM's first "aha" = seeing discipline breakdown from a template | model-prior | Guessing | model prior knowledge (unsourced) | n/a | n/a | n/a |
| 19 | Generic PM tools criticized for lacking document versioning/stage gates | model-prior | Guessing | model prior knowledge (unsourced) | n/a | n/a | n/a |
| 20 | Coordination-cost literature: chasing people is a core PM complaint | model-prior | Guessing | model prior knowledge (unsourced) | n/a | n/a | n/a |
| 21 | Regulated-industry buyers are risk-averse, want trust signals pre-signup | model-prior | Guessing | model prior knowledge (unsourced) | n/a | n/a | n/a |
| 22 | Session's WebSearch budget was exhausted before this task's queries ran | fetched-page | Certain | Tool error output this session | n/a | n/a | n/a |
| 23 | EPC/O&G firms require SOC2/ISO27001, SSO, 2FA before procurement | model-prior | Guessing | General enterprise SaaS procurement practice, unsourced | n/a | n/a | n/a |
| 24 | Aconex is the incumbent EDMS on Gulf EPC/LNG megaprojects | model-prior | Guessing | General industry knowledge, unsourced | n/a | n/a | n/a |
| 25 | Procore/PlanRadar/Fieldwire/ACC originated in field/site management, not discipline coordination | model-prior | Guessing | General knowledge, unsourced | n/a | n/a | n/a |
| 26 | Asana/ClickUp/monday/Wrike lack discipline/version/stage-gate concepts | model-prior | Guessing | General knowledge, unsourced | n/a | n/a | n/a |
| 27 | AEC SaaS pricing bands roughly $30-60/user/mo to $100+/user/mo | model-prior | Guessing | General recollection, unsourced, needs verification | n/a | n/a | n/a |
| 28 | GCC O&G buyers expect data residency/audit-trail assurances | model-prior | Guessing | General knowledge, unsourced | n/a | n/a | n/a |
| 29 | GCC observes Friday-Saturday weekend (Sun-Thu work week) | model-prior | Guessing | General knowledge, unsourced | n/a | n/a | n/a |
| 30 | Ramadan shortens Gulf working hours (~6 hrs/day) | model-prior | Guessing | General knowledge, unsourced, needs verification | n/a | n/a | n/a |
| 31 | Field sites often have poor connectivity, mid-range Android devices | model-prior | Guessing | General knowledge, unsourced | n/a | n/a | n/a |
| 32 | Time-limited external access tied to contract/phase, admin'd by project controls | model-prior | Guessing | General knowledge, unsourced | n/a | n/a | n/a |
| 33 | GM/PMs cite Excel+email tracking as top operational pain | model-prior | Guessing | General industry-observed pattern, unsourced | n/a | n/a | n/a |
| 34 | Microsoft 365 dominates Gulf/international engineering firm office stacks | model-prior | Guessing | General knowledge, unsourced | n/a | n/a | n/a |
| 35 | Oman applies 5% VAT to B2B services incl. SaaS | model-prior | Guessing | General knowledge, unsourced, needs verification | n/a | n/a | n/a |
| 36 | Stage-gate/FEL/Gate 0-5 terminology standard in oil & gas capital projects | model-prior | Guessing | General knowledge, unsourced | n/a | n/a | n/a |
| 37 | HSE is a first-class, often veto-holding discipline in Gulf O&G/construction | model-prior | Guessing | General knowledge, unsourced | n/a | n/a | n/a |
| 38 | Gulf workforce multilingual; English is standard contract/documentation language | model-prior | Guessing | General knowledge, unsourced | n/a | n/a | n/a |
| 39 | Buyers expect a data-import path from Excel/prior EDMS | model-prior | Guessing | General industry expectation, unsourced | n/a | n/a | n/a |
| 40 | Jira seen as a developer tool by non-technical PMs | model-prior | Guessing | General knowledge, unsourced | n/a | n/a | n/a |
| 41 | Smartsheet used as a no-setup spreadsheet-native stopgap tracker | model-prior | Guessing | General knowledge, unsourced | n/a | n/a | n/a |
| 42 | GM/PM "tired of Excel and email" is the product's own founding reason | repo-doc | Certain | Tielora repo docs | repo | design-notes.md:31 / competitor-analysis:14 | n/a |
| 43 | Design research distilled from Mobbin studies of 10 named products | repo-doc | Certain | Tielora repo docs | repo | design-notes.md:7 | n/a |
| 44 | Brand tokens are hard Oman LNG constraints | repo-doc | Certain | Tielora repo docs | repo | design-notes.md:9-24 | n/a |
| 45 | design-notes.md/ui-spec.md flagged stale post-rebrand; live tokens are --brand-* | repo-doc | Certain | Tielora repo docs | repo | design-notes.md:3-5; ui-spec.md:3-5 | n/a |
| 46 | Sail motif restricted to login/empty states only | repo-doc | Certain | Tielora repo docs | repo | design-notes.md:20 | n/a |
| 47 | Login tagline: "Multidisciplinary coordination for engineering teams" | repo-doc | Certain | Tielora repo docs | repo | design-notes.md:39; ui-spec.md:48 | n/a |
| 48 | Dashboard KPI tiles: Total/In progress/Completed/Blocked/Overdue/Due soon | repo-doc | Certain | Tielora repo docs | repo | design-notes.md:31; ui-spec.md:106 | n/a |
| 49 | No mandatory review-confirmation gate; Mark Complete closes directly | repo-doc | Certain | Tielora repo docs | repo | ui-spec.md:11-13 | n/a |
| 50 | CONTRADICTION: stale text still describes a mandatory Lead-confirmation step | repo-doc | Certain | Tielora repo docs | repo | ui-spec.md:289-300 vs 11-13, 502 | n/a |
| 51 | Upload limits enforced: 25MB, magic-number whitelist | repo-doc | Certain | Tielora repo docs | repo | ui-spec.md:14 | n/a |
| 52 | CONTRADICTION: stale text says no upload limit is defined | repo-doc | Certain | Tielora repo docs | repo | ui-spec.md:484, 504 | n/a |
| 53 | Document versions can never be deleted, only whole documents soft-deleted | repo-doc | Certain | Tielora repo docs | repo | ui-spec.md:16 | n/a |
| 54 | CONTRADICTION: stale text describes deleting Latest promoting previous version | repo-doc | Certain | Tielora repo docs | repo | ui-spec.md:350, 503 | n/a |
| 55 | New users get admin-set/system-generated password; no SSO/AD yet | repo-doc | Certain | Tielora repo docs | repo | ui-spec.md:15, 429, 505 | n/a |
| 56 | PM has read-only Disciplines view; only Admin gets Users tab | repo-doc | Certain | Tielora repo docs | repo | ui-spec.md:17, 416-417, 507 | n/a |
| 57 | Gantt dependency arrows explicitly deferred/out of scope | repo-doc | Certain | Tielora repo docs | repo | ui-spec.md:18, 328, 506 | n/a |
| 58 | Font stack is Candara (chosen for OLNG's Windows fleet) | repo-doc | Certain | Tielora repo docs | repo | design-notes.md:19 | n/a |
| 59 | Discipline-task page has one dominant, self-explaining action | repo-doc | Certain | Tielora repo docs | repo | design-notes.md:34; ui-spec.md:296-298 | n/a |
| 60 | Confirmed shipped: discipline-task model, external access, Gantt, dormant MS365/Paddle, flat pricing | repo-doc | Certain | Tielora repo docs | repo | report-2026-09-01.md:6, 12-14 | 2026-09-01 |
| 61 | No researched competitor offers first-class no-extra-seat external access | repo-doc | Certain | Tielora repo docs | repo | report-2026-09-01.md:44 | 2026-09-01 |
| 62 | Asana: guests can invite guests with zero admin control below Enterprise | repo-doc | Likely | Tielora repo docs | repo | report-2026-09-01.md:42 | 2026-09-01 |
| 63 | Procore: praised at scale, but opaque quote-only sales is the top complaint | repo-doc | Likely | Tielora repo docs | repo | report-2026-09-01.md:38 | 2026-09-01 |
| 64 | PlanRadar: praised mobile workflow (4.3★), onboarding-overload complaint | repo-doc | Likely | Tielora repo docs | repo | report-2026-09-01.md:39 | 2026-09-01 |
| 65 | Fieldwire: simple/fast, strong offline; clunky sync, no time tracking | repo-doc | Likely | Tielora repo docs | repo | report-2026-09-01.md:40 | 2026-09-01 |
| 66 | monday.com: 3-seat minimum friction; notification overload complaint | repo-doc | Likely | Tielora repo docs | repo | report-2026-09-01.md:41 | 2026-09-01 |
| 67 | ClickUp: "Learning Curve" top G2 complaint (1,752+ mentions) | repo-doc | Likely | Tielora repo docs | repo | report-2026-09-01.md:43 | 2026-09-01 |
| 68 | Recommended Pro pricing raised to $149-249/month flat | repo-doc | Likely | Tielora repo docs | repo | report-2026-09-01.md:10, 79-84 | 2026-09-01 |
| 69 | Pricing recommendation adopted: Pro shipped at $249/month | repo-doc | Certain | Tielora repo docs | repo | GO-LIVE.md:401-405 | 2026-09-01 |
| 70 | Missing vs. competitors: RFI/submittal workflow, drawing markup (high impact) | repo-doc | Likely | Tielora repo docs | repo | report-2026-09-01.md:49-53 | 2026-09-01 |
| 71 | Explicit skip candidates: BIM/3D viewing, ACV pricing, deep BI, native mobile | repo-doc | Likely | Tielora repo docs | repo | report-2026-09-01.md:60-64 | 2026-09-01 |
| 72 | Weak spots: webhook-paste Slack/Teams; org-wide-only MS365 connection | repo-doc | Likely | Tielora repo docs | repo | report-2026-09-01.md:56-58 | 2026-09-01 |
| 73 | Single shared MS365 connection is a deliberate v1 scope choice | repo-doc | Certain | Tielora repo docs | repo | GO-LIVE.md:590-594 | 2026-09-01 |
| 74 | Production signup is invite-only until SIGNUPS_OPEN is set | repo-doc | Certain | Tielora repo docs | repo | GO-LIVE.md:24 | 2026-09-01 |
| 75 | Report calls Tielora's model "fast" and "self-serve" vs. quote-gated rivals | repo-doc | Likely | Tielora repo docs | repo | report-2026-09-01.md:69-70 | 2026-09-01 |
| 76 | No task/comment/deadline is ever emailed or texted, by design | repo-doc | Certain | Tielora repo docs | repo | GO-LIVE.md:575-579 | 2026-09-01 |
| 77 | Web search budget exhausted before Arabic/GCC-specific queries could run | model-prior | Guessing | model prior knowledge (unsourced) | n/a | n/a | n/a |
| 78 | Oman VAT: 5%, introduced April 2021 (unverified this run) | model-prior | Guessing | model prior knowledge (unsourced) | n/a | n/a | n/a |
| 79 | UAE VAT 5%, Saudi VAT 15% (unverified this run) | model-prior | Guessing | model prior knowledge (unsourced) | n/a | n/a | n/a |
| 80 | Oman Ramadan hours reduction ~2 hrs/day (unverified this run) | model-prior | Guessing | model prior knowledge (unsourced) | n/a | n/a | n/a |
| 81 | Oracle Primavera Unifier/P6: poor fit for firms without a PMO | model-prior | Guessing | model prior knowledge (unsourced) | n/a | n/a | n/a |
| 82 | e-Builder/CMiC: owner-side, sales-led enterprise procurement | model-prior | Guessing | model prior knowledge (unsourced) | n/a | n/a | n/a |
| 83 | InEight/Bentley AssetWise: skewed toward megaproject owners | model-prior | Guessing | model prior knowledge (unsourced) | n/a | n/a | n/a |

**Blocked hosts (attempted, could not fetch — snippet only, and in several cases not even a snippet):**
- procore.com — could not fetch, blocked by sandbox egress proxy
- planradar.com — could not fetch, blocked by sandbox egress proxy
- fieldwire.com — could not fetch, blocked by sandbox egress proxy
- construction.autodesk.com (Autodesk Construction Cloud) — could not fetch, blocked by sandbox egress proxy
- asana.com — could not fetch, blocked by sandbox egress proxy
- iso.org — could not fetch, blocked by sandbox egress proxy

Additionally, the WebSearch tool itself returned zero results for every query across five of seven modalities (competitors, sentiment, market, gap-1, gap-2, gap-3, gap-4 partially) because the session's search budget (200/200) was exhausted before this task's queries executed — not a host-blocking issue, but the reason so much of this document is marked Guessing rather than Certain or Likely.
