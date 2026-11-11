import { POLICY_ADJUST } from '../../src/content/wlm/tuning';
import { evaluateLpar, sliceSpec } from '../../src/sim/wlm/evaluate';
import { demandUplift, projectionInput } from '../../src/sim/wlm/projection';
import { ACC_DECAY, decayInto, emptyAcc, type ScpState } from '../../src/sim/wlm/runtime';
import type { ScpTick } from '../../src/sim/wlm/evaluate';

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

  it('seeds a new or old-save accumulator at steady state, then decays it (demand and zIIP engines)', () => {
    const tick = { completions: 0, rtSumSec: 0, buckets: [], using: 1, delay: 0, delayCpu: 0, delayZiip: 0, delayIo: 0, delayOther: 0, delayCap: 0, cpEngines: 1, iipcpEngines: 0, ziipEngines: 0.5, demandCp: 1.2, demandZi: 0.6 } as unknown as ScpTick;
    const first = decayInto(emptyAcc(), tick);
    expect(first.demandCp! * (1 - ACC_DECAY)).toBeCloseTo(1.2, 9);
    expect(first.demandZi! * (1 - ACC_DECAY)).toBeCloseTo(0.6, 9);
    expect(first.ziipEngines! * (1 - ACC_DECAY)).toBeCloseTo(0.5, 9);
    const quiet = decayInto(first, { ...tick, ziipEngines: 0, demandCp: 0, demandZi: 0 });
    expect(quiet.ziipEngines).toBeCloseTo(first.ziipEngines! * ACC_DECAY, 9);
    expect(quiet.demandCp).toBeCloseTo(first.demandCp! * ACC_DECAY, 9);
  });

  it('never lifts a running batch slice on any image, and keeps it out of sustained demand (no zIIP needed)', () => {
    // A batch job's slice carries `fixedDemand`; a CP-only image passes no batch recovery list.
    const job = sliceSpec({ key: 'BATCH:X#1@P', scKey: 'X#1', kind: 'AS', cpEngines: 1, fixedDemand: true });
    const as = sliceSpec({ key: 'x', scKey: 'X#1', kind: 'AS', cpEngines: 1 });
    // The period's smoothed demand has 3 engines of non-batch work (the job is not in it).
    const p = projectionInput({ ...base([]), ziipCapacityEngines: 0, ziipServers: 0, slices: [job, as] }, [scp('X#1', 3)], POLICY_ADJUST);
    expect(p.slices[0]).toBe(job);
    expect(p.slices[1]!.cpEngines).toBeCloseTo(POLICY_ADJUST.demandUpliftMax, 9);
    // At rest the accounting's demand is the non-batch work only, so nothing is lifted.
    const tick = evaluateLpar({ ...base([]), ziipCapacityEngines: 0, ziipServers: 0, slices: [{ ...job, cpEngines: 3 }, as], dpOf: () => 240 }).scps[0]!;
    expect(tick.demandCp).toBeCloseTo(1, 9);
    const settled: ScpState = { scKey: 'X#1', dp: 240, starvedSec: 0, acc: decayInto(emptyAcc(), tick) };
    const rest = projectionInput({ ...base([]), ziipCapacityEngines: 0, ziipServers: 0, slices: [{ ...job, cpEngines: 3 }, as] }, [settled], POLICY_ADJUST);
    expect(rest.slices.map((x) => x.cpEngines)).toEqual([3, 1]);
  });
});

