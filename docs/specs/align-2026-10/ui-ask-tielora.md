# Tielora — UI spec: Ask Tielora, the AI card, the AI meter and AI-written briefs

Companion to `docs/specs/align-2026-10/ai-assistant.md` (the behaviour, wording of refusals, and rules live there; this file only decides how it looks and feels). Same conventions as `ui-export-report.md`.
Rules followed: `CONVENTIONS.md` house rules 6-8 (plain English, dates like "1 Nov 2026", brand tokens from `src/app/globals.css` only, no new hex) and THE EXTERNAL RULE (a contractor sees nothing, not even a gap).

**Mobbin references:** pulled by the orchestrator on 30 Sep 2026 — listed under "Prior art" at the bottom of this file. They inform, they do not replace the app's styling.

**Proposed additions to the design system: one, small.** A sparkle icon added to `src/components/shell/icons.tsx` (same stroke style as the others) for the "Ask Tielora" buttons. No new colours, fonts or components otherwise. Reused: `Button`, `Card`, `Badge`, `Field`, `Textarea`, `Select` (`src/components/ui/primitives.tsx`), `Skeleton` (`ui/skeleton.tsx`), `useToast` (`ui/toast.tsx`), `Modal` (`ui/modal.tsx`), `ErrorBanner`, the menu open/close behaviour in `shell/topbar.tsx`, and the checkbox-row pattern in `admin/admin-integrations-view.tsx` (`EventToggleList`).

**Invisible while the key is unset (one rule for everything below):** no Ask Tielora button, no dashboard card, no panel, no AI card on Integrations, no AI meter on Billing, no summary in any brief. Nothing greyed out, no empty space left behind. The server decides this once per page (key set AND company switch on AND internal role) and hands the page one yes/no; the screen never guesses. While "who am I" is still loading, render nothing (no flash).

---

## 1. Entry points

### 1a. Project page
File: `src/components/projects/project-view.tsx`, the action row that `ui-export-report.md` adds to the `<header>` (Edit left, Export right).
- New button **Ask Tielora**: `secondary` variant, sparkle icon then the words (so not icon-only), `min-h-11` (44px). It sits directly **before Export**, so Export stays last at the reading end.
- Phone (390px): row is Edit (left) then Ask Tielora and Export together on the right, 8px apart. Widths roughly 60 + 150 + 110 = fits in 358px; if a narrow phone cannot fit, the row wraps and Ask Tielora goes first on its own line, full width.
- Laptop (1440px): Edit, Ask Tielora and Export sit at the far right of the name line (`ml-auto`), 8px apart. Nothing stretches.
- Hover hint (`title`): "Ask a question about this project".
- States: default, hover (`--page-bg`), pressed/panel open (`aria-expanded="true"`, `aria-controls` the panel, `--page-bg`), focus ring (existing `--brand-accent`), disabled never (it is there or it is not). Pressing it again closes the panel.

### 1b. Dashboard
File: `src/components/dashboard/dashboard-view.tsx`. A slim launcher card **directly under the company news strip and above the stat tiles**, so it is near the top without pushing the numbers off a phone screen.
- Only drawn when the person is on at least one project.
- Card (no title bar): sparkle icon in `--brand-accent` circle-free (just the icon), heading "Ask Tielora" (16px semibold `--brand-ink`), one line "Ask a question about your projects, like what is blocking them." (14px `--brand-text`, wraps), and the button **Ask a question** (`primary`, 44px).
- Phone: heading and line stacked, button full width under them (about 150px tall in total). Laptop: one row, text left, button at the far right (`ml-auto`), about 80px tall.
- Loading: nothing until the dashboard has loaded (the card does not skeleton; it simply arrives with the tiles). Error: card not drawn.
- Hover hint on the button: "Ask a question about your projects".

---

## 2. The panel (one component, used by both entry points)

New file suggestion: `src/components/ai/ask-tielora-panel.tsx`. Same content in both layouts; only the frame changes.

### 2.1 The frame: sheet on phone, side panel on laptop
| | Phone and tablet (under 1024px) | Laptop (1024px and up, designed at 1440px) |
|---|---|---|
| Form | Bottom sheet, slides up. Full width, `max-w-xl` centred on a tablet, height 92% of the screen (`92dvh`), top corners rounded 6px, `--brand-ink`/40 dim behind (same as `Modal`). Bottom padding respects the phone's safe area. | Side panel fixed to the right edge, 420px wide, full height, white, `--border` line on its left edge, shadow. **No dimming**: the page behind stays visible and usable, so someone can read a task and keep the answer open. It sits over the page; it does not push it. |
| Behaves as | Dialog, page behind is locked (`aria-modal="true"`), focus is kept inside. | A non-modal dialog (`aria-modal="false"`), Tab can leave it; Escape still closes it. |
| Closes on | The X, Escape, tapping the dim area. | The X, Escape, pressing the entry button again. (Clicking the page does **not** close it.) |
| Motion | Slides up 200ms; under "reduce motion" it just appears. | Slides in from the right 200ms; same reduce-motion rule. |
| First focus | The panel itself (a phone keyboard popping up would hide the starter questions). | The question box. |
| On close | Focus returns to the button that opened it. | Same. |

Panel z-index 50, same as `Modal` (only one can be open; the Integrations confirm below is on a different page).

### 2.2 Inside, top to bottom
1. **Header (fixed, 56px):** title "Ask Tielora" (16px semibold `--brand-ink`); on the right a **Close** X button, 44x44 tap area, `aria-label="Close"` and `title="Close"`.
2. **Scope line under the header** (fixed):
   - Project page: "Asking about SUR-EXP · Surge Export" (12px `--brand-text`, `break-words`, two lines allowed). Not changeable.
   - Dashboard: a labelled `Select` "Ask about" (label 12px semibold `--brand-ink`, control 44px tall): first option **All my projects** (default), then "SUR-EXP · Surge Export" per project the person is on (option text is cut with an ellipsis if long). Hover hint on the select: "Choose which of your projects the question covers".
3. **Body (scrolls; the only part that scrolls):** four possible contents, only one at a time (section 2.3).
4. **Footer (fixed to the bottom, above the phone keyboard):**
   - `Textarea` with visible label "Ask about your projects" (14px semibold `--brand-ink`), 3 lines tall (88px) minimum, grows to 6 lines then scrolls inside. Placeholder (`--brand-gray`, it is only an example): "For example: What is blocking this project?" (dashboard: "For example: What is late across my projects?"). Max 500 characters (`maxlength`).
   - Character counter, right-aligned under the box, only from 450 characters on: "462 / 500", 12px `--brand-text`; from 490 on it turns `--status-blocked`. Screen readers hear "20 characters left" once at 480 (polite).
   - Button **Send** (`primary`, 44px, right-aligned, on a phone full width). Disabled (grey, `--brand-gray`) while the box is empty or an answer is loading. While loading it shows the spinner and "Asking…" at fixed width (`min-w-[8rem]`) so nothing jumps. Hover hint: "Send your question (Ctrl+Enter)"; on a Mac "(Cmd+Enter)".
   - Keyboard: **Ctrl/Cmd+Enter sends**; plain Enter adds a new line (on a phone Enter is always a new line, Send is the button).
   - Field error (plain language, under the box, `--status-blocked` 12px, `role="alert"`): empty "Type a question first." · too long "Keep your question under 500 characters."

### 2.3 Body states
**A. Empty (before the first question).**
- Line (14px `--brand-text`): "What would you like to know? I read the live project, so answers are as fresh as your team's last update."
- Small heading "Not sure where to start? Try one of these." (12px semibold `--brand-ink`), then **three starter buttons**, stacked, full width, each **min 44px tall** (text wraps to two lines if needed, `break-words`), left-aligned text, `--brand-primary` text on white, `--border` outline, hover `--page-bg`:
  - Project page: "What is blocking this project?" · "What is late?" · "What is the next gate waiting on?"
  - Dashboard, "All my projects": "What is blocked across my projects?" · "What is late?" · "Which project is furthest behind?" (When one project is picked in the chooser, the project set above is shown.)
- Tapping a starter **fills the question box and moves focus to it; it does not send** (each send costs money and the person may want to tweak it). Hover hint: "Put this question in the box".

**B. Waiting.**
- The question the person asked is shown at the top of the body as a quote (14px `--brand-ink`, `break-words`, left rule 4px `--border`), so they can see what is being answered.
- Under it, **skeleton shaped like the answer**: four grey lines (`Skeleton`, `h-4`, widths 100%, 96%, 90%, 55%) and a short 12px line (40% width) where "Based on" will go. Text beside it: "Reading your project…" (14px `--brand-text`). The app has no dark theme today, so the existing grey pulse is the whole answer; if a dark theme is added, the skeleton keeps using `--brand-gray` at 30%.
- After **8 seconds** the text changes to "Still thinking… big projects take a moment." (the server gives up at 25 seconds and the error in state D appears).
- The body is a polite live region: screen readers hear "Reading your project" then the answer or error when it arrives. `aria-busy="true"` while waiting.
- Closing the panel while waiting is allowed; the reply is thrown away when it arrives.

**C. Answer (one at a time; a new question replaces it).**
- The question quote on top (as above), then the answer: 16px `--brand-ink`, `whitespace-pre-wrap break-words`, plain text only (never a link, image or formatting), with a 4px `--brand-accent` rule on its left. Body scrolls to the top of the answer.
- Under it, **"Based on"** line (12px `--brand-text`, `break-words`): "Based on: SUR-EXP · Surge Export". Several projects: "Based on: 4 projects — SUR-EXP · Surge Export, GAS-TIE · Gas Tie-in, and 2 more" (names from the server).
- Under that, always, 12px semibold `--brand-text`: **"Answers may be wrong. Check the task before you act."**
- Under that, a heading "Ask something else" and the starter buttons again (state A), so the next question is one tap. The box in the footer is cleared and focused on laptop (not on phone).
- The answer appearing is the confirmation; no toast.

**D. Cannot answer.** Each sentence is exactly the server's (`ai-assistant.md` 2.3); the panel never re-words it. Shown in a box in the body under the question quote. The question stays in the box so nothing is lost.
| Situation | Look | What else changes |
|---|---|---|
| "I can't find that project." | Neutral box (`--page-bg`, `--border` line, `--brand-text`). | Nothing disabled. On the dashboard the project list is refreshed. |
| Allowance used, administrator: "Your company has used its AI allowance for this month. See Admin → Billing." | Neutral box, `role="status"`. Not red: nothing is broken. | A `secondary` 44px button **Open Billing** under the sentence (links to `/admin/billing`). The question box, Send and starters are **disabled** for the rest of this visit (reopening the panel tries again). |
| Allowance used, anyone else: "Your company has used its AI allowance for this month. Ask your administrator." | Same neutral box. | **No button** (a non-admin cannot open Billing, so we do not point at a door they cannot use). Box, Send and starters disabled as above. |
| "Ask Tielora could not answer just now. Try again in a minute." | Red text `--status-blocked`, 1px `--status-blocked` outline, white background, `role="alert"` (the same look as the `ErrorBanner`). | A `secondary` 44px **Try again** button that re-sends the same question. |
| "You are asking quickly. Try again in a moment." (429) | Neutral box, `role="status"`. | Send disabled for the seconds in `Retry-After` (never more than 60) and reads "Try again in 12 s", counting down; then it enables by itself. |
| No connection | "Could not reach Tielora. Check your connection and try again." (red, as the error row) | **Try again** button. |
| Panel is somehow open but the feature was switched off meanwhile ("Ask Tielora is not switched on for your company." / "Ask Tielora is not set up.") | Neutral box. | Box and Send disabled; refreshing the page removes the button. |

---

## 3. What each kind of person sees
| Person | Sees |
|---|---|
| Administrator | Ask Tielora button and dashboard card; at the allowance, the sentence with **Open Billing**. Asking on the dashboard covers every project in the company. |
| Project manager, Discipline lead, Engineer | The same, but only their own projects; at the allowance, the "Ask your administrator" sentence and no button. |
| Contractor (EXTERNAL) | **Nothing.** No button, no card, no space where they would be, no menu item, no hint the feature exists. Nothing greyed out. The server decides this when the page is built; a hand-typed address answers "not found". |
| Anyone, feature off in their company, or no key | Nothing, same as above. |

---

## 4. Admin -> Billing: "AI this month" meter
File: `src/components/admin/admin-billing-view.tsx`, inside `CurrentPlanCard`, as a **fourth meter directly under Documents**, same `Meter` look (label left, figure right at the reading end, thin bar). Only drawn when the deployment has the key. Nothing else on the page changes; no new buttons.
- Label **AI this month**. Figure: "$0.42 / $2.00" (dollars with cents, `tabular-nums`). Bar uses the normal `ProgressBar`.
- Line under the bar (12px `--brand-text`): "15 AI requests this month · Resets on 1 Nov 2026".
- **At the allowance**: figure and bar turn `--status-blocked` (this is the app's existing "over" look in this same file, and there is no amber token; see owner decisions). Red line below (12px, same as the existing over-limit line): "You have used this month's AI allowance. Ask Tielora and AI-written summaries are paused until 1 Nov 2026. Everything else works as normal." "At the allowance" comes from the server as a yes/no ("the next question would be refused"), not from a sum in the screen.
- Plan with no AI allowance (0): no bar; a plain row "AI this month" with "Not included in your plan".
- Phone: label and figure share a row and the wrap rule is the existing one; the reset line wraps. Laptop: unchanged, card stays in the `max-w-2xl` column.
- Loading: the page is a server component, so no skeleton (it arrives whole). Error: existing page error.

---

## 5. Admin -> Integrations: the AI card
File: `src/components/admin/admin-integrations-view.tsx`. New `AdminAiCard`, placed **after the Slack and Teams cards and before the Microsoft card** in the existing `lg:grid-cols-2` grid (phone: one column in that order; laptop: takes the next half-width slot). Administrators only, and only when the deployment has the key.
- Card title **AI**, header badge: **On** (accent fill, ink text) if either switch is on, otherwise **Off** (`--brand-mid`), like the chat cards' Enabled/Disabled.
- Intro (14px `--brand-text`): "Let your team ask questions about their projects, and add a short written summary to your daily and weekly brief. Both are off until you switch them on."
- Two switches, drawn with the **existing checkbox-row pattern** (no new component): whole row at least 44px tall (`min-h-11`), checkbox enlarged to 20px, bold label, helper line under it in 12px `--brand-text`. Saved the moment they are ticked; the pair is disabled while saving.
  - **Ask Tielora** — "People on your team can ask questions about the projects they are on. Administrators can ask about every project in the company. Contractors never see it. Answers can be wrong."
  - **AI-written briefs** — "The daily and weekly brief opens with two or three sentences written by AI, above the usual lines. If the AI is unavailable or your allowance is used up, the brief goes out as normal."
- **Turning a switch on asks first** (`Modal`, size `sm`, like the "Remove" confirm in the same file). Title "Turn on Ask Tielora?" / "Turn on AI-written briefs?". Body: "Turning this on sends project information to Anthropic, our AI provider, to write each answer. Turning it off again takes effect straight away." Buttons: Cancel (ghost) and **Turn on** (primary, loading while saving). Turning **off** needs no confirmation. Escape and Cancel change nothing.
- **What is sent** (12px `--brand-text`, shown always under the switches, `break-words`): "What is sent to Anthropic: when someone asks a question, or a brief is written, the question and the project names, codes, deadlines, progress figures and task titles it needs are sent to Anthropic. People's names, email addresses, comments and documents are never sent. Tielora does not save questions or answers. Please tell your team not to type personal or confidential details into a question." Then a link **Read our Privacy page** (44px tap area, goes to `/privacy`).
- **Allowance line** (14px `--brand-ink`): "Your plan's monthly allowance is $2.00. Used so far this month: $0.42." plus a link **See Admin → Billing** (`/admin/billing`, 44px tap area). At the allowance, add a calm note (`CalmNote` look, as on Billing): "Your company has used its AI allowance for this month. Both switches stay as they are and start working again on 1 Nov 2026."
- **Plan with no AI allowance:** the switches are not drawn. Instead the paragraph "Your plan doesn't include AI. There is nothing to switch on." plus the same Billing link.
- **Outcomes (toasts, success tone):** "Ask Tielora is on. Your team can now ask questions about their projects." · "Ask Tielora is off. The Ask Tielora button is gone from every page." · "AI-written briefs are on. The next daily brief will open with a short summary." · "AI-written briefs are off. Briefs go out as before." Failure: "Couldn't change that. Try again." Rate limit: the server's plain sentence, shown as an error toast.
- Loading: server-rendered, no skeleton. A contractor or non-admin never reaches this page.

---

## 6. How an AI-written summary appears in the brief

The summary is always **above** the computed lines, labelled, and the computed lines are exactly as today. If there is no summary (off, dormant, at the allowance, a slow or failed AI) the brief is byte for byte today's: no empty label, no "AI unavailable" note.

**Chat card (Slack and Teams).** `digestMessage()` in `src/server/services/briefs.ts` keeps its title ("Today's brief — 3 active projects", weekly likewise). The body becomes:
```
Summary (written by AI)
Two or three plain sentences.

• SUR-EXP Surge Export — 64% · 2 overdue · 1 blocked · next gate: FEED review
• ...
```
A blank line separates them. Plain text, escaped like every other line, so it can never become a link.
- **Length:** the card body is capped at 1,200 characters today and the project lines already use most of it. The summary is cut at **350 characters** on a whole sentence. If summary plus lines still would not fit, the **summary is dropped, never the computed lines**.
- The word "overdue" in the lines is a wording question for the briefs spec (which moves the app to "late"); this file does not change it.

**Email** (any email that carries the company digest). The summary sits in a box at the top of the message body, above the project lines/table:
- Box: `--page-bg` fill, 4px `--brand-accent` left edge, 12px padding.
- Heading "Summary (written by AI)" 12px bold `--brand-ink`; the sentences 14px `--brand-text`; then one 12px `--brand-text` line: "Written by AI from the figures below. It can be wrong."
- Emails cannot read CSS variables, so the hex values are copied once from `globals.css` into the existing email theme (the same trick the report spec uses); nothing new.
- A contractor's messages, the personal "Your day" brief and the notice email never carry a summary.

---

## 7. Accessibility and touch checklist (for the builder)
- Every button, chip, select, checkbox row and link above is at least **44px** tall; the shared `Button` is only about 36px, so add `min-h-11` (the Export spec does the same).
- **Icon-only controls:** only the panel's Close X. It has `aria-label="Close"` and `title="Close"`. (The shared `Modal`'s own close button is only about 24px; for the confirm dialogs in section 5 the builder should raise it to 44px too. It is a one-line change in `ui/modal.tsx` and helps every dialog.)
- Panel has `role="dialog"`, `aria-labelledby` its title. Phone: focus trapped, background inert. Laptop: Escape closes, Tab may leave.
- Live region for the body: "Reading your project", the answer, and errors are announced. Errors use `role="alert"`, neutral notices `role="status"`.
- Colour is never the only signal: an error also has words and a "Try again" button; the meter turns red **and** says so in a sentence.
- Text sizes used: 12, 14, 16 (answer and headings only). Contrast: everything a person must read is `--brand-text` or darker; `--brand-gray` only for placeholders and disabled looks. (Note: the existing integration helper lines use `--brand-gray`, which is pale in daylight; the new lines deliberately use `--brand-text`.)
- Long text: the question quote, answer, "Based on" line, project names and every sentence use `break-words` and `min-w-0`; a 5,000-character task title never scrolls the page sideways. Select option text is truncated with an ellipsis, with the full name on hover (`title`).
- Reduce-motion respected for the slide, and the skeleton pulse is `aria-hidden`.
- Tooltips (`title`) on every control whose purpose is not obvious from its label: listed inline above (Ask Tielora buttons, project chooser, starter chips, Send).

---

## Decisions for the owner's taste
1. **One answer at a time (chosen)** versus a running conversation in the panel. One answer is simpler, cheaper and matches "not saved"; the cost is that follow-up questions do not see the last answer.
2. **Dashboard launcher above the tiles (chosen)** versus below them. Above is easier to find; below keeps the numbers first.
3. **The "Turn on" confirm** before an administrator switches either AI setting on. It adds one tap but makes the "project data goes to Anthropic" consent explicit. Say the word to drop it.
4. **Amber vs red at the allowance.** The spec says the meter "turns amber", but the app has no amber and the live Billing meters use the red `--status-blocked`. I used the red. A new warning colour would be a design-system addition, so it is your call.
5. **Showing the dollar allowance on the Billing "Plans" table** (FREE $2, PRO $30). Not added: those are placeholders until the pricing decision, and `/pricing` is unchanged in this round.
6. **Meter wording.** The stored figure is a single request count, so the meter says "15 AI requests" rather than "questions and summaries" as the spec suggested.

## Prior art (Mobbin, pulled 30 Sep 2026)

- [Klaviyo — Composer AI panel](https://mobbin.com/screens/14bcd4a7-1d5f-408b-97fe-d8bf8bf44617): sparkle mark, "What can I help you with?", three starter chips, and a small line under the question box saying the message is processed by the company and its providers, with a Privacy Notice link.
- [Mintlify — assistant side panel](https://mobbin.com/screens/99f9f314-b207-46e1-82bc-239240c4b543): a narrow side panel beside the working page, question box fixed at the bottom — the laptop layout this spec chose.
- [AirOps — assistant answer](https://mobbin.com/screens/433da809-2c06-433d-a05e-6f1a74a7ce8a): an answer followed by small copy / thumbs actions and a question box underneath.
- [Microsoft Copilot — answer](https://mobbin.com/screens/0fb9fc0d-38aa-4489-88f3-6e35396a361a): plain paragraphs, generous line length, actions under the answer — what Microsoft-first customers already know.

**Changed after prior-art review:** one small grey line under the question box: "Your question and this project's details are sent to Anthropic to write the answer. Privacy" (the last word links to `/privacy`). It makes the data going out visible at the moment of asking, not only on the settings card.
