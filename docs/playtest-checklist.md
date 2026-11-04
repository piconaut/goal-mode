# Human playtest checklist (M8.6)

Build: the published artifact (see PROGRESS.md "Published build"), or `npm run dev`. Play Midwest on Normal,
seed of your choice (type it in the briefing's Seed box), with the tutorial on. Aim for days 1–5 in one sitting (≈1 hour), then one later-act day
if time allows. Jot the time of day and the sim clock (`D3 10:40`) next to every note.

## Before you start
- [ ] Note your z/OS background (expert / some / none). It decides how to read the rest.
- [ ] Desktop browser at normal width; one session on a phone (or browser at ~390 px wide) later.

## First 15 minutes (onboarding)
- [ ] Does the tutorial explain what "winning a day" means (SLAs, trust, MLC/budget)?
- [ ] Without the tutorial: could you tell what to look at first?
- [ ] Time until you made your first deliberate change: ____ min. Was it because of something you *read in a report*?
- [ ] Any word or abbreviation you didn't understand, and whether the Codex hint covered it.

## Diagnosis loop (the core gameplay)
For each incident or alert that mattered, note:
- [ ] Symptom you noticed first, and where (alert, Ops console, chart, inbox).
- [ ] Which report gave the clue (WLMGL, Partition Data, CF Activity, DELAY, SYSINFO, SYSWKM, SMF…).
      Did you find it unaided, via a hint, or not at all?
- [ ] What you changed, and whether the effect was visible within an hour of sim time.
- [ ] Did the outcome make sense afterwards? Anything that felt like a hidden gotcha?
- [ ] Number of decisions that felt meaningful per day: ____ (target 3–6 alerts that matter, 1–2 incidents in Act II+).
- [ ] Moments of nothing to do (fast-forwarded) vs. moments of overload.

## Change Desk and costs
- [ ] Is batching several edits into one change request obvious? Did you ever submit an emergency change?
- [ ] Did the trust / fail-risk cost of emergency changes actually make you hesitate? (open question in PROGRESS)
- [ ] Did a draft ever go stale under you (e.g. CF failed after you typed the change)? Was that confusing?
- [ ] Every lever you used: did it have a cost or trade-off you noticed? Any lever that felt strictly better?

## Tools, insight and money
- [ ] Did you buy analytics tools? Was the insight cost / benefit clear before buying?
- [ ] Is MLC / R4HA / budget pressure understandable from the Finance view?
- [ ] TFP offer (if seen): did the choice feel real, or obvious?

## Specific things to watch
- [ ] CICS issues: is diagnosing CICS CPU through the AOR classes / Monitor III SYSWKM understandable?
- [ ] If CICS_SOS appears: what did you try? (Known issue: raising MXT clears it, which real z/OS wouldn't — note
      whether you'd have tried that.)
- [ ] Batch window around days 27–28 (if reached): was the pressure foreseeable from earlier data?
- [ ] WLM log: does it explain why WLM moved dispatch priorities?

## UI and comfort
- [ ] Phone width: settings rows (known to scroll inside panels), Change Desk, reports. Anything unusable?
- [ ] Keyboard controls, theme/contrast, sound: anything annoying or missing?
- [ ] Autosave / reload: reload mid-day, press **Continue saved run** and confirm you resume within a few sim
  minutes of where you were (the live day saves every 30 seconds).
- [ ] At the end of the session press **⇩ export** and attach the run file to your notes (it replays headlessly).
- [ ] Any error, frozen UI, or console error (F12) — note the sim clock.

## Wrap-up (answer in a sentence each)
- [ ] Fun? Would you start another run tomorrow?
- [ ] The most satisfying moment, and the most frustrating one.
- [ ] One thing you'd want explained in plain language (input for M9 simplified mode).
- [ ] End report: did the day/run score feel fair?
