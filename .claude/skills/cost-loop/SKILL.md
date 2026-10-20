---
name: cost-loop
description: Self-paced work loop that sets its own wakeup delay from measured session cost (target $ per hour, default $6/hr). Each iteration does one task, commits and pushes, prices the iteration from the transcript and schedules the next wakeup. Keeps a heartbeat file and an hourly watchdog so the loop restarts if it dies.
argument-hint: "[$N/hr] <task>   e.g. /cost-loop $4/hr continue from PROGRESS.md   (default $6/hr)"
---

# /cost-loop

Input: `$ARGUMENTS`

## Parse

- If the first token matches `$<number>/hr` (also accept `$<number>/h`, `<number>/hr`), that is the
  target RATE in dollars per hour; the rest is TASK. Otherwise RATE = 6 and TASK is the whole input.
- Empty TASK: reply with the usage line `/cost-loop [$N/hr] <task>` and stop.
- SELF = `/cost-loop $<RATE>/hr <TASK>`: the exact prompt every wakeup and the watchdog re-enter with.

## Each iteration

1. **Heartbeat.** Write now+90 min (ISO UTC, `date -u -d '+90 min' +%FT%TZ`) to
   `<scratchpad>/loop-next-wakeup.txt`, using this session's real scratchpad path.
2. **Watchdog (first iteration of a session, or if unsure).** `list_triggers`; if no enabled task named
   "cost-loop watchdog (hourly)" fires into this session, create one with `create_trigger` (no
   `persistent_session_id`, not a new session per fire), `initiation: human_request`, cron at a
   jittered minute (e.g. `7 * * * *`), with this prompt, filling in the real values:
   > Loop watchdog. Read <scratchpad>/loop-next-wakeup.txt (ISO UTC). If it is missing or more than
   > 10 minutes in the past compared with `date -u`, the loop has died: run `SELF` now. Otherwise reply
   > in one line that the loop is alive.

   Delete watchdogs that point at an older session only if the user asked; otherwise mention them.
3. **Work.** Do TASK: one item (or a batch of small related items), following the repo's CLAUDE.md.
   Commit and push. Keep the iteration lean: cost is mostly cache reads (context size × turns), so
   - avoid re-reading big files and long outputs; grep or tail instead;
   - delegate log digests to `log-reader` and content/tests/small UI to `implementer` when the task
     outweighs a subagent's ~30–40k-token start-up;
   - batch small items instead of spending a wakeup on each.
4. **Price.** Run `python3 .claude/skills/cost-loop/cost.py --rate <RATE> --mark`. It prints the session
   total, the cost of this iteration (since the previous mark) incl. subagents, the context size and the
   delay = iteration cost ÷ RATE, clamped to 600–3300 s (stays inside the 1-hour cache TTL).
   If subagents ran this iteration and `<scratchpad>/subagent-savings-log.md` exists, add a row with
   their measured cost.
5. **Schedule.** `ScheduleWakeup` with that delay, prompt SELF, `noop` false if anything was pushed, and
   a reason quoting the numbers (e.g. "iter $1.90 at $6/hr → 1140 s"). If ScheduleWakeup is unavailable,
   use `send_later` with the delay in minutes and SELF as the message.
6. **Heartbeat again.** Rewrite the heartbeat file with the scheduled wakeup time.
7. **Report** in one or two visible lines: what was pushed, iteration cost, next wakeup.
   If cost.py says "suggest /compact", tell the user that compacting now would cut the cost of every
   later iteration (you cannot compact yourself).

## Stopping

Stop when TASK is done, blocked on a user decision, or the user asks: `ScheduleWakeup` with
`stop: true`, delete this session's watchdog with `delete_trigger`, and say why it stopped.
If `/usage` output appears in the conversation, prefer its "Total cost" over cost.py's estimate when
they disagree by more than 10%, and say so.
