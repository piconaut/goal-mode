# Install the /cost-loop skill user-wide (paste into the cloud environment setup script)
mkdir -p ~/.claude/skills/cost-loop
cat > ~/.claude/skills/cost-loop/SKILL.md <<'COSTLOOP_EOF'
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
3. **Work.** Do TASK: one item (or a batch of small related items), following the repo's CLAUDE.md (if any).
   Commit and push. Keep the iteration lean: cost is mostly cache reads (context size × turns), so
   - avoid re-reading big files and long outputs; grep or tail instead;
   - delegate to cheaper subagents (e.g. Sonnet agents in `.claude/agents/`, or a general-purpose agent with
     `model: sonnet`) when the task outweighs a subagent's ~30–40k-token start-up;
   - batch small items instead of spending a wakeup on each.
4. **Price.** Run `python3 <this skill's base directory>/cost.py --rate <RATE> --mark` from the project root. It prints the session
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
COSTLOOP_EOF
cat > ~/.claude/skills/cost-loop/cost.py <<'COSTLOOP_EOF'
#!/usr/bin/env python3
"""Price this Claude Code session from its transcript, for /cost-loop pacing.

  python3 <skill dir>/cost.py [--rate 6] [--mark]   (run from the project root)

Reads ~/.claude/projects/<cwd slug>/<newest session>.jsonl plus its subagents/*.jsonl, sums per-turn
token usage (deduplicated by message id) and prices it. Prints the session total, the cost since the
last mark (one mark per loop iteration), subagent cost since the mark, the current context size and a
suggested wakeup delay = cost per iteration / target $ per hour, clamped to [600, 3300] s so the 1-hour
prompt cache stays warm. --mark records now as the start of the next iteration.

Estimates only: it tracks /usage "Total cost" to within ~5%. Update PRICES if pricing changes.
"""
import argparse, glob, json, os, sys
from datetime import datetime, timezone

# $ per million tokens: input, cache write (1h TTL = 2x input), cache read, output.
PRICES = {
    'claude-opus': (4.0, 8.0, 0.20, 20.0),
    'claude-sonnet': (2.0, 4.0, 0.20, 10.0),
    'claude-haiku': (1.0, 2.0, 0.10, 5.0),  # assumed; haiku is a tiny share (web search helper)
}
MIN_DELAY, MAX_DELAY = 600, 3300
COMPACT_AT_TOKENS = 120_000


def price_of(model):
    for k, p in PRICES.items():
        if model.startswith(k):
            return p
    return None


def turns(path):
    """(timestamp, model, cost, context_tokens) per unique assistant message."""
    seen, out = set(), []
    with open(path, encoding='utf-8', errors='replace') as f:
        for line in f:
            if '"usage"' not in line:
                continue
            try:
                d = json.loads(line)
            except ValueError:
                continue
            m = d.get('message') or {}
            u, mid, model = m.get('usage'), m.get('id'), m.get('model', '')
            p = price_of(model)
            if not u or not p or mid in seen:
                continue
            seen.add(mid)
            i, cw, cr, o = (u.get(k, 0) or 0 for k in ('input_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens', 'output_tokens'))
            cost = (i * p[0] + cw * p[1] + cr * p[2] + o * p[3]) / 1e6
            out.append((d.get('timestamp', ''), model, cost, i + cw + cr))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--rate', type=float, default=6.0, help='target $ per hour')
    ap.add_argument('--mark', action='store_true', help='start a new iteration window after reporting')
    a = ap.parse_args()

    proj = os.path.expanduser('~/.claude/projects/' + os.getcwd().replace('/', '-'))
    mains = sorted(glob.glob(proj + '/*.jsonl'), key=os.path.getmtime)
    if not mains:  # run from another directory: fall back to the newest session anywhere
        mains = sorted(glob.glob(os.path.expanduser('~/.claude/projects/*/*.jsonl')), key=os.path.getmtime)
    if not mains:
        sys.exit(f'no transcript under {proj}')
    main_path = mains[-1]
    sess_dir = main_path[:-len('.jsonl')]
    state_path = os.path.join(sess_dir, 'cost-loop-mark.json')
    try:
        mark = json.load(open(state_path))
    except (OSError, ValueError):
        mark = {}
    since = mark.get('ts', '')

    main_turns = turns(main_path)
    sub_turns = [t for p in sorted(glob.glob(sess_dir + '/subagents/*.jsonl')) for t in turns(p)]
    total = sum(t[2] for t in main_turns + sub_turns)
    window = sum(t[2] for t in main_turns + sub_turns if t[0] > since)
    sub_window = sum(t[2] for t in sub_turns if t[0] > since)
    context = main_turns[-1][3] if main_turns else 0

    per_iter = window if since else None
    delay = MIN_DELAY if per_iter is None else int(min(MAX_DELAY, max(MIN_DELAY, per_iter / a.rate * 3600)))
    print(f'session total ≈ ${total:.2f}')
    print(f'since last mark ≈ ${window:.2f}' + (f' (subagents ${sub_window:.2f})' if sub_window else '') + ('' if since else ' (no mark yet: first iteration)'))
    print(f'context ≈ {context // 1000}k tokens' + ('  → suggest /compact' if context > COMPACT_AT_TOKENS else ''))
    print(f'target ${a.rate:g}/hr → delay {delay} s')

    if a.mark:
        now = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.%f')[:-3] + 'Z'
        json.dump({'ts': now, 'iterations': mark.get('iterations', 0) + 1}, open(state_path, 'w'))


if __name__ == '__main__':
    main()
COSTLOOP_EOF
