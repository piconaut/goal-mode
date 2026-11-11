import { applyPlayCommand, encodePlayFile, newPlayFile } from '../../tools/playCore';
import { statsText, wlmStats, wlmStatsText } from '../../tools/inspect';
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
      candidate({
        trials: [
          trial({ move: 'A#1 DP 20→21', verdict: 'ACCEPTED' }),
          trial({ move: 'DONOR B#1 DP 10→F', verdict: 'ACCEPTED' }),
          trial({ verdict: 'MORE_IMPORTANT_HARMED', receiverPi: [0.8, 0.8] }),
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
    expect(stats.total.trials).toBe(6);
    expect(stats.total.verdicts).toEqual({
      ACCEPTED: 3, CPU_CRITICAL: 0, NO_RECEIVER_GAIN: 0, SMALL_GAIN: 1, MORE_IMPORTANT_HARMED: 1, EQUAL_DISPARITY: 0, NO_NET_VALUE: 1,
    });
    expect(stats.total.acceptedReceiverUp).toBe(2);
    expect(stats.total.acceptedDonor).toBe(1);
    // The own-tick PI the trial was judged on: one at 0.8, one null, one at 1.5.
    expect(stats.total.rejectedPiUnder09).toBe(1);
    expect(stats.total.rejectedPiNull).toBe(1);
    // A#1 went up in `busy` and down in `reversed`.
    expect(stats.total.reversed).toBe(1);
    expect(stats.systems.map((s) => [s.lparId, s.counters.adjustments, s.counters.trials])).toEqual([
      ['PROD1', 3, 6],
      ['PROD2', 1, 0],
    ]);
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
      { lparId: 'PROD1', lines: ['D1 12:00:50  A#1=21 B#1=10', 'D2 11:59:50  A#1=40 B#1=10'] },
    ]);
    expect(text).toContain('DP ladder at 12:00 each played day (hex, highest first)');
  });
});

describe('inspect … wlm-stats over a play file', () => {
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
    // A browser save has no log to replay.
    expect(() => wlmStatsText(encodePlayFile({ ...f, log: [] }), { to: 'D1 08:00' })).toThrow(/play-CLI file/);
  });
});
