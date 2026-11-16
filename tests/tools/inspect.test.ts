import { applyPlayCommand, catalogText, clockText, encodePlayFile, newPlayFile, type PlayCommand, type PlayFile } from '../../tools/playCore';
import { classRows, moveRows, replayAdvance, statsText, stoppedEarly, wlmStats, wlmStatsText } from '../../tools/inspect';
import type { WlmAdjustTrace, WlmCandidateTrace, WlmTrialTrace } from '../../src/sim/wlm/adjust';
import { TICKS_PER_HOUR } from '../../src/sim/core/units';

const trial = (over: Partial<WlmTrialTrace> = {}): WlmTrialTrace => ({
  move: 'A#1 DP 20→21', verdict: 'NO_RECEIVER_GAIN', receiverPi: [1.4, 1.3], ...over,
});

const candidate = (over: Partial<WlmCandidateTrace> = {}): WlmCandidateTrace => ({
  scKey: 'A#1', importance: 2, sysplexPi: null, localPi: 1.4, dp: 0x20, bottleneck: 'CPU',
  delayShares: { CPU: 1, ZIIP: 0, IO: 0, STORAGE: 0, QUEUE: 0, CAP: 0, OTHER: 0 }, outcome: 'ASSESSED', trials: [], ...over,
});

const trace = (over: Partial<WlmAdjustTrace> = {}): WlmAdjustTrace => ({
  clockText: 'D1 06:00:00', lparId: 'PROD1', dps: { 'A#1': 0x20, 'B#1': 0x10 }, candidates: [], action: null, protection: [], ...over,
});

describe('wlmStats counts the audit table (WT-01)', () => {
  it('counts atomic plans, retained steps and projections separately; canonical renumbering does not reverse UP', () => {
    const steps: NonNullable<WlmTrialTrace['plan']> = [
      { kind: 'UP', scKey: 'A#1', fromDp: 246, toDp: 246, above: 'B#1' },
      { kind: 'CARRY', scKey: 'B#1', fromDp: 244, toDp: 246 },
    ];
    const rows = [
      trace({ dps: { 'A#1': 246, 'B#1': 246, 'C#1': 246 }, candidates: [candidate({ trials: [
        trial({ verdict: 'RETAINED', projected: true }),
        trial({ verdict: 'ACCEPTED', projected: true, plan: steps, afterDps: { 'A#1': 246, 'B#1': 246, 'C#1': 244 } }),
      ] })] }),
      trace({ dps: { 'A#1': 246, 'B#1': 246, 'C#1': 244 }, candidates: [candidate({ trials: [
        trial({ verdict: 'ACCEPTED', projected: true, plan: [steps[0]!], afterDps: { 'A#1': 246, 'B#1': 244, 'C#1': 242 } }),
      ] })] }),
    ];
    const total = wlmStats(rows).total;
    expect(total.projections).toBe(3);
    expect(total.acceptedPlans).toBe(2);
    expect(total.acceptedSteps).toBe(3);
    expect(total.acceptedCarry).toBe(1);
    expect(total.reversed).toBe(0);
    expect(total.rejectedPiUnder09).toBe(0);
  });

  const busy = trace({
    candidates: [
      candidate({ scKey: 'IO#1', outcome: 'NOT_FIXABLE', bottleneck: 'IO' }),
      candidate({ scKey: 'STO#1', outcome: 'NOT_FIXABLE', bottleneck: 'STORAGE' }),
      candidate({ scKey: 'QUE#1', outcome: 'NOT_FIXABLE', bottleneck: 'QUEUE', waitingFrac: 0.7 }),
      candidate({ scKey: 'WAI#1', outcome: 'NO_MANAGED_DELAY', waitingFrac: 0.8 }),
      candidate({ scKey: 'CAP#1', outcome: 'NO_MANAGED_DELAY', waitingFrac: 0.1 }),
      candidate({ scKey: 'BUD#1', outcome: 'BUDGET' }),
      candidate({ scKey: 'REC#1', outcome: 'RECOVERING', waitingFrac: 0.8 }),
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
    expect(stats.total.notFixable).toEqual({ IO: 1, STORAGE: 1, QUEUE: 1 });
    expect(stats.total.noManagedDelay).toBe(2);
    expect(stats.total.waitingNoDelay).toBe(1);
    expect(stats.total.waitingNotFixable).toBe(1);
    expect(stats.total.waitingRecovering).toBe(1);
    expect(stats.total.budget).toBe(1);
    expect(stats.total.recovering).toBe(1);
    expect(stats.total.trials).toBe(7);
    expect(stats.total.verdicts).toEqual({
      ACCEPTED: 3, RETAINED: 0, CPU_CRITICAL: 1, NO_RECEIVER_GAIN: 0, SMALL_GAIN: 1, MORE_IMPORTANT_HARMED: 1, EQUAL_DISPARITY: 0, NO_NET_VALUE: 1, PROJECTION_DISAGREES: 0,
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

  it('I13: a reversal within two minutes after another receiver projected the period past its goal is counted apart', () => {
    // C#1's plan in between projects A#1 at 25 (S-3 PRDD D3 11:35:30); at 1.0, its goal, it would not count.
    const harm = (pi: number) => trace({ candidates: [candidate({ scKey: 'C#1', trials: [trial({ move: 'C#1 DP 10→11', verdict: 'ACCEPTED', afterPis: { 'A#1': pi, 'C#1': 0.5 } })] })] });
    expect(wlmStats([busy, harm(25), reversed]).total).toMatchObject({ reversed: 1, reversedWithin2Min: 0, reversedAfterHarm: 1 });
    expect(wlmStats([busy, harm(1), reversed]).total).toMatchObject({ reversed: 1, reversedWithin2Min: 1, reversedAfterHarm: 0 });
    // Harm before the period's own first move does not excuse the reversal.
    expect(wlmStats([harm(25), busy, reversed]).total).toMatchObject({ reversedWithin2Min: 1, reversedAfterHarm: 0 });
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

  it('a donor-only plan helps its primary receiver without ending the donor\'s own episode', () => {
    const rows = Array.from({ length: 30 }, (_, i) => trace({ candidates: [
      candidate({ trials: i === 15 ? [trial({ verdict: 'ACCEPTED', plan: [{ kind: 'DONOR', scKey: 'B#1', fromDp: 246, toDp: 244 }] })] : [trial()] }),
      candidate({ scKey: 'B#1', trials: [trial()] }),
    ] }));
    expect(wlmStats(rows, { episodes: true }).episodes?.map((e) => e.scKey)).toEqual(['B#1']);
    expect(classRows(rows).map((c) => [c.scKey, c.helped])).toEqual([['A#1', 1], ['B#1', 0]]);
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
  it('prints the complete committed plan rather than just its final proposal', () => {
    const plan: NonNullable<WlmTrialTrace['plan']> = [
      { kind: 'UP', scKey: 'A#1', fromDp: 244, toDp: 246 },
      { kind: 'CARRY', scKey: 'B#1', fromDp: 244, toDp: 246 },
      { kind: 'DONOR', scKey: 'D#1', fromDp: 246, toDp: 244 },
      { kind: 'UP', scKey: 'A#1', fromDp: 246, toDp: 246, above: 'B#1' },
    ];
    const ts = [trace({ candidates: [candidate({ trials: [trial({
      move: 'UP A#1 DP F6→F6 (above B#1)', verdict: 'ACCEPTED', plan,
    })] })] })];
    expect(moveRows(ts)[0]!.move).toBe('UP A#1 DP F4→F6; CARRY B#1 DP F4→F6; DONOR D#1 DP F6→F4; UP A#1 DP F6→F6 (above B#1)');
    expect(statsText(wlmStats(ts, { moves: true }))).toContain('CARRY B#1 DP F4→F6; DONOR D#1 DP F6→F4');
  });

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
  // Both tests read one played log: the 15 hours to the abend are the expensive part, so they are played once and
  // each test replays the same file for its own claim. Built in a hook, so a failure names the fixture rather than
  // whichever test asked for it first.
  interface Played {
    /** The file where the CLI stopped at the abend (D1 21:00, 15 hours in). */
    atStop: PlayFile;
    /** The file after the restart and the three hours that followed. */
    final: PlayFile;
    after: string;
    abended: string;
    stopTick: number;
  }
  let played!: Played;
  const playToAbend = (): Played => {
    let f = newPlayFile(7);
    const run = (c: Extract<PlayCommand, { cmd: 'start' | 'advance' | 'restart' | 'change' }>) => {
      const out = applyPlayCommand(f, c);
      expect(out.ok, out.text).toBe(true);
      f = out.file;
      return out;
    };
    // A Db2 job that starts on an image without a Db2 subsystem abends at connect (DSNE100I, Db2 13 Messages p.140;
    // src/sim/subsys/batch.ts). Class A runs on PROD1/PROD2 only, so giving it initiators on SYSP (no Db2) abends the
    // first stream it starts in the first batch night — an ordinary change, not a 41-hour wait for the day-2 card.
    const classA = (initiators: Record<string, number>) => run({ cmd: 'change', req: { label: `Class A initiators on ${Object.keys(initiators).join(' ') || 'none'}`, commands: [{ kind: 'SET_JOB_CLASS', jobClass: 'A', initiators }] } });
    run({ cmd: 'start' });
    // Live, so these are emergency changes: 1 h each from the day's 8, a trust cost, and a seeded 3 % chance of
    // failing (labelled by their text). Planned in the briefing instead, seed 7's 06:00 apply fails, so keep them here.
    classA({ PROD1: 12, PROD2: 10, SYSP: 8 });
    // Seed 7, Midwest: the first class-A job on SYSP abends at 21:00, so the CLI stops the 24-hour advance 15 hours in.
    const stopped = run({ cmd: 'advance', hours: 24 }).text;
    expect(stopped).toContain('STOPPED:');
    const abended = /STOPPED: (\S+)/.exec(stopped)![1]!;
    const atStop = f;
    const stopTick = f.run.sim.tick;
    // Restarting the job and taking the initiators back off SYSP clears the cause; the next advance runs through.
    run({ cmd: 'restart', name: abended });
    classA({ PROD1: 12, PROD2: 10 });
    const after = run({ cmd: 'advance', hours: 3 }).text;
    return { atStop, final: f, after, abended, stopTick };
  };

  beforeAll(() => {
    played = playToAbend();
  });

  it('does not invent hours after an ABEND cut the logged advance (B1)', () => {
    const p = played;
    // One replay of where the CLI stopped: the range reports that the log, not the request, ended it, and the
    // counters cover the 15 hours the CLI actually played, not the 24 asked for.
    const stats = JSON.parse(wlmStatsText(encodePlayFile(p.atStop), { to: 'D2 06:00', json: true }));
    expect(stats.range.covered).toBe(false);
    expect(stats.range.to).toBe('D1 Mon 21:00');
    expect(stats.total.adjustments).toBe(stats.systems.length * 15 * 360);
    // The restart has to be checked directly: the pass-through also holds with the initiator change alone.
    expect(p.after).not.toContain('STOPPED:');
    expect(p.final.run.sim.tick - p.stopTick).toBe(3 * TICKS_PER_HOUR); // all three hours ran, not one
    // The restarted job is no longer abended; the other jobs that abended on SYSP still are.
    expect(catalogText(p.final)).not.toContain(`abended now: ${p.abended}`);
    // 15 played hours plus one replay of the same log: ~12-15 s alone on the shared host (was 43 s for 41 hours
    // and two replays). The restart coverage the second replay used to give is the test below.
  }, 120_000);

  it('replays a log that restarts the abended job without stopping there', () => {
    const p = played;
    // The replay crosses the restart: it reaches the CLI's own clock (midnight) rather than stopping at the 21:00
    // abend, and counts all 18 played hours across the restart. replayAdvance's stop rule around a restart has an
    // injected test (PR-12); this is the one that runs replayTraces over a log that restarts.
    const stats = JSON.parse(wlmStatsText(encodePlayFile(p.final), { to: 'D2 06:00', json: true }));
    expect(stats.range.to).toBe(clockText(p.final.run.sim.tick));
    // All four images reported, so the count below cannot shrink with a lost system.
    expect(stats.systems.map((x: { lparId: string }) => x.lparId).sort()).toEqual(['DEVT', 'PROD1', 'PROD2', 'SYSP']);
    expect(stats.total.adjustments).toBe(stats.systems.length * 18 * 360);
  }, 120_000);
});
