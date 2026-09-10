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
