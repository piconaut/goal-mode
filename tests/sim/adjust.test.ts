import { POLICY_ADJUST } from '../../src/content/wlm/tuning';
import { BASEPOL } from '../../src/content/wlm/basepol';
import { enforceCpuProtection, policyAdjust, setWlmTraceSink, type WlmAdjustTrace } from '../../src/sim/wlm/adjust';
import { emptyScpTick, evaluateLpar, sliceSpec, type SliceSpec } from '../../src/sim/wlm/evaluate';
import { jobCpuDemand, jobShape, type JobDef } from '../../src/sim/subsys/batch';

const IO = { RANDOM: { rtSec: 0.0008, delaySec: 0.0002 }, SEQ: { rtSec: 0.0006, delaySec: 0.0001 } };
import { decayInto, emptyAcc, type WlmSystemState } from '../../src/sim/wlm/runtime';

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
  const dps: Record<string, number> = { 'ONLHI#1': 230, 'BATCHPRD#1': 240 };
  const cur = evaluateLpar({ ...evalInput, dpOf: (k) => dps[k]! });
  const system: WlmSystemState = {
    lparId: 'SYS1',
    scps: cur.scps.map((t) => ({ scKey: t.scKey, dp: dps[t.scKey]!, starvedSec: 0, acc: decayInto(emptyAcc(), t) })),
  };

  it('helps the important unhappy class by moving it above the less important one', () => {
    const out = policyAdjust({ def: BASEPOL, system, evalInput, current: cur.scps, sysplexPi: {}, clockText: 'T' });
    expect(out.log).toContain('RCVR=ONLHI#1');
    expect(out.dps['ONLHI#1']!).toBeGreaterThan(out.dps['BATCHPRD#1']!);
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
  // Controlled shared-region case based on the save's no-zIIP F2→F4 sequence.
  const def = structuredClone(BASEPOL);
  def.classes.push({ ...structuredClone(def.classes.find((c) => c.id === 'ONLHI')!), id: 'ONLCARD', periods: [{ goal: { kind: 'PCT', pct: 99, rtSec: .1 }, importance: 2, durationSu: null }] });
  const dps: Record<string, number> = { 'ONLCARD#1': 0xf4, 'STCHI#1': 0xfa, 'BATCHPRD#1': 0xf2, 'STCLO#1': 0xf3 };
  const run = (batchCp: number) => {
    const slices = [
      sliceSpec({ key: 'card', scKey: 'ONLCARD#1', kind: 'TXN', workloadId: 'CARD', rate: 200, cpEngines: .2, cpuSecPerTxn: .001, baseLatencySec: .025, rtSigma: .4, goalRtSec: .1, timeoutSec: 30 }),
      sliceSpec({ key: 'aor', scKey: 'STCHI#1', kind: 'AS', role: 'CICS.AOR', cpEngines: .1, units: 1 }),
      sliceSpec({ key: 'batch', scKey: 'BATCHPRD#1', kind: 'AS', cpEngines: batchCp, units: 20 }),
      sliceSpec({ key: 'other', scKey: 'STCLO#1', kind: 'AS', cpEngines: 1.5, units: 4 }),
    ];
    const evalInput = { cpCapacityEngines: 4, cpServers: 4, ziipCapacityEngines: 0, ziipServers: 0, cpPrsmDelayFrac: 0, slices, backlog: {}, io: IO, pagingFrac: 0, regions: { keys: ['ONLCARD#1'], mode: 'TRANSACTION' as const, regionKey: 'STCHI#1', servers: ['aor'] } };
    const current = evaluateLpar({ ...evalInput, dpOf: (k) => dps[k]! });
    const system: WlmSystemState = { lparId: 'SYS1', scps: current.scps.map((t) => ({ scKey: t.scKey, dp: dps[t.scKey]!, starvedSec: 0, acc: decayInto(emptyAcc(), t) })) };
    return policyAdjust({ def, system, evalInput, current: current.scps, sysplexPi: {}, clockText: 'T' });
  };
  expect(run(3).dps['BATCHPRD#1']).toBe(0xf4);
  expect(run(savedReadyDemand()).dps['BATCHPRD#1']).toBe(0xf2);
});

describe('equal-importance moves narrow the PI gap (SG24-6472 p.60; Enrico, How WLM Works, slide 52)', () => {
  // ONLMED and DDFPRD period 1 are both importance 2; ONLMED (PI 4) sits below DDFPRD on a saturated image.
  const run = (ddfLatencySec: number) => {
    const slices = [slice('A', 'ONLMED#1', 2.5, 0.5), { ...slice('B', 'DDFPRD#1', 1, 0.5), baseLatencySec: ddfLatencySec }];
    const evalInput = { cpCapacityEngines: 3.5, cpServers: 4, ziipCapacityEngines: 0, ziipServers: 0, cpPrsmDelayFrac: 0, slices, backlog: {}, io: IO, pagingFrac: 0 };
    const dps: Record<string, number> = { 'ONLMED#1': 230, 'DDFPRD#1': 240 };
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
    const dps: Record<string, number> = { 'ONLMED#1': 230, 'DDFPRD#1': 240, 'IONOW#1': 0xf0 };
    const cur = evaluateLpar({ ...evalInput, dpOf: (k) => dps[k]! });
    const system: WlmSystemState = {
      lparId: 'SYS1',
      scps: [...cur.scps.map((t) => ({ scKey: t.scKey, dp: dps[t.scKey]!, starvedSec: 0, acc: decayInto(emptyAcc(), t) })),
        { scKey: 'IONOW#1', dp: 0xf0, starvedSec: 0, acc: { ...emptyAcc(), using: 0.01, delay: 5, delayIo: 5 } }],
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

  it('still assesses at most receiversPerImportance (default two) receivers per importance', () => {
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
    const traces: WlmAdjustTrace[] = [];
    setWlmTraceSink((t) => traces.push(t));
    try {
      policyAdjust({ def: wide, system: system3, evalInput: input3, current: cur3.scps, sysplexPi: { 'OLD1#1': 2.1, 'OLD2#1': 1.7, 'OLD3#1': 1.5 }, clockText: 'T' });
    } finally {
      setWlmTraceSink(null);
    }
    const b = traces[0]!.candidates.filter((c) => c.outcome === 'BUDGET').map((c) => c.scKey);
    expect(b).toEqual(['OLD3#1']);
    // The limit comes from the adjust input; a limit below 1 is clamped to 1.
    for (const [limit, budget] of [[1, ['OLD2#1', 'OLD3#1']], [0, ['OLD2#1', 'OLD3#1']], [3, []]] as const) {
      const tr: WlmAdjustTrace[] = [];
      setWlmTraceSink((t) => tr.push(t));
      try {
        policyAdjust({ def: wide, system: system3, evalInput: input3, current: cur3.scps, sysplexPi: { 'OLD1#1': 2.1, 'OLD2#1': 1.7, 'OLD3#1': 1.5 }, clockText: 'T', receiversPerImportance: limit });
      } finally {
        setWlmTraceSink(null);
      }
      expect(tr[0]!.candidates.filter((c) => c.outcome === 'BUDGET').map((c) => c.scKey)).toEqual(budget);
    }
  });

  it('skips past a spent budget to the next importance whether traced or not', () => {
    // Three importance-1 receivers that find nothing (PR/SM delay: no DP move helps) spend the importance-1 budget;
    // the importance-2 class behind them must still be helped in the untraced (production) path, not only when
    // the trace is on.
    const wide = structuredClone(BASEPOL);
    wide.classes.push(cls('OLD1', 90, 1), cls('OLD2', 90, 1), cls('OLD3', 90, 1), cls('ONLCARD', 95, 2));
    const bat = structuredClone(BASEPOL.classes.find((c) => c.id === 'STCLO')!);
    bat.id = 'BAT';
    bat.periods = [{ goal: { kind: 'VEL', velocity: 10 }, importance: 5, durationSu: null }];
    wide.classes.push(bat);
    const sl = [
      sliceSpec({ key: 'old1', scKey: 'OLD1#1', kind: 'AS', cpEngines: 0.5, units: 4 }),
      sliceSpec({ key: 'old2', scKey: 'OLD2#1', kind: 'AS', cpEngines: 0.5, units: 4 }),
      sliceSpec({ key: 'old3', scKey: 'OLD3#1', kind: 'AS', cpEngines: 0.5, units: 4 }),
      sliceSpec({ key: 'card', scKey: 'ONLCARD#1', kind: 'AS', cpEngines: 1.5, units: 8 }),
      sliceSpec({ key: 'bat', scKey: 'BAT#1', kind: 'AS', cpEngines: 3, units: 8 }),
    ];
    const input = { ...evalInput, cpPrsmDelayFrac: 0.3, slices: sl };
    const d: Record<string, number> = { 'OLD1#1': 0xf4, 'OLD2#1': 0xf3, 'OLD3#1': 0xf2, 'BAT#1': 0xf0, 'ONLCARD#1': 0xe6 };
    const c = evaluateLpar({ ...input, dpOf: (k) => d[k]! });
    const sys: WlmSystemState = {
      lparId: 'SYS1',
      scps: c.scps.map((t) => ({ scKey: t.scKey, dp: d[t.scKey]!, starvedSec: 0, acc: decayInto(emptyAcc(), t) })),
    };
    const run = () => policyAdjust({ def: wide, system: sys, evalInput: input, current: c.scps, sysplexPi: { 'OLD1#1': 2.1, 'OLD2#1': 1.7, 'OLD3#1': 1.5 }, clockText: 'T' });
    const plain = run();
    const traces: WlmAdjustTrace[] = [];
    setWlmTraceSink((t) => traces.push(t));
    let traced;
    try {
      traced = run();
    } finally {
      setWlmTraceSink(null);
    }
    expect(traces[0]!.candidates.find((x) => x.scKey === 'OLD3#1')!.outcome).toBe('BUDGET');
    expect(plain.log).toMatch(/RCVR=ONLCARD#1 /);
    expect(plain.log).toBe(traced.log);
    expect(plain.dps).toEqual(traced.dps);
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
    expect(out.dps).toEqual({ 'ONLRBANK#1': 0xf4, 'BATCHHI#1': 0xf3, 'BATCHPRD#1': 0xf3, 'ONLHI#1': 0xfc });
    expect(out.moves).toEqual(['BATCHHI#1 DP F9→F3', 'BATCHPRD#1 DP FB→F3']);
  });

  it('changes nothing when protection already holds, and CCIMP protects first periods up to that importance', () => {
    expect(enforceCpuProtection({ 'ONLRBANK#1': 0xf4, 'BATCHHI#1': 0xf2, 'BATCHPRD#1': 0xf0, 'ONLHI#1': 0xfc }, info, 0).moves).toEqual([]);
    const cc = enforceCpuProtection({ 'ONLRBANK#1': 0xfa, 'BATCHHI#1': 0xf2, 'BATCHPRD#1': 0xf0, 'ONLHI#1': 0xf0 }, info, 1);
    expect(cc.dps['ONLRBANK#1']).toBe(0xef);
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
    expect(out.protect).toBe('T SYS1 CPU PROTECTION BATCHPRD#1 DP FB→F3');
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
    const dps: Record<string, number> = { 'ZA#1': 0xf0, 'BLO#1': 0xe6 };
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
    const past = blo.trials.filter((t) => /BLO#1 DP E6→F[0-9A-F]/.test(t.move) && parseInt(t.move.slice(-2), 16) >= 0xf0);
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
});
