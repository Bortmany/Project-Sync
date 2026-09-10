# Tielora — user-testing report (2026-09-07)

**Verdict: Not ready** — six separate P1 problems were confirmed by an independent re-test, and at least four of them sit squarely on the main journey (the home dashboard, the "what's late" lists, the project Brief, and the My-tasks filters). The rule is mechanical: three or more confirmed P1 code bugs in the core loop means not ready. There were no P0 problems, and nothing was lost, leaked or corrupted.

A first-time user can sign in, open a project, create a main task with discipline tasks and required documents, upload a drawing, comment on it, mark work complete and watch the parent task move itself to "in progress" or "complete" — the headline promise of the product genuinely works, on the desktop and on the phone. What they cannot do is trust a single number the app shows them: the six counters on the home screen disagree with the lists they link to, "Upcoming deadlines" is full of dates from July, and the same project reports one, three or four late items depending on which screen you are looking at.

The single most important thing to change: make every number on the dashboard come from the same place as the list it opens, and label clearly whether a number means "my work" or "the whole company". Nothing else in the report matters as much, because every tester independently stopped trusting the product at that screen.

**First impression: 74/100** — all three testers understood what Tielora is in 8–12 seconds from the landing page alone and all three said they would keep going, but the very first screen inside the app contradicted itself for every one of them.

**Core loop: 61/100** — the chain of main task to discipline task to required document to completion to derived parent status works exactly as advertised and is well explained at every step, but you cannot create a dependency, you cannot delete a task you created by mistake, and the reporting numbers on top of that loop cannot be relied on.

## What we tested

| Who | Language | Desktop | Phone | Scenarios passed / failed / blocked |
|---|---|---|---|---|
| Admin / GM — the owner of an engineering firm deciding whether to buy this for the whole company | English | Yes | Yes | 10 / 3 / 0 |
| Project manager — runs the SUR-EXP project day to day and reports status on Sunday mornings | English | Yes | Yes | 4 / 2 / 0 |
| Engineer — a mechanical engineer who wants to know what he owes this week and upload his drawings | English | Yes | Yes | 11 / 4 / 0 |

Tested on a fresh local copy with demo data only. No real order, payment or message was sent.

## First impressions (blind)

- **Admin / GM (English)** — Understood the product in **8 seconds**; would continue: **yes**. Quote: *"I got what this does and why my firm needs it before I finished the first scroll — but then the very first screen inside told me six tasks and no tasks in the same breath, and that's the number I was going to trust."* Confusions: the six dashboard counters sitting on top of "No tasks assigned to you yet"; four already-past dates listed under "Upcoming deadlines"; deadline dates printed with no year on a two-year project; a public price of $249/month that the app says it cannot sell; every discipline reading "No lead assigned"; phone tables hiding deadline, role and the action buttons. Delights: the landing page teaching the product with pictures of the real screens; locked phases explaining in plain English exactly why they are locked and what must finish first; the Brief tab reading like a one-page morning report; pricing that promises nothing is locked behind a higher plan; an override notification that carried the reason and the MOC number; and a completely clean run — no console errors and no broken pages across about 25 screens. Phone vs desktop: the same layout on both and genuinely well made on the phone, except that the two tables a GM would actually open on a phone clip their most useful columns.
- **Project manager (English)** — Understood the product in **12 seconds**; would continue: **yes**. Quote: *"The home screen tells me six tasks, one blocked, one overdue — then two centimetres lower it tells me I have nothing assigned at all. Which one do I read out in the Sunday meeting?"* Confusions: the counters versus the empty personal list; "Upcoming deadlines" full of July dates while "Due soon" reads 0; the project header saying one overdue while the timeline shows four; a blocked task with no reason anywhere; "No lead assigned" on every discipline; and a task showing "Completed *" in the list with the override explanation only visible on the detail page. Delights: derived status being real rather than marketing; phase gating that matches how engineering projects actually run; the plain-English "Must be done — yes, the main task waits on it"; per-discipline documents with revisions and history; seed comments that read like a live project; and fast page loads with no errors. Phone vs desktop: the phone is genuinely usable and the task detail page reads beautifully, but the project task table loses status and deadlines, and the desktop sidebar shortcuts and the Gantt are where a PM would really work.
- **Engineer (English)** — Understood the product in **10 seconds**; would continue: **yes**. Quote: *"It explained itself faster than any tool I've been handed at work, and uploading a drawing from my phone actually worked — but when the front page says I've got six tasks and one is overdue, and the list behind it shows two and zero, I stop believing the numbers."* Confusions: "Total 6" against a list of 2, with no idea where the other four live; the Blocked and Overdue tiles both landing on "No tasks match your filters"; July dates under "Upcoming"; a task with a 20 August deadline filed under the heading "TODAY"; an empty "This week" view when he had three things due; and the phone document table running off the right edge so Download and New revision are unreachable. Delights: a landing page that taught the product in one scroll without jargon; uploading a file from the phone working cleanly with a revision number and an audit line; a task page that explains in plain English why it is blocked and which documents are still missing; phase gates that say exactly what is locked and why; and global search finding his task by the word "datasheet" as he typed. Phone vs desktop: a real, usable app at 390px, but the sidebar shortcuts hide behind a hamburger and the document table is the one place clearly not designed for a narrow screen.

## Findings, most serious first

### P0

None. Nothing lost data, leaked another company's information, or stopped the core loop dead.

### P1

**The dashboard counters contradict the very lists they link to** (all three roles, desktop and phone, English, [Certain])

What happened. Every tester signed in and landed on the home dashboard, which shows six big numbers across the top — Total, In progress, Completed, Blocked, Overdue, Due soon. Directly underneath sits a panel headed "My tasks". They read the numbers, then read the panel, then clicked the numbers.

Expected. Either the six numbers count the tester's own work and match the list below, or they are clearly labelled as company-wide and lead somewhere that actually shows those items.

Seen. The admin saw "Total 15" above "No tasks assigned to you yet". The project manager saw "10 Total / 1 Blocked / 1 Overdue" above the same empty panel, and watched the total climb to 12 and then 15 during her session as other people created work — so the numbers are the whole company's, but every one of them is a link to her personal task list. Clicking the red "1 Overdue" card opened a page reading "No tasks assigned to you right now." The engineer measured the same gap twice in one sitting: Total 16 against a list of 8, In progress 4 against 2, Completed 4 against 3, Blocked 1 against an empty list, Overdue 1 against an empty list. On top of that, the sub-counts do not add up to the stated total, and a third screen — the "Your day" brief — insists nothing is overdue while the tile says one thing is.

Evidence: screenshots/admin-en/019-desktop-blind-desktop2-21-overdue-card-result.png, screenshots/pm-en/022-desktop-blind-desktop-d02-dashboard.png, screenshots/engineer-en/027-desktop-core-personal-05-dashboard-recheck.png, screenshots/engineer-en/019-phone-blind-phone3-11-blocked.png.

Confirmed by an independent re-test: **yes** — reproduced for all three roles (screenshots/admin-en/024-desktop-repro-blind-tl-admin-en-01-02-dashboard-counters-and-mytasks-card.png, screenshots/pm-en/026-desktop-repro-blind-tie-pm-01-04-dashboard-decisive.png, screenshots/pm-en/001-desktop-repro-pm-en-01-01-dashboard-after-login.png, screenshots/engineer-en/006-desktop-repro-eng-f1-list-1-blocked.png, screenshots/engineer-en/038-phone-repro-blind-tie-eng-01-phone-02-blocked-empty.png). The engineer's re-test even returned different numbers from the first measurement, which independently proves the counts are unreliable rather than a one-off glitch.

Fix brief. Decide, once, what the dashboard is for. The simplest fix that keeps the current design: make each of the six tiles count exactly the same set of items that the link behind it opens, so a tile and its list can never disagree — one query, used in both places. If the numbers are meant to be company-wide, keep them company-wide, put a small label on the block saying so ("Across the whole company"), and point them at a company-wide list rather than the personal one. Do the same for the "Your day" brief so it reads from that one source too. This is the highest-value fix in the report and should be treated as one job, not five.

---

**"Upcoming deadlines" is a list of dates that already passed, and the overdue counts never agree** (all three roles, desktop and phone, English, [Certain])

What happened. Testers opened the dashboard on 8 September 2026 and read the "Upcoming deadlines" card and the "Overdue" counter next to it, then compared them with the project header and the project Brief tab.

Expected. A card called "Upcoming" lists dates still ahead; anything already late is shown as overdue and counted as overdue. On a two-year project every date carries its year. One consistent "how much is late" figure, or each figure clearly labelled.

Seen. Four of the five rows under "Upcoming deadlines" were 22 July, 25 July, 28 July and 1 August — six to seven weeks in the past — printed in red but still under the word "Upcoming". Only 20 September was genuinely upcoming, and none of the dates showed a year. At the same time the "Overdue" counter said 1 and "Due soon" said 0. The project manager then found three different answers for the same project on the same day: the dashboard and the project header both said "1 overdue" (they count only main tasks), while the Brief tab said "Overdue by discipline (3)" and the timeline showed at least four discipline tasks past their date.

Evidence: screenshots/admin-en/x18-desktop-dashboard-counters.png, screenshots/pm-en/035-desktop-core-login-after-login.png.

Confirmed by an independent re-test: **yes** (screenshots/admin-en/003-desktop-repro-tie-adm-02-03-dashboard-decisive.png).

Fix brief. Split the card in two: a "Late" block for anything whose deadline has passed and an "Upcoming" block for what is still ahead, and put the year on every date. Then pick one definition of "overdue" for the whole product — the honest one is "any main task or discipline task past its deadline and not complete" — and use it on the dashboard counter, the project header badge and the Brief tab alike. Where a screen deliberately counts only main tasks, say so on the label ("1 main task overdue"). Right now the same project has three different published answers, and a project manager cannot read any of them out loud with confidence.

---

**On the phone, the important table columns are hidden behind a sideways scroll nobody signals** (admin, project manager and engineer; phone; English; [Certain])

What happened. On a 390px phone, testers opened the project Tasks tab, the admin Users page and a task's Documents tab.

Expected. On a phone the rows collapse into cards showing what matters — deadline and status for tasks, role and the Edit/Deactivate buttons for users, revision and Download for documents — or at the very least there is a visible hint that the table slides sideways.

Seen. The desktop tables are rendered as-is inside a silent scroll box: 609px of task table squeezed into a 356px window, and 887px of document table into the same space. The DEADLINE column is sliced in half at the screen edge ("25 5 202"), STATUS and PRIORITY are entirely off-screen, and on the Users page only NAME and EMAIL are visible while ROLE, ACCESS, STATUS, Edit and Deactivate are unreachable. After uploading a drawing from site, the engineer could see only the file's name — Download, History and New revision sat about 700px off the right edge. There is no arrow, shadow or "swipe for more" cue anywhere, and because every other page fits 390px perfectly, the panel simply looks broken rather than scrollable.

Evidence: screenshots/admin-en/p02-phone-project.png, screenshots/admin-en/029-phone-blind-phone3-33-phone-users.png, screenshots/pm-en/111-phone-phone-core-project-tasks.png, screenshots/engineer-en/064-phone-phone-core-07b-after-upload-full.png.

Confirmed by an independent re-test: **yes** for the project task table (screenshots/admin-en/023-phone-repro-tie-adm-04-31-tasks-table-decisive.png). The Users and Documents tables were not separately re-screenshotted, but they use the same pattern [Likely].

Fix brief. Below the desktop breakpoint, turn these three tables into stacked cards: one card per row with the title on top and deadline, status and priority underneath as labelled lines, with the row actions as full-width buttons. That is one shared component reused in three places. If stacked cards are too big a change for now, the minimum acceptable stop-gap is to drop the low-value columns on narrow screens and keep deadline and status visible, plus a visible edge fade so people know the table moves. This is the one thing that makes the phone version look unfinished, and it hits exactly the question people open a phone to answer.

---

**The project Brief quotes the wrong number when it explains a locked phase** (project manager, desktop and phone, English, [Certain])

What happened. The project manager opened SUR-EXP and read the Brief tab's "Locked phases" block, then read the panel directly below it.

Expected. Every line saying "waiting on FEED" quotes the same FEED figure, so the manager can state one number in a meeting.

Seen. Each line quotes the *locked* phase's own count of open tasks while the sentence attributes that number to FEED: "Detail design — waiting on FEED, which still has 2 main tasks open", "Procurement — waiting on FEED, which still has 1 main task open", "Construction — waiting on FEED, which still has 0 main tasks open". The panel immediately beneath correctly says: "The 'FEED' phase — 9 main tasks still open." The Construction line is the dangerous one: it reads as though the gate should already have opened.

Evidence: screenshots/pm-en/113-phone-phone-core-project-brief.png.

Confirmed by an independent re-test: **yes** (screenshots/pm-en/007-desktop-repro-pm-en-02-11-desktop-brief-locked-phases.png).

Fix brief. The sentence is pulling the open-task count from the phase being described instead of from the phase it is waiting on. Point it at the blocking phase's count so every "waiting on FEED" line reads the same number as the FEED panel below, and add a quick check that these two parts of the page can never print different figures for the same phase. Small change, and it removes the chance of a manager announcing that a gate is clear when it is not.

---

**One long comment with no spaces stretches the whole page about 44,000 pixels sideways** (project manager, admin and engineer; desktop and phone; English; [Certain])

What happened. A tester pasted a long unbroken string into a task comment — the sort of thing that happens naturally when someone pastes a file path, a long web link or a list of tag numbers — and pressed Post.

Expected. The text wraps inside its comment card, or the app caps comment length with a visible counter. The page stays as wide as the screen.

Seen. The comment posts and is drawn on one endless line. The page grows to roughly 44,000–45,600 pixels wide against a 1,440px desktop window and a 390px phone window. The header, sidebar, status bar and every other comment are dragged along with it, and the page gains a giant sideways scrollbar. It survives a reload, so the task page is ruined for everyone who opens it afterwards, not just the person who posted. There is no length limit and no character counter anywhere.

Evidence: screenshots/admin-en/x01-desktop-overflow-long-comment-1440.png, screenshots/pm-en/075-desktop-edge-misc-fail-page-does-not-overflow-horizontally-after-a-long-commen.png.

Confirmed by an independent re-test: **yes** — reproduced on both desktop and phone (screenshots/pm-en/020-phone-repro-pm-en-03-21-phone-comment-row.png).

Fix brief. Make comment text break inside its own card so a long unbroken run of characters wraps to the next line instead of pushing the page wider, and apply the same treatment to document titles and task titles, which take free text from users too. Add a sensible maximum comment length with a visible counter as a second line of defence. Then add a check that no page is ever wider than the screen, so this class of problem is caught before it ships.

---

**The "Awaiting review" sidebar link shows every task, including completed ones** (engineer, desktop, English, [Certain])

What happened. The engineer opened My tasks and clicked "Awaiting review" in the left sidebar, waited for the page to settle, then pressed refresh on the same address.

Expected. Clicking the link shows only work awaiting review — for this engineer, none — with a "Status: Awaiting review" chip, exactly as a refresh does.

Seen. The address changes and the sidebar item highlights, but all 8 tasks stay on screen, including three marked Completed, and no filter chip appears. It is not a flicker; the page stays that way. A refresh of the identical address correctly shows zero tasks and the chip. The date shortcuts (Overdue, Due today, This week) do re-filter properly when clicked — only the status shortcuts are ignored.

Evidence: screenshots/engineer-en/109-desktop-flicker-02-awaiting-settled.png.

Confirmed by an independent re-test: **yes** (screenshots/engineer-en/013-desktop-repro-eng-f2-02-after-click-awaiting-review-settled.png). Note the blind tester saw a milder version of this and rated it P3, believing it was a brief flash; the full test showed it settles and stays wrong, which is why it is P1 here.

Fix brief. When someone clicks a status shortcut inside the app, the task list needs to re-read the status setting from the address the same way it already re-reads the date settings — today only the date ones are picked up on an in-app click, while a full page load handles both correctly. Until it is fixed, an engineer can see finished work sitting under "Awaiting review" and reasonably conclude their sign-offs were bounced back.

---

**Dependencies can be seen and enforced, but nobody can create one** (admin, desktop and phone, English, [Certain] that no control exists; a product gap rather than a broken feature)

What happened. The admin created a main task with two discipline tasks and then looked everywhere for a way to say "this task waits on that one" — the task page, the "Depends on" card, the Add discipline task dialog, the Edit details dialog and the project Timeline.

Expected. An admin or project manager can add and remove a dependency between discipline tasks from the screen, the same way the demo data already has them.

Seen. The "Depends on" card is read-only and says "Nothing else has to finish before this task." There is no add control anywhere in the product. The seeded demo project does have dependencies and the completion gate genuinely enforces them ("Waiting on 1 earlier task: Process line walkdown") — but they can only be put there by the setup script. The project manager independently reached the same dead end and had to test the required-document gate instead.

Evidence: screenshots/admin-en/051-desktop-comment-dep-discipline-task.png.

Confirmed by an independent re-test: **not re-tested** — reported at P1 by the admin tester and independently hit by the project manager, but it did not go through the formal re-test step, so treat the severity as the tester's judgement.

Fix brief. Add an "Add dependency" control to the "Depends on" card on the discipline task page: pick another discipline task on the same project, save, and show it in the list with a remove option. The rule that stops a task completing early already works and the demo data proves the underlying storage works — what is missing is the button. Sequencing disciplines is one of the three reasons a firm buys this product, so this should be near the front of the queue.

### P2

**A plain .txt file is accepted as a mandatory required document** (project manager and engineer, desktop, English, [Certain]) — The upload box states "PDF, Office, images, CSV, DWG or ZIP — up to 25 MB", but a 21-byte junk text file uploaded silently as "Rev 0", flipped the checklist to "1 of 1 complete" and opened the completion gate. Evidence: screenshots/pm-en/071-desktop-edge-upload-after-bad-txt-upload.png. Confirmed by an independent re-test: no (seen once, but reported independently by two testers). Fix brief. Either enforce the list the box promises and refuse anything else with a plain-English message, or reword the hint to say all file types are accepted. As it stands the green tick against a mandatory document means nothing, which quietly undermines the document register the product is sold on.

**Anyone who knows your email address can lock you out** (project manager, desktop, English, [Certain]) — Twelve wrong passwords from one browser locked the account itself, not the attacking device: the correct password submitted from a completely different browser and address was still refused, while a different account from that same address signed in fine. With password reset by email switched off, a locked-out person has no self-service way back in. Confirmed by an independent re-test: no (seen once). Fix brief. Count failed attempts against the device and network address doing the guessing, not against the email being guessed, so the real owner can still sign in from their own phone. Keep a much higher, slower account-level limit as a backstop, and turn on the password reset email before launch.

**"Blocked" has no reason field** (project manager, desktop and phone, English, [Certain]) — Marking a discipline task Blocked records only the word "Blocked". The Brief tab honestly reports "Marked blocked, with nothing named", and the real reason (a vendor had not released certificates) lived only in a comment. Evidence: screenshots/pm-en/059-desktop-core-gate-blocked-discipline-task.png. Confirmed by an independent re-test: no (seen once). Fix brief. When someone sets a task to Blocked, ask for a short reason and optionally which task or person it is waiting on, then show that reason on the task header and in the Brief. This is the difference between a status and a piece of information a manager can act on.

**Every discipline reads "No lead assigned"** (project manager, desktop, English, [Guessing] whether this is a gap or just demo data) — All eight disciplines on the demo project show "No lead assigned" even though people hold the "Discipline lead" title in the user list. Evidence: screenshots/pm-en/031-desktop-blind-desktop2-d13-project-team.png. Confirmed by an independent re-test: no (seen once). Testers disagreed on whether this is a fault — see "Where testers disagreed". Fix brief. Confirm whether the per-project lead picker exists on the Team tab; if it does, this is a demo-data problem and the seed should name a lead per discipline before any client sees it. If it does not, add it — "who do I chase for Electrical" is the first question a manager asks.

**A task 19 days past its deadline is filed under "TODAY" and answers the "Due today" filter** (engineer, desktop and phone, English, [Certain]) — "Mechanical design review comments closed", status Completed, deadline 20 August 2026, appears under a heading reading TODAY on 8 September and is returned by the Due today filter. Evidence: screenshots/engineer-en/007-desktop-core-counters-filter-due-today.png. Confirmed by an independent re-test: no (seen once). Fix brief. The grouping is not comparing the deadline against today's date correctly — most likely a time-zone or "start of day" mistake. Fix the comparison, exclude completed work from date-based groupings, and add a check that nothing dated in the past can appear under TODAY.

**Buttons on another discipline's task always end in "You do not have permission"** (engineer, desktop, English, [Certain]) — Opening a Civil task as the Mechanical engineer shows live Upload and New revision buttons on the required documents. The dialog even promises "This upload ticks off 'Soil investigation summary' on the checklist". Only after choosing a file and pressing Upload is the attempt refused. The good news: the server holds the line and nothing was written. Evidence: screenshots/engineer-en/029-desktop-edge1-02-gate-complete-attempt.png. Confirmed by an independent re-test: no (seen once). Fix brief. Hide the Upload and New revision buttons on tasks that belong to another discipline or another person, so the required-documents list is plainly read-only. The protection is already right where it matters; the screen just needs to stop offering something it will refuse.

**No way to take back a document uploaded to the wrong task** (engineer, desktop and phone, English, [Certain]) — The only row actions are Download, History and New revision. There is no remove or withdraw anywhere, so the best a person can do is upload a corrected revision on top of a document that should not exist. Confirmed by an independent re-test: no (seen once). Fix brief. Add a "Withdraw" action for the person who uploaded a document and for admins, which hides it from the register but keeps the revision in the audit trail, with a note saying who withdrew it and when. That keeps the promise of an unalterable record while giving people a way out of an honest mistake.

**A task created by mistake can never be removed** (admin, desktop and phone, English, [Certain]) — There is no delete, cancel or archive for tasks anywhere. Two duplicate test tasks are now permanent rows on the demo project and are counted in the dashboard totals. Documents, by contrast, do have a delete with a confirmation. Confirmed by an independent re-test: no (seen once). Fix brief. Give admins and project managers a "Cancel task" action that takes the task out of the counts and lists while keeping it visible in the audit trail — a full delete is not needed. Without it, people become nervous about creating anything, and every mistyped task inflates the reporting numbers forever.

**No cross-project "what's blocked and who's blocking" view** (project manager, desktop and phone, English, [Guessing]) — The blind project manager could not find a single view answering "what is late and what is blocked across everything", and had to open the project, then a main task, then read the discipline rows. The same tester later found that the project Brief tab does exactly this *within one project* and praised it. Confirmed by an independent re-test: no (seen once, and disputed by the same tester's later run). Fix brief. The Brief tab is the right answer and already good — the gap is that it is per project. Offer the same summary across all of a manager's projects from the top-level navigation.

### P3

**Who overrode a task and why is only in a hover tooltip** (admin, desktop and phone, English, [Certain]) — The task header shows "Completed *" and an "Overridden" chip; the reason and the person's name live only in the tooltip, so on a phone they cannot be seen at all. The Activity tab does record it in full. Confirmed by an independent re-test: no (seen once). Fix brief. Print the override reason and the person's name as a line on the task itself, not only in a tooltip. Accountability is the thing the product is sold on.

**A React page error on three different pages** (admin, project manager and engineer; desktop; English; [Certain]) — A "minified React error #418" (the server and the browser drawing different text) appears on the admin Data & privacy page whenever an export exists, occasionally on the project page, and on a discipline task page. Nothing visibly breaks. Confirmed by an independent re-test: no (seen once each, but reported by all three testers). Fix brief. Almost certainly dates and times being formatted differently on the server and in the browser. Format them the same way in both places. It is invisible today but is the class of problem that later makes a badge or a date flip after the page loads.

**"Create main task" greys out with no reason when no discipline is ticked** (admin, desktop and phone, English, [Certain]) — The button is disabled with no message at all until a discipline is ticked, at which point a helpful line finally appears. Evidence: screenshots/admin-en/008-desktop-blind-desktop-02-dashboard-desktop.png (the dialog is reached from this screen). Confirmed by an independent re-test: no (seen once). Fix brief. Show the missing-field message from the start, the way the dialog already does for assignees.

**A contractor whose access has expired is told "Incorrect email or password"** (admin, desktop and phone, English, [Certain]) — The admin's Users page correctly shows "Expired / Extend", but the contractor is told their password is wrong. With reset emails switched off, they will phone the manager. Confirmed by an independent re-test: no (seen once). Fix brief. Say what actually happened: "Your access to this workspace ended on 7 September 2026 — ask your project manager to extend it."

**Several controls are smaller than a comfortable finger on the phone** (admin, phone, English, [Certain]) — Notification bell 34px, avatar 36px, favourite star 32px, "Collapse all" 16px tall, footer links 17px tall, against a 44px comfortable minimum. Everything else is generous. Confirmed by an independent re-test: no (seen once). Fix brief. Pad these small controls out to a 44px tap area without changing how they look.

**Search does not ignore accents** (project manager and engineer, desktop, English, [Certain]) — "Riyámi" finds nobody while "Riyami" finds her; "Réview" finds nothing while "Review" finds six. Confirmed by an independent re-test: no (seen once, reported by two testers). Fix brief. Strip accents from both the search words and the stored text before matching. This is a global product; Müller, José and Ünal will all be typed both ways.

**"Mark complete" looks available inside a locked phase** (project manager and engineer, desktop and phone, English, [Certain]) — Nothing on the page hints at the gate; the button is fully enabled and only after clicking does an excellent red message appear naming the phase, the blocker and who can override. Confirmed by an independent re-test: no (seen once, reported by two testers). Fix brief. Show the lock before the click, the way the missing-document rule already does — grey the button and put the same sentence beside it.

**The activity trail names the raw file, not the title you typed** (engineer, desktop, English, [Certain]) — Uploading a file called villa.jpg with the title "UT-engineer-en Alignment Drawing" produces "John Carter uploaded villa.jpg — Rev 0" in Recent activity, while the document list shows the proper title. Confirmed by an independent re-test: no (seen once). Fix brief. Use the document title in the activity line, with the file name after it if useful.

**Phone Timeline is a dead end** (engineer, phone, English, [Certain]) — The Weeks / Months / Today controls render, then a single sentence: "The schedule view works best on a larger screen." No task data and no link back to the list. Evidence: screenshots/pm-en/112-phone-phone-core-project-timeline-fallback.png. Confirmed by an independent re-test: no (seen once). Fix brief. The fallback message is honest and the decision is defensible, but it should offer something: a simple date-ordered list of the same tasks and a clear "Back to list" button.

## Owner setup needed before launch (not code bugs)

- **Payments are switched off.** The public pricing page sells a Pro plan at $249/month, but inside the app Billing says "Upgrading isn't turned on for this Tielora yet". The owner needs a Paddle account and the payment keys set on the server. Until then, either the price should say "contact us" or the plan should not be advertised. Where it shows today: screenshots/admin-en/016-desktop-blind-desktop-10-billing.png.
- **Email is switched off.** Invitations, password resets and verification links are all dormant because the email service and the site address are not configured. Today "Forgot password?" says "Password resets by email aren't available right now. Please contact your workspace administrator." That means a locked-out person's only way back in is another admin — which combines badly with the account lockout problem above.
- **The Microsoft 365, Slack and Teams integration cards are unconfigured.** They need real external addresses to be set up, and none of them could be exercised in testing.
- **The demo project needs reseeding before any client sees it.** SUR-EXP is now cluttered with testers' own tasks and two files literally named "bad", which makes the discipline percentages and "My tasks" meaningless as a sales demo. Naming a lead for each of the eight disciplines in the seed would fix the "No lead assigned" impression at the same time.

## Things that looked wrong but are not bugs

- Billing, invitation emails, password resets and the Microsoft 365 / Slack / Teams cards being inert are dormant switches, not faults — they are waiting on the owner.
- The Gantt chart showing a plain sentence below 640px is deliberate and honestly worded ("The schedule view works best on a larger screen. Use a tablet or desktop for the full timeline."). It is a fair call for a desktop-first product; the only complaint is that it offers nothing else (logged as P3).
- The refusal when the engineer tried to upload onto another discipline's task is the security working, not breaking — the server returned a clean refusal and nothing was written. The same is true of a brand-new company getting "not found" on every Meridian address and an empty search: isolation between companies is genuinely airtight.
- A task showing "Completed *" with an "Overridden" badge is the override feature doing its job, not a wrong status.
- The test harness blocks all external internet addresses, so the integrations genuinely could not be reached — that is the sandbox, not the app.
- Date entry boxes appearing in US month/day/year order while every date the app *displays* is the unambiguous "30 Nov 2026" is a design question for a global audience, not a fault.

## What worked well

- **The headline promise holds.** Upload the required document, "Mark complete" unlocks itself, the discipline task completes and the main task moves itself to "In progress · 1 of 2 disciplines complete · 50%" — with nobody typing a status anywhere. All three testers verified this independently.
- **Every gate refuses in plain English.** "You can't mark this complete yet: 1 required document is still missing: UT-admin-1 Mechanical datasheet." And the best message any of the testers had seen: "This task is in the Detail design phase, which is locked until FEED is complete. An administrator or project manager can override the gate." It names the rule, the blocker and who can lift it.
- **Company isolation is airtight.** A brand-new workspace gets "not found" on Meridian's projects and tasks, empty search results, and only its own people from the internal data feeds. Role isolation is just as clean: the project manager gets a polite "This page is for administrators" on every admin page.
- **Everything typed comes back exactly right.** Title, priority, both dates, phase, owner, per-discipline assignees and deadlines, document revisions with their notes, sizes and authors — every value checked matched.
- **Document revisions are a real audit trail.** "Every revision, newest first. Revisions are kept for good", with each file, note, size and author recorded.
- **Two-factor sign-in is complete and honest.** A QR code plus a typed key, eight recovery codes shown once with "we can't show them to you again", sign-in with a code, a fresh code required to switch it back off, and a reused code correctly rejected.
- **Forms and slow networks are handled well.** "Deadline can't be before the start date" appears inline as you type, a genuine fast double-click creates exactly one task, refreshing mid-form creates nothing, and on a throttled 3G connection the button becomes "Creating…" for ten seconds and then lands correctly.
- **It is fast and clean.** Roughly 150 page loads across three testers and two devices produced essentially no console errors and no failed requests, with pages painting in under two seconds even on simulated 3G.

## What we could not test, and why

- **Overriding a live phase gate on the demo project** — it would permanently change the shared SUR-EXP gates other testers were using. The equivalent override on a tester's own task was tested and worked.
- **Email journeys** — invitations, password resets and verification links are switched off by design (owner setup, not a fault).
- **Buying the Pro plan** — billing is dormant, and no test ever touches real payment rails.
- **Slack, Microsoft Teams and Microsoft 365 integrations** — they need real external addresses, and the test harness blocks everything outside the local machine.
- **On-screen keyboard overlap on a real phone** — the automated browser does not raise a software keyboard. Fields and the submit button do sit inside the screen, but a check on a real handset is still needed.
- **Creating and completing a task blocked by a dependency** — there is no way in the product to create one (see the P1 finding). The required-document and phase gates were tested instead.
- **External collaborator expiry from the project manager's side** — no collaborator invite or expiry control is visible to that role, and admin pages are closed to them. The admin tester covered it instead.
- **The "Awaiting review" sign-off queue end to end** — it is filled by external collaborator sign-offs; an internal engineer's completions go straight to Completed, so the queue was empty by design.
- **Which tasks the dashboard's "Blocked 1" and "Overdue 1" actually refer to** — every list reachable from those tiles returns nothing, so the underlying tasks could never be opened.
- **A deliberate account lockout against the shared demo admin** — it would have blocked the other testers, so the same test was run against a fresh private account instead, with identical results.

## Phone verdict

Tielora is a desktop-first product and says so — the Gantt chart deliberately steps aside below 640px with an honest message, and that is a fair decision for software an engineering team runs from an office. Graded as a real user would, though, the phone version is much closer to good than the "desktop-first" label suggests, and it is let down by one repeated mistake rather than by its design. The good news is substantial: all three testers completed real work at 390px — signing in, opening a project, creating and assigning a task, uploading a drawing from site, commenting, changing status and marking complete — with a proper drawer menu, forms that fit, a comment box the keyboard does not bury, and no page anywhere scrolling sideways by itself. The bad news is that the three tables people actually open on a phone — the project task list, the admin user list, and a task's documents — are the untouched desktop tables stuffed into a silent scroll box. Deadline is sliced in half at the screen edge, status and priority are off-screen entirely, and the Download and New revision buttons sit hundreds of pixels past the right edge with no arrow or shadow to say the row moves. So a manager standing on site can see task names and nothing that tells them whether the job is late, and an engineer who has just uploaded a drawing cannot check it or send it on. Add the same wrong dashboard numbers as on the desktop, and the phone experience today is: the work works, the answers do not. Turning those three tables into stacked cards would move the phone from "usable in an emergency" to genuinely good.

## Where testers disagreed

- **"No lead assigned" on every discipline.** The blind admin tester filed it as *not a bug* — probably just demo data, since the Team tab appears to have a per-project lead picker. The project manager filed it as a P2 gap after finding no such control on the tab at all. Both views are recorded; someone should open the Team tab and settle it.
- **Whether a project manager has a "what's blocked" view.** The blind project manager said no such view exists and rated it a P2 gap. The same tester, on the full run, found the project Brief tab does precisely that and listed it under what worked well. The honest reading is that the view exists but only within one project, and it is not discoverable from the home screen.
- **Whether duplicate tasks can be created.** The admin tester forced three clicks on the already-disabled Create button using automation and did produce duplicates, concluding the server has no protection of its own. The project manager's genuine fast double-click produced exactly one task. Both agree the on-screen protection saves a real person; they disagree on whether the server should also be protected.
- **How bad the "Awaiting review" filter problem is.** The blind engineer saw it as a brief flash and rated it P3. The full run showed the page settles and stays wrong, and rated it P1. The re-test supports P1.

## Numbers

P0 0 · P1 7 · P2 9 · P3 9 · owner-setup 4 · scenarios run 34 (passed 25, failed 9, blocked 0) · screenshots 40 in docs/user-testing/screenshots/. Build tested: e007f8f.

---

## Who this user really is

**Who he really is.** The person who decides on Tielora is a general manager or project manager at a 20–200 person engineering or contracting firm, personally on the hook for a schedule he tracks today in Excel and email — the research calls him Rashid, hired to "stop discovering a missed discipline deliverable in a client meeting" (research §1, Persona A) [Guessing]. Under him sits the discipline engineer — Fatima in the research — who owns Mechanical or Electrical or HSE deliverables, wants one clear "Mark Complete" button that explains itself (research §1, Persona B, citing the shipped design) [Certain], and above all does not want to "feel like data entry exists purely for the PM's benefit" (research §1, Persona B) [Guessing]. The third persona in the research, the external contractor, is almost entirely guesswork — the research itself says "this persona has almost no independently-sourced evidence anywhere in this corpus" [Certain that the research says so] — and he was never put in front of a tester, so treat him as a hypothesis, not a user. He is not buying a to-do list [Likely]; he is buying a number he can read out loud on Sunday morning and a document register his client's QA team would accept. *Note on citations: report.md prints no numbered finding ids, so every reference below quotes the finding's printed headline exactly; research references are section number plus a short quote, with the confidence tag added here because that document carries its confidence in a separate source table.*

**What he came for.** One place where a main task's discipline breakdown is real, where a document has a version history he can stand behind, and where nobody has to be chased for a status: research §5 must-have 1, "Replace the Excel/email tracking loop with one system of record" [Guessing on the pain, Certain on the product's framing], and must-have 3, "Audit trail / version history one click from any document, versions never deletable" [Certain]. He also came for the one thing no competitor offers — letting another company work inside one project with no extra seat, "confirmed against 8 researched tools" (research §2) [Certain]. And he came for a number: the research assumed the six dashboard tiles were exactly the at-a-glance read he needs ("The dashboard's KPI tiles — Total / In progress / Completed / Blocked / Overdue / Due soon — are built to deliver exactly this at-a-glance read", research §1) [Certain that the tiles exist, Guessing that they land].

**What testing actually showed.** The product he came for genuinely works. All three blind testers understood Tielora in 8–12 seconds, all three said they would keep going, and all three watched the headline promise hold — upload the required document, the gate opens itself, and the parent task moves to "In progress · 1 of 2 disciplines complete · 50%" with nobody typing a status ("The headline promise holds", under What worked well) [Certain]. Then the very first screen inside the app contradicted itself for every one of them: "six tasks and no tasks in the same breath, and that's the number I was going to trust" (Admin/GM blind quote) [Certain]. Where research and testing agree: the phone matters — "Why do I need my laptop just to see if something's overdue while I'm at a site meeting?" (research §6, request 2) [Guessing] — and the phone is exactly where the deadline column gets sliced in half ("On the phone, the important table columns are hidden behind a sideways scroll nobody signals", P1, confirmed by re-test) [Certain]; and the contractor's fear of silent lockout (research §6, request 4) [Guessing] shows up for real as an expired contractor being told "Incorrect email or password" (P3) [Certain]. Where testing contradicts the research: the two biggest predicted anxieties never appeared — "How do I know my upload actually went through?" (research §6, request 3) [Guessing] turned out to be a delight rather than a worry, with the engineer getting a revision number and an audit line on his phone; and notification fatigue (research §6, request 12) [Guessing/Likely] never surfaced, because nothing is emailed at all by design [Certain], so the real risk is the opposite — that nothing ever reaches you outside the app. The research also treated missing dependency arrows as a deliberate Gantt scope decision (research §7, claim [57]) [Certain]; testing found something bigger, that nobody can create a dependency at all ("Dependencies can be seen and enforced, but nobody can create one", P1) [Certain]. And the single biggest real problem — reporting numbers that cannot be trusted — was not predicted anywhere in the research [Certain]. Two research items stayed untested and remain open questions: whether firms really want an Excel import, and whether invite-only signup versus "self-serve" marketing costs sales (research §7, "The 'self-serve' positioning claim… does not match the production reality of invite-only signup") [Certain]. Testers also could not exercise the awaiting-review sign-off queue end to end, dependency completion, or any email journey [Certain].

## What they will want

The research's Kano wishlist (research §5), condensed, with what testing did to each line. "Already built?" is judged against what testers actually saw, which is stricter than the research's own read.

| Item | Kano band | Already built? | Evidence strength |
|---|---|---|---|
| One system of record replacing the Excel/email tracking loop | Must-have | **Yes** — and **confirmed in testing**: all three testers ran the full chain and the parent status moved itself | Pain [Guessing] (never independently verified — the research's own biggest gap); product does it [Certain] |
| Exactly one clearly-surfaced accountable owner per discipline task | Must-have | **Partly** — **contradicted in testing**: "Every discipline reads 'No lead assigned'" (P2, testers disagreed on whether it is a gap or demo data) | [Guessing] |
| Audit trail / version history one click from any document, versions never deletable | Must-have | **Yes** — **confirmed in testing**: "Document revisions are a real audit trail" (What worked well) | [Certain] |
| Immediate, explicit confirmation after any upload or stage-gate action | Must-have | **Yes** — **confirmed in testing, and a delight**: the engineer got a revision number and an audit line after uploading from his phone | Research said "check" [Guessing]; testing settles it [Certain] |
| Visible "access expires in N days" + self-service extension for external collaborators | Must-have | **No** — **contradicted in testing**: an expired contractor is told "Incorrect email or password" (P3); the admin side does show "Expired / Extend" | [Guessing] — this whole persona is unsourced |
| A documented Excel / prior-system import path for onboarding | Must-have | **No** — **never tested**; no tester attempted it | [Guessing] — worth one buyer conversation before any build |
| A daily brief / my-tasks view separating "blocking others" from ordinary open work | Expected | **Partly** — the per-project Brief tab was praised by two testers, but it disagrees with the tiles and quotes the wrong locked-phase number (both P1) | [Guessing] on the need, [Certain] on the defects |
| Notification filtering: "affects me" vs "FYI" | Expected | **Unknown** — **not observed**; no tester complained of noise, because nothing is emailed at all | [Likely] for monday.com, [Guessing] as a general principle |
| A lightweight phone view of the brief and blockers | Expected | **Partly** — **contradicted in testing**: the phone can do the work but not show the answers; three tables clip deadline and status (P1) | [Guessing]; testing makes it [Certain] |
| 2FA and role-based access | Expected | **Yes** — **confirmed in testing**: "Two-factor sign-in is complete and honest"; role isolation clean | [Certain] |
| HSE configurable as a hard blocking gate | Expected | **Unknown** — **not observed**; phase gates work, but no HSE-specific veto was exercised | [Guessing] |
| Industry template auto-populates a main task's full discipline breakdown | Delighter | **Yes** — partly confirmed: testers created main tasks with discipline tasks, and the phase-gate explanations were repeatedly praised | [Guessing] on the "aha", [Certain] the templates ship |
| Exportable, timestamped audit trail a contractor's legal/QA team would accept | Delighter | **Unknown** — **not observed**; the trail exists on screen, the export was never tested | [Guessing] |
| Offline queuing for document/photo upload in the field | Delighter | **No** — confirmed gap versus Fieldwire/PlanRadar; not testable in the sandbox | [Likely] |
| Per-person Microsoft 365 / SharePoint sign-in (not one shared org connection) | Delighter | **No** — deliberate v1 scope, not an oversight; the integration cards could not be reached in testing | [Certain] |

## What they will ask to change

The research's 14 predicted change requests (research §6), reconciled with what the testers actually hit. report.md prints no finding ids, so the middle column quotes each finding's printed headline and severity.

| Request | Seen in testing? | Suggested response |
|---|---|---|
| 1. "Why can't I just import my Excel tracker instead of retyping the whole project?" | Not observed — no tester attempted an import | Real gap, but unverified demand [Guessing]. Have one buyer conversation before building; meanwhile lean on the industry template and set the first project up with the client. |
| 2. "Why do I need my laptop just to see if something's overdue at a site meeting?" | **Yes** — P1 "On the phone, the important table columns are hidden behind a sideways scroll nobody signals" (confirmed by re-test) | Confirmed and specced: turn the three tables into stacked cards (top-3 change #2). |
| 3. "How do I know my upload actually went through?" | **Contradicted** — testers praised the revision number and audit line; listed under What worked well | No work needed. Keep the confirmation exactly as it is; it is a selling point [Certain]. |
| 4. "How many days do I have left before I lose access?" | **Partly** — P3 "A contractor whose access has expired is told 'Incorrect email or password'" | Fix the message first (cheap, P3). The countdown badge is unsourced [Guessing] — hold it until a real contractor asks. |
| 5. "Why don't I get an email or text when something's overdue?" | Not observed — no email journey could be tested (owner setup) | Answer that it is deliberate [Certain], and offer the per-company webhook / daily digest as the middle ground. |
| 6. "Why is Microsoft 365 connected once for the whole company, not for me?" | Not observed — integrations blocked by the sandbox | Confirm it is intentional v1 scope [Certain]; per-person sign-in stays a scoped future item. |
| 7. "Can I get the audit trail as a report for my QA team or the client?" | Not observed — the on-screen trail was praised, the export never tested | Check whether an export exists; if not, it directly answers a named trust gap and is worth scoping. |
| 8. "Why can't my project manager add a user without going through Admin?" | Not observed — testers confirmed the boundary holds ("This page is for administrators") | Intentional role boundary [Certain]. Revisit only if it becomes a real onboarding bottleneck. |
| 9. "Why is there no offline mode for uploading site photos?" | Not observed — not testable in the sandbox; confirmed absent in the code | Acknowledge as a known, accepted gap. Weigh it honestly with offshore-heavy buyers [Likely]. |
| 10. "Why isn't there a Gantt chart with dependency arrows?" | **Bigger than predicted** — P1 "Dependencies can be seen and enforced, but nobody can create one" | The arrows were a deliberate scope call; the missing *create* control was not. Build the control (top-3 change #3). |
| 11. "The site says self-serve, so why did I need an invite code?" | **Partly** — the admin tester flagged "a public price of $249/month that the app says it cannot sell" | Owner setup, not code: either open signup or change the wording to "request access" until it flips [Certain]. |
| 12. "Why do I keep getting notified about things that don't need my attention?" | **Contradicted** — nobody complained; nothing is emailed at all | Do not build filtering yet. The live risk is silence, not noise. |
| 13. "Is there a lead sign-off step before a discipline task closes, or not?" | **Partly** — the sign-off queue could not be tested end to end, and P1 "The 'Awaiting review' sidebar link shows every task, including completed ones" made it look broken | Two jobs: clean up the contradictory internal docs [Certain], and fix the filter (folded into top-3 change #1). |
| 14. "Can HSE actually block everything else from closing?" | Not observed | Check whether the stage-gate model already supports a mandatory blocking discipline; if not it is a credible, high-trust feature [Guessing on demand]. |

## What a prospect will object to in a demo

Merged from both review lenses and de-duplicated. "Honest answer" is what the owner can truthfully say **today**, on the build tested (`e007f8f`).

| Objection | Severity | The honest answer the owner can give today |
|---|---|---|
| "Your own front page says I have six tasks and one overdue, then the list right underneath says I have nothing at all. Why would I trust any number in here?" | **Deal-breaker** | You're right, and it's the number-one item on our fix list. The six tiles count the whole company; the panel underneath counts only your own work — and today the tiles link to the personal list instead of the company one. The underlying task data is correct: every value we typed came back exactly right in testing. It's the reporting layer on top that reads from two different sources, and we're making both read from one. Let me show you the same numbers inside a project, where they hold up. |
| "The same project tells me one thing is late on the header and three on the Brief tab. I can't present that to a client." | **Deal-breaker** | Correct, and the reason is that different screens count different things: the header counts only main tasks, the Brief counts discipline tasks, and nothing on the label says so. We're picking one definition — anything past its deadline and not complete — and using it everywhere, with the label saying which is which. Until then, the Brief tab's number is the fuller one. |
| "Can I sequence work — this task waits on that one — like a real schedule?" | **Deal-breaker** | Half of it works today, and it's the real half: the rule is enforced, a task genuinely refuses to close while an earlier one is open, and it names the blocker. You can see it on the demo project. What's missing is the button to create the link yourself — today dependencies are set up when we load your project for you. It's near the front of the build queue precisely because it's a buying reason. |
| "My engineers are on site with bad signal. Does it work offline?" | **Deal-breaker** | No. There's no offline queue — uploads need a connection. What does work is the phone browser: our testers signed in, opened a project, uploaded a drawing from site, commented and marked work complete at phone size. If your work is mostly offshore or in dead zones, that's a genuine gap you should weigh against us. |
| "On my phone I can see the task names but not whether anything is late." | Friction | Correct today. Three tables — the project task list, the user list and a task's documents — are still the desktop tables inside a sideways scroll, so deadline and status run off the edge. Every other phone screen fits properly, and the task page itself reads well on a phone. We're turning those three into stacked cards. The Gantt chart is deliberately desktop-only and says so on screen. |
| "Your pricing page says $249 a month — can I put my card in now? And why did I need an invite code?" | Friction | Both are true and neither is a fault in the software. Card payments aren't connected in this deployment, so we set your company up directly and invoice you; the $249 is the real settled price, flat, with nothing held back behind a higher plan. Signup is invite-only until we open it, which is why you got a code — and if that bothers you in writing, we'll say "request access" rather than "self-serve" until it flips. |
| "What happens when someone forgets their password or gets locked out on a Sunday?" | Friction | Right now an administrator resets it inside the app — reset-by-email is switched off until we connect the email service, and the app says so in plain English rather than pretending. There's also a real bug we found ourselves: repeated wrong guesses lock the account rather than the device doing the guessing, so we're changing that to count against the guesser before launch. Two-factor sign-in, by contrast, is complete and tested end to end, including one-time recovery codes. |
| "Someone will upload a file to the wrong task or create a duplicate. How do we clean that up?" | Friction | Today you can't remove either — the best you can do is upload a corrected revision on top. That's the side effect of the promise that no revision or audit entry is ever altered or lost. We're adding "cancel task" and "withdraw document", which take the item out of lists and counts while keeping the trail intact. |
| "We've got three years of trackers in Excel. Am I retyping all of it?" | Friction | Today, yes — there's no Excel import and I won't pretend otherwise. What shortens it is that a new project's discipline breakdown comes from an industry template rather than being built by hand, and we set the first project up with you. It's a known gap, not a hidden one. |
| "Will it email or text my engineers when something's overdue?" | Minor | No, and that's deliberate rather than missing — nothing in this app emails or texts a task, comment or deadline. It all lands in the in-app notifications and the daily "Your day" brief, which is how we avoid the notification fatigue people complain about in monday.com and similar tools. If your team lives in Outlook, Slack or Teams, an administrator can paste a webhook per company and turn on a daily digest — but say so now, because it's a real difference. |

## Top-3 recommended changes

The report's verdict is "Not ready" on a mechanical rule — seven confirmed P1s, four of them on the main journey. These three builds clear **all seven**, which is the only thing that answers the owner's launch question. Nothing is left at P1 afterwards.

### 1. One set of numbers, one definition of "late"

**Why.** Every tester independently stopped trusting the product at the home screen, and this build takes four of the seven P1s at once: "The dashboard counters contradict the very lists they link to" (all three roles, [Certain], confirmed by re-test — the engineer's re-test returned *different* numbers from his first measurement, which proves the counts are unreliable rather than a one-off); "'Upcoming deadlines' is a list of dates that already passed, and the overdue counts never agree" ([Certain], confirmed); "The project Brief quotes the wrong number when it explains a locked phase" ([Certain], confirmed — the Construction line reads as though a gate should already have opened); and "The 'Awaiting review' sidebar link shows every task, including completed ones" ([Certain], confirmed). It also picks up the P2 date bug where a task 19 days past its deadline is filed under "TODAY", because that is the same read-time date comparison the overdue definition uses. The pieces are bundled rather than split because they are mechanically the same defect — the tiles link into My tasks with a status in the address, and in-app clicks on status shortcuts are ignored, so fixing the tiles alone would just make them open a list that still lies. On the research side this is exactly the promise the buyer came for: the tiles were assumed to deliver the at-a-glance read (research §1, Persona A) [Certain that they exist, Guessing that they land], and today they do the opposite.
**Effort:** **L** — genuinely large. If dev-lead needs a seam it splits cleanly in two: first the tiles, the Brief and the status-shortcut click; then the one shared "late" definition, the Late/Upcoming split, the year on every date and the locked-phase count. Two builders in parallel, one on the server-side counts and one on the screens.
**Spec:** `../../../Agents/docs/specs/tielora/dashboard-numbers-that-agree.md` — absolute: `/home/user/Agents/docs/specs/tielora/dashboard-numbers-that-agree.md`

### 2. On the phone the answers are on screen, and no pasted link can break a page

**Why.** This takes the two remaining P1s, and they are one surface and one regression check. "On the phone, the important table columns are hidden behind a sideways scroll nobody signals" (all three roles, phone, [Certain], confirmed by re-test for the project task table; the Users and Documents tables use the same pattern [Likely]) — 609px of task table squeezed into a 356px window, the deadline sliced in half at the edge, and after an upload the Download and New revision buttons sitting roughly 700px off-screen. And "One long comment with no spaces stretches the whole page about 44,000 pixels sideways" ([Certain], confirmed on both desktop and phone) — which survives a reload, so it ruins the task page for everyone who opens it afterwards. The report itself asks for "a check that no page is ever wider than the screen", and that single regression check covers both halves of this build. The research predicted the phone half twice (research §6 request 2 and §5 expected 3, "a lightweight mobile/phone view of the daily brief and blockers") [Guessing]; testing turns it into [Certain]. Two P3s ride along at negligible cost: the sub-44px tap targets (bell, avatar, favourite star, "Collapse all") are the same phone pass on the same components.
**Effort:** **M** — one shared stacked-card component reused in three places, plus a text-wrapping rule applied to comments, document titles and task titles.
**Spec:** `../../../Agents/docs/specs/tielora/phone-cards-and-safe-text.md` — absolute: `/home/user/Agents/docs/specs/tielora/phone-cards-and-safe-text.md`

### 3. Sequence the work yourself, and make every gate mean what it says

**Why.** The last uncovered P1 and the clearest sales asset in the report. "Dependencies can be seen and enforced, but nobody can create one" (admin, [Certain] that no control exists; not formally re-tested, so the severity is the tester's judgement) — the rule works, the demo data proves the storage works, and the report's own fix brief says "sequencing disciplines is one of the three reasons a firm buys this product". Both lenses costed it as a normal feature; `docs/CONVENTIONS.md` shows `addDependency` and `removeDependency` already exist as server actions with the index migration already approved, so the missing piece really is just the button — far cheaper than a normal feature. It also buys back a test scenario, since "creating and completing a task blocked by a dependency" is on the untested list purely because no control exists. Grafted in are the two things that make a gate honest: the P2 where "a plain .txt file is accepted as a mandatory required document" (a 21-byte junk file flipped the checklist to "1 of 1 complete" and opened the gate — a bug against the repo's own house rule 9, and it quietly voids the document register the product is sold on), and the P3/P2 pair where "'Mark complete' looks available inside a locked phase" and "buttons on another discipline's task always end in 'You do not have permission'" — both cases of the screen offering something the server will refuse, when the answer is already derived at read time. Research-side, this is Fatima's must-happen first moment: "exactly one dominant action — 'Mark Complete' — disabled with a plain-English reason" (research §1, Persona B) [Certain].
**Effort:** **M** — one screen control on the "Depends on" card, a file-type check on upload, and read-time gate checks the screens already have the data for.
**Spec:** `../../../Agents/docs/specs/tielora/dependencies-and-honest-gates.md` — absolute: `/home/user/Agents/docs/specs/tielora/dependencies-and-honest-gates.md`

**A constraint that shaped this ranking, and that both review lenses missed:** `docs/CONVENTIONS.md` says the schema is FROZEN after Milestone 1 and every amendment needs the main session's approval. That is why nothing needing a new database column — a Blocked reason, a Cancel-task state — is in the top three, however cheap it looks on the surface.

### The rest of the backlog

- Count failed sign-ins against the guesser, not the victim (P2 lockout — the strongest candidate for a fourth build; pair it with the owner switching on reset emails).
- Let an admin or PM cancel a task created by mistake (P2 — check first whether tasks already carry a soft-delete column, since the schema is frozen).
- Withdraw a document uploaded to the wrong task (P2 — `softDeleteDocument` already exists for admins and PMs; this is the uploader's version of it).
- Ask "why?" when someone marks a task Blocked (P2 — needs one main-session-approved nullable column, so not the cheap win both lenses assumed).
- One brief across all my projects (P2, disputed by the very tester who raised it — the per-project Brief tab is already praised; the gap is that it is not discoverable from the home screen).
- Settle "No lead assigned" on every discipline (P2, testers disagreed — open the project Team tab and decide whether it is a missing picker or just demo data).
- Print the override reason and the person's name on the task itself, not only in a hover tooltip (P3 — invisible on a phone today).
- Fix the React #418 hydration error on three pages (P3 — server and browser formatting dates differently).
- Make search ignore accents (P3 — "Riyámi" finds nobody, "Riyami" finds her).
- Give the phone Timeline something instead of a dead end (P3 — a date-ordered list and a "Back to list" button).
- Show the missing-field message on "Create main task" from the start (P3).
- Tell an expired contractor their access ended, instead of "Incorrect email or password" (P3).
- Use the document title rather than the raw file name in the activity trail (P3).
- Bring an Excel tracker in on day one (research-only [Guessing], never tested — worth one buyer conversation before any build).
- Owner setup, not code: Paddle keys or a "contact us" price, the email service, the Microsoft 365 / Slack / Teams addresses, and reseeding the SUR-EXP demo project with a named lead per discipline.

## Focus score

**72 / 100.**

Tielora is much further along than its "Not ready" verdict sounds: there are no P0s, nothing was lost or leaked, the thing a buyer actually pays for — discipline breakdown, gates that explain themselves, an unalterable document register and derived status with nobody typing one — works on both desktop and phone, and most of the research's must-have list is already shipped rather than planned. The three specced builds above close all seven confirmed P1s, which means the gap between here and sellable is a known, bounded month of work plus four owner setup steps, and the distance to first revenue is short in a way most products at this stage are not: the price is settled at $249/month flat, the plan is per company rather than per seat, and Paddle is dormant code waiting on an account rather than an unbuilt feature. What holds the score below the eighties is evidence, not engineering — over half the research corpus is [Guessing], the central premise that firms are in pain over Excel-and-email tracking has never been checked against a single real buyer, and the one genuinely well-evidenced strength (no-extra-seat access for another company, confirmed against 8 competitors [Certain]) has never been experienced by an actual contractor, so the next month is worth spending on the code *and* on two or three real buyer conversations in parallel.
