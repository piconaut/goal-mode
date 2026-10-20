#!/usr/bin/env python3
"""Price this Claude Code session from its transcript, for /cost-loop pacing.

  python3 .claude/skills/cost-loop/cost.py [--rate 6] [--mark]

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
