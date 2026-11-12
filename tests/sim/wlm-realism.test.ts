// Scenario-level checks of WLM policy adjustment (docs/wlm-design.md §5.9, SPEC §16 style).
import { MIDWEST } from '../../src/content/scenarios';
import { initState } from '../../src/sim/core/init';
import { step } from '../../src/sim/core/step';
import { TICKS_PER_DAY, TICKS_PER_HOUR } from '../../src/sim/core/units';
import { goalInfo } from '../../src/sim/wlm/runtime';
import { DP } from '../../src/sim/zos/dispatcher';
import { BASEPOL } from '../../src/content/wlm/basepol';
import { policyAdjust, setWlmTraceSink, type WlmAdjustTrace } from '../../src/sim/wlm/adjust';
import { evaluateLpar, sliceSpec } from '../../src/sim/wlm/evaluate';
import { decayInto, emptyAcc, goalPi } from '../../src/sim/wlm/runtime';

describe('donors retain their goal protection (WT-07, I5)', () => {
  it('a happy more important class is tried as a donor but is not pushed past its goal', () => {
    // SG24-6472-03 (March 2008), p.60: more important work may donate only while still meeting its goal.
    // Neither joining the receiver to HAPPY nor lowering HAPPY to the receiver can keep its velocity goal.
    const def = structuredClone(BASEPOL);
    const template = def.classes.find((c) => c.id === 'STCLO')!;
    for (const [id, importance, velocity] of [['HAPPY', 1, 80], ['RECEIVER', 3, 90]] as const) {
      def.classes.push({ ...structuredClone(template), id, cpuCritical: false,
        periods: [{ goal: { kind: 'VEL', velocity }, importance, durationSu: null }] });
    }
    const dps: Record<string, number> = { 'HAPPY#1': 246, 'RECEIVER#1': 244 };
    const evalInput = {
      cpCapacityEngines: 4, cpServers: 4, ziipCapacityEngines: 0, ziipServers: 0, cpPrsmDelayFrac: 0,
      slices: [sliceSpec({ key: 'happy', scKey: 'HAPPY#1', kind: 'AS', cpEngines: 3.5, units: 4 }),
        sliceSpec({ key: 'receiver', scKey: 'RECEIVER#1', kind: 'AS', cpEngines: 2, units: 2 })],
      backlog: {}, io: { RANDOM: { rtSec: 0, delaySec: 0 }, SEQ: { rtSec: 0, delaySec: 0 } }, pagingFrac: 0,
    };
    const current = evaluateLpar({ ...evalInput, dpOf: (k) => dps[k]! }).scps;
    const system = { lparId: 'SYS', scps: current.map((t) => ({ scKey: t.scKey, dp: dps[t.scKey]!, starvedSec: 0, acc: decayInto(emptyAcc(), t) })) };
    const happyPi = goalPi({ kind: 'VEL', velocity: 80 }, system.scps.find((s) => s.scKey === 'HAPPY#1')!.acc)!;
    expect(happyPi).toBeLessThan(1);
    const traces: WlmAdjustTrace[] = [];
    setWlmTraceSink((t) => traces.push(t));
    let out;
    try {
      out = policyAdjust({ def, system, evalInput, current, sysplexPi: {}, clockText: 'T' });
    } finally {
      setWlmTraceSink(null);
    }
    const receiver = traces[0]!.candidates.find((c) => c.scKey === 'RECEIVER#1')!;
    expect(receiver.outcome).toBe('ASSESSED');
    expect(receiver.donors).toEqual(['HAPPY#1']);
    const donor = receiver.trials.find((t) => t.move.startsWith('DONOR HAPPY#1'))!;
    expect(donor).toBeDefined();
    expect(donor.verdict).toBe('MORE_IMPORTANT_HARMED');
    expect(donor.detail).toContain('HAPPY#1');
    expect(out.dps).toEqual(dps);
    expect(out.log).not.toContain('RCVR=');
  });
});

interface Move { sec: number; who: string; from: number; to: number; line: string }

/** DP moves WLM logged on one system, in order. */
function movesOn(log: readonly string[], system: string): Move[] {
  const re = new RegExp(`^D(\\d+) (\\d\\d):(\\d\\d):(\\d\\d) ${system} RCVR=\\S+ .*?(?:DONOR )?(\\S+) DP ([0-9A-F]+)→([0-9A-F]+)$`);
  return log.flatMap((line) => {
    const m = re.exec(line);
    if (!m) return [];
    const sec = Number(m[1]) * 86400 + Number(m[2]) * 3600 + Number(m[3]) * 60 + Number(m[4]);
    return [{ sec, who: m[5]!, from: parseInt(m[6]!, 16), to: parseInt(m[7]!, 16), line }];
  });
}

/** Moves of one period that undo the direction of its previous move within `withinSec`. */
export function quickReversals(moves: readonly Move[], withinSec: number): string[] {
  const last: Record<string, Move> = {};
  const out: string[] = [];
  for (const m of moves) {
    const p = last[m.who];
    if (p && m.sec - p.sec <= withinSec && Math.sign(m.to - m.from) !== Math.sign(p.to - p.from)) out.push(`${p.line}  ⇄  ${m.line}`);
    last[m.who] = m;
  }
  return out;
}

describe('WLM does not flip a period on one quiet tick (docs/wlm-design.md W1, R-1)', () => {
  // Midwest seed 42, PROD2, day 1. Judged on one tick's PI, the second period of DDFPRD (importance 4) was moved
  // above the first (importance 2) on the one interval whose tick showed no harm, and moved back 40 s later, four
  // times in 3.5 minutes around 12:20. Judged on projections at sustained demand, and never passing more
  // important work that is missing its goal, no period is moved one way and back within two minutes.
  it('no DP move on PROD2 is undone by the same period\'s next move within two minutes (06:00–14:00)', () => {
    let s = initState(42, MIDWEST);
    const log: string[] = [];
    let seen = s.wlm.log;
    for (let t = 0; t < 8 * 360; t++) {
      s = step(s, [], MIDWEST);
      if (s.wlm.log === seen) continue;
      const lastSeen = seen[seen.length - 1];
      const from = lastSeen === undefined ? 0 : s.wlm.log.lastIndexOf(lastSeen) + 1;
      log.push(...s.wlm.log.slice(from));
      seen = s.wlm.log;
    }
    const moves = movesOn(log, 'PROD2');
    expect(moves.length).toBeGreaterThan(0); // WLM did have work to do
    expect(quickReversals(moves, 120)).toEqual([]);
  }, 240_000);
});

describe('the ladder does not collapse (docs/wlm-design.md W2, S-4; WT-06)', () => {
  // Midwest seed 42, eight days. Before the canonical ladder, receivers moved to an occupied level + 1 and nothing
  // spread or lowered the ladder, so it climbed to the top managed priority: PROD2's seven goal periods of importance
  // 1 to 4 sat on three adjacent levels from day 2, five of them sharing 252 on day 4.
  it('PROD2 at D8 12:00 has its goal periods on at least four levels and nothing at MANAGED_MAX', () => {
    let s = initState(42, MIDWEST);
    const at = 7 * TICKS_PER_DAY + 12 * TICKS_PER_HOUR;
    while (s.tick < at) s = step(s, [], MIDWEST);
    const prod2 = s.wlm.systems.find((x) => x.lparId === 'PROD2')!;
    const goal = prod2.scps.filter((p) => {
      const g = goalInfo(s.wlm.definition, p.scKey);
      return g !== null && g.goal.kind !== 'DISC';
    });
    expect(goal.length).toBeGreaterThanOrEqual(7);
    expect(new Set(goal.map((p) => p.dp)).size).toBeGreaterThanOrEqual(4);
    expect(goal.every((p) => p.dp < DP.MANAGED_MAX)).toBe(true);
  }, 300_000);
});
