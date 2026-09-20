# Tielora production ads

Five 30 second spots, ready for Higgsfield (Kling 3.0) and a human editor. Sources: `docs/brand/05-ad-concepts.md` (selection), `src/app/(public)/page.tsx` (claims), `src/app/globals.css` (colours).

House rules for every spot
- 9:16, 1080x1920, 30 s, for LinkedIn and Reels. Three scenes of 10 s each.
- Every product scene uses a real screenshot composited in post. The prompt only asks Kling for a laptop with a bright screen. Never let the model invent UI.
- No em dashes, no exclamation marks, sentence case, plain English. Dates written like 30 Sep 2026.
- Colours on screen: ink #152647 backgrounds, white or #f5f6f7 text panels, teal #46c4b0 for one highlight per scene, primary blue #2e5aac for the CTA button. Red #b54a4a appears only where the product itself shows a blocked status.
- Type: Candara or Segoe UI. Wordmark is the SVG from code, never rendered by the model.
- No made-up customers, quotes, logos or numbers. The only price allowed is the real one from `src/lib/plan-limits.ts` and the ads do not need it.
- Two CTAs only: "Start free, no card" and "See the demo company".

---

## Concept A: Nobody typed that status

### CONCEPT
- Name: Nobody typed that status
- Ad type: UGC style, one project manager on camera, founder-style candour
- Target audience: project managers and discipline leads, 30 to 55, oil and gas, energy and construction, running work across several contractors
- Pain point: the weekly status is a spreadsheet someone typed. It says done because someone was hopeful, not because the work is done
- Core message: in Tielora the status is derived, not typed in. A task can never say done unless its work is done
- Platform: LinkedIn feed and Reels, sound on and sound off
- Duration: 30 s
- Format: 9:16, 1080x1920

### HOOK (0:00 to 0:03)
She looks at the camera and says: "That task was marked done for three weeks. It was not done."

### SCRIPT
Voiceover and dialogue are the same voice: the project manager, speaking to camera, unscripted tone.

0:00 to 0:10, dialogue
"That task was marked done for three weeks. It was not done. Someone typed it into the tracker on a Thursday, the civil pack never arrived, and nobody looked underneath the word."

0:10 to 0:20, dialogue
"So we stopped typing statuses. In Tielora the main task works its status out from the discipline tasks under it. Civil is blocked, so the parent is blocked. Nobody can overrule that."

0:20 to 0:30, dialogue
"Every company on the project sees the same board. Same truth, same morning. Try it free, no card, or open the demo company and poke around."

On-screen text
- 0:01 "Marked done for three weeks"
- 0:12 "Derived, not typed in"
- 0:16 "A task can never say done unless its work is done"
- 0:22 "One project. Every company."
- 0:26 "Start free, no card"
- 0:28 "See the demo company"

### SHOT LIST

Character continuity line (repeat verbatim in every scene where she appears):
"Same person in every scene: a project manager, a woman in her early forties, dark hair tied back, navy polo shirt under a white hi-vis vest, white hard hat on the desk beside her, inside a portable site office with grey walls, a whiteboard, and a window onto a daylit construction yard, soft daylight from the window, neutral colour grade."

Scene 1, 0:00 to 0:10, hook and problem
- Visual: she sits at a cluttered site office desk, talking to camera, a printed spreadsheet in one hand
- Camera: handheld, chest-up, slight drift, phone-style framing, eye level
- Subject movement: she taps the printed sheet, then sets it down and leans in
- Environment: portable site office, whiteboard behind, window onto the yard
- Lighting: soft window daylight, no fill
- Mood: honest, a little tired, direct
- Transition: hard cut
- On-screen text: "Marked done for three weeks"
- Voiceover: dialogue lines for 0:00 to 0:10
- Sound: room tone, distant site noise, no music
- HIGGSFIELD PROMPT (Kling 3.0, 9:16, 10 s, photoreal, commercial quality, daylight):
"Vertical 9:16 photoreal handheld video, 10 seconds, commercial quality. Same person in every scene: a project manager, a woman in her early forties, dark hair tied back, navy polo shirt under a white hi-vis vest, white hard hat on the desk beside her, inside a portable site office with grey walls, a whiteboard, and a window onto a daylit construction yard, soft daylight from the window, neutral colour grade. She speaks to camera, holds up a printed spreadsheet, taps one row, sets it down and leans in. Natural skin, subtle camera drift, shallow depth of field, no text, no logos."

Scene 2, 0:10 to 0:20, product
- Visual: she turns the laptop toward camera. The laptop screen shows the real Tielora task board with a main task whose status reads blocked because one discipline task is blocked (real screenshot composited in post); do not invent UI
- Camera: handheld, slow push in toward the laptop, then hold
- Subject movement: she points at the parent task, then at the civil row under it
- Environment: same site office desk
- Lighting: window daylight plus screen glow on her hands
- Mood: calm, matter of fact
- Transition: hard cut
- On-screen text: "Derived, not typed in" then "A task can never say done unless its work is done"
- Voiceover: dialogue lines for 0:10 to 0:20
- Sound: room tone, one soft click as she points
- HIGGSFIELD PROMPT:
"Vertical 9:16 photoreal handheld video, 10 seconds, commercial quality. Same person in every scene: a project manager, a woman in her early forties, dark hair tied back, navy polo shirt under a white hi-vis vest, white hard hat on the desk beside her, inside a portable site office with grey walls, a whiteboard, and a window onto a daylit construction yard, soft daylight from the window, neutral colour grade. She turns an open laptop toward the camera and points at the screen twice. The laptop screen is a plain bright light panel with no content (the real Tielora task board is composited in post), slow push in, natural hands, no text, no logos."

Scene 3, 0:20 to 0:30, benefit and CTA
- Visual: she stands, picks up the hard hat and steps toward the door and the daylight, glancing back at camera. Last 4 s: ink #152647 end card with the SVG wordmark and both CTAs
- Camera: handheld follow, then locked end card
- Subject movement: stands, hat on, walks out into the yard
- Environment: site office door opening onto the construction yard
- Lighting: bright daylight flooding the doorway
- Mood: settled, moving on with the day
- Transition: cut to end card at 0:26
- On-screen text: "One project. Every company." then "Start free, no card" and "See the demo company"
- Voiceover: dialogue lines for 0:20 to 0:30
- Sound: site ambience rises briefly, then silence under the end card
- HIGGSFIELD PROMPT:
"Vertical 9:16 photoreal handheld video, 10 seconds, commercial quality. Same person in every scene: a project manager, a woman in her early forties, dark hair tied back, navy polo shirt under a white hi-vis vest, white hard hat on the desk beside her, inside a portable site office with grey walls, a whiteboard, and a window onto a daylit construction yard, soft daylight from the window, neutral colour grade. She stands, puts the white hard hat on, walks to the open door and steps out into bright daylight on the yard, looking back once, camera follows, no text, no logos."

### TRANSITIONS
Hard cuts only. End card fades in over 8 frames at 0:26.

### VOICEOVER (full)
"That task was marked done for three weeks. It was not done. Someone typed it into the tracker on a Thursday, the civil pack never arrived, and nobody looked underneath the word. So we stopped typing statuses. In Tielora the main task works its status out from the discipline tasks under it. Civil is blocked, so the parent is blocked. Nobody can overrule that. Every company on the project sees the same board. Same truth, same morning. Try it free, no card, or open the demo company and poke around."

### ON-SCREEN TEXT
1. Marked done for three weeks
2. Derived, not typed in
3. A task can never say done unless its work is done
4. One project. Every company.
5. Start free, no card
6. See the demo company

### CTA
Primary: Start free, no card. Secondary: See the demo company.

### A/B/C HOOKS
- Hook A (original): "That task was marked done for three weeks. It was not done." Scene 1 prompt as above.
- Hook B (alternative): "Who typed this?" She holds the printed sheet up to the lens so the word done fills the frame. Replacement Scene 1 prompt: "Vertical 9:16 photoreal handheld video, 10 seconds, commercial quality. Same person in every scene: a project manager, a woman in her early forties, dark hair tied back, navy polo shirt under a white hi-vis vest, white hard hat on the desk beside her, inside a portable site office with grey walls, a whiteboard, and a window onto a daylit construction yard, soft daylight from the window, neutral colour grade. She holds a printed spreadsheet up close to the lens, then lowers it and looks straight at camera, unimpressed, slow rack focus from paper to face, no text, no logos."
- Hook C (aggressive, problem first): "Your status report is fiction. Not on purpose. It is just typed." Replacement Scene 1 prompt: "Vertical 9:16 photoreal handheld video, 10 seconds, commercial quality. Same person in every scene: a project manager, a woman in her early forties, dark hair tied back, navy polo shirt under a white hi-vis vest, white hard hat on the desk beside her, inside a portable site office with grey walls, a whiteboard, and a window onto a daylit construction yard, soft daylight from the window, neutral colour grade. She crumples a printed status sheet, drops it in the bin beside the desk and turns back to camera, handheld, close, no text, no logos."

### CUTDOWNS
- 15 s: Scene 1 trimmed to 0:00 to 0:05 (hook only), Scene 2 in full 0:05 to 0:15 with the end card burned into the last 3 s. Voiceover: hook sentence, then "In Tielora the status is worked out from the work. Start free, no card."
- 20 s: Scene 1 0:00 to 0:07, Scene 2 0:07 to 0:16, Scene 3 end card only 0:16 to 0:20. Drop the walk-out shot.

---

## Concept B: One page, every morning

### CONCEPT
- Name: One page, every morning
- Ad type: product led demo, the daily brief and the task board on a laptop are the hero
- Target audience: discipline leads and project managers who start each day in a 40 message email chain
- Pain point: the morning is spent finding out what changed, across three contractors, two inboxes and a spreadsheet
- Core message: one computed page each morning, with the same headlines posted to Slack or Teams. Nobody writes it, it is worked out from the project
- Platform: LinkedIn feed and Reels, works with sound off
- Duration: 30 s
- Format: 9:16, 1080x1920, laptop framed vertically with the screen filling the middle third

### HOOK (0:00 to 0:03)
On-screen text over an overflowing inbox: "07:12. Forty emails. Which one matters." Voiceover: "Every morning starts the same way."

### SCRIPT
Voiceover, calm male or female narrator, no dialogue.

0:00 to 0:10
"Every morning starts the same way. Three contractors, two inboxes, one spreadsheet, and the question nobody can answer before ten: what actually changed."

0:10 to 0:20
"Tielora works it out for you. Due today. Overdue. Newly unblocked. Anything you were mentioned in. One short page, computed from the project, and the same headlines posted to Slack or Teams."

0:20 to 0:30
"Behind it, one board every company shares. Status derived from the work, not typed in. Start free, no card. Or open the demo company right now."

On-screen text
- 0:01 "07:12. Forty emails. Which one matters."
- 0:11 "One page, every morning"
- 0:15 "Due today. Overdue. Newly unblocked."
- 0:18 "Copied to Slack or Teams"
- 0:22 "One source of truth."
- 0:26 "Start free, no card"
- 0:28 "See the demo company"

### SHOT LIST

Character continuity line (repeat verbatim in every scene where he appears):
"Same person in every scene: a discipline lead, a man in his late thirties, short dark beard, light blue shirt with sleeves rolled, seated at a clean desk in a modern engineering office with drawings pinned to the wall behind him and a window bringing in morning daylight, neutral colour grade."

Scene 1, 0:00 to 0:10, hook and problem
- Visual: over the shoulder on a laptop, the screen shows a crowded email inbox and a spreadsheet side by side (generic mock, not Tielora), his hand on the trackpad, coffee untouched
- Camera: locked off, slight top-down over the shoulder, laptop screen dominant in the vertical frame
- Subject movement: scrolls, stops, scrolls again, rubs his forehead
- Environment: engineering office desk
- Lighting: morning window light from the left, screen glow
- Mood: familiar, slightly heavy
- Transition: match cut on the laptop screen to Scene 2
- On-screen text: "07:12. Forty emails. Which one matters."
- Voiceover: lines for 0:00 to 0:10
- Sound: office hum, keyboard, one notification chime
- HIGGSFIELD PROMPT (Kling 3.0, 9:16, 10 s, photoreal, commercial quality, daylight):
"Vertical 9:16 photoreal video, 10 seconds, commercial quality, locked camera over the shoulder. Same person in every scene: a discipline lead, a man in his late thirties, short dark beard, light blue shirt with sleeves rolled, seated at a clean desk in a modern engineering office with drawings pinned to the wall behind him and a window bringing in morning daylight, neutral colour grade. An open laptop fills the middle of the frame, its screen a plain bright light panel with no content (a generic crowded inbox is composited in post), he scrolls with the trackpad, pauses, rubs his forehead, coffee cup beside him, no text, no logos."

Scene 2, 0:10 to 0:20, product
- Visual: same framing, the laptop screen shows the real Tielora daily brief (real screenshot composited in post); do not invent UI. A second beat shows the same headlines arriving in a Slack or Teams channel on the laptop (real screenshot composited in post)
- Camera: slow push in to the laptop until the screen fills the frame, then a gentle settle
- Subject movement: his hand rests still on the desk. One nod
- Environment: same desk
- Lighting: same morning light, screen brighter than in Scene 1
- Mood: relief, order
- Transition: hard cut
- On-screen text: "One page, every morning" then "Due today. Overdue. Newly unblocked." then "Copied to Slack or Teams"
- Voiceover: lines for 0:10 to 0:20
- Sound: office hum fades, a low warm pad begins under the voice
- HIGGSFIELD PROMPT:
"Vertical 9:16 photoreal video, 10 seconds, commercial quality, slow push in over the shoulder. Same person in every scene: a discipline lead, a man in his late thirties, short dark beard, light blue shirt with sleeves rolled, seated at a clean desk in a modern engineering office with drawings pinned to the wall behind him and a window bringing in morning daylight, neutral colour grade. The laptop screen is a plain bright light panel with no content (the real Tielora daily brief is composited in post), camera pushes in until the screen fills the frame, his hand still on the desk, one small nod, no text, no logos."

Scene 3, 0:20 to 0:30, benefit and CTA
- Visual: the laptop screen shows the real Tielora project task board with main tasks and their discipline tasks (real screenshot composited in post); do not invent UI. He closes the laptop halfway and picks up the coffee. Last 4 s: ink #152647 end card with the SVG wordmark and both CTAs
- Camera: pull back from the screen to a wider desk shot, then locked end card
- Subject movement: closes laptop halfway, lifts coffee
- Environment: same desk, office now visibly busier in the background
- Lighting: same morning light
- Mood: done before ten
- Transition: cut to end card at 0:26
- On-screen text: "One source of truth." then "Start free, no card" and "See the demo company"
- Voiceover: lines for 0:20 to 0:30
- Sound: pad resolves, silence under the end card
- HIGGSFIELD PROMPT:
"Vertical 9:16 photoreal video, 10 seconds, commercial quality, slow pull back. Same person in every scene: a discipline lead, a man in his late thirties, short dark beard, light blue shirt with sleeves rolled, seated at a clean desk in a modern engineering office with drawings pinned to the wall behind him and a window bringing in morning daylight, neutral colour grade. The laptop screen is a plain bright light panel with no content (the real Tielora task board is composited in post), he closes the laptop halfway and lifts a coffee cup, colleagues softly out of focus behind, no text, no logos."

### TRANSITIONS
Match cut on the laptop screen from Scene 1 to Scene 2 (the inbox is replaced by the brief in one frame). Hard cut into Scene 3. End card fade over 8 frames.

### VOICEOVER (full)
"Every morning starts the same way. Three contractors, two inboxes, one spreadsheet, and the question nobody can answer before ten: what actually changed. Tielora works it out for you. Due today. Overdue. Newly unblocked. Anything you were mentioned in. One short page, computed from the project, and the same headlines posted to Slack or Teams. Behind it, one board every company shares. Status derived from the work, not typed in. Start free, no card. Or open the demo company right now."

### ON-SCREEN TEXT
1. 07:12. Forty emails. Which one matters.
2. One page, every morning
3. Due today. Overdue. Newly unblocked.
4. Copied to Slack or Teams
5. One source of truth.
6. Start free, no card
7. See the demo company

### CTA
Primary: Start free, no card. Secondary: See the demo company.

### A/B/C HOOKS
- Hook A (original): "07:12. Forty emails. Which one matters." Scene 1 prompt as above.
- Hook B (alternative): "Nobody wrote this page. The project did." Open straight on the brief. Replacement Scene 1 prompt: "Vertical 9:16 photoreal video, 10 seconds, commercial quality, locked camera. Same person in every scene: a discipline lead, a man in his late thirties, short dark beard, light blue shirt with sleeves rolled, seated at a clean desk in a modern engineering office with drawings pinned to the wall behind him and a window bringing in morning daylight, neutral colour grade. He opens the laptop lid, the screen lights up as a plain bright light panel with no content (the real Tielora daily brief is composited in post), he reads for a moment and sits back, no text, no logos."
- Hook C (aggressive, problem first): "You spend the first hour finding out what changed. Every day. Across every contractor." Replacement Scene 1 prompt: "Vertical 9:16 photoreal video, 10 seconds, commercial quality, handheld close. Same person in every scene: a discipline lead, a man in his late thirties, short dark beard, light blue shirt with sleeves rolled, seated at a clean desk in a modern engineering office with drawings pinned to the wall behind him and a window bringing in morning daylight, neutral colour grade. Two phones and a laptop on the desk all lit at once, he picks up one phone, puts it down, picks up the other, laptop screen a plain bright light panel with no content, no text, no logos."

### CUTDOWNS
- 15 s: hook text only over 3 s of Scene 1, then Scene 2 in full (0:03 to 0:13), end card 2 s. Voiceover: "What actually changed. Tielora works it out. One page, every morning, posted to Slack or Teams. Start free, no card."
- 20 s: Scene 1 0:00 to 0:06, Scene 2 0:06 to 0:16, end card 0:16 to 0:20. Drop the coffee shot.

---

## Concept C: The gap between companies

### CONCEPT
- Name: The gap between companies
- Ad type: cinematic commercial
- Target audience: project directors and PMs on multi-contractor energy and construction projects
- Pain point: each company has its own truth. The project falls into the gap between them
- Core message: one project, every company, one source of truth. Each company's workspace is sealed off from every other, and the project itself is shared
- Platform: LinkedIn feed, Reels, also usable as a 16:9 crop for a website hero
- Duration: 30 s
- Format: 9:16, 1080x1920

### HOOK (0:00 to 0:03)
Wide drone shot of a plant at dawn, two site offices at opposite ends of the frame. Text: "Four companies. One project. Four versions of the truth."

### SCRIPT
Voiceover only, slow and low.

0:00 to 0:10
"Four companies on one site. Each one with its own tracker, its own folder, its own idea of what is done."

0:10 to 0:20
"Tielora gives the project one board. Every company sees its own work, and the project sees everything. Documents are versioned, never overwritten. Every action is on the record."

0:20 to 0:30
"One project. Every company. One source of truth. Start free, no card, or see the demo company."

On-screen text
- 0:01 "Four companies. One project. Four versions of the truth."
- 0:12 "One project. Every company."
- 0:16 "Nothing gets overwritten"
- 0:22 "One source of truth."
- 0:26 "Start free, no card"
- 0:28 "See the demo company"

### SHOT LIST

Character continuity line (repeat verbatim where he appears):
"Same person in every scene: a site supervisor, a man in his fifties, grey stubble, orange hi-vis jacket over a khaki shirt, white hard hat with a chin strap, walking through an outdoor gas processing plant of silver pipework and steel walkways, bright hard daylight, long shadows, neutral colour grade."

Scene 1, 0:00 to 0:10, hook and problem
- Visual: aerial dawn shot of the plant, then the supervisor walking a steel walkway with a clipboard, two portable site offices visible far apart
- Camera: slow aerial descent, then long lens tracking
- Subject movement: walking, checking the clipboard, glancing across the site
- Environment: outdoor gas plant, pipework, walkways
- Lighting: early hard daylight, long shadows
- Mood: vast, divided
- Transition: slow dissolve
- On-screen text: "Four companies. One project. Four versions of the truth."
- Voiceover: lines for 0:00 to 0:10
- Sound: wind, distant plant hum, a single low string note
- HIGGSFIELD PROMPT (Kling 3.0, 9:16, 10 s, photoreal, commercial quality, daylight):
"Vertical 9:16 photoreal cinematic video, 10 seconds, commercial quality, aerial descending to long lens tracking. Same person in every scene: a site supervisor, a man in his fifties, grey stubble, orange hi-vis jacket over a khaki shirt, white hard hat with a chin strap, walking through an outdoor gas processing plant of silver pipework and steel walkways, bright hard daylight, long shadows, neutral colour grade. He walks a raised steel walkway holding a clipboard, two portable site offices visible far apart in the background, wide scale, no text, no logos."

Scene 2, 0:10 to 0:20, product
- Visual: inside a control room, the supervisor stands behind a seated engineer. The laptop screen shows the real Tielora project task board with several companies' discipline tasks under one main task, then the document version history panel (real screenshots composited in post); do not invent UI
- Camera: slow dolly in from the doorway to over the shoulder
- Subject movement: the supervisor leans in and points once, the engineer nods
- Environment: plant control room, wall of monitors dimmed, one laptop lit
- Lighting: daylight from a high window plus screen glow
- Mood: focused, quiet
- Transition: hard cut
- On-screen text: "One project. Every company." then "Nothing gets overwritten"
- Voiceover: lines for 0:10 to 0:20
- Sound: plant hum muffled, string note holds
- HIGGSFIELD PROMPT:
"Vertical 9:16 photoreal cinematic video, 10 seconds, commercial quality, slow dolly in. Same person in every scene: a site supervisor, a man in his fifties, grey stubble, orange hi-vis jacket over a khaki shirt, white hard hat with a chin strap, walking through an outdoor gas processing plant of silver pipework and steel walkways, bright hard daylight, long shadows, neutral colour grade. Now inside a plant control room with a high daylit window, he stands behind a seated engineer at a laptop whose screen is a plain bright light panel with no content (the real Tielora task board is composited in post), he points once, no text, no logos."

Scene 3, 0:20 to 0:30, benefit and CTA
- Visual: back outside, the supervisor and two people in different company colours (blue vest, orange vest) walk together along the walkway toward camera. Last 4 s: ink #152647 end card with SVG wordmark and both CTAs
- Camera: low wide, slow push, then locked end card
- Subject movement: three people walking in step
- Environment: plant walkway, pipework behind
- Lighting: full daylight
- Mood: resolved, aligned
- Transition: cut to end card at 0:26
- On-screen text: "One source of truth." then "Start free, no card" and "See the demo company"
- Voiceover: lines for 0:20 to 0:30
- Sound: string resolves to a single chord, silence under the end card
- HIGGSFIELD PROMPT:
"Vertical 9:16 photoreal cinematic video, 10 seconds, commercial quality, low wide slow push. Same person in every scene: a site supervisor, a man in his fifties, grey stubble, orange hi-vis jacket over a khaki shirt, white hard hat with a chin strap, walking through an outdoor gas processing plant of silver pipework and steel walkways, bright hard daylight, long shadows, neutral colour grade. He walks toward camera in step with two colleagues, one in a blue hi-vis vest and one in an orange vest, all in white hard hats, pipework behind, no text, no logos."

### TRANSITIONS
Dissolve from Scene 1 to 2. Hard cut to Scene 3. End card fade over 12 frames.

### VOICEOVER (full)
"Four companies on one site. Each one with its own tracker, its own folder, its own idea of what is done. Tielora gives the project one board. Every company sees its own work, and the project sees everything. Documents are versioned, never overwritten. Every action is on the record. One project. Every company. One source of truth. Start free, no card, or see the demo company."

### ON-SCREEN TEXT
1. Four companies. One project. Four versions of the truth.
2. One project. Every company.
3. Nothing gets overwritten
4. One source of truth.
5. Start free, no card
6. See the demo company

### CTA
Primary: Start free, no card. Secondary: See the demo company.

### A/B/C HOOKS
- Hook A (original): "Four companies. One project. Four versions of the truth." Scene 1 prompt as above.
- Hook B (alternative): "Which version is the right one." Open on a desk with four printed copies of the same drawing, each marked up differently. Replacement Scene 1 prompt: "Vertical 9:16 photoreal cinematic video, 10 seconds, commercial quality, slow top-down tilt. Same person in every scene: a site supervisor, a man in his fifties, grey stubble, orange hi-vis jacket over a khaki shirt, white hard hat with a chin strap, walking through an outdoor gas processing plant of silver pipework and steel walkways, bright hard daylight, long shadows, neutral colour grade. He stands at an outdoor plan table with four printed engineering drawings laid side by side, each with different pen marks, and flips one over, no text, no logos."
- Hook C (aggressive, problem first): "The project is not late. It is just being reported by four companies who never see the same page." Replacement Scene 1 prompt: "Vertical 9:16 photoreal cinematic video, 10 seconds, commercial quality, handheld. Same person in every scene: a site supervisor, a man in his fifties, grey stubble, orange hi-vis jacket over a khaki shirt, white hard hat with a chin strap, walking through an outdoor gas processing plant of silver pipework and steel walkways, bright hard daylight, long shadows, neutral colour grade. He stands still on the walkway holding a phone to his ear, looking across to a distant site office, frustrated, wind moving his jacket, no text, no logos."

### CUTDOWNS
- 15 s: aerial 0:00 to 0:04, control room 0:04 to 0:12, end card 0:12 to 0:15. Voiceover: "Four companies, one site. Tielora gives the project one board. One source of truth. Start free, no card."
- 20 s: Scene 1 0:00 to 0:06, Scene 2 0:06 to 0:15, Scene 3 walk 0:15 to 0:17, end card to 0:20.

---

## Concept D: Stop typing statuses

### CONCEPT
- Name: Stop typing statuses
- Ad type: performance, "you are doing this wrong"
- Target audience: PMs who maintain a master tracker spreadsheet by hand
- Pain point: the tracker is only as true as the last person who typed in it
- Core message: status is derived from the work. Required documents gate completion. A task can never say done unless its work is done
- Platform: LinkedIn feed and Reels, sound off first
- Duration: 30 s
- Format: 9:16, 1080x1920

### HOOK (0:00 to 0:03)
Close on a spreadsheet cell being typed: d o n e. Text: "This is where projects go wrong."

### SCRIPT
Voiceover, direct, neutral.

0:00 to 0:10
"If your project status is something a person types, it is an opinion. The mechanical pack is missing, the cell still says done, and everyone plans around it."

0:10 to 0:20
"In Tielora nobody types a status. The main task derives it from the discipline tasks underneath. A required document missing means the parent cannot complete. No exceptions, not even for an admin."

0:20 to 0:30
"Plan around what is true. Start free, no card, or see the demo company."

On-screen text
- 0:01 "This is where projects go wrong."
- 0:06 "Typed in. Not checked."
- 0:12 "Derived, not typed in"
- 0:16 "Required documents gate completion"
- 0:22 "A task can never say done unless its work is done"
- 0:26 "Start free, no card"
- 0:28 "See the demo company"

### SHOT LIST

Character continuity line (repeat verbatim where she appears):
"Same person in every scene: a planning engineer, a woman in her thirties, hijab in dark grey, charcoal blazer over a white shirt, seated in a bright open-plan engineering office with a large window and a printed schedule on the wall, soft daylight, neutral colour grade."

Scene 1, 0:00 to 0:10, hook and problem
- Visual: macro on fingers typing "done" into a spreadsheet cell (generic mock composited), pull out to reveal her at the desk, a second monitor showing an email with "attachment missing"
- Camera: macro on keys, then a smooth pull back
- Subject movement: types, hits enter, moves on without looking
- Environment: open-plan engineering office
- Lighting: soft daylight
- Mood: routine, quietly wrong
- Transition: hard cut
- On-screen text: "This is where projects go wrong." then "Typed in. Not checked."
- Voiceover: lines for 0:00 to 0:10
- Sound: keyboard clicks, one enter key emphasised
- HIGGSFIELD PROMPT (Kling 3.0, 9:16, 10 s, photoreal, commercial quality, daylight):
"Vertical 9:16 photoreal video, 10 seconds, commercial quality, macro pulling back. Same person in every scene: a planning engineer, a woman in her thirties, hijab in dark grey, charcoal blazer over a white shirt, seated in a bright open-plan engineering office with a large window and a printed schedule on the wall, soft daylight, neutral colour grade. Extreme close up of her fingers typing on a laptop keyboard and pressing enter, then a smooth pull back to reveal her at the desk, laptop screen a plain bright light panel with no content (a generic spreadsheet is composited in post), no text, no logos."

Scene 2, 0:10 to 0:20, product
- Visual: the laptop screen shows the real Tielora main task with its discipline tasks, one marked blocked in #b54a4a, and the required-document gate showing a missing document (real screenshot composited in post); do not invent UI
- Camera: locked, straight on to the laptop, tight
- Subject movement: her hand tries to click the parent status, nothing changes; she sits back
- Environment: same desk
- Lighting: same daylight, screen glow
- Mood: firm, reassuring
- Transition: hard cut
- On-screen text: "Derived, not typed in" then "Required documents gate completion"
- Voiceover: lines for 0:10 to 0:20
- Sound: room tone, no clicks
- HIGGSFIELD PROMPT:
"Vertical 9:16 photoreal video, 10 seconds, commercial quality, locked straight-on shot. Same person in every scene: a planning engineer, a woman in her thirties, hijab in dark grey, charcoal blazer over a white shirt, seated in a bright open-plan engineering office with a large window and a printed schedule on the wall, soft daylight, neutral colour grade. Close on the open laptop, screen a plain bright light panel with no content (the real Tielora task board with a blocked discipline task is composited in post), her hand moves the trackpad once, then she sits back calmly, no text, no logos."

Scene 3, 0:20 to 0:30, benefit and CTA
- Visual: she turns to a colleague, shows the screen, both nod. Last 4 s: ink end card with SVG wordmark and both CTAs
- Camera: medium two-shot, slow push, then locked end card
- Subject movement: turns laptop, colleague leans in
- Environment: open-plan office
- Lighting: daylight
- Mood: shared, settled
- Transition: cut to end card at 0:26
- On-screen text: "A task can never say done unless its work is done" then "Start free, no card" and "See the demo company"
- Voiceover: lines for 0:20 to 0:30
- Sound: quiet office, silence under end card
- HIGGSFIELD PROMPT:
"Vertical 9:16 photoreal video, 10 seconds, commercial quality, medium two-shot slow push. Same person in every scene: a planning engineer, a woman in her thirties, hijab in dark grey, charcoal blazer over a white shirt, seated in a bright open-plan engineering office with a large window and a printed schedule on the wall, soft daylight, neutral colour grade. She turns the laptop toward a male colleague in a grey shirt who leans in and nods, laptop screen a plain bright light panel with no content, no text, no logos."

### TRANSITIONS
Hard cuts. End card fade over 8 frames.

### VOICEOVER (full)
"If your project status is something a person types, it is an opinion. The mechanical pack is missing, the cell still says done, and everyone plans around it. In Tielora nobody types a status. The main task derives it from the discipline tasks underneath. A required document missing means the parent cannot complete. No exceptions, not even for an admin. Plan around what is true. Start free, no card, or see the demo company."

### ON-SCREEN TEXT
1. This is where projects go wrong.
2. Typed in. Not checked.
3. Derived, not typed in
4. Required documents gate completion
5. A task can never say done unless its work is done
6. Start free, no card
7. See the demo company

### CTA
Primary: Start free, no card. Secondary: See the demo company.

### A/B/C HOOKS
- Hook A (original): "This is where projects go wrong." Scene 1 prompt as above.
- Hook B (alternative): "Done, according to whom." Replacement Scene 1 prompt: "Vertical 9:16 photoreal video, 10 seconds, commercial quality, slow push. Same person in every scene: a planning engineer, a woman in her thirties, hijab in dark grey, charcoal blazer over a white shirt, seated in a bright open-plan engineering office with a large window and a printed schedule on the wall, soft daylight, neutral colour grade. She looks from her laptop to the printed schedule on the wall and back, frowning slightly, laptop screen a plain bright light panel with no content, no text, no logos."
- Hook C (aggressive, problem first): "Your tracker lies. Not because anyone lied. Because someone typed." Replacement Scene 1 prompt: "Vertical 9:16 photoreal video, 10 seconds, commercial quality, handheld close. Same person in every scene: a planning engineer, a woman in her thirties, hijab in dark grey, charcoal blazer over a white shirt, seated in a bright open-plan engineering office with a large window and a printed schedule on the wall, soft daylight, neutral colour grade. She highlights one row on a printed schedule with a red marker, pauses, then puts the cap back on and looks at the laptop, no text, no logos."

### CUTDOWNS
- 15 s: typing macro 0:00 to 0:04, Scene 2 0:04 to 0:12, end card to 0:15. Voiceover: "Typed status is an opinion. In Tielora it is derived from the work. Start free, no card."
- 20 s: Scene 1 0:00 to 0:06, Scene 2 0:06 to 0:16, end card 0:16 to 0:20.

---

## Concept E: Outside help, safely scoped

### CONCEPT
- Name: Outside help, safely scoped
- Ad type: product demo, feature focus on external contractor accounts
- Target audience: PMs who avoid giving contractors system access and fall back to email attachments
- Pain point: to give a contractor one task you either open the whole project or you send email
- Core message: an external contractor sees only the tasks assigned to them on one project. Their finished work waits in a sign-off queue for your own team
- Platform: LinkedIn feed and Reels
- Duration: 30 s
- Format: 9:16, 1080x1920

### HOOK (0:00 to 0:03)
Text over a forwarded email chain: "You gave the contractor everything. Or nothing." Voiceover: "There used to be two options."

### SCRIPT
Voiceover, warm and plain.

0:00 to 0:10
"There used to be two options. Give the contractor a login to the whole project, or keep them on email and chase the attachments yourself."

0:10 to 0:20
"Tielora has a third. An external account, scoped to one project, that sees only the tasks you assign. Not the team list, not another company's work. When they finish, it lands in your sign-off queue."

0:20 to 0:30
"Outside help, safely scoped. Start free, no card, or see the demo company."

On-screen text
- 0:01 "You gave the contractor everything. Or nothing."
- 0:12 "Outside help, safely scoped"
- 0:15 "Sees only the tasks you assign"
- 0:18 "Finished work waits for your sign-off"
- 0:22 "One project. Every company."
- 0:26 "Start free, no card"
- 0:28 "See the demo company"

### SHOT LIST

Character continuity line (repeat verbatim where he appears):
"Same person in every scene: a project manager, a man in his mid forties, close-cropped grey hair, white shirt with a company lanyard, seated at a desk in a glass-walled meeting room beside an engineering office, daylight through the glass, neutral colour grade."

Scene 1, 0:00 to 0:10, hook and problem
- Visual: he forwards an email with three attachments on the laptop (generic mock composited), then looks at a second window of user permissions with everything ticked
- Camera: over the shoulder, locked, laptop centred
- Subject movement: clicks forward, sighs, scrolls a permissions list
- Environment: glass meeting room
- Lighting: daylight through glass
- Mood: cautious, stuck
- Transition: hard cut
- On-screen text: "You gave the contractor everything. Or nothing."
- Voiceover: lines for 0:00 to 0:10
- Sound: office hum, mouse clicks
- HIGGSFIELD PROMPT (Kling 3.0, 9:16, 10 s, photoreal, commercial quality, daylight):
"Vertical 9:16 photoreal video, 10 seconds, commercial quality, locked over the shoulder. Same person in every scene: a project manager, a man in his mid forties, close-cropped grey hair, white shirt with a company lanyard, seated at a desk in a glass-walled meeting room beside an engineering office, daylight through the glass, neutral colour grade. He works on an open laptop whose screen is a plain bright light panel with no content (a generic email and permissions window are composited in post), clicks once, sighs, scrolls, no text, no logos."

Scene 2, 0:10 to 0:20, product
- Visual: the laptop screen shows the real Tielora external contractor view, the scoped task list, then the sign-off queue on the team side (real screenshots composited in post); do not invent UI
- Camera: slow push to the laptop screen, split into two beats in post
- Subject movement: he assigns a task, then sits back
- Environment: same room
- Lighting: same daylight
- Mood: controlled, simple
- Transition: hard cut
- On-screen text: "Outside help, safely scoped" then "Sees only the tasks you assign" then "Finished work waits for your sign-off"
- Voiceover: lines for 0:10 to 0:20
- Sound: one soft click, low pad begins
- HIGGSFIELD PROMPT:
"Vertical 9:16 photoreal video, 10 seconds, commercial quality, slow push in. Same person in every scene: a project manager, a man in his mid forties, close-cropped grey hair, white shirt with a company lanyard, seated at a desk in a glass-walled meeting room beside an engineering office, daylight through the glass, neutral colour grade. The laptop screen is a plain bright light panel with no content (the real Tielora contractor view and sign-off queue are composited in post), he taps the trackpad once and sits back, hands relaxed, no text, no logos."

Scene 3, 0:20 to 0:30, benefit and CTA
- Visual: through the glass, a contractor in a hi-vis vest waves from the corridor and walks on; he waves back and returns to the screen. Last 4 s: ink end card with SVG wordmark and both CTAs
- Camera: wider, through the glass wall, then locked end card
- Subject movement: brief wave, back to work
- Environment: glass room with corridor behind
- Lighting: daylight
- Mood: easy, trusting
- Transition: cut to end card at 0:26
- On-screen text: "One project. Every company." then "Start free, no card" and "See the demo company"
- Voiceover: lines for 0:20 to 0:30
- Sound: pad resolves, silence under end card
- HIGGSFIELD PROMPT:
"Vertical 9:16 photoreal video, 10 seconds, commercial quality, wide shot through glass. Same person in every scene: a project manager, a man in his mid forties, close-cropped grey hair, white shirt with a company lanyard, seated at a desk in a glass-walled meeting room beside an engineering office, daylight through the glass, neutral colour grade. In the corridor behind the glass a contractor in an orange hi-vis vest and white hard hat waves and walks past, he waves back and turns to the laptop, no text, no logos."

### TRANSITIONS
Hard cuts. End card fade over 8 frames.

### VOICEOVER (full)
"There used to be two options. Give the contractor a login to the whole project, or keep them on email and chase the attachments yourself. Tielora has a third. An external account, scoped to one project, that sees only the tasks you assign. Not the team list, not another company's work. When they finish, it lands in your sign-off queue. Outside help, safely scoped. Start free, no card, or see the demo company."

### ON-SCREEN TEXT
1. You gave the contractor everything. Or nothing.
2. Outside help, safely scoped
3. Sees only the tasks you assign
4. Finished work waits for your sign-off
5. One project. Every company.
6. Start free, no card
7. See the demo company

### CTA
Primary: Start free, no card. Secondary: See the demo company.

### A/B/C HOOKS
- Hook A (original): "You gave the contractor everything. Or nothing." Scene 1 prompt as above.
- Hook B (alternative): "How much of your project can a contractor see." Replacement Scene 1 prompt: "Vertical 9:16 photoreal video, 10 seconds, commercial quality, slow push. Same person in every scene: a project manager, a man in his mid forties, close-cropped grey hair, white shirt with a company lanyard, seated at a desk in a glass-walled meeting room beside an engineering office, daylight through the glass, neutral colour grade. He pauses with his hand over the trackpad, looks through the glass at people passing, then back to the laptop screen, a plain bright light panel with no content, no text, no logos."
- Hook C (aggressive, problem first): "Every attachment you forward to a contractor is a version nobody will find later." Replacement Scene 1 prompt: "Vertical 9:16 photoreal video, 10 seconds, commercial quality, handheld close. Same person in every scene: a project manager, a man in his mid forties, close-cropped grey hair, white shirt with a company lanyard, seated at a desk in a glass-walled meeting room beside an engineering office, daylight through the glass, neutral colour grade. He drags a folder of printed drawings across the desk, flips through three near-identical sheets, and drops them, laptop screen a plain bright light panel with no content, no text, no logos."

### CUTDOWNS
- 15 s: hook text over 3 s, Scene 2 in full 0:03 to 0:13, end card to 0:15. Voiceover: "A contractor account that sees only its tasks, and a sign-off queue for your team. Outside help, safely scoped. Start free, no card."
- 20 s: Scene 1 0:00 to 0:06, Scene 2 0:06 to 0:16, end card 0:16 to 0:20.
