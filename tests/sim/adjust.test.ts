import { POLICY_ADJUST } from '../../src/content/wlm/tuning';
import { BASEPOL } from '../../src/content/wlm/basepol';
import { donorOrder, type DonorInfo, enforceCpuProtection, managedDelayFrac, policyAdjust, setWlmTraceSink, type WlmAdjustTrace } from '../../src/sim/wlm/adjust';
import { emptyScpTick, evaluateLpar, sliceSpec, type SliceSpec } from '../../src/sim/wlm/evaluate';
import { jobCpuDemand, jobShape, type JobDef } from '../../src/sim/subsys/batch';

const IO = { RANDOM: { rtSec: 0.0008, delaySec: 0.0002 }, SEQ: { rtSec: 0.0006, delaySec: 0.0001 } };
import { ACC_DECAY, decayInto, emptyAcc, type WlmSystemState } from '../../src/sim/wlm/runtime';

// RPT job shapes and prior pacing from the saved D5 22:23 CP-only trial.
const savedJobs = [
  [287.591646848, 254501, .00130261, .00014490], [560.028035341, 216030, .00113143, .00012584],
  [605.710936085, 475232, .00126820, .00014107], [554.25259103, 477784, .00129476, .00014403],
  [357.338680702, 392706, .00137599, .00015308],
];
const savedReadyDemand = () => savedJobs.reduce((sum, [cpuSecRef, ioCount, cpPace, ziipPace]) => {
  const shape = jobShape({ cpuSecRef, ioCount, ziipFrac: .1 } as JobDef, .6, .86, .0004);
  const d = jobCpuDemand(shape, { cpPace, ziipPace }, false);
  return sum + d.cp + d.ziip;
}, 0);

const slice = (key: string, scKey: string, cpEngines: number, goalRtSec: number | null): SliceSpec => ({
  key,
  scKey,
  kind: 'TXN',
  workloadId: key,
  jobname: null,
  role: null,
  rate: 200,
  cpEngines,
  ziipEngines: 0,
  mayOverflow: true,
  cpuSecPerTxn: cpEngines / 200,
  ziipSecPerTxn: 0,
  ioPerTxn: 0,
  baseLatencySec: 0.02,
  rtSigma: 0.5,
  timeoutSec: 30,
  servers: [],
  goalRtSec,
  slaRtSec: null,
  ioClass: 'RANDOM',
  ioRate: 0,
  extraOtherSec: 0,
  failFrac: 0,
  outsideWaitSec: 0,
});

describe('policy adjustment', () => {
  // ONLHI (imp 1, 95% < 0.25 s) sits below BATCHPRD (imp 4) on a saturated image.
  const slices = [slice('RB', 'ONLHI#1', 2.5, 0.25), slice('BAT', 'BATCHPRD#1', 3, null)];
  const evalInput = { cpCapacityEngines: 4, cpServers: 4, ziipCapacityEngines: 0, ziipServers: 0, cpPrsmDelayFrac: 0, slices, backlog: {}, io: IO, pagingFrac: 0 };
  const dps: Record<string, number> = { 'ONLHI#1': 244, 'BATCHPRD#1': 246 };
  const cur = evaluateLpar({ ...evalInput, dpOf: (k) => dps[k]! });
  const system: WlmSystemState = {
    lparId: 'SYS1',
    scps: cur.scps.map((t) => ({ scKey: t.scKey, dp: dps[t.scKey]!, starvedSec: 0, acc: decayInto(emptyAcc(), t) })),
  };

  it('helps the important unhappy class by moving it above the less important one', () => {
    const out = policyAdjust({ def: BASEPOL, system, evalInput, current: cur.scps, sysplexPi: {}, clockText: 'T' });
    expect(out.log).toContain('RCVR=ONLHI#1');
    // One step: alone below batch, it joins batch's level (WLM Services p.707, code 620).
    expect(out.dps['ONLHI#1']!).toBe(out.dps['BATCHPRD#1']!);
  });

  it('only one receiver is helped per interval', () => {
    const out = policyAdjust({ def: BASEPOL, system, evalInput, current: cur.scps, sysplexPi: {}, clockText: 'T' });
    const changed = Object.keys(dps).filter((k) => out.dps[k] !== dps[k]);
    expect(changed.length).toBe(1);
  });
});

it('tries a locally unhappy more important receiver before a globally unhappy lower tier', () => {
  const def = structuredClone(BASEPOL);
  def.classes.push({ ...structuredClone(def.classes.find((c) => c.id === 'ONLHI')!), id: 'ONLCARD', periods: [{ goal: { kind: 'PCT', pct: 99, rtSec: 0.1 }, importance: 2, durationSu: null }] });
  const slices = [slice('card', 'ONLCARD#1', 2.5, 0.1), slice('batch', 'BATCHPRD#1', 3, null), slice('other', 'STCLO#1', 1, null)];
  const evalInput = { cpCapacityEngines: 4, cpServers: 4, ziipCapacityEngines: 0, ziipServers: 0, cpPrsmDelayFrac: 0, slices, backlog: {}, io: IO, pagingFrac: 0 };
  const dps: Record<string, number> = { 'ONLCARD#1': 230, 'BATCHPRD#1': 240, 'STCLO#1': 245 };
  const cur = evaluateLpar({ ...evalInput, dpOf: (k) => dps[k]! });
  const system: WlmSystemState = { lparId: 'SYS1', scps: cur.scps.map((t) => ({ scKey: t.scKey, dp: dps[t.scKey]!, starvedSec: 0, acc: decayInto(emptyAcc(), t) })) };
  const out = policyAdjust({ def, system, evalInput, current: cur.scps, sysplexPi: { 'ONLCARD#1': 0.8, 'BATCHPRD#1': 1.2 }, clockText: 'T' });
  expect(out.log).toContain('RCVR=ONLCARD#1');
});

it('retains starved batch demand when projecting the playtest F2 to F4 raise on CPs', () => {
  // Five RPT jobs and their pacing factors from the D5 22:23 save replay; no zIIP pool.
  const demand = savedReadyDemand();
  const dps: Record<string, number> = { 'ONLHI#1': 0xf4, 'BATCHPRD#1': 0xf2 };
  const evalInput = { cpCapacityEngines: 3.06035, cpServers: 4, ziipCapacityEngines: 0, ziipServers: 0, cpPrsmDelayFrac: 0, slices: [slice('card', 'ONLHI#1', .2, .25), { ...slice('batch', 'BATCHPRD#1', demand, null), kind: 'AS' as const, units: 5 }], backlog: {}, io: IO, pagingFrac: 0 };
  const before = evaluateLpar({ ...evalInput, dpOf: (k) => dps[k]! });
  const after = evaluateLpar({ ...evalInput, dpOf: () => 0xf4 });
  const card = (ticks: typeof before.scps) => ticks.find((t) => t.scKey === 'ONLHI#1')!;
  expect(card(after.scps).rtSumSec / card(after.scps).completions).toBeGreaterThan(card(before.scps).rtSumSec / card(before.scps).completions);
  expect(demand).toBeGreaterThan(3);
});

it('rejects a harmful F2 to F4 batch raise when ready demand is restored', () => {
  // Controlled shared-region case based on the save's no-zIIP F2→F4 sequence. On the ladder (WT-06) the raise is a
  // step at a time: batch first joins STCLO, below ONLCARD; with STCLO above ONLCARD its first step joins ONLCARD.
  const def = structuredClone(BASEPOL);
  def.classes.push({ ...structuredClone(def.classes.find((c) => c.id === 'ONLHI')!), id: 'ONLCARD', periods: [{ goal: { kind: 'PCT', pct: 99, rtSec: .1 }, importance: 2, durationSu: null }] });
  const run = (batchCp: number, stcloDp: number) => {
    const dps: Record<string, number> = { 'ONLCARD#1': 0xf4, 'STCHI#1': 0xfa, 'BATCHPRD#1': 0xf2, 'STCLO#1': stcloDp };
    const slices = [
      sliceSpec({ key: 'card', scKey: 'ONLCARD#1', kind: 'TXN', workloadId: 'CARD', rate: 200, cpEngines: .2, cpuSecPerTxn: .001, baseLatencySec: .025, rtSigma: .4, goalRtSec: .1, timeoutSec: 30 }),
      sliceSpec({ key: 'aor', scKey: 'STCHI#1', kind: 'AS', role: 'CICS.AOR', cpEngines: .1, units: 1 }),
      sliceSpec({ key: 'batch', scKey: 'BATCHPRD#1', kind: 'AS', cpEngines: batchCp, units: 20 }),
      sliceSpec({ key: 'other', scKey: 'STCLO#1', kind: 'AS', cpEngines: 1.5, units: 4 }),
    ];
    const evalInput = { cpCapacityEngines: 4, cpServers: 4, ziipCapacityEngines: 0, ziipServers: 0, cpPrsmDelayFrac: 0, slices, backlog: {}, io: IO, pagingFrac: 0, regions: { keys: ['ONLCARD#1'], mode: 'TRANSACTION' as const, regionKey: 'STCHI#1', servers: ['aor'] } };
    const current = evaluateLpar({ ...evalInput, dpOf: (k) => dps[k]! });
    const system: WlmSystemState = { lparId: 'SYS1', scps: current.scps.map((t) => ({ scKey: t.scKey, dp: dps[t.scKey]!, starvedSec: 0, acc: decayInto(emptyAcc(), t) })) };
    const traces: WlmAdjustTrace[] = [];
    setWlmTraceSink((t) => traces.push(t));
    try {
      return { out: policyAdjust({ def, system, evalInput, current: current.scps, sysplexPi: {}, clockText: 'T' }), trace: traces[0]! };
    } finally {
      setWlmTraceSink(null);
    }
  };
  for (const demand of [3, savedReadyDemand()]) {
    const { out } = run(demand, 0xf3);
    expect(out.log).toContain('RCVR=BATCHPRD#1');
    expect(out.dps['BATCHPRD#1']).toBe(out.dps['STCLO#1']);
    expect(out.dps['BATCHPRD#1']!).toBeLessThan(out.dps['ONLCARD#1']!);
  }
  const { out, trace } = run(savedReadyDemand(), 0xfa);
  const batch = trace.candidates.find((c) => c.scKey === 'BATCHPRD#1')!;
  expect(batch.trials[0]).toMatchObject({ verdict: 'MORE_IMPORTANT_HARMED' });
  expect(batch.trials[0]!.detail).toMatch(/^ONLCARD#1 /);
  expect(out.dps['BATCHPRD#1']!).toBeLessThan(out.dps['ONLCARD#1']!);
});

describe('equal-importance moves narrow the PI gap (SG24-6472 p.60; Enrico, How WLM Works, slide 52)', () => {
  // ONLMED and DDFPRD period 1 are both importance 2; ONLMED (PI 4) sits below DDFPRD on a saturated image.
  const run = (ddfLatencySec: number) => {
    const slices = [slice('A', 'ONLMED#1', 2.5, 0.5), { ...slice('B', 'DDFPRD#1', 1, 0.5), baseLatencySec: ddfLatencySec }];
    const evalInput = { cpCapacityEngines: 3.5, cpServers: 4, ziipCapacityEngines: 0, ziipServers: 0, cpPrsmDelayFrac: 0, slices, backlog: {}, io: IO, pagingFrac: 0 };
    const dps: Record<string, number> = { 'ONLMED#1': 244, 'DDFPRD#1': 246 };
    const cur = evaluateLpar({ ...evalInput, dpOf: (k) => dps[k]! });
    const system: WlmSystemState = {
      lparId: 'SYS1',
      scps: cur.scps.map((t) => ({ scKey: t.scKey, dp: dps[t.scKey]!, starvedSec: 0, acc: decayInto(emptyAcc(), t) })),
    };
    return { dps, out: policyAdjust({ def: BASEPOL, system, evalInput, current: cur.scps, sysplexPi: {}, clockText: 'T' }) };
  };

  it('accepts a move that brings the two PIs closer (4.0 / 0.5 → 0.5 / 1.0)', () => {
    const { out } = run(0.02);
    expect(out.log).toContain('RCVR=ONLMED#1');
    expect(out.dps['ONLMED#1']!).toBeGreaterThan(out.dps['DDFPRD#1']!);
  });

  it('rejects a move whose gain beats the harm but leaves the PIs further apart (4.0 / 1.4 → 0.5 / 4.0)', () => {
    const { dps, out } = run(0.4);
    expect(out.dps).toEqual(dps);
    expect(out.log).toContain('no action');
  });

  it('names the rejected move and why in the player-visible log (PT-05)', () => {
    const { out } = run(0.4);
    expect(out.log).toMatch(/no action with net value \(.+\)/);
    expect(out.log).toMatch(/rejected: harms DDFPRD#1, equal importance/);
  });

  it("keeps the rejected move on its own receiver's line, not another class's note (PT-05 B3)", () => {
    // An importance-1 class is I/O-bound (not WLM-fixable) and is assessed first; the equal-importance pair that
    // cannot be helped comes after. Its clue must not be glued to the earlier class's note.
    const def = structuredClone(BASEPOL);
    def.classes.push({ ...structuredClone(BASEPOL.classes.find((c) => c.id === 'STCLO')!), id: 'IONOW', periods: [{ goal: { kind: 'VEL' as const, velocity: 10 }, importance: 1, durationSu: null }] });
    const slices = [slice('A', 'ONLMED#1', 2.5, 0.5), { ...slice('B', 'DDFPRD#1', 1, 0.5), baseLatencySec: 0.4 }];
    const evalInput = { cpCapacityEngines: 3.5, cpServers: 4, ziipCapacityEngines: 0, ziipServers: 0, cpPrsmDelayFrac: 0, slices, backlog: {}, io: IO, pagingFrac: 0 };
    const dps: Record<string, number> = { 'ONLMED#1': 244, 'DDFPRD#1': 246, 'IONOW#1': 0xf2 };
    const cur = evaluateLpar({ ...evalInput, dpOf: (k) => dps[k]! });
    const system: WlmSystemState = {
      lparId: 'SYS1',
      scps: [...cur.scps.map((t) => ({ scKey: t.scKey, dp: dps[t.scKey]!, starvedSec: 0, acc: decayInto(emptyAcc(), t) })),
        { scKey: 'IONOW#1', dp: 0xf2, starvedSec: 0, acc: { ...emptyAcc(), using: 0.01, delay: 5, delayIo: 5 } }],
    };
    const ionow = { ...emptyScpTick('IONOW#1', 0xf0), usingIo: 5, delayIo: 5 };
    const out = policyAdjust({ def, system, evalInput, current: [...cur.scps, ionow], sysplexPi: {}, clockText: 'T' });
    expect(out.log).toMatch(/IONOW#1 PI=\S+ BTLNK=IO not WLM-fixable$/);
    expect(out.log).not.toContain('rejected:');
  });

  it('the investigation trace names why each trial failed and changes no decision', () => {
    const traces: WlmAdjustTrace[] = [];
    const plain = [run(0.4).out, run(0.02).out];
    setWlmTraceSink((t) => traces.push(t));
    let traced;
    try {
      traced = [run(0.4).out, run(0.02).out];
    } finally {
      setWlmTraceSink(null);
    }
    expect(traced).toEqual(plain);
    const [rejected, accepted] = traces;
    const recv = rejected!.candidates.find((c) => c.scKey === 'ONLMED#1')!;
    expect(recv.outcome).toBe('ASSESSED');
    expect(recv.trials.map((t) => t.verdict)).toContain('EQUAL_DISPARITY');
    expect(recv.trials.every((t) => t.verdict !== 'ACCEPTED')).toBe(true);
    expect(rejected!.action).toBeNull();
    expect(accepted!.candidates[0]!.trials.at(-1)!.verdict).toBe('ACCEPTED');
    expect(accepted!.action).toContain('RCVR=ONLMED#1');
  });

  it('the trace carries the receiver PI pair, the delay shares and the donor order (WT-02)', () => {
    const traces: WlmAdjustTrace[] = [];
    setWlmTraceSink((t) => traces.push(t));
    try {
      run(0.4);
      run(0.02);
    } finally {
      setWlmTraceSink(null);
    }
    const [rejected, accepted] = traces as [WlmAdjustTrace, WlmAdjustTrace];
    // A rejected trial keeps its projected receiver pair (it did before), and now an accepted one records it too:
    // the move must have brought the receiver's PI down.
    const rejectedTrial = rejected.candidates.find((c) => c.scKey === 'ONLMED#1')!.trials.find((t) => t.verdict === 'EQUAL_DISPARITY')!;
    expect(rejectedTrial.receiverPi![0]).toBeGreaterThan(rejectedTrial.receiverPi![1]!);
    expect(rejectedTrial.receiverPi![0]).toBeGreaterThan(1);
    const acceptedTrial = accepted.candidates[0]!.trials.at(-1)!;
    expect(acceptedTrial.verdict).toBe('ACCEPTED');
    expect(acceptedTrial.receiverPi![0]!).toBeGreaterThan(acceptedTrial.receiverPi![1]!);

    // The shares are the numbers the bottleneck was chosen from, so the bottleneck's own share leads the rest; a
    // rejected candidate carries them too.
    const c = accepted.candidates[0]!;
    expect(c.bottleneck).toBe('CPU');
    expect(c.delayShares.CPU).toBeGreaterThan(0);
    expect(c.delayShares.CPU).toBeLessThanOrEqual(1);
    expect(c.delayShares.CPU).toBeGreaterThan(c.delayShares.ZIIP + c.delayShares.IO + c.delayShares.CAP + c.delayShares.OTHER);
    expect(rejected.candidates.find((x) => x.scKey === 'ONLMED#1')!.delayShares.CPU).toBeGreaterThan(0);

    // The donor list is what the DONOR trials were built from, in the same order.
    const candidates = traces.flatMap((t) => t.candidates);
    expect(candidates.some((x) => (x.donors ?? []).length > 0)).toBe(true);
    for (const x of candidates) {
      const tried = x.trials.filter((t) => t.move.startsWith('DONOR ')).map((t) => t.move.split(' ')[1]!);
      if (tried.length > 0) expect(tried).toEqual((x.donors ?? []).slice(0, tried.length));
      if (x.outcome !== 'ASSESSED') expect(x.donors).toBeUndefined();
    }
  });
});

describe('a hopeless receiver does not stop the search at the next importance (SG24-7621 p.105–106)', () => {
  // Playtest round 2, D19 22:00–22:27: the two importance-1 slots went to receivers whose projections found no
  // move of net value (STCMED's sysplex PI came from another system; STCHI's DP cannot reach the transaction-managed
  // regions it hosts), so ONLCARD/ONLRBANK at importance 2 waited until 22:30. Shape here: two importance-1
  // receivers that are CPU-fixable but locally at their goal, and a helpable importance-2 class on a saturated image.
  const def = structuredClone(BASEPOL);
  const cls = (id: string, velocity: number, importance: 1 | 2) => ({
    ...structuredClone(BASEPOL.classes.find((c) => c.id === 'STCLO')!),
    id,
    periods: [{ goal: { kind: 'VEL' as const, velocity }, importance, durationSu: null }],
  });
  def.classes.push(cls('OLD1', 5, 1), cls('OLD2', 5, 1), cls('ONLCARD', 95, 2));
  const slices = [
    sliceSpec({ key: 'old1', scKey: 'OLD1#1', kind: 'AS', cpEngines: 2.5, units: 8 }),
    sliceSpec({ key: 'old2', scKey: 'OLD2#1', kind: 'AS', cpEngines: 2.5, units: 8 }),
    sliceSpec({ key: 'card', scKey: 'ONLCARD#1', kind: 'AS', cpEngines: 2, units: 8 }),
  ];
  const evalInput = { cpCapacityEngines: 4, cpServers: 4, ziipCapacityEngines: 0, ziipServers: 0, cpPrsmDelayFrac: 0, slices, backlog: {}, io: IO, pagingFrac: 0 };
  const dps: Record<string, number> = { 'OLD1#1': 0xf4, 'OLD2#1': 0xf3, 'ONLCARD#1': 0xe6 };
  const cur = evaluateLpar({ ...evalInput, dpOf: (k) => dps[k]! });
  const system: WlmSystemState = {
    lparId: 'SYS1',
    scps: cur.scps.map((t) => ({ scKey: t.scKey, dp: dps[t.scKey]!, starvedSec: 0, acc: decayInto(emptyAcc(), t) })),
  };

  it('goes on to the importance-2 receiver after the importance-1 receivers find nothing', () => {
    const traces: WlmAdjustTrace[] = [];
    setWlmTraceSink((t) => traces.push(t));
    let out;
    try {
      out = policyAdjust({ def, system, evalInput, current: cur.scps, sysplexPi: { 'OLD1#1': 2.1, 'OLD2#1': 1.7 }, clockText: 'T' });
    } finally {
      setWlmTraceSink(null);
    }
    // One basis (docs/wlm-design.md §5.2): the importance-1 receivers are at their goal on this system (only the
    // sysplex PI is over 1), so their projected PI is ≤ 1 and they get no trials and use no budget.
    const outcomes = traces[0]!.candidates.map((c) => [c.scKey, c.outcome]);
    expect(outcomes).toEqual([['OLD1#1', 'RECOVERING'], ['OLD2#1', 'RECOVERING'], ['ONLCARD#1', 'ASSESSED']]);
    for (const k of ['OLD1#1', 'OLD2#1']) expect(traces[0]!.candidates.find((c) => c.scKey === k)!.basePi).toBeLessThanOrEqual(1);
    expect(traces[0]!.candidates.find((c) => c.scKey === 'ONLCARD#1')!.trials.length).toBeGreaterThan(0);
    expect(out.log).not.toContain('RCVR=');
  });

  // Receivers that miss their goal on this system and that no DP move helps: their CPU delay is PR/SM delay.
  const wide = structuredClone(BASEPOL);
  wide.classes.push(cls('OLD1', 90, 1), cls('OLD2', 90, 1), cls('OLD3', 90, 1), cls('ONLCARD', 95, 2));
  const slices3 = [
    sliceSpec({ key: 'old1', scKey: 'OLD1#1', kind: 'AS', cpEngines: 0.5, units: 4 }),
    sliceSpec({ key: 'old2', scKey: 'OLD2#1', kind: 'AS', cpEngines: 0.5, units: 4 }),
    sliceSpec({ key: 'old3', scKey: 'OLD3#1', kind: 'AS', cpEngines: 0.5, units: 4 }),
    sliceSpec({ key: 'card', scKey: 'ONLCARD#1', kind: 'AS', cpEngines: 2, units: 8 }),
  ];
  const input3 = { ...evalInput, cpPrsmDelayFrac: 0.3, slices: slices3 };
  const cur3 = evaluateLpar({ ...input3, dpOf: (k) => dps[k] ?? 0xee });
  const system3: WlmSystemState = {
    lparId: 'SYS1',
    scps: cur3.scps.map((t) => ({ scKey: t.scKey, dp: dps[t.scKey] ?? 0xee, starvedSec: 0, acc: decayInto(emptyAcc(), t) })),
  };
  const plexPi = { 'OLD1#1': 2.1, 'OLD2#1': 1.7, 'OLD3#1': 1.5 };
  const run3 = (sys: WlmSystemState, nowTick: number) => {
    const tr: WlmAdjustTrace[] = [];
    setWlmTraceSink((t) => tr.push(t));
    try {
      const out = policyAdjust({ def: wide, system: sys, evalInput: input3, current: cur3.scps, sysplexPi: plexPi, clockText: 'D1 06:00:00', nowTick });
      return { out, trace: tr[0]! };
    } finally {
      setWlmTraceSink(null);
    }
  };
  const withClocks = (clocks: Record<string, number>): WlmSystemState => ({
    ...system3,
    scps: system3.scps.map((s) => (clocks[s.scKey] !== undefined ? { ...s, skipUntilTick: clocks[s.scKey] } : s)),
  });
  const outcome = (t: WlmAdjustTrace, k: string) => t.candidates.find((c) => c.scKey === k)?.outcome;

  it('sets a skip clock on a receiver whose every trial was rejected, honours it, and drops it on expiry (WLM Services p.145)', () => {
    const first = run3(system3, 0);
    const until = POLICY_ADJUST.rejectedSkipTicks;
    for (const k of ['OLD1#1', 'OLD2#1', 'OLD3#1']) {
      expect(outcome(first.trace, k)).toBe('ASSESSED');
      expect(first.out.skipUntil[k]).toBe(until);
    }
    // OLD1 is alone on the top level: no step up, no donor, so no trial at all; it is clocked like a rejected one.
    expect(first.out.log).toMatch(/OLD1#1 .* no action with net value, next look 06:01:00$/);
    // ONLCARD's raises would all pass importance-1 work that is missing its goal: rejected too, and clocked.
    expect(first.out.skipUntil['ONLCARD#1']).toBe(until);
    // A tick later all four are on their clocks: no projection at all this interval (I16).
    const next = run3(withClocks(first.out.skipUntil), 1);
    expect(next.trace.candidates.flatMap((c) => c.trials)).toEqual([]);
    for (const k of ['OLD1#1', 'OLD2#1', 'OLD3#1', 'ONLCARD#1']) {
      expect(outcome(next.trace, k)).toBe('SKIP_CLOCK');
      expect(next.trace.candidates.find((c) => c.scKey === k)!.skipUntilTick).toBe(until);
      expect(next.out.skipUntil[k]).toBe(until);
    }
    // At the clock's tick they are assessed again.
    const later = run3(withClocks(first.out.skipUntil), until);
    expect(outcome(later.trace, 'OLD1#1')).toBe('ASSESSED');
  });

  it('gives a helped receiver no clock: it may be helped again next interval', () => {
    // An importance-2 class below busy importance-5 work: raising it is worth it.
    const two = structuredClone(BASEPOL);
    const bat = { ...cls('BAT', 10, 2), periods: [{ goal: { kind: 'VEL' as const, velocity: 10 }, importance: 5 as const, durationSu: null }] };
    two.classes.push(cls('ONLCARD', 95, 2), bat);
    const sl = [sliceSpec({ key: 'card', scKey: 'ONLCARD#1', kind: 'AS', cpEngines: 1.5, units: 8 }), sliceSpec({ key: 'bat', scKey: 'BAT#1', kind: 'AS', cpEngines: 3, units: 8 })];
    const inp = { ...evalInput, slices: sl };
    const d: Record<string, number> = { 'BAT#1': 0xf0, 'ONLCARD#1': 0xe6 };
    const c = evaluateLpar({ ...inp, dpOf: (k) => d[k]! });
    const sys: WlmSystemState = { lparId: 'SYS1', scps: c.scps.map((t) => ({ scKey: t.scKey, dp: d[t.scKey]!, starvedSec: 0, acc: decayInto(emptyAcc(), t) })) };
    const out = policyAdjust({ def: two, system: sys, evalInput: inp, current: c.scps, sysplexPi: {}, clockText: 'T', nowTick: 100 });
    expect(out.log).toMatch(/RCVR=ONLCARD#1 /);
    expect(out.skipUntil).toEqual({});
  });

  it('stops the search when the interval projection budget is spent, with no clock for the receiver it cut short', () => {
    // OLD1 is on its clock; OLD2 spends three projections (two raises, then OLD1 as an unhappy equal-importance
    // donor, eligible since WT-07). OLD3 gets the last of four, without finishing its trials.
    const saved = POLICY_ADJUST.maxProjectionsPerInterval;
    POLICY_ADJUST.maxProjectionsPerInterval = 4;
    try {
      const { out, trace } = run3(withClocks({ 'OLD1#1': 200 }), 100);
      const old3 = trace.candidates.find((c) => c.scKey === 'OLD3#1')!;
      expect(old3.outcome).toBe('ASSESSED');
      expect(old3.trials).toHaveLength(1);
      expect(old3.skipUntilTick).toBeUndefined();
      expect(trace.candidates.map((c) => c.scKey)).toEqual(['OLD1#1', 'OLD2#1', 'OLD3#1']);
      expect(out.skipUntil).toEqual({ 'OLD1#1': 200, 'OLD2#1': 100 + POLICY_ADJUST.rejectedSkipTicks });
    } finally {
      POLICY_ADJUST.maxProjectionsPerInterval = saved;
    }
  });

  it('clocks a receiver that had the whole budget and still ran out, so it cannot keep the rest out (I12)', () => {
    const saved = POLICY_ADJUST.maxProjectionsPerInterval;
    POLICY_ADJUST.maxProjectionsPerInterval = 1;
    try {
      const { out, trace } = run3(withClocks({ 'OLD1#1': 200, 'OLD2#1': 200 }), 100);
      const old3 = trace.candidates.find((c) => c.scKey === 'OLD3#1')!;
      expect(old3.trials).toHaveLength(1);
      expect(out.skipUntil['OLD3#1']).toBe(100 + POLICY_ADJUST.rejectedSkipTicks);
      expect(trace.candidates.map((c) => c.scKey)).toEqual(['OLD1#1', 'OLD2#1', 'OLD3#1']);
    } finally {
      POLICY_ADJUST.maxProjectionsPerInterval = saved;
    }
  });

  it('traces BUDGET for the next candidate when the budget ran out between receivers, and stops', () => {
    const saved = POLICY_ADJUST.maxProjectionsPerInterval;
    // OLD1 has no trial (alone on top); OLD2's two raises and equal-importance donor trial spend the budget (WT-07).
    POLICY_ADJUST.maxProjectionsPerInterval = 3;
    try {
      const { out, trace } = run3(system3, 100);
      expect(trace.candidates.map((c) => [c.scKey, c.outcome])).toEqual([['OLD1#1', 'ASSESSED'], ['OLD2#1', 'ASSESSED'], ['OLD3#1', 'BUDGET']]);
      expect(out.skipUntil).toEqual({ 'OLD1#1': 100 + POLICY_ADJUST.rejectedSkipTicks, 'OLD2#1': 100 + POLICY_ADJUST.rejectedSkipTicks });
    } finally {
      POLICY_ADJUST.maxProjectionsPerInterval = saved;
    }
  });

  it('skips a period with no managed delay without a clock (WLM Services p.144)', () => {
    // OLD1 waits on something WLM does not manage (a lock, a server): no delay state at all, only waits, which the
    // accumulator keeps beside `delay` rather than in it (`decayInto`).
    const sys = { ...system3, scps: system3.scps.map((s) => (s.scKey === 'OLD1#1' ? { ...s, acc: { ...s.acc, delay: 0, delayCpu: 0, delayZiip: 0, delayIo: 0, delayCap: 0, delayOther: s.acc.delay } } : s)) };
    const { out, trace } = run3(sys, 100);
    expect(outcome(trace, 'OLD1#1')).toBe('NO_MANAGED_DELAY');
    expect(trace.candidates.find((c) => c.scKey === 'OLD1#1')!.managedDelayFrac).toBe(0);
    expect(out.skipUntil['OLD1#1']).toBeUndefined();
  });

  it('decides the same with and without the trace sink', () => {
    const plain = policyAdjust({ def: wide, system: system3, evalInput: input3, current: cur3.scps, sysplexPi: plexPi, clockText: 'T', nowTick: 100 });
    const { out } = run3(system3, 100);
    expect(plain.dps).toEqual(out.dps);
    expect(plain.skipUntil).toEqual(out.skipUntil);
  });
});

describe('a run of hopeless receivers does not starve the receivers behind it (I12; #296 review B1)', () => {
  // Twelve importance-1 receivers no move helps (their CPU delay is PR/SM delay), each costing six projections: three
  // raises (above the blockers' level, onto the happy level, above it) and three happy equal-importance donors. With the budget at 12 and the clock at 6 intervals, two are
  // clocked per interval and the first clocks expire just as the last are reached, so a search that restarted at
  // the top every interval never reached TARGET, which an EF→DF donor move by HOG helps at once.
  const tpl = BASEPOL.classes.find((c) => c.id === 'STCLO')!;
  const cls = (id: string, velocity: number, importance: 1 | 2 | 5) => ({ ...structuredClone(tpl), id, periods: [{ goal: { kind: 'VEL' as const, velocity }, importance, durationSu: null }] });
  const def = structuredClone(BASEPOL);
  const blockers = Array.from({ length: 12 }, (_, i) => `BLK${String(i).padStart(2, '0')}`);
  const donors = ['HAPPY1', 'HAPPY2', 'HAPPY3'];
  def.classes.push(...blockers.map((b) => cls(b, 90, 1)), ...donors.map((d) => cls(d, 5, 1)), cls('TARGET', 90, 2), cls('HOG', 10, 5));
  const slices = [
    ...[...blockers, ...donors].map((k) => sliceSpec({ key: k, scKey: `${k}#1`, kind: 'AS', cpEngines: 0.01, units: 1 })),
    sliceSpec({ key: 'target', scKey: 'TARGET#1', kind: 'AS', cpEngines: 0.5, units: 2 }),
    sliceSpec({ key: 'hog', scKey: 'HOG#1', kind: 'AS', cpEngines: 3.5, units: 8 }),
  ];
  const evalInput = { cpCapacityEngines: 4, cpServers: 4, ziipCapacityEngines: 0, ziipServers: 0, cpPrsmDelayFrac: 0.3, slices, backlog: {}, io: IO, pagingFrac: 0 };
  const dps0: Record<string, number> = { 'TARGET#1': 0xe0, 'HOG#1': 0xef, 'HAPPY1#1': 0xf1, 'HAPPY2#1': 0xf1, 'HAPPY3#1': 0xf1 };
  for (const b of blockers) dps0[`${b}#1`] = 0xf0;

  it('reaches TARGET: a search the budget stopped resumes where it stopped', () => {
    let system: WlmSystemState | null = null;
    const dps = { ...dps0 };
    let targetAssessed = -1;
    let budgetStops = 0;
    for (let tick = 0; tick < 20 && targetAssessed < 0; tick++) {
      const cur = evaluateLpar({ ...evalInput, dpOf: (k) => dps[k]! });
      const prev: Record<string, WlmSystemState['scps'][number]> = {};
      for (const p of system?.scps ?? []) prev[p.scKey] = p;
      system = {
        lparId: 'SYS1',
        scps: cur.scps.map((t) => {
          const p = prev[t.scKey];
          return { scKey: t.scKey, dp: dps[t.scKey]!, starvedSec: 0, acc: decayInto(p?.acc ?? emptyAcc(), t), ...(p?.skipUntilTick !== undefined ? { skipUntilTick: p.skipUntilTick } : {}), ...(p?.resumeSearch ? { resumeSearch: true as const } : {}) };
        }),
      };
      const traces: WlmAdjustTrace[] = [];
      setWlmTraceSink((t) => traces.push(t));
      let out;
      try {
        out = policyAdjust({ def, system, evalInput, current: cur.scps, sysplexPi: {}, clockText: 'T', nowTick: tick });
      } finally {
        setWlmTraceSink(null);
      }
      const target = traces[0]!.candidates.find((c) => c.scKey === 'TARGET#1');
      if (target?.outcome === 'ASSESSED') targetAssessed = tick;
      if (traces[0]!.candidates.some((c) => c.outcome === 'BUDGET')) budgetStops++;
      Object.assign(dps, out.dps);
      system = { ...system, scps: system.scps.map((p) => {
        const { skipUntilTick: _c, resumeSearch: _r, ...rest } = p;
        const c = out.skipUntil[p.scKey];
        return { ...rest, ...(c !== undefined ? { skipUntilTick: c } : {}), ...(p.scKey === out.resumeAt ? { resumeSearch: true as const } : {}) };
      }) };
      if (targetAssessed >= 0) expect(out.log).toContain('RCVR=TARGET#1');
    }
    expect(budgetStops).toBeGreaterThan(0);
    // Two blockers per interval: TARGET's turn comes in the seventh interval.
    expect(targetAssessed).toBeGreaterThanOrEqual(0);
    expect(targetAssessed).toBeLessThanOrEqual(blockers.length / 2 + 1);
  });
});

it('assesses a mixed class for its own members when its AOR is healthy (#296 review B2)', () => {
  // MIXED holds a 1-CP AOR managed to TX's transaction goals and a starved address space. Its goal PI is the address
  // space's; the delay test must read the same population, or the AOR's using samples hide the starvation.
  const tpl = BASEPOL.classes.find((c) => c.id === 'STCLO')!;
  const def = structuredClone(BASEPOL);
  def.classes.push(
    { ...structuredClone(tpl), id: 'MIXED', periods: [{ goal: { kind: 'VEL' as const, velocity: 50 }, importance: 2, durationSu: null }] },
    { ...structuredClone(tpl), id: 'HOG', periods: [{ goal: { kind: 'VEL' as const, velocity: 10 }, importance: 5, durationSu: null }] },
    { ...structuredClone(def.classes.find((c) => c.id === 'ONLHI')!), id: 'TX', periods: [{ goal: { kind: 'PCT', pct: 90, rtSec: 1 }, importance: 1, durationSu: null }] },
  );
  const slices = [
    sliceSpec({ key: 'tx', scKey: 'TX#1', kind: 'TXN', workloadId: 'TX', rate: 100, cpEngines: 0.1, cpuSecPerTxn: 0.001, baseLatencySec: 0.01, rtSigma: 0.4, goalRtSec: 1, timeoutSec: 30 }),
    sliceSpec({ key: 'aor', scKey: 'MIXED#1', kind: 'AS', role: 'CICS.AOR', cpEngines: 1, units: 1 }),
    sliceSpec({ key: 'own', scKey: 'MIXED#1', kind: 'AS', cpEngines: 0.001, units: 1 }),
    sliceSpec({ key: 'hog', scKey: 'HOG#1', kind: 'AS', cpEngines: 3.4, units: 8 }),
  ];
  const evalInput = { cpCapacityEngines: 4, cpServers: 4, ziipCapacityEngines: 0, ziipServers: 0, cpPrsmDelayFrac: 0, slices, backlog: {}, io: IO, pagingFrac: 0, regions: { keys: ['TX#1'], mode: 'TRANSACTION' as const, regionKey: 'MIXED#1', servers: ['aor'] } };
  const dps: Record<string, number> = { 'TX#1': 0xfc, 'MIXED#1': 0xe0, 'HOG#1': 0xf0 };
  const cur = evaluateLpar({ ...evalInput, dpOf: (k) => dps[k]! });
  const system: WlmSystemState = { lparId: 'SYS1', scps: cur.scps.map((t) => ({ scKey: t.scKey, dp: dps[t.scKey]!, starvedSec: 0, acc: decayInto(emptyAcc(), t) })) };
  const acc = system.scps.find((p) => p.scKey === 'MIXED#1')!.acc;
  expect(acc.srvUsing).toBeGreaterThan(0);
  const traces: WlmAdjustTrace[] = [];
  setWlmTraceSink((t) => traces.push(t));
  let out;
  try {
    out = policyAdjust({ def, system, evalInput, current: cur.scps, sysplexPi: {}, clockText: 'T' });
  } finally {
    setWlmTraceSink(null);
  }
  const mixed = traces[0]!.candidates.find((c) => c.scKey === 'MIXED#1')!;
  expect(mixed.outcome).toBe('ASSESSED');
  expect(mixed.managedDelayFrac).toBeGreaterThan(POLICY_ADJUST.needsHelpDelayFrac);
  expect(out.log).toContain('RCVR=MIXED#1');
});

describe('managedDelayFrac (docs/wlm-design.md §5.7)', () => {
  // Built the way the sim builds it (decayInto from one tick), so `delay` has the shape the sim gives it: waits
  // (`delayOther`) are kept beside it, not inside it.
  const tick = { ...emptyScpTick('X#1', 0xf0), usingCpu: 40, usingZiip: 5, usingIo: 5, delayCpu: 20, delayZiip: 5, delayIo: 5, delayStorage: 3, delayQueue: 2, delayCap: 5, delayOther: 400 };
  const acc = decayInto(emptyAcc(), tick);
  it('counts CPU, zIIP, I/O, storage and queue, not capping; waits change nothing however long', () => {
    // using 50; delay 20 + 5 + 5 + 3 + 2 + 5 cap = 40; managed 35 of 90.
    expect(acc.delay).toBe(40);
    expect(managedDelayFrac(acc)).toBeCloseTo(35 / 90, 12);
    expect(managedDelayFrac(decayInto(emptyAcc(), { ...tick, delayOther: 0 }))).toBeCloseTo(35 / 90, 12);
  });
  it('a transaction class waiting on a lock as well as the processor still needs help (Harbourline expert seed 7)', () => {
    // MKTORD#1 on PRDB, D29 09:20: CPU delay 98 % of using + delay, waits several times its samples.
    const mkt = decayInto(emptyAcc(), { ...emptyScpTick('MKTORD#1', 0xfc), usingCpu: 2, delayCpu: 98, delayOther: 566 });
    expect(managedDelayFrac(mkt)).toBeGreaterThan(POLICY_ADJUST.needsHelpDelayFrac);
  });
  it('leaves I/O outside velocity out of both sides', () => {
    const noVel = decayInto(emptyAcc(), { ...tick, usingIoNoVel: 5, delayIoNoVel: 5 });
    expect(managedDelayFrac(noVel)).toBeCloseTo(30 / 80, 12);
  });
  it('is 0 for a period with no samples', () => {
    expect(managedDelayFrac(emptyAcc())).toBe(0);
  });
  it('leaves transaction-server regions out, as the goal PI does (WLM Planning p.122; #296 review B2)', () => {
    // A healthy 1-CP AOR managed to its transactions' goals and a starved address space in the same class: the
    // class is managed for the address space, whose samples are all delay.
    const mixed = decayInto(emptyAcc(), { ...emptyScpTick('MIXED#1', 0xe0), usingCpu: 1, delayCpu: 0.001, srvUsing: 1, srvDelay: 0, srvDelayCap: 0 });
    expect(managedDelayFrac(mixed)).toBeCloseTo(1, 12);
    // A capped server's capping delay is its own: the other members' CPU delay still counts.
    const capped = decayInto(emptyAcc(), { ...emptyScpTick('MIXED#1', 0xe0), usingCpu: 14, delayCpu: 1, delayCap: 10, srvUsing: 5, srvDelay: 10, srvDelayCap: 10 });
    expect(managedDelayFrac(capped)).toBeCloseTo(1 / 10, 12);
    // A save from before srvDelayCap: the server history is there without it. Taking the server's capping off twice
    // (inside srvDelay and again from delayCap) would leave no managed delay at all (#296 review B3).
    const { srvDelayCap: _gone, ...legacy } = capped;
    expect(managedDelayFrac(legacy)).toBeCloseTo(1 / 10, 12);
    const next = decayInto(legacy, { ...emptyScpTick('MIXED#1', 0xe0), usingCpu: 14, delayCpu: 1, delayCap: 10, srvUsing: 5, srvDelay: 10, srvDelayCap: 10 });
    expect(next.srvDelayCap).toBeCloseTo(10 * (1 + ACC_DECAY), 12);
    expect(managedDelayFrac(next)).toBeCloseTo(1 / 10, 12);
    // Only server regions: nothing left to manage.
    expect(managedDelayFrac(decayInto(emptyAcc(), { ...emptyScpTick('TOR#1', 0xe0), usingCpu: 1, delayCpu: 1, srvUsing: 1, srvDelay: 1, srvDelayCap: 0 }))).toBe(0);
  });
});

describe('long-term CPU protection is enforced, not a reason to stop managing (WLM Planning p.120)', () => {
  const info = {
    'ONLRBANK#1': { cpuCritical: true, period: 0, importance: 2 },
    'BATCHHI#1': { cpuCritical: false, period: 0, importance: 3 },
    'BATCHPRD#1': { cpuCritical: false, period: 0, importance: 5 },
    'ONLHI#1': { cpuCritical: false, period: 0, importance: 1 },
  } as const;

  it('lowers less important periods below the protected DP and leaves more important ones alone', () => {
    const out = enforceCpuProtection({ 'ONLRBANK#1': 0xf4, 'BATCHHI#1': 0xf9, 'BATCHPRD#1': 0xfb, 'ONLHI#1': 0xfc }, info, 0);
    // Both onto one new level directly below the protected one; the result is canonical (WT-06).
    expect(out.dps).toEqual({ 'ONLHI#1': 0xf6, 'ONLRBANK#1': 0xf4, 'BATCHHI#1': 0xf2, 'BATCHPRD#1': 0xf2 });
    expect(out.moves).toEqual(['BATCHHI#1 DP F9→F2 below ONLRBANK#1', 'BATCHPRD#1 DP FB→F2 below ONLRBANK#1']);
  });

  it('names chained moves by the DPs before and after all of them (a protected period lowered, then a floor)', () => {
    const chain = {
      A: { cpuCritical: false, period: 0, importance: 1 },
      B: { cpuCritical: false, period: 0, importance: 2 },
      C: { cpuCritical: false, period: 0, importance: 3 },
    } as const;
    const out = enforceCpuProtection({ A: 0xf2, B: 0xf6, C: 0xf4 }, chain, 2);
    expect(out.dps).toEqual({ A: 0xf6, B: 0xf4, C: 0xf2 });
    expect(out.moves).toEqual(['B DP F6→F4 below A', 'C DP F4→F2 below B']);
  });

  it('changes nothing when protection already holds, and CCIMP protects first periods up to that importance', () => {
    expect(enforceCpuProtection({ 'ONLRBANK#1': 0xf4, 'BATCHHI#1': 0xf2, 'BATCHPRD#1': 0xf0, 'ONLHI#1': 0xfc }, info, 0).moves).toEqual([]);
    const cc = enforceCpuProtection({ 'ONLRBANK#1': 0xfa, 'BATCHHI#1': 0xf2, 'BATCHPRD#1': 0xf0, 'ONLHI#1': 0xf0 }, info, 1);
    expect(cc.dps).toEqual({ 'ONLHI#1': 0xf6, 'ONLRBANK#1': 0xf4, 'BATCHHI#1': 0xf2, 'BATCHPRD#1': 0xf2 });
  });

  it('a protected class below batch is still helped (playtest BASEPO10, D20 21:15)', () => {
    const def = structuredClone(BASEPOL);
    def.classes.push({ ...structuredClone(def.classes.find((c) => c.id === 'ONLHI')!), id: 'ONLCARD', cpuCritical: true, periods: [{ goal: { kind: 'PCT', pct: 95, rtSec: 0.1 }, importance: 2, durationSu: null }] });
    const slices = [slice('card', 'ONLCARD#1', 2.5, 0.1), slice('batch', 'BATCHPRD#1', 3, null)];
    const evalInput = { cpCapacityEngines: 4, cpServers: 4, ziipCapacityEngines: 0, ziipServers: 0, cpPrsmDelayFrac: 0, slices, backlog: {}, io: IO, pagingFrac: 0 };
    const dps: Record<string, number> = { 'ONLCARD#1': 0xf4, 'BATCHPRD#1': 0xfb };
    const cur = evaluateLpar({ ...evalInput, dpOf: (k) => dps[k]! });
    const system: WlmSystemState = { lparId: 'SYS1', scps: cur.scps.map((t) => ({ scKey: t.scKey, dp: dps[t.scKey]!, starvedSec: 0, acc: decayInto(emptyAcc(), t) })) };
    const out = policyAdjust({ def, system, evalInput, current: cur.scps, sysplexPi: {}, clockText: 'T' });
    expect(out.protect).toBe('T SYS1 CPU PROTECTION BATCHPRD#1 DP FB→F4 below ONLCARD#1');
    expect(out.dps['BATCHPRD#1']!).toBeLessThan(out.dps['ONLCARD#1']!);
    expect(out.log ?? '').not.toContain('no action with net value');
  });
});

describe('the missing-goal rule counts smoothed zIIP use (docs/wlm-design.md §5.3)', () => {
  it('a less important receiver is not raised past a quiet zIIP class that is missing its goal', () => {
    const def = structuredClone(BASEPOL);
    const tpl = BASEPOL.classes.find((c) => c.id === 'STCLO')!;
    const cls = (id: string, velocity: number, importance: 1 | 4) => ({ ...structuredClone(tpl), id, periods: [{ goal: { kind: 'VEL' as const, velocity }, importance, durationSu: null }] });
    def.classes.push(cls('ZA', 50, 1), cls('BLO', 90, 4));
    const slices = [
      sliceSpec({ key: 'za', scKey: 'ZA#1', kind: 'AS', ziipEngines: 0.001, units: 2 }),
      sliceSpec({ key: 'blo', scKey: 'BLO#1', kind: 'AS', cpEngines: 3, units: 8 }),
    ];
    const evalInput = { cpCapacityEngines: 2, cpServers: 2, ziipCapacityEngines: 2, ziipServers: 2, cpPrsmDelayFrac: 0, slices, backlog: {}, io: IO, pagingFrac: 0 };
    const dps: Record<string, number> = { 'ZA#1': 0xf6, 'BLO#1': 0xf4 };
    const cur = evaluateLpar({ ...evalInput, dpOf: (k) => dps[k]! });
    const system: WlmSystemState = {
      lparId: 'SYS1',
      scps: cur.scps.map((t) => {
        const acc = decayInto(emptyAcc(), t);
        // ZA has used a whole zIIP for a minute and is quiet only this tick.
        return { scKey: t.scKey, dp: dps[t.scKey]!, starvedSec: 0, acc: t.scKey === 'ZA#1' ? { ...acc, ziipEngines: 1 / (1 - 0.85) } : acc };
      }),
    };
    const traces: WlmAdjustTrace[] = [];
    setWlmTraceSink((t) => traces.push(t));
    try {
      policyAdjust({ def, system, evalInput, current: cur.scps, sysplexPi: { 'ZA#1': 1.5 }, clockText: 'T' });
    } finally {
      setWlmTraceSink(null);
    }
    const blo = traces[0]!.candidates.find((c) => c.scKey === 'BLO#1')!;
    const past = blo.trials.filter((t) => /^BLO#1 DP F4→/.test(t.move) && parseInt(t.move.slice(-2), 16) >= 0xf6);
    expect(past.length).toBeGreaterThan(0);
    for (const t of past) {
      expect(t.verdict).toBe('MORE_IMPORTANT_HARMED');
      expect(t.detail).toContain('ZA#1');
    }
  });
});

describe('a receiver measured far worse than projected is not raised (projectionTrustMax, docs/wlm-design.md §9.5)', () => {
  // Midwest seed 2's shape: a runaway (importance 4) whose management PI is 56.6 while the projection, with its
  // backlog bounded, puts it at 1.15. Here: a transaction class with a large backlog and a smoothed PI far above
  // what the projection says.
  const def = structuredClone(BASEPOL);
  const tpl = BASEPOL.classes.find((c) => c.id === 'STCLO')!;
  const cls = (id: string, velocity: number, importance: 4 | 5) => ({ ...structuredClone(tpl), id, periods: [{ goal: { kind: 'VEL' as const, velocity }, importance, durationSu: null }] });
  def.classes.push(cls('RUN', 50, 4), cls('BAT', 10, 5));
  const slices = [
    sliceSpec({ key: 'run', scKey: 'RUN#1', kind: 'TXN', workloadId: 'run', rate: 100, cpEngines: 2, cpuSecPerTxn: 0.02, baseLatencySec: 0.01, rtSigma: 0.5 }),
    sliceSpec({ key: 'bat', scKey: 'BAT#1', kind: 'AS', cpEngines: 3, units: 8 }),
  ];
  const dps: Record<string, number> = { 'RUN#1': 0xe6, 'BAT#1': 0xf0 };
  const run = (backlog: Record<string, number>, plex: (basePi: number) => number) => {
    const evalInput = { cpCapacityEngines: 4, cpServers: 4, ziipCapacityEngines: 0, ziipServers: 0, cpPrsmDelayFrac: 0, slices, backlog, io: IO, pagingFrac: 0 };
    const cur = evaluateLpar({ ...evalInput, dpOf: (k) => dps[k]! });
    const system: WlmSystemState = { lparId: 'SYS1', scps: cur.scps.map((t) => ({ scKey: t.scKey, dp: dps[t.scKey]!, starvedSec: 0, acc: decayInto(emptyAcc(), t) })) };
    const go = (p: number) => {
      const traces: WlmAdjustTrace[] = [];
      setWlmTraceSink((t) => traces.push(t));
      try {
        policyAdjust({ def, system, evalInput, current: cur.scps, sysplexPi: { 'RUN#1': p }, clockText: 'T' });
      } finally {
        setWlmTraceSink(null);
      }
      return traces[0]!.candidates.find((c) => c.scKey === 'RUN#1')!;
    };
    return go(plex(go(1.5).basePi ?? 1.5));
  };
  const far = (b: number) => b * POLICY_ADJUST.projectionTrustMax + 1;

  it('rejects its receiver-up moves as PROJECTION_DISAGREES when the bound cut its backlog, and still tries donors', () => {
    const c = run({ run: 2 * 10 * 50 }, far);
    expect(c.outcome).toBe('ASSESSED');
    const up = c.trials.filter((t) => !t.move.startsWith('DONOR '));
    expect(up.length).toBeGreaterThan(0);
    for (const t of up) expect(t.verdict).toBe('PROJECTION_DISAGREES');
    expect(c.trials.some((t) => t.move.startsWith('DONOR ') && t.verdict !== 'PROJECTION_DISAGREES')).toBe(true);
  });

  it('trusts the projection when nothing was cut, however far the measured PI is', () => {
    const c = run({}, far);
    expect(c.trials.some((t) => t.verdict === 'PROJECTION_DISAGREES')).toBe(false);
  });

  it('trusts it when the measured PI is close, backlog or not', () => {
    const c = run({ run: 2 * 10 * 50 }, () => 1.5);
    expect(c.trials.some((t) => t.verdict === 'PROJECTION_DISAGREES')).toBe(false);
  });

  it('spends no projection on a PROJECTION_DISAGREES rejection (WT-05 budget)', () => {
    const all = run({ run: 2 * 10 * 50 }, far);
    const donorTrials = all.trials.filter((t) => t.move.startsWith('DONOR ')).length;
    expect(donorTrials).toBeGreaterThan(0);
    const saved = POLICY_ADJUST.maxProjectionsPerInterval;
    // Exactly enough budget for the donor trials: the receiver-up rejections before them must not use any.
    POLICY_ADJUST.maxProjectionsPerInterval = donorTrials;
    try {
      const c = run({ run: 2 * 10 * 50 }, far);
      expect(c.trials.map((t) => t.move)).toEqual(all.trials.map((t) => t.move));
      expect(c.trials.map((t) => t.verdict)).toEqual(all.trials.map((t) => t.verdict));
    } finally {
      POLICY_ADJUST.maxProjectionsPerInterval = saved;
    }
  });
});

describe('the missing-goal rule on the ladder (WT-06)', () => {
  it('a donor move is not refused for a more important period that already shared the receiver\'s level', () => {
    // MORE (imp 2, missing its goal) and RCV (imp 3) share a level; HOG (imp 5) above them is the donor. Moving HOG
    // down passes nobody, so it is judged on its projection, not refused for MORE.
    const def = structuredClone(BASEPOL);
    const tpl = BASEPOL.classes.find((c) => c.id === 'STCLO')!;
    const cls = (id: string, velocity: number, importance: 2 | 3 | 5) => ({ ...structuredClone(tpl), id, periods: [{ goal: { kind: 'VEL' as const, velocity }, importance, durationSu: null }] });
    def.classes.push(cls('MORE', 90, 2), cls('RCV', 90, 3), cls('HOG', 10, 5));
    const slices = [
      sliceSpec({ key: 'more', scKey: 'MORE#1', kind: 'AS', cpEngines: 1.5, units: 4 }),
      sliceSpec({ key: 'rcv', scKey: 'RCV#1', kind: 'AS', cpEngines: 1.5, units: 4 }),
      sliceSpec({ key: 'hog', scKey: 'HOG#1', kind: 'AS', cpEngines: 3, units: 8 }),
    ];
    const evalInput = { cpCapacityEngines: 4, cpServers: 4, ziipCapacityEngines: 0, ziipServers: 0, cpPrsmDelayFrac: 0, slices, backlog: {}, io: IO, pagingFrac: 0 };
    const dps: Record<string, number> = { 'HOG#1': 0xf6, 'MORE#1': 0xf4, 'RCV#1': 0xf4 };
    const cur = evaluateLpar({ ...evalInput, dpOf: (k) => dps[k]! });
    // MORE is on its skip clock, so the search goes on to RCV.
    const system: WlmSystemState = { lparId: 'SYS1', scps: cur.scps.map((t) => ({ scKey: t.scKey, dp: dps[t.scKey]!, starvedSec: 0, acc: decayInto(emptyAcc(), t), ...(t.scKey === 'MORE#1' ? { skipUntilTick: 100 } : {}) })) };
    const traces: WlmAdjustTrace[] = [];
    setWlmTraceSink((t) => traces.push(t));
    try {
      policyAdjust({ def, system, evalInput, current: cur.scps, sysplexPi: {}, clockText: 'T', nowTick: 0 });
    } finally {
      setWlmTraceSink(null);
    }
    const rcv = traces[0]!.candidates.find((c) => c.scKey === 'RCV#1');
    const donor = rcv?.trials.find((t) => t.move.startsWith('DONOR HOG#1'));
    expect(donor, JSON.stringify(traces[0]!.candidates.map((c) => [c.scKey, c.outcome, c.trials.map((t) => [t.move, t.verdict, t.detail])]))).toBeDefined();
    expect(donor!.detail ?? '').not.toContain('would be passed');
    // The raise past MORE is refused for it.
    expect(rcv!.trials[0]!.detail).toMatch(/^MORE#1 .*would be passed/);
  });
});


describe('donor order (WT-07, docs/wlm-design.md §5.5)', () => {
  const atRest = (importance: DonorInfo['importance'], localPi: number | null, sysplexPi = localPi, cp = 1, ziip = 0): DonorInfo => ({
    importance, localPi, sysplexPi, acc: { cpuEngines: cp / (1 - ACC_DECAY), ziipEngines: ziip / (1 - ACC_DECAY) },
  });
  const all = { ...POLICY_ADJUST, donorsPerReceiver: 100 };

  it('tries an over-achieving importance-1 period before a struggling importance-4 one', () => {
    const info = { R: atRest(2, 2), HAPPY: atRest(1, .6), STRUGGLING: atRest(4, 1.2) };
    expect(donorOrder('R', 'CPU', { R: 242, HAPPY: 246, STRUGGLING: 244 }, info)).toEqual(['HAPPY', 'STRUGGLING']);
  });

  it('orders happy periods by the worse local/sysplex PI, ignoring importance and CPU size', () => {
    const info = { R: atRest(2, 2), A: atRest(1, .2, .8, .1), B: atRest(5, .6, .3, 2), C: atRest(3, .1, .9, 4) };
    expect(donorOrder('R', 'CPU', { R: 240, A: 246, B: 244, C: 242 }, info)).toEqual(['B', 'A', 'C']);
    // A locally happy but globally missing more important period is excluded, as is the converse.
    expect(donorOrder('R', 'CPU', { R: 240, A: 246, B: 244, C: 242 }, { ...info, A: atRest(1, .2, 1.1) })).toEqual(['B', 'C']);
    expect(donorOrder('R', 'CPU', { R: 240, A: 246, B: 244, C: 242 }, { ...info, A: atRest(1, 1.1, .2) })).toEqual(['B', 'C']);
  });

  it('then takes non-happy periods from importance 5 up, best PI first and keys breaking ties', () => {
    const info = { R: atRest(3, 2), A: atRest(5, 1.4), B: atRest(5, 1.1), C: atRest(5, 1.1), D: atRest(4, 1), E: atRest(3, 1.2), EXCLUDED: atRest(2, 1.1), HAPPY: atRest(1, .9) };
    const dps = Object.fromEntries(Object.keys(info).map((k) => [k, 246]));
    expect(donorOrder('R', 'CPU', dps, info, all)).toEqual(['HAPPY', 'B', 'C', 'A', 'D', 'E']);
    expect(donorOrder('R', 'CPU', dps, info)).toEqual(['HAPPY', 'B', 'C']);
    expect(donorOrder('R', 'CPU', dps, info, { ...all, donorsPerReceiver: 0 })).toEqual([]);
  });

  it('C-2: a zIIP bottleneck takes 2 zIIP engines with no CP, not 0.2 CP with no zIIP', () => {
    const info = { R: atRest(2, 2), Z: atRest(4, .5, .5, 0, 2), CP: atRest(5, .2, .2, .2, 0) };
    const dps = { R: 242, Z: 244, CP: 246 };
    expect(donorOrder('R', 'ZIIP', dps, info)).toEqual(['Z']);
    expect(donorOrder('R', 'CPU', dps, info)).toEqual(['CP']);
  });

  it('uses the zIIP donor order in policyAdjust on a real zIIP-bound image (C-2)', () => {
    const def = structuredClone(BASEPOL);
    const template = def.classes.find((c) => c.id === 'STCLO')!;
    for (const [id, importance, velocity] of [['R', 2, 90], ['Z', 4, 5], ['CP', 5, 5]] as const) {
      def.classes.push({ ...structuredClone(template), id, cpuCritical: false,
        periods: [{ goal: { kind: 'VEL', velocity }, importance, durationSu: null }] });
    }
    const dps: Record<string, number> = { 'R#1': 242, 'Z#1': 244, 'CP#1': 246 };
    const evalInput = { cpCapacityEngines: 4, cpServers: 4, ziipCapacityEngines: 2, ziipServers: 2, cpPrsmDelayFrac: 0,
      slices: [sliceSpec({ key: 'R', scKey: 'R#1', kind: 'AS', cpEngines: 0, ziipEngines: 2, units: 2, mayOverflow: false }),
        sliceSpec({ key: 'Z', scKey: 'Z#1', kind: 'AS', cpEngines: 0, ziipEngines: 2, units: 2, mayOverflow: false }),
        sliceSpec({ key: 'CP', scKey: 'CP#1', kind: 'AS', cpEngines: .2, units: 1 })], backlog: {}, io: IO, pagingFrac: 0 };
    const current = evaluateLpar({ ...evalInput, dpOf: (k) => dps[k]! }).scps;
    const system = { lparId: 'SYS', scps: current.map((t) => ({ scKey: t.scKey, dp: dps[t.scKey]!, starvedSec: 0, acc: decayInto(emptyAcc(), t) })) };
    const traces: WlmAdjustTrace[] = [];
    setWlmTraceSink((t) => traces.push(t));
    try {
      policyAdjust({ def, system, evalInput, current, sysplexPi: {}, clockText: 'T' });
    } finally {
      setWlmTraceSink(null);
    }
    const receiver = traces[0]!.candidates.find((c) => c.scKey === 'R#1')!;
    expect(receiver.outcome).toBe('ASSESSED');
    expect(receiver.bottleneck).toBe('ZIIP');
    expect(receiver.donors).toEqual(['Z#1']);
  });

  it('uses smoothed processor use, including IIPCP, with an inclusive minimum; ignores absent old-save zIIP use', () => {
    const min = POLICY_ADJUST.donorMinEngines;
    const info = { R: atRest(2, 2), AT: atRest(4, .5, .5, min * 2), BELOW: atRest(5, .1, .1, min / 2), OLD: { ...atRest(4, .6), acc: { cpuEngines: 1 / (1 - ACC_DECAY) } } };
    expect(donorOrder('R', 'CPU', { R: 242, AT: 246, BELOW: 246, OLD: 244 }, info)).toEqual(['AT', 'OLD']);
    expect(donorOrder('R', 'ZIIP', { R: 242, AT: 246, BELOW: 246, OLD: 244 }, info)).toEqual([]);
    // A binary-exact decay makes the boundary exact too, rather than just below it through rounding.
    expect(donorOrder('R', 'CPU', { R: 242, AT: 246 }, { R: info.R, AT: { ...info.AT, acc: { cpuEngines: 2 * min } } },
      { ...POLICY_ADJUST, accDecay: .5 })).toEqual(['AT']);
    const t = { ...emptyScpTick('IIPCP#1', 246), iipcpEngines: 1 };
    const acc = decayInto(emptyAcc(), t);
    expect(donorOrder('R', 'CPU', { R: 242, IIPCP: 246 }, { R: info.R, IIPCP: { ...atRest(5, .5), acc } })).toEqual(['IIPCP']);
    // The tick is quiet now, but its decayed history still holds CPU the projection could take.
    const quiet = decayInto(acc, emptyScpTick('IIPCP#1', 246));
    expect(donorOrder('R', 'CPU', { R: 242, IIPCP: 246 }, { R: info.R, IIPCP: { ...atRest(5, .5), acc: quiet } })).toEqual(['IIPCP']);
  });

  it('excludes self, lower and absent holders; keeps inputs unchanged and key order irrelevant', () => {
    const info = { R: atRest(2, 2), LOWER: atRest(5, .1), ABSENT: atRest(5, .1), Z: atRest(4, .5), A: atRest(1, .5, null) };
    const dps = { R: 244, LOWER: 242, Z: 246, A: 244 };
    const before = structuredClone({ info, dps });
    expect(donorOrder('R', 'CPU', dps, info)).toEqual(['A', 'Z']);
    expect(donorOrder('R', 'CPU', dps, Object.fromEntries(Object.entries(info).reverse()))).toEqual(['A', 'Z']);
    expect({ info, dps }).toEqual(before);
    expect(donorOrder('MISSING', 'CPU', dps, info)).toEqual([]);
  });
});
