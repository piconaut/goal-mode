import { evaluateLpar, sliceSpec } from '../../src/sim/wlm/evaluate';
import { emptyScpTick } from '../../src/sim/wlm/evaluate';
import { tickPi } from '../../src/sim/wlm/runtime';

const io = { RANDOM: { rtSec: 0, delaySec: 0 }, SEQ: { rtSec: 0, delaySec: 0 } };
const goal = { kind: 'VEL' as const, velocity: 60 };

describe('velocity samples under CPU starvation (WT-16, RMF Report Analysis p.539–540)', () => {
  const run = (dp: number, cp = 0.2, zi = 0.05, units = 30, ziipCapacityEngines = 1, mayOverflow = true, rivalZi = 0) => evaluateLpar({
    cpCapacityEngines: 1, cpServers: 1, ziipCapacityEngines, ziipServers: ziipCapacityEngines > 0 ? 1 : 0,
    cpPrsmDelayFrac: 0, io, pagingFrac: 0, backlog: {},
    slices: [sliceSpec({ key: 'A', scKey: 'A#1', kind: 'AS', cpEngines: cp, ziipEngines: zi, units, mayOverflow }),
      sliceSpec({ key: 'H', scKey: 'H#1', kind: 'TXN', cpEngines: 2, ziipEngines: rivalZi, mayOverflow: false })],
    dpOf: k => k === 'A#1' ? dp : 200,
  });

  it('improves velocity when joining a saturated level restores CP service with continuing zIIP use', () => {
    const below = run(199), joined = run(200), above = run(201);
    expect(below.slices[0]!.cpGranted).toBe(0);
    expect(joined.slices[0]!.cpGranted).toBeCloseTo(0.2, 12);
    expect(joined.slices[0]!.ziipGranted).toBeCloseTo(below.slices[0]!.ziipGranted, 12);
    expect(joined.slices[0]!.queueRatio).toBe(below.slices[0]!.queueRatio);
    expect(tickPi(goal, joined.scps[0]!)!).toBeLessThan(tickPi(goal, below.scps[0]!)!);
    expect(tickPi(goal, above.scps[0]!)!).toBeLessThan(tickPi(goal, joined.scps[0]!)!);
    expect(joined.slices[0]!.delayCpu).toBeLessThan(below.slices[0]!.delayCpu);
  });

  it('never worsens PI on a raise across fixed demands, ready counts and overflow settings', () => {
    for (const cp of [0.01, 0.2, 1.5]) for (const zi of [0.005, 0.05, 0.5])
      for (const units of [2, 12, 30]) for (const ziCapacity of [0, 1]) for (const overflow of [false, true]) for (const rivalZi of [0, 2]) {
        const rows = [199, 200, 201].map(dp => run(dp, cp, zi, units, ziCapacity, overflow, rivalZi));
        for (let i = 1; i < rows.length; i++) {
          const prev = rows[i - 1]!, next = rows[i]!;
          const pi = tickPi(goal, next.scps[0]!)!;
          expect(pi).toBeLessThanOrEqual(tickPi(goal, prev.scps[0]!)! + 1e-9);
          const s = next.slices[0]!;
          expect(s.usingCpu + s.usingZiip + s.delayCpu + s.delayZiip).toBeLessThanOrEqual(units + 1e-9);
        }
      }
  });

  it('preserves projected velocity gains hidden by the reported PI ceiling', () => {
    const before = { ...emptyScpTick('A#1', 200), usingCpu: 0.05, delayCpu: 20 };
    const after = { ...before, usingCpu: 0.08, delayCpu: 19.97 };
    expect(tickPi(goal, before)).toBe(99);
    expect(tickPi(goal, after)).toBe(99);
    expect(tickPi(goal, after, Infinity)!).toBeLessThan(tickPi(goal, before, Infinity)!);
    // Keep the existing 0.1% velocity floor: no Infinity/NaN in gain and harm arithmetic at zero service.
    const starved = { ...before, usingCpu: 0 };
    expect(Number.isFinite(tickPi(goal, starved, Infinity))).toBe(true);
    expect(tickPi(goal, emptyScpTick('A#1', 200), Infinity)).toBeNull();
  });
});
