# Owner's answers — 30 Sep 2026

The owner answered "all defaults, dormant test for the AI" to the decision sitting of the October 2026
alignment round. Every builder reads this file with its spec; where a spec's open question lists a
default, that default is now the decision.

1. **Pricing** (`pricing.md`, recommendation approved): Pro stays **flat $249/month**, one Paddle price,
   no seat syncing. **Contractors (EXTERNAL) never count as people**; ceiling of **50 active
   contractors on Pro, 10 on Free**. **Pro is capped at 100 office staff** (non-EXTERNAL, active).
   **AI monthly cap: $25 on Pro, $2 on Free** — this replaces the placeholders in `ai-assistant.md`
   (which said PRO=30). Step 5 builds this.
2. **Microsoft approach** (`microsoft-teams-app.md`, approved): identity is `tid` + `oid`; the email is
   used only for the first match and only when `xms_edov` is true; a company is switched on by an
   admin's own Microsoft sign-in (never a typed tenant id). Teams app = read-only personal "Your day"
   tab; notifications stay on the existing Workflows webhook; **no bot, no new table** this round.
3. **Email** (`microsoft-first.md` defaults): existing people all off; new accounts `emailAlerts` on,
   both briefs off; mail only to confirmed addresses; the daily email is each person's own "Your day";
   password sign-in keeps working for everyone; unsubscribe token is an HMAC, not an `EmailToken` row.
   The weekly email's "sent" date is per person (`User.weeklyBriefEmailedAt`).
4. **AI assistant** (`ai-assistant.md` defaults): each company's admin switches it on (off until then);
   the model sees titles, codes, dates, percentages and counts only — no comments, names or document
   names; one answer at a time; no in-app alert at the cap.
5. **Reports** (`briefs-and-status-report.md` defaults): every internal project member who can read the
   Brief may export; quiet projects still show in the weekly brief ("64%, unchanged").
6. **Design calls** (the three `ui-*.md` files): landscape PDF with the dark cover; Microsoft's logo as
   an SVG picture file (no new hex in styles); the Microsoft button below the password form; the Teams
   chat card renamed "Microsoft Teams channel"; emails plain text; the at-cap colour is the existing
   red; the Teams tab light-only; the Teams pilot uses the current Railway address; the confirm dialog
   when an admin switches AI on stays; the dashboard Ask card sits above the tiles.
7. **Anthropic key: none.** Step 4 is tested in **dormant mode** — the browser test covers the dormant
   screens (everything invisible), and the mocked-`fetch` tests cover the rest.
8. **Teams follow-ups kept out of this round:** the in-memory token fallback for phones/Safari (ship
   the "open Tielora in your browser" message instead); admins of a company without Microsoft linked
   still see the Teams app card with a notice.

9. **Pricing spec approved** (2 Oct 2026): `docs/specs/align-2026-10/pricing-2026-10.md` with its three defaults — a Free company already over 10 contractors keeps them (only new ones refused); `/pricing` shows the AI allowance in dollars only once the deployment has the AI key; the "Pro is full" refusal points the admin at deactivating someone.
