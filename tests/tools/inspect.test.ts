import { applyPlayCommand, clockText, encodePlayFile, newPlayFile } from '../../tools/playCore';
import { classRows, moveRows, replayAdvance, statsText, stoppedEarly, wlmStats, wlmStatsText } from '../../tools/inspect';
import type { WlmAdjustTrace, WlmCandidateTrace, WlmTrialTrace } from '../../src/sim/wlm/adjust';

const trial = (over: Partial<WlmTrialTrace> = {}): WlmTrialTrace => ({
  move: 'A#1 DP 20→21', verdict: 'NO_RECEIVER_GAIN', receiverPi: [1.4, 1.3], ...over,
});

const candidate = (over: Partial<WlmCandidateTrace> = {}): WlmCandidateTrace => ({
  scKey: 'A#1', importance: 2, sysplexPi: null, localPi: 1.4, dp: 0x20, bottleneck: 'CPU',
  delayShares: { CPU: 1, ZIIP: 0, IO: 0, CAP: 0, OTHER: 0 }, outcome: 'ASSESSED', trials: [], ...over,
});

const trace = (over: Partial<WlmAdjustTrace> = {}): WlmAdjustTrace => ({
  clockText: 'D1 06:00:00', lparId: 'PROD1', dps: { 'A#1': 0x20, 'B#1': 0x10 }, candidates: [], action: null, protection: [], ...over,
});

describe('wlmStats counts the audit table (WT-01)', () => {
  const busy = trace({
    candidates: [
      candidate({ scKey: 'IO#1', outcome: 'NOT_FIXABLE', bottleneck: 'IO' }),
      candidate({ scKey: 'OTH#1', outcome: 'NOT_FIXABLE', bottleneck: 'OTHER' }),
      candidate({ scKey: 'CAP#1', outcome: 'NOT_FIXABLE', bottleneck: 'CAP' }),
      candidate({ scKey: 'NON#1', outcome: 'NOT_FIXABLE', bottleneck: null }),
      candidate({ scKey: 'BUD#1', outcome: 'BUDGET' }),
      candidate({ scKey: 'REC#1', outcome: 'RECOVERING' }),
      candidate({
        trials: [
          trial({ move: 'A#1 DP 20→21', verdict: 'ACCEPTED' }),
          trial({ move: 'DONOR B#1 DP 10→F', verdict: 'ACCEPTED' }),
          trial({ verdict: 'MORE_IMPORTANT_HARMED', receiverPi: [0.8, 0.8] }),
          // A CPU_CRITICAL trial is never projected, but its before PI was measured (adjust.ts records `[pi, null]`).
          trial({ verdict: 'CPU_CRITICAL', receiverPi: [0.7, null] }),
          // Only a trial with no receiver PI at all is the "null" counter.
          trial({ verdict: 'SMALL_GAIN', receiverPi: [null, null] }),
          trial({ verdict: 'NO_NET_VALUE', receiverPi: [1.5, 1.4] }),
        ],
      }),
    ],
  });
  const reversed = trace({
    candidates: [candidate({ trials: [trial({ move: 'A#1 DP 21→20', verdict: 'ACCEPTED' })] })],
    dps: { 'A#1': 0x20, 'B#1': 0x10 },
  });

  it('counts adjustments, outcomes, trials and verdicts in total and per system', () => {
    const stats = wlmStats([trace(), busy, reversed, trace({ lparId: 'PROD2' })]);
    expect(stats.total.adjustments).toBe(4);
    expect(stats.total.noCandidate).toBe(2);
    expect(stats.total.assessed).toBe(2);
    expect(stats.total.notFixable).toEqual({ IO: 1, OTHER: 1, CAP: 1, NONE: 1 });
    expect(stats.total.budget).toBe(1);
    expect(stats.total.recovering).toBe(1);
    expect(stats.total.trials).toBe(7);
    expect(stats.total.verdicts).toEqual({
      ACCEPTED: 3, CPU_CRITICAL: 1, NO_RECEIVER_GAIN: 0, SMALL_GAIN: 1, MORE_IMPORTANT_HARMED: 1, EQUAL_DISPARITY: 0, NO_NET_VALUE: 1, PROJECTION_DISAGREES: 0,
    });
    expect(stats.total.acceptedReceiverUp).toBe(2);
    expect(stats.total.acceptedDonor).toBe(1);
    // The before PI each trial was judged on: 0.8, 0.7 (CPU_CRITICAL), null, 1.5.
    expect(stats.total.rejectedPiUnder09).toBe(2);
    expect(stats.total.rejectedPiNull).toBe(1);
    // A#1 went up in `busy` and down in `reversed`.
    expect(stats.total.reversed).toBe(1);
    expect(stats.total.reversedWithin2Min).toBe(1);
    expect(stats.systems.map((s) => [s.lparId, s.counters.adjustments, s.counters.trials])).toEqual([
      ['PROD1', 3, 7],
      ['PROD2', 1, 0],
    ]);
  });

  it('counts a reversal within two minutes only when at most 12 adjustments separate the moves', () => {
    const gap = (n: number) => wlmStats([busy, ...Array.from({ length: n - 1 }, () => trace()), reversed]).total;
    expect(gap(12)).toMatchObject({ reversed: 1, reversedWithin2Min: 1 });
    expect(gap(13)).toMatchObject({ reversed: 1, reversedWithin2Min: 0 });
  });

  it('counts a period assessed 30 adjustments without a receiver move as one episode', () => {
    const run = (n: number, donorAt?: number) => Array.from({ length: n }, (_, i) => trace({
      clockText: `D1 ${String(6 + Math.floor(i / 360)).padStart(2, '0')}:${String(Math.floor((i % 360) / 6)).padStart(2, '0')}:00`,
      candidates: [candidate({
        trials: i === donorAt ? [trial({ move: 'DONOR B#1 DP 10→F', verdict: 'ACCEPTED' })] : [trial()],
      })],
    }));
    expect(wlmStats(run(29)).total.episodes).toBe(0);
    expect(wlmStats(run(30)).total.episodes).toBe(1);
    // A donor move elsewhere does not reset the period's run; only being moved as the receiver does.
    expect(wlmStats(run(30, 15)).total.episodes).toBe(1);
    expect(wlmStats([...run(20), ...run(20).map((t) => ({ ...t, candidates: [candidate({ trials: [trial({ move: 'A#1 DP 20→21', verdict: 'ACCEPTED' })] })] })), ...run(9)]).total.episodes)
      .toBe(0);
  });

  it('prints a column per system, the total, and the requested DP ladder', () => {
    const stats = wlmStats(
      [
        trace({ clockText: 'D1 11:59:50', dps: { 'A#1': 0x20, 'B#1': 0x10 } }),
        trace({ clockText: 'D1 12:00:50', dps: { 'A#1': 0x21, 'B#1': 0x10 } }),
        trace({ clockText: 'D1 13:00:00', dps: { 'A#1': 0x22, 'B#1': 0x10 } }),
        // 05:59 is the end of the same played day (days run 06:00 → 06:00), so it is after 12:00, not before it.
        trace({ clockText: 'D1 05:59:50', dps: { 'A#1': 0x30, 'B#1': 0x10 } }),
        trace({ clockText: 'D2 11:59:50', dps: { 'A#1': 0x40, 'B#1': 0x10 } }),
      ],
      { ladder: '12:00' },
    );
    const text = statsText(stats);
    expect(text).toContain('adjustments');
    expect(text).toContain('rejected: MORE_IMPORTANT_HARMED');
    expect(text).toMatch(/PROD1\s+TOTAL/);
    expect(stats.ladder).toEqual([
      { lparId: 'PROD1', lines: ['D1 11:59:50  A#1=20 B#1=10', 'D2 11:59:50  A#1=40 B#1=10'] },
    ]);
    expect(text).toContain('DP ladder at 12:00 each played day (hex, highest first)');
    // The ladder reads the whole first day, so a later --from does not erase the day's earlier ladder.
    const late = wlmStats(
      [trace({ clockText: 'D1 13:00:00', dps: { 'A#1': 0x22, 'B#1': 0x10 } })],
      { ladder: '12:00', ladderTraces: [
        trace({ clockText: 'D1 11:59:50', dps: { 'A#1': 0x20, 'B#1': 0x10 } }),
        trace({ clockText: 'D1 12:00:50', dps: { 'A#1': 0x21, 'B#1': 0x10 } }),
        trace({ clockText: 'D1 13:00:00', dps: { 'A#1': 0x22, 'B#1': 0x10 } }),
      ] },
    );
    expect(late.ladder[0]!.lines).toEqual(['D1 11:59:50  A#1=20 B#1=10']);
  });
});

describe('wlm-stats detail sections: --by-class, --episodes, --moves', () => {
  const clock = (i: number) => `D1 ${String(6 + Math.floor(i / 360)).padStart(2, '0')}:${String(Math.floor((i % 360) / 6)).padStart(2, '0')}:${String((i % 6) * 10).padStart(2, '0')}`;
  const assessed = (i: number, trials = [trial()]) => trace({ clockText: clock(i), candidates: [candidate({ trials })] });

  it('lists each episode the counter counts, with its first and last assessment and how it ended', () => {
    const helped = trial({ move: 'A#1 DP 20→21', verdict: 'ACCEPTED', receiverPi: [1.4, 0.9] });
    const ts = [
      ...Array.from({ length: 31 }, (_, i) => assessed(i)),
      assessed(31, [helped]),
      // A skipped adjustment neither counts nor ends the run.
      trace({ clockText: clock(32), candidates: [candidate({ outcome: 'SKIP_CLOCK' })] }),
      ...Array.from({ length: 30 }, (_, i) => assessed(33 + i)),
      trace({ clockText: clock(63), lparId: 'PROD2', candidates: [candidate()] }),
    ];
    const stats = wlmStats(ts, { episodes: true });
    expect(stats.total.episodes).toBe(2);
    expect(stats.episodes).toEqual([
      { lparId: 'PROD1', scKey: 'A#1', first: clock(0), last: clock(30), assessments: 31, verdicts: { NO_RECEIVER_GAIN: 31 }, end: clock(31) },
      { lparId: 'PROD1', scKey: 'A#1', first: clock(33), last: clock(62), assessments: 30, verdicts: { NO_RECEIVER_GAIN: 30 }, end: null },
    ]);
    const text = statsText(stats);
    expect(text).toContain(`PROD1 A#1  ${clock(0)} → ${clock(30)}  31 assessments, ended by a move at ${clock(31)}`);
    expect(text).toContain('still open at the end of the range');
    // A run under 30 is not listed.
    expect(wlmStats(ts.slice(0, 29), { episodes: true }).episodes).toEqual([]);
  });

  it('counts outcomes, trials and receiver moves per period', () => {
    const ts = [
      trace({
        candidates: [
          candidate({ trials: [trial({ move: 'A#1 DP 20→21', verdict: 'ACCEPTED' })] }),
          candidate({ scKey: 'B#1', outcome: 'SKIP_CLOCK' }),
        ],
      }),
      trace({ candidates: [candidate({ trials: [trial({ move: 'DONOR B#1 DP 10→F', verdict: 'ACCEPTED' }), trial()] }), candidate({ scKey: 'B#1', outcome: 'RECOVERING' })] }),
      trace({ lparId: 'PROD2', candidates: [candidate({ outcome: 'NOT_FIXABLE', bottleneck: 'IO' })] }),
    ];
    const rows = classRows(ts);
    expect(rows.map((r) => [r.lparId, r.scKey, r.outcomes.ASSESSED, r.outcomes.SKIP_CLOCK, r.outcomes.RECOVERING, r.outcomes.NOT_FIXABLE, r.trials, r.helped])).toEqual([
      ['PROD1', 'A#1', 2, 0, 0, 0, 3, 1],
      ['PROD1', 'B#1', 0, 1, 1, 0, 0, 0],
      ['PROD2', 'A#1', 0, 0, 0, 1, 0, 0],
    ]);
    expect(statsText(wlmStats(ts, { byClass: true }))).toMatch(/PROD1 A#1\s+2\s+0\s+0\s+0\s+0\s+0\s+3\s+1/);
  });

  it('lists accepted moves with the receiver they were made for', () => {
    const ts = [
      trace({ clockText: 'D1 09:00:10', candidates: [candidate({ trials: [trial(), trial({ move: 'DONOR B#1 DP 10→F', verdict: 'ACCEPTED', receiverPi: [2, 0.8] })] })] }),
      trace({ clockText: 'D1 09:00:20', candidates: [candidate({ scKey: 'B#1', trials: [trial({ move: 'B#1 DP F→10', verdict: 'ACCEPTED', receiverPi: [1.2, null] })] })] }),
    ];
    expect(moveRows(ts)).toEqual([
      { clockText: 'D1 09:00:10', lparId: 'PROD1', receiver: 'A#1', move: 'DONOR B#1 DP 10→F', receiverPi: [2, 0.8] },
      { clockText: 'D1 09:00:20', lparId: 'PROD1', receiver: 'B#1', move: 'B#1 DP F→10', receiverPi: [1.2, null] },
    ]);
    const text = statsText(wlmStats(ts, { moves: true }));
    expect(text).toContain('D1 09:00:10  PROD1  for A#1: DONOR B#1 DP 10→F  2.00→0.80');
    expect(text).toContain('D1 09:00:20  PROD1  for B#1: B#1 DP F→10  1.20→-');
    // Without the options the sections and fields stay out (the JSON shape is unchanged).
    const plain = wlmStats(ts);
    expect('moves' in plain || 'episodes' in plain || 'byClass' in plain).toBe(false);
    expect(statsText(plain)).not.toContain('Accepted moves');
  });
});

describe('inspect … wlm-stats over a play file', () => {
  it('knows when the CLI advance stopped early (B1)', () => {
    const none = new Set<string>();
    expect(stoppedEarly(none, none)).toBe(false);
    expect(stoppedEarly(none, new Set(['2:STL004']))).toBe(true);
    expect(stoppedEarly(new Set(['2:STL004']), new Set(['2:STL004']))).toBe(false);
    expect(stoppedEarly(new Set(['2:STL004']), new Set(['2:STL004', '2:STL005']))).toBe(true);
    // A restart that clears an abend mid-advance does not stop the CLI (it only pages on a fresh abend).
    expect(stoppedEarly(new Set(['2:STL004']), none)).toBe(false);
  });

  it('replays a logged advance through a restart without stopping (PR-12)', () => {
    // Abended sets seen at the advance start and after each hour: STL004 is restarted in hour 2 and re-abends in
    // hour 3 (neither stops the CLI); STL005 abends fresh in hour 4, so the CLI stopped there.
    const seen = [['2:STL004'], ['2:STL004'], [], ['2:STL004'], ['2:STL004', '2:STL005'], [], []].map((x) => new Set(x));
    let i = 0;
    const run = (hours: number, ok = () => true) => {
      i = 0;
      return replayAdvance(hours, () => seen[i]!, () => (i++, ok()));
    };
    expect(run(6)).toBe(4);
    expect(run(3)).toBe(3);
    // The caller's own stop (end of range, day over) ends the advance at that hour.
    expect(run(6, () => i < 2)).toBe(2);
  });

  it('validates the range and keeps second precision', () => {
    let f = newPlayFile(42);
    for (const c of [{ cmd: 'start' as const }, { cmd: 'advance' as const, hours: 1 }]) {
      const out = applyPlayCommand(f, c);
      expect(out.ok, out.text).toBe(true);
      f = out.file;
    }
    expect(() => wlmStatsText(encodePlayFile(f), { to: 'garbage' })).toThrow(/times look like/);
    expect(() => wlmStatsText(encodePlayFile(f), { ladder: '12' })).toThrow(/times look like/);
    // Seconds in a bound would be floored by `tickOfClock`, so they are refused rather than silently mis-applied.
    expect(() => wlmStatsText(encodePlayFile(f), { from: 'D1 06:30:40', to: 'D1 06:31' })).toThrow(/times look like/);
    // A one-minute range is its six 10 s adjustments per system, and nothing at the upper bound.
    const stats = JSON.parse(wlmStatsText(encodePlayFile(f), { from: 'D1 06:30', to: 'D1 06:31', json: true }));
    expect(stats.total.adjustments).toBe(6 * stats.systems.length);
    // The trace at 06:31:00 belongs to the next range, not this one: adjacent minutes have the same count, so no
    // adjustment is counted twice or dropped at the boundary.
    const next = JSON.parse(wlmStatsText(encodePlayFile(f), { from: 'D1 06:31', to: 'D1 06:32', json: true }));
    expect(next.total.adjustments).toBe(stats.total.adjustments);
  });

  it('replays the log and reports the range it covered', () => {
    let f = newPlayFile(42);
    for (const c of [{ cmd: 'start' as const }, { cmd: 'advance' as const, hours: 2 }]) {
      const out = applyPlayCommand(f, c);
      expect(out.ok, out.text).toBe(true);
      f = out.file;
    }
    const text = wlmStatsText(encodePlayFile(f), { to: 'D1 08:00' });
    expect(text).toContain('WLM policy adjustment statistics');
    expect(text).toContain('adjustments');
    expect(text).toMatch(/D1 \w{3} 06:00 → D1 \w{3} 08:00/);
    // Two hours of adjustments on every system (one per 10 s tick each).
    const stats = JSON.parse(wlmStatsText(encodePlayFile(f), { to: 'D1 08:00', json: true }));
    expect(stats.total.adjustments).toBe(2 * 360 * stats.systems.length);
    // A range that starts and ends mid-hour counts only its own adjustments.
    const half = JSON.parse(wlmStatsText(encodePlayFile(f), { from: 'D1 06:30', to: 'D1 07:00', json: true }));
    expect(half.total.adjustments).toBe(30 * 60 / 10 * half.systems.length);
    // A range past the end of the log says so instead of inventing hours.
    expect(wlmStatsText(encodePlayFile(f), { to: 'D1 09:00' }))
      .toMatch(/The play log ends at D1 \w{3} 08:00; the range D1 \w{3} 09:00 is not covered\./);
    // A browser save has no log to replay.
    expect(() => wlmStatsText(encodePlayFile({ ...f, log: [] }), { to: 'D1 08:00' })).toThrow(/play-CLI file/);
  });
});

describe('inspect … wlm-stats stops where the play CLI stopped', () => {
  it('does not invent hours after an ABEND cut the logged advance (B1)', () => {
    let f = newPlayFile(42);
    const run = (c: { cmd: 'start' } | { cmd: 'advance'; hours: number } | { cmd: 'draft'; optionId: null } | { cmd: 'restart'; name: string }) => {
      const out = applyPlayCommand(f, c);
      expect(out.ok, out.text).toBe(true);
      f = out.file;
      return out;
    };
    run({ cmd: 'start' });
    run({ cmd: 'advance', hours: 24 });
    run({ cmd: 'draft', optionId: null });
    run({ cmd: 'start' });
    // Seed 42, Midwest, day 2: STL004 abends, so the CLI stops the advance 17 hours in.
    expect(run({ cmd: 'advance', hours: 24 }).text).toContain('STOPPED:');
    // One replay: the range reports that the log, not the request, ended it, and the counters cover the 41 hours the
    // CLI actually played (24 + 17), not the 48 asked for.
    const stats = JSON.parse(wlmStatsText(encodePlayFile(f), { to: 'D3 06:00', json: true }));
    expect(stats.range.covered).toBe(false);
    expect(stats.range.to).toMatch(/^D2 /);
    expect(stats.total.adjustments).toBe(stats.systems.length * 41 * 360);
    // Restarting the job clears the abend during the next advance; the CLI does not stop for that, so neither does
    // the replay: it covers all three hours (D2 23:00 → D3 02:00), not one.
    run({ cmd: 'restart', name: 'STL004' });
    expect(run({ cmd: 'advance', hours: 3 }).text).not.toContain('STOPPED:');
    const after = JSON.parse(wlmStatsText(encodePlayFile(f), { from: 'D2 22:00', to: 'D3 06:00', json: true }));
    expect(after.range.to).toBe(clockText(f.run.sim.tick));
    expect(after.total.adjustments).toBe(after.systems.length * 4 * 360);
    // About 43 played hours plus two replays: ~27 s alone, so over the 30 s default under a parallel CI load.
  }, 120_000);
});
