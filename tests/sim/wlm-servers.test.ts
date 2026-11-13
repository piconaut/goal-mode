// Server periods (WT-09, docs/wlm-design.md §5.1, §5.8): the TRANSACTION regions and the CICS transactions of an image
// are dispatched at one internal service class period's DP, `$SRMS001`; the served classes are its goal receivers and
// donors (SG24-6472-03 p.62–63, p.86–89; WLM Services p.136–138).
import { BASEPOL } from '../../src/content/wlm/basepol';
import { policyAdjust, setWlmTraceSink, type WlmAdjustTrace } from '../../src/sim/wlm/adjust';
import { evaluateLpar, sliceSpec, type LparEvalInput } from '../../src/sim/wlm/evaluate';
import { holderOf, holderTopology, SERVER_KEY } from '../../src/sim/wlm/holders';
import { buildPlan } from '../../src/sim/wlm/plan';
import { decayInto, emptyAcc, placeLateDp, placeNewPeriods, type WlmSystemState } from '../../src/sim/wlm/runtime';
import { explainWlmLog } from '../../src/game/mon3';
import type { ServiceDefinition } from '../../src/sim/wlm/types';

const IO = { RANDOM: { rtSec: 0.0008, delaySec: 0.0002 }, SEQ: { rtSec: 0.0006, delaySec: 0.0001 } };
const REGIONS = { keys: ['ONLHI#1', 'ONLMED#1'], mode: 'TRANSACTION' as const, regionKey: 'STCHI#1', serverKey: SERVER_KEY, servers: ['aor'] };

/** BASEPOL with ONLMED at importance 3 (a less important class in the same regions) and goals set per test. */
function policy(hiRtSec: number, medRtSec: number): ServiceDefinition {
  const def = structuredClone(BASEPOL);
  def.classes.find((c) => c.id === 'ONLHI')!.periods = [{ goal: { kind: 'PCT', pct: 90, rtSec: hiRtSec }, importance: 1, durationSu: null }];
  def.classes.find((c) => c.id === 'ONLMED')!.periods = [{ goal: { kind: 'PCT', pct: 90, rtSec: medRtSec }, importance: 3, durationSu: null }];
  return def;
}

const cics = (key: string, scKey: string, cp: number, goalRtSec: number) =>
  sliceSpec({ key, scKey, kind: 'TXN', workloadId: key, rate: 200, cpEngines: cp, cpuSecPerTxn: cp / 200, baseLatencySec: 0.02, rtSigma: 0.4, goalRtSec, timeoutSec: 30 });

const rtGoal = (def: ServiceDefinition, id: string) => {
  const g = def.classes.find((c) => c.id === id)!.periods[0]!.goal;
  return g.kind === 'PCT' ? g.rtSec : 0.2;
};

/** Two CICS classes in the same regions below production batch on a 2-engine image. */
function image(def: ServiceDefinition = policy(0.2, 0.2), regions: LparEvalInput['regions'] = REGIONS) {
  const slices = [
    cics('hi', 'ONLHI#1', 0.5, rtGoal(def, 'ONLHI')),
    cics('med', 'ONLMED#1', 0.5, rtGoal(def, 'ONLMED')),
    sliceSpec({ key: 'aor', scKey: 'STCHI#1', kind: 'AS', role: 'CICS.AOR', jobname: 'AOR', cpEngines: 0.05, units: 1 }),
    sliceSpec({ key: 'mq', scKey: 'STCHI#1', kind: 'AS', role: 'MQ.MSTR', jobname: 'MQ', cpEngines: 0.05, units: 1 }),
    sliceSpec({ key: 'bat', scKey: 'BATCHPRD#1', kind: 'AS', cpEngines: 1.6, units: 6 }),
  ];
  return { cpCapacityEngines: 2, cpServers: 2, ziipCapacityEngines: 0, ziipServers: 0, cpPrsmDelayFrac: 0, slices, backlog: {}, io: IO, pagingFrac: 0, regions };
}

function adjust(def: ServiceDefinition, dps: Record<string, number>, server = dps[SERVER_KEY]) {
  const evalInput = image(def);
  const current = evaluateLpar({ ...evalInput, dpOf: (k) => dps[k]! });
  const system: WlmSystemState = {
    lparId: 'SYS1',
    scps: current.scps.map((t) => ({ scKey: t.scKey, dp: dps[t.scKey]!, starvedSec: 0, acc: decayInto(emptyAcc(), t) })),
    ...(server !== undefined ? { servers: [{ key: SERVER_KEY, dp: server }] } : {}),
  };
  const traces: WlmAdjustTrace[] = [];
  setWlmTraceSink((t) => traces.push(t));
  try {
    return { out: policyAdjust({ def, system, evalInput, current: current.scps, sysplexPi: {}, clockText: 'D1 10:00:00' }), trace: traces[0]!, evalInput };
  } finally {
    setWlmTraceSink(null);
  }
}

const medRt = (input: ReturnType<typeof image>, dps: Record<string, number>) => {
  const t = evaluateLpar({ ...input, dpOf: (k) => dps[k]! }).scps.find((s) => s.scKey === 'ONLMED#1')!;
  return t.rtSumSec / t.completions;
};

describe('server periods (WT-09)', () => {
  it('holds the CICS transaction periods in the server period only under TRANSACTION', () => {
    const t = holderTopology(REGIONS, ['ONLHI#1', 'ONLMED#1', 'STCHI#1', 'BATCHPRD#1']);
    expect(t.serverKey).toBe(SERVER_KEY);
    expect(['ONLHI#1', 'ONLMED#1', 'STCHI#1'].map((k) => holderOf(t, k))).toEqual([SERVER_KEY, SERVER_KEY, 'STCHI#1']);
    // REGION/BOTH: no server period (the transactions run at the region class's DP, as before).
    expect(holderTopology({ ...REGIONS, mode: 'REGION', serverKey: undefined }, ['ONLHI#1']).serverKey).toBeNull();
    // A served class without a goal period on the image (discretionary, or absent) makes no server period.
    expect(holderTopology(REGIONS, ['STCHI#1']).serverKey).toBeNull();
  });

  it('places a new served period at its server period, and a new server period by its most important class', () => {
    const def = policy(0.2, 0.2);
    const t = holderTopology(REGIONS, ['ONLHI#1', 'ONLMED#1']);
    const held = { 'STCHI#1': 0xfc, [SERVER_KEY]: 0xfa, 'BATCHPRD#1': 0xf8 };
    const out = placeNewPeriods(def, held, ['ONLMED#1'], t);
    expect(out['ONLMED#1']).toBe(out[SERVER_KEY]);
    expect(placeLateDp(def, held, 'ONLHI#1', t)).toBe(0xfa);
    // First tick: the server period takes the level of importance 1 (ONLHI), with STCHI.
    const first = placeNewPeriods(def, {}, ['ONLHI#1', 'ONLMED#1', 'STCHI#1', 'BATCHPRD#1'], t);
    expect(first[SERVER_KEY]).toBe(first['STCHI#1']);
    expect(first['ONLMED#1']).toBe(first[SERVER_KEY]);
    expect(first['BATCHPRD#1']!).toBeLessThan(first[SERVER_KEY]!);
  });

  it('I11 one priority per server: a served class\'s stored DP alone changes nothing; the server period\'s moves every CICS class (C-3 a, c)', () => {
    const input = image();
    const run = (dps: Record<string, number>) => evaluateLpar({ ...input, dpOf: (k) => dps[k]! }).slices.map((s) => s.cpGranted);
    const dps = { 'ONLHI#1': 0xf0, 'ONLMED#1': 0xf0, [SERVER_KEY]: 0xf0, 'STCHI#1': 0xfc, 'BATCHPRD#1': 0xf4 };
    expect(run({ ...dps, 'ONLMED#1': 0xc4 })).toEqual(run(dps));
    expect(run({ ...dps, 'ONLHI#1': 0xfa })).toEqual(run(dps));
    // Above batch, both classes and the AOR are served in full; one step below it, both wait together (no cliff to a
    // less important class's stale DP).
    const up = run({ ...dps, [SERVER_KEY]: 0xf6 });
    expect(up[0]).toBeCloseTo(0.5, 6);
    expect(up[1]).toBeCloseTo(0.5, 6);
    const down = run(dps);
    expect(down[0]).toBeCloseTo(down[1]!, 6);
    expect(down[0]!).toBeLessThan(0.5);
  });

  it('the free ride: a less important class in the same regions as a missing class runs at its DP and improves with it', () => {
    // ONLHI (importance 1) misses its goal below batch; ONLMED (importance 3) has a loose goal.
    const def = policy(0.03, 5);
    const dps = { 'ONLHI#1': 0xf0, 'ONLMED#1': 0xf0, [SERVER_KEY]: 0xf0, 'STCHI#1': 0xfc, 'BATCHPRD#1': 0xf4 };
    const { out, evalInput } = adjust(def, dps);
    expect(out.log).toMatch(/RCVR=ONLHI#1 \(regions \$SRMS001\) PI=[\d.]+ BTLNK=CPU UP \$SRMS001 /);
    expect(out.dps['ONLMED#1']).toBe(out.dps['ONLHI#1']);
    expect(out.servers).toEqual([{ key: SERVER_KEY, dp: out.dps['ONLHI#1'] }]);
    expect(out.dps[SERVER_KEY]!).toBeGreaterThan(out.dps['BATCHPRD#1']!);
    expect(medRt(evalInput, out.dps)).toBeLessThan(medRt(evalInput, dps));
  });

  it('a less important served class is helped by moving its server period (C-3 a)', () => {
    // ONLHI meets a loose goal; ONLMED misses. Before server periods, raising ONLMED up to ONLHI's DP changed nothing.
    const def = policy(100, 0.03);
    const dps = { 'ONLHI#1': 0xf0, 'ONLMED#1': 0xf0, [SERVER_KEY]: 0xf0, 'STCHI#1': 0xfc, 'BATCHPRD#1': 0xf4 };
    const { out, trace } = adjust(def, dps);
    expect(out.log).toContain('RCVR=ONLMED#1 (regions $SRMS001)');
    expect(trace.candidates.find((c) => c.scKey === 'ONLMED#1')!.holder).toBe(SERVER_KEY);
    expect(out.dps['ONLHI#1']).toBe(out.dps['ONLMED#1']);
    expect(explainWlmLog(out.log!)).toContain('server period $SRMS001');
  });

  it('the server period is one donor for the classes it serves (C-3 b)', () => {
    // Batch misses below the happy CICS classes: the server period is offered once, never a served class.
    const def = structuredClone(policy(100, 100));
    def.classes.find((c) => c.id === 'BATCHPRD')!.periods = [{ goal: { kind: 'VEL', velocity: 90 }, importance: 4, durationSu: null }];
    const dps = { 'ONLHI#1': 0xf6, 'ONLMED#1': 0xf6, [SERVER_KEY]: 0xf6, 'STCHI#1': 0xfc, 'BATCHPRD#1': 0xf0 };
    const { trace } = adjust(def, dps);
    const bat = trace.candidates.find((c) => c.scKey === 'BATCHPRD#1')!;
    expect(bat.donors).toContain(SERVER_KEY);
    expect(bat.donors).not.toContain('ONLHI#1');
    expect(bat.donors).not.toContain('ONLMED#1');
  });

  it('a save from before server periods: the server period starts at the highest served DP', () => {
    const def = policy(100, 100);
    const dps = { 'ONLHI#1': 0xf6, 'ONLMED#1': 0xee, 'STCHI#1': 0xfc, 'BATCHPRD#1': 0xf0 };
    const { out, trace } = adjust(def, dps, undefined);
    // The ladder the interval starts from: ONLMED rides at ONLHI's level, above batch.
    expect(trace.dps['ONLMED#1']).toBe(trace.dps[SERVER_KEY]);
    expect(trace.dps['ONLHI#1']).toBe(trace.dps[SERVER_KEY]);
    expect(trace.dps[SERVER_KEY]!).toBeGreaterThan(trace.dps['BATCHPRD#1']!);
    expect(out.servers![0]!.dp).toBe(out.dps['ONLHI#1']);
    expect(out.dps['ONLMED#1']).toBe(out.dps['ONLHI#1']);
  });

  it('the region class\'s goal does not move the regions (R-2)', () => {
    // STCHI holds the AOR (a transaction server) and MQ. Its DP moves MQ only: the AOR and the transactions it serves
    // run at the server period's DP (SG24-6472-03 p.89: the external service class of a server is ignored).
    const input = image();
    const grants = (server: number, stchi: number) =>
      evaluateLpar({ ...input, dpOf: (k) => ({ 'ONLHI#1': 0xc4, 'ONLMED#1': 0xc4, [SERVER_KEY]: server, 'STCHI#1': stchi, 'BATCHPRD#1': 0xf4 })[k]! }).slices.map((s) => s.cpGranted);
    // Server period above batch, region class at the bottom: the AOR is served in full, MQ starves.
    const up = grants(0xf6, 0xc2);
    expect(up[2]).toBeCloseTo(0.05, 6);
    expect(up[3]!).toBeLessThan(0.01);
    // Region class on top, server period below batch: MQ is served, and the region class's DP does nothing for the
    // transactions in its regions.
    const down = grants(0xc4, 0xfc);
    expect(down[3]).toBeCloseTo(0.05, 6);
    expect(down[0]!).toBeLessThan(up[0]! - 0.1);
  });

  it('a region class holding only server regions is neither receiver nor donor and reports the regions\' DP', () => {
    const def = policy(0.03, 5);
    const evalInput = { ...image(def), slices: image(def).slices.filter((s) => s.key !== 'mq') };
    const dps: Record<string, number> = { 'ONLHI#1': 0xf0, 'ONLMED#1': 0xf0, [SERVER_KEY]: 0xf0, 'STCHI#1': 0xfc, 'BATCHPRD#1': 0xf4 };
    const current = evaluateLpar({ ...evalInput, dpOf: (k) => dps[k]! });
    const system: WlmSystemState = {
      lparId: 'SYS1', servers: [{ key: SERVER_KEY, dp: 0xf0 }],
      scps: current.scps.map((t) => ({ scKey: t.scKey, dp: dps[t.scKey]!, starvedSec: 0, acc: decayInto(emptyAcc(), t) })),
    };
    const traces: WlmAdjustTrace[] = [];
    setWlmTraceSink((t) => traces.push(t));
    let out;
    try {
      out = policyAdjust({ def, system, evalInput, current: current.scps, sysplexPi: { 'STCHI#1': 3 }, clockText: 'T' });
    } finally {
      setWlmTraceSink(null);
    }
    expect(traces[0]!.candidates.map((c) => c.scKey)).not.toContain('STCHI#1');
    expect(out.dps['STCHI#1']).toBe(out.dps[SERVER_KEY]);
  });

  it('no trial lowers a holder below work that is behind with a backlog the projection bounds (§9.12)', () => {
    // RUN (importance 4) is far behind with a large queue; the CICS classes are happy above it. Batch's plan may not
    // offer the server period as a donor past RUN: draining RUN's backlog would starve the regions.
    const def = structuredClone(policy(100, 100));
    def.classes.push({ ...structuredClone(def.classes.find((c) => c.id === 'ONLMED')!), id: 'RUN', periods: [{ goal: { kind: 'PCT', pct: 90, rtSec: 0.1 }, importance: 4, durationSu: null }] });
    def.classes.find((c) => c.id === 'BATCHPRD')!.periods = [{ goal: { kind: 'VEL', velocity: 90 }, importance: 5, durationSu: null }];
    const base = image(def);
    const evalInput = {
      ...base,
      slices: [...base.slices, sliceSpec({ key: 'run', scKey: 'RUN#1', kind: 'TXN', workloadId: 'run', rate: 100, cpEngines: 0.3, cpuSecPerTxn: 0.003, baseLatencySec: 0.02, rtSigma: 0.4, goalRtSec: 0.1, timeoutSec: 600 })],
      backlog: { run: 200 },
    };
    const dps: Record<string, number> = { 'ONLHI#1': 0xf8, 'ONLMED#1': 0xf8, [SERVER_KEY]: 0xf8, 'STCHI#1': 0xfc, 'RUN#1': 0xf4, 'BATCHPRD#1': 0xf0 };
    const current = evaluateLpar({ ...evalInput, dpOf: (k) => dps[k]! });
    const system: WlmSystemState = {
      lparId: 'SYS1', servers: [{ key: SERVER_KEY, dp: 0xf8 }],
      scps: current.scps.map((t) => ({ scKey: t.scKey, dp: dps[t.scKey]!, starvedSec: 0, acc: decayInto(emptyAcc(), t) })),
    };
    const traces: WlmAdjustTrace[] = [];
    setWlmTraceSink((t) => traces.push(t));
    try {
      policyAdjust({ def, system, evalInput, current: current.scps, sysplexPi: {}, clockText: 'T' });
    } finally {
      setWlmTraceSink(null);
    }
    const trials = traces[0]!.candidates.flatMap((c) => c.trials);
    const donation = trials.find((t) => t.move.startsWith(`DONOR ${SERVER_KEY}`));
    expect(donation?.verdict).toBe('PROJECTION_DISAGREES');
    expect(donation?.detail).toBe(`RUN#1 is behind with a backlog the projection bounds and would pass ${SERVER_KEY}`);
  });

  it('a carry of a blocker that shares the receiver\'s holder is void', () => {
    const ladder = [['STCHI#1'], ['BAT#1'], [SERVER_KEY]];
    const plan = buildPlan({
      receiver: SERVER_KEY, receiverImportance: 3, holderOf: (k) => (k.startsWith('ONL') ? SERVER_KEY : k),
      ladder, donors: [], maxSteps: 4, basePi: 2, importanceOf: (k) => (k === 'ONLHI#1' ? 1 : 3), receiverValue: () => true,
      assess: () => ({ ok: false, verdict: 'MORE_IMPORTANT_HARMED', receiverPi: [2, 2], blockedBy: 'ONLHI#1', projected: true }),
    });
    expect(plan.attempts.flatMap((a) => a.moves).some((m) => m.kind === 'CARRY')).toBe(false);
  });
});
