import { POLICY_ADJUST } from '../../src/content/wlm/tuning';
import { sliceSpec } from '../../src/sim/wlm/evaluate';
import { demandUplift, projectionInput } from '../../src/sim/wlm/projection';
import { ACC_DECAY, emptyAcc, type ScpState } from '../../src/sim/wlm/runtime';

const IO = { RANDOM: { rtSec: 0.0008, delaySec: 0.0002 }, SEQ: { rtSec: 0.0006, delaySec: 0.0001 } };
const txn = (key: string, scKey: string, cp: number, zi = 0, timeoutSec = Infinity) => sliceSpec({ key, scKey, kind: 'TXN', timeoutSec, rate: 100, cpEngines: cp, ziipEngines: zi, cpuSecPerTxn: cp / 100, ziipSecPerTxn: zi / 100, goalRtSec: 0.2 });
/** A period whose accumulator has settled at `engines` of arriving demand. */
const scp = (scKey: string, cp: number, zi = 0): ScpState => ({ scKey, dp: 240, starvedSec: 0, acc: { ...emptyAcc(), demandCp: cp / (1 - ACC_DECAY), demandZi: zi / (1 - ACC_DECAY) } });
const base = (slices: ReturnType<typeof txn>[], backlog: Record<string, number> = {}, ziipBacklog?: Record<string, number>) => ({
  cpCapacityEngines: 4, cpServers: 4, ziipCapacityEngines: 2, ziipServers: 2, cpPrsmDelayFrac: 0, slices, backlog, ...(ziipBacklog ? { ziipBacklog } : {}), io: IO, pagingFrac: 0.1, capOf: () => 3,
});

describe('WLM projection input: sustained demand (docs/wlm-design.md §5.4)', () => {
  it('lifts a quiet tick to the smoothed demand, never lowers a busy one, and caps the lift', () => {
    const slices = [txn('a', 'A#1', 1), txn('b', 'B#1', 3), txn('c', 'C#1', 0.1)];
    const f = demandUplift(slices, [scp('A#1', 1.5), scp('B#1', 2), scp('C#1', 5)], POLICY_ADJUST);
    expect(f['A#1']).toBeCloseTo(1.5, 9); // smoothed 1.5 over a tick of 1
    expect(f['B#1']).toBeUndefined(); // the tick is above the smoothed demand: believed at once
    expect(f['C#1']).toBe(POLICY_ADJUST.demandUpliftMax);
    const p = projectionInput(base(slices), [scp('A#1', 1.5), scp('B#1', 2), scp('C#1', 5)], POLICY_ADJUST);
    expect(p.slices[0]).toMatchObject({ cpEngines: 1.5, rate: 150, cpuSecPerTxn: 0.01 });
    expect(p.slices[1]).toBe(slices[1]);
    expect(p.slices[2]!.cpEngines).toBeCloseTo(0.2, 9);
  });

  it('returns the same input when nothing is lifted or bounded', () => {
    const i = base([txn('a', 'A#1', 1, 0.5)]);
    expect(projectionInput(i, [scp('A#1', 1, 0.5)], POLICY_ADJUST)).toBe(i);
    // A period seen for the first time (no demand history) is not lifted.
    expect(projectionInput(i, [{ scKey: 'A#1', acc: emptyAcc() }], POLICY_ADJUST)).toBe(i);
  });

  it('bounds a backlog to a boost over the sustained demand and scales its zIIP part alike', () => {
    const slices = [txn('a', 'A#1', 1, 1)];
    const i = base(slices, { a: 400 }, { a: 100 });
    const p = projectionInput(i, [scp('A#1', 1, 1)], POLICY_ADJUST);
    const bound = POLICY_ADJUST.backlogBoostFrac * 2 * 10;
    expect(p.backlog.a).toBeCloseTo(bound, 9);
    expect(p.ziipBacklog!.a).toBeCloseTo((100 * bound) / 400, 9);
    // A backlog under the bound is left alone.
    expect(projectionInput(base(slices, { a: bound / 2 }), [scp('A#1', 1, 1)], POLICY_ADJUST).backlog.a).toBe(bound / 2);
  });

  it('keeps the transaction timeout, as execution does (a PI without it has no upper scale)', () => {
    const slices = [txn('a', 'A#1', 1, 0, 30)];
    const p = projectionInput(base(slices), [scp('A#1', 2)], POLICY_ADJUST);
    expect(p.slices[0]!.timeoutSec).toBe(30);
  });

  it('never lifts fixed (batch) slices and leaves caps, I/O, paging and capacity untouched', () => {
    const batch = sliceSpec({ key: 'BATCH:B#1@X', scKey: 'B#1', kind: 'AS', cpEngines: 1, units: 2 });
    const i = base([txn('a', 'A#1', 1), batch], { a: 400 });
    const p = projectionInput(i, [scp('A#1', 2), scp('B#1', 3)], POLICY_ADJUST, new Set([batch.key]));
    expect(p.slices[1]).toBe(batch);
    expect(p.slices[0]!.cpEngines).toBe(2);
    for (const k of ['cpCapacityEngines', 'cpServers', 'ziipCapacityEngines', 'ziipServers', 'io', 'pagingFrac', 'capOf'] as const) expect(p[k]).toBe(i[k]);
    expect(i.slices[0]!.cpEngines).toBe(1); // the input is not mutated
    expect(i.backlog.a).toBe(400);
  });
});
