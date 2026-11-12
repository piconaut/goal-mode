import { POLICY_ADJUST } from '../../src/content/wlm/tuning';
import type { WlmAdjustTrace } from '../../src/sim/wlm/adjust';
import { addTrace, candidateDump, dumpDay, emptyHour } from '../../tools/botTrace';
import { planSweep } from '../../tools/ci/sweepPlan';
import { REPRO_RUNS, reproFile } from '../../tools/repro';
import { applyTune, parseTune } from '../../tools/tune';

describe('--tune (tools/tune.ts)', () => {
  it('parses key=number pairs against POLICY_ADJUST', () => {
    expect(parseTune('rejectedSkipTicks=0,maxProjectionsPerInterval=24,harmEps=0.05')).toEqual({ rejectedSkipTicks: 0, maxProjectionsPerInterval: 24, harmEps: 0.05 });
  });

  it('refuses unknown keys, bad values and a tunable the sim reads only at load', () => {
    expect(() => parseTune('rejectedSkipTick=0')).toThrow(/no numeric POLICY_ADJUST.rejectedSkipTick/);
    expect(() => parseTune('rejectedSkipTicks=x')).toThrow(/key=number/);
    expect(() => parseTune('rejectedSkipTicks=1;rm')).toThrow(/key=number/);
    expect(() => parseTune('accDecay=0.5')).toThrow(/read once at load/);
  });

  it('applies the overrides in this process', () => {
    const was = POLICY_ADJUST.rejectedSkipTicks;
    try {
      expect(applyTune('rejectedSkipTicks=2')).toEqual({ rejectedSkipTicks: 2 });
      expect(POLICY_ADJUST.rejectedSkipTicks).toBe(2);
    } finally {
      POLICY_ADJUST.rejectedSkipTicks = was;
    }
  });

  it('passes through the remote sweep plan, with the same value rule', () => {
    expect(planSweep('--bots expert --seeds 1-2 --tune rejectedSkipTicks=0,harmEps=0.05').args).toBe('--bots expert --tune rejectedSkipTicks=0,harmEps=0.05');
    expect(() => planSweep('--tune rejectedSkipTicks=$(id)')).toThrow(/bad value/);
    expect(() => planSweep('--tune rejectedSkipTicks')).toThrow(/bad value/);
  });
});

describe('bot WLM tracing (tools/botTrace.ts)', () => {
  const t: WlmAdjustTrace = {
    clockText: 'D29 10:00:10', lparId: 'PRDA', dps: { 'A#1': 0xfc }, action: null, protection: [],
    candidates: [{
      scKey: 'A#1', importance: 1, sysplexPi: 2.5, localPi: 3, dp: 0xfc, bottleneck: 'CPU', basePi: 2.8, managedDelayFrac: 0.4,
      delayShares: { CPU: 0.9, ZIIP: 0, IO: 0.1, CAP: 0, OTHER: 0 }, outcome: 'ASSESSED', skipUntilTick: 1234,
      trials: [
        { move: 'DONOR B#1 DP FC→FB', verdict: 'NO_RECEIVER_GAIN', receiverPi: [2.8, 2.8] },
        { move: 'A#1 DP FC→FD', verdict: 'ACCEPTED', receiverPi: [2.8, 0.9] },
      ],
    }],
  };

  it('dumps candidates and trials, and finds the day a dump prefix names', () => {
    expect(candidateDump(t)).toEqual([
      '## PRDA D29 10:00:10',
      '   A#1 imp1 plex 2.50 loc 3.00 dp FC ASSESSED base 2.80 mdf 0.400 [CPU90 ZIIP0 IO10 CAP0 OTHER0] clock→1234',
      '      DONOR B#1 DP FC→FB NO_RECEIVER_GAIN 2.80→2.80',
      '      A#1 DP FC→FD ACCEPTED 2.80→0.90',
    ]);
    expect(dumpDay('PRDA D29 10:0')).toBe(29);
    expect(dumpDay('PRDA')).toBeNull();
  });

  it('collects an hour of outcomes and accepted moves', () => {
    const h = emptyHour();
    addTrace(h, t);
    addTrace(h, { ...t, clockText: 'D29 10:00:20' });
    expect(h.outcomes).toEqual({ 'PRDA ASSESSED': 2 });
    expect(h.moves).toEqual(['D29 10:00:10 PRDA for A#1: A#1 DP FC→FD 2.80→0.90', 'D29 10:00:20 PRDA for A#1: A#1 DP FC→FD 2.80→0.90']);
  });
});

describe('npm run repro (tools/repro.ts)', () => {
  it('names the audit runs of docs/wlm-design.md §1', () => {
    expect(REPRO_RUNS).toEqual({ 'S-1': { scenario: 'midwest', days: 2 }, 'S-2': { scenario: 'revenue', days: 3 }, 'S-3': { scenario: 'harbourline', days: 3 } });
  });

  it('logs the CLI recipe: new, then start, advance 24 until the day ends, draft none', () => {
    const f = reproFile({ scenario: 'revenue', days: 1 });
    expect(f.log[0]).toEqual({ cmd: 'new', seed: 42, difficulty: 'NORMAL', scenario: 'revenue' });
    const rest = f.log.slice(1);
    expect(rest[0]).toEqual({ cmd: 'start' });
    expect(rest.at(-1)).toEqual({ cmd: 'draft', optionId: null });
    expect(rest.slice(1, -1).every((c) => c.cmd === 'advance' && c.hours === 24)).toBe(true);
    expect(f.run.phase).toBe('BRIEFING');
    expect(f.run.day).toBe(1);
  }, 60_000);
});
