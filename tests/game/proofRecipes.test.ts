// Proof recipes (RT-13, docs/rca-design.md §4.6): every claim has a recipe a set of pins can satisfy, look-alikes fail
// each other's recipes, the common recipes have a tier-0/1 path, three pins carry both recipes for every pair but the
// listed ones, and the RCA scores the proof rather than the relevance sum.
import { beforeAll, describe, expect, it } from 'vitest';
import {
  EVIDENCE,
  EVIDENCE_METRICS,
  MECHANISM_RECIPES,
  METRIC_TIER,
  PROOF,
  TRIGGER_RECIPES,
  type EvidenceMetric,
  type PredicateOption,
  type ProofRecipe,
} from '../../src/content/evidence';
import { MIDWEST_GAME } from '../../src/content/game-midwest';
import { MIDWEST } from '../../src/content/scenarios';
import { addPin, incidentSubjects, type EvidencePin } from '../../src/game/evidence';
import { judgeProof, proofLines } from '../../src/game/proof';
import { db2Accounting } from '../../src/game/smf';
import { advance, chooseDraft, newRun, startDay, submitRca } from '../../src/game/run';
import { TICKS_PER_DAY } from '../../src/sim/core/units';
import { MECHANISMS, TRIGGERS } from '../../src/game/sla';
import type { Incident, IncidentSubjects, Mechanism, RunState, Trigger } from '../../src/game/types';
import { minPins } from '../helpers/proofPins';
import { MIDWEST_EVENTS } from '../../src/content/events/midwest-events';
import type { Command } from '../../src/sim/core/commands';

const content = { ...MIDWEST_GAME, events: [] };
const HOUR = 360;
let noon: RunState;
/** The fixture state: `day2` with a class row that only the last interval carries, new work's (a day of report
 * without it first, as "no history" needs). */
let fixtureRun: RunState;
/** Noon on the second day: a pin's ended rate compares with the same interval the day before (the slot baseline). */
let day2: RunState;

beforeAll(() => {
  noon = advance(startDay(newRun(MIDWEST, content, 7), content), MIDWEST, content, 6 * HOUR);
  // A critical job ABENDs at 22:00 on day 1 (JOB_ABEND's command), so the night has a failure to pin.
  const late = advance(noon, MIDWEST, content, 10 * HOUR);
  const night = advance({ ...late, pendingCommands: [{ kind: 'ABEND_JOB', critical: true }] }, MIDWEST, content, TICKS_PER_DAY);
  day2 = advance(startDay(chooseDraft(night, content, null), content), MIDWEST, content, 6 * HOUR);
  const ivs = day2.sim.rmf.intervals;
  const lastIv = ivs.at(-1)!;
  const template = lastIv.wlm.find((w) => w.lparId === 'PROD1' && w.scKey === 'TSO#1')!;
  fixtureRun = { ...day2, sim: { ...day2.sim, rmf: { ...day2.sim.rmf, intervals: [...ivs.slice(0, -1), { ...lastIv, wlm: [...lastIv.wlm, { ...template, scKey: 'NEWAPP#1' }] }] } } };
}, 120_000);

/** Claims proven by a test from replayed report rows; the last replay test checks it covers every claim. */
const REPLAYED = new Set<Mechanism | Trigger>();

const recipeOf = (claim: Mechanism | Trigger): ProofRecipe =>
  (MECHANISM_RECIPES as Record<string, ProofRecipe>)[claim] ?? (TRIGGER_RECIPES as Record<string, ProofRecipe>)[claim]!;
const CLAIMS: (Mechanism | Trigger)[] = [...MECHANISMS, ...TRIGGERS];

// ---------------------------------------------------------------------------------------------------------------
// Fixture pins: one pin per option, shaped like the report row the option reads, on one of three incident kinds.

type Kind = 'CICS' | 'DDF' | 'BATCH';

const fixtureIncident = (r: RunState, kind: Kind, truth: Incident['truth']): Incident => {
  const workloadId = kind === 'CICS' ? 'RBANK' : kind === 'DDF' ? 'MOBILE' : 'BATCH';
  const subjects: IncidentSubjects = kind === 'BATCH'
    ? { classes: ['BATCHPRD'], lpars: ['PROD1'], hosts: ['PROD1'], servers: [] }
    : incidentSubjects(r, MIDWEST, workloadId, 0);
  return { id: 999, workloadId, day: 0, startTick: r.sim.tick - HOUR, endTick: null, hours: 1, worstAttainmentPct: 80, truth, rca: null, trustLost: 0, subjects };
};

const WLM_FAMILY = new Set<EvidenceMetric>(['PI', 'APPL', 'APPL_CP', 'APPL_IIP', 'IIPCP', 'ENDED_RATE', 'CPU_PER_TXN', 'DELAY_CPU', 'DELAY_ZIIP', 'DELAY_IO', 'DELAY_STO', 'DELAY_CAP', 'DELAY_OTHER', 'WM_LOCK', 'WM_READY']);
const DB2_FAMILY = new Set<EvidenceMetric>(['CPU_VS_BASE', 'LOCK_WAIT', 'SYNC_IO', 'CF_WAIT', 'DBAT_QUEUE']);
const CICS_FAMILY = new Set<EvidenceMetric>(['QR_WAIT', 'MXT_WAIT', 'FAIL_PCT']);

/** Where a pin of this metric and relation sits for this incident kind, or null when no report row is one. */
function placeFor(kind: Kind, o: PredicateOption, relation: string): Pick<EvidencePin, 'source' | 'subject' | 'system'> | null {
  const own = kind === 'CICS' ? 'ONLHI' : kind === 'DDF' ? 'DDFPRD' : 'BATCHPRD';
  const workloadId = kind === 'CICS' ? 'RBANK' : kind === 'DDF' ? 'MOBILE' : 'BATCH';
  const m = o.metric;
  if (WLM_FAMILY.has(m)) {
    // New work's row: a class no earlier interval carried (the work's own classes always have history here).
    if (o.test.kind === 'noHistory') return relation === 'competitor' ? { source: 'WLMGL', subject: 'NEWAPP#1', system: 'PROD1' } : null;
    // A displaceable row of the work's own class is a less important period: only DDFPRD has one.
    if (relation === 'self') return o.displaceable ? (kind === 'DDF' ? { source: 'WLMGL', subject: 'DDFPRD#2', system: 'PROD1' } : null) : { source: 'WLMGL', subject: `${own}#1`, system: 'PROD1' };
    if (relation === 'server') return kind === 'CICS' ? { source: 'WLMGL', subject: 'STCHI#1', system: 'PROD1' } : null;
    if (relation === 'competitor') return { source: 'WLMGL', subject: o.batchClass ? (kind === 'BATCH' ? 'DEVBAT#1' : 'BATCHPRD#1') : o.displaceable ? 'STCLO#1' : 'TSO#1', system: 'PROD1' };
    return null;
  }
  if (relation === 'host') {
    if (m === 'CPC_BUSY' || m === 'CAPACITY_ADJ') return { source: 'CPC', subject: 'CPCA', system: 'CPCA' };
    if (m === 'CAPPED' || m === 'LPAR_BUSY' || m === 'PRSM_DELAY') return { source: 'CPC', subject: 'PROD1', system: 'PROD1' };
    return null;
  }
  if (m === 'CF_SYNC' || m === 'CF_ASYNC_PCT') return relation === 'server' ? { source: 'CF', subject: 'CF01', system: 'CF01' } : null;
  if (m.startsWith('DASD_')) return relation === 'server' ? { source: 'DASD', subject: '21', system: '*PLEX' } : null;
  if (DB2_FAMILY.has(m)) return relation === 'self' && kind !== 'BATCH' ? { source: 'Db2 101', subject: workloadId, system: '*PLEX' } : null;
  if (CICS_FAMILY.has(m)) return relation === 'self' && kind === 'CICS' ? { source: 'CICS 110', subject: workloadId, system: '*PLEX' } : null;
  if (m === 'SOS_MIN') return relation === 'server' && kind === 'CICS' ? { source: 'CICS 110', subject: 'CICSAOR1', system: '*PLEX' } : null;
  if (m === 'JOB_APPL') {
    if (relation === 'server') return kind === 'CICS' ? { source: 'PROCU', subject: 'CICSAOR1', system: 'PROD1' } : null;
    // MONAGENT runs in STCMED (importance 3), below every hurt class here.
    if (relation === 'competitor') return { source: 'PROCU', subject: 'MONAGENT', system: 'PROD1' };
    return null;
  }
  if (m.startsWith('JOB_')) return relation === 'self' && kind === 'BATCH' ? { source: 'SMF 30', subject: 'BATCH', system: '*PLEX' } : null;
  return null;
}

/** A reading that passes the option's test: [value, baseline]. PROD1 has 6 logical CPs. */
function readingFor(o: PredicateOption): [number, number | undefined] {
  const t = o.test;
  switch (t.kind) {
    case 'atLeast': return [t.value + 1, undefined];
    case 'below': return [t.value / 2, undefined];
    case 'notable': {
      const d = EVIDENCE_METRICS[o.metric];
      return d.notableMultiple !== undefined ? [Math.max(d.notableAt, d.notableMultiple) * 2 + 1, 1] : [d.notableAt * 2 + 1, undefined];
    }
    case 'ratioAtLeast': return [100 * t.ratio + 1, 100];
    case 'normal': return [100, 100];
    case 'riseBy': return [10 + t.points + 1, 10];
    case 'shareOfImage': return [t.frac * 100 * 6 + 1, undefined];
    case 'noHistory': return [50, undefined];
  }
}

/** A pin satisfying the option for an incident of this kind, or null when the option's rows don't exist for it. */
function pinFor(r: RunState, kind: Kind, o: PredicateOption, id: number): EvidencePin | null {
  for (const relation of o.relations) {
    const place = placeFor(kind, o, relation);
    if (!place) continue;
    const [value, baseline] = readingFor(o);
    const tick = r.sim.rmf.intervals.at(-1)!.endTick;
    const base = { id, metric: o.metric, tick, text: `fixture ${o.metric}`, ...place };
    if (o.reading === 'rate') return { ...base, value: 100, baseline: 100, rate: { value, ...(baseline !== undefined ? { baseline } : {}) } };
    return { ...base, value, ...(baseline !== undefined ? { baseline } : {}) };
  }
  return null;
}

const KINDS: Kind[] = ['CICS', 'DDF', 'BATCH'];

describe('proof recipe vocabulary (RT-13)', () => {
  it('gives every mechanism and trigger a two-predicate recipe with options on known metrics', () => {
    expect(Object.keys(MECHANISM_RECIPES).sort()).toEqual([...MECHANISMS].sort());
    expect(Object.keys(TRIGGER_RECIPES).sort()).toEqual([...TRIGGERS].sort());
    for (const claim of CLAIMS) {
      const r = recipeOf(claim);
      expect(r.predicates, claim).toHaveLength(2);
      for (const p of r.predicates) {
        expect(p.label.length, claim).toBeGreaterThan(10);
        expect(p.options.length, claim).toBeGreaterThan(0);
        for (const o of p.options) expect(EVIDENCE_METRICS[o.metric], `${claim} ${o.metric}`).toBeDefined();
      }
    }
  });

  it('lets one pin complete a recipe only where its row shows both facts: a cost per transaction beside its rate', () => {
    const single = CLAIMS.filter((c) => minPins(recipeOf(c).predicates).pins < 2);
    expect(single.sort()).toEqual(['CHANGE_REGRESSION', 'DEMAND_SURGE']);
    for (const c of single) expect(minPins(recipeOf(c).predicates).options.some((o) => o.reading === 'rate'), c).toBe(true);
  });

  it('makes every option satisfiable by a pin of the row it reads, on some incident', () => {
    const unreachable: string[] = [];
    for (const claim of CLAIMS) for (const pred of recipeOf(claim).predicates) for (const o of pred.options) {
      const ok = KINDS.some((kind) => {
        const pin = pinFor(fixtureRun, kind, o, 1000);
        if (!pin) return false;
        const inc = fixtureIncident(fixtureRun, kind, { mechanism: 'CPU_PRIORITY', trigger: 'POLICY' });
        const proof = judgeProof(fixtureRun, MIDWEST, [inc], MECHANISMS.includes(claim as Mechanism) ? claim as Mechanism : 'CPU_PRIORITY',
          TRIGGERS.includes(claim as Trigger) ? claim as Trigger : 'POLICY', [pin]);
        const check = MECHANISMS.includes(claim as Mechanism) ? proof.mechanism : proof.trigger;
        return check.predicates[recipeOf(claim).predicates.indexOf(pred)]!.met;
      });
      if (!ok) unreachable.push(`${claim} ${o.metric} ${o.test.kind}`);
    }
    expect(unreachable).toEqual([]);
  });

  it.each(CLAIMS)('completes the %s recipe from fixture pins and not from one predicate alone', (claim) => {
    const isMech = MECHANISMS.includes(claim as Mechanism);
    const done = KINDS.some((kind) => {
      const pins = recipeOf(claim).predicates.map((pred, k) => pred.options.map((o) => pinFor(fixtureRun, kind, o, 1000 + k)).find((p) => p !== null) ?? null);
      if (pins.some((p) => p === null)) return false;
      const inc = fixtureIncident(fixtureRun, kind, { mechanism: 'CPU_PRIORITY', trigger: 'POLICY' });
      const judge = (ps: EvidencePin[]) => {
        const r = judgeProof(fixtureRun, MIDWEST, [inc], isMech ? claim as Mechanism : 'CPU_PRIORITY', isMech ? 'POLICY' : claim as Trigger, ps);
        return isMech ? r.mechanism : r.trigger;
      };
      const full = judge(pins as EvidencePin[]);
      if (!full.complete) return false;
      // One pin of a two-pin proof leaves the recipe incomplete (the one-pin recipes are the cost rows above).
      if (minPins(recipeOf(claim).predicates).pins >= 2) expect(judge([pins[0]!]).complete, claim).toBe(false);
      return true;
    });
    expect(done).toBe(true);
  });
});

/** Pairs whose two recipes need a fourth pin: four separate facts with no row showing two of them. BACKLOG RT-27
 * holds the design question. The pairs a shipped card can produce are marked in the BACKLOG entry. */
const FOUR_PIN_PAIRS = [
  'CPU_CAPACITY×RUNAWAY_WORK', 'CPU_CAPACITY×BATCH_OVERLAP', 'CPU_CAPACITY×APPLICATION_ERROR', 'CPU_PRIORITY×HARDWARE_FAULT',
  'CPU_PRIORITY×APPLICATION_ERROR', 'CAPPING×RUNAWAY_WORK', 'CAPPING×BATCH_OVERLAP', 'CAPPING×HARDWARE_FAULT',
  'CAPPING×APPLICATION_ERROR', 'DEPENDENCY×RUNAWAY_WORK', 'DEPENDENCY×BATCH_OVERLAP', 'DEPENDENCY×APPLICATION_ERROR',
  'LOCK_CONTENTION×RUNAWAY_WORK', 'LOCK_CONTENTION×APPLICATION_ERROR', 'CF_SERVICE×RUNAWAY_WORK', 'CF_SERVICE×BATCH_OVERLAP',
  'CF_SERVICE×APPLICATION_ERROR', 'QR_TCB×RUNAWAY_WORK', 'QR_TCB×BATCH_OVERLAP', 'QR_TCB×HARDWARE_FAULT',
  'QR_TCB×APPLICATION_ERROR', 'THREAD_LIMIT×BATCH_OVERLAP', 'ROUTING×BATCH_OVERLAP', 'IO×RUNAWAY_WORK',
  'IO×APPLICATION_ERROR', 'STORAGE×RUNAWAY_WORK', 'STORAGE×BATCH_OVERLAP', 'JOB_FAILURE×RUNAWAY_WORK', 'JOB_FAILURE×BATCH_OVERLAP',
];

describe('documented values (RT-13)', () => {
  it('scores what SPEC §10 states: 3 for a recipe, 0.5 for one predicate, +5 Insight for strong evidence', () => {
    expect([PROOF.recipePoints, PROOF.partialPoints, EVIDENCE.strongInsight, EVIDENCE.perRca]).toEqual([3, 0.5, 5, 3]);
  });

  it('puts the symptom first and the discriminator second in every recipe', () => {
    // The first words of each predicate's label: the symptom (what hurt the work), then what tells the cause apart.
    const order = Object.fromEntries(CLAIMS.map((c) => [c, recipeOf(c).predicates.map((p) => p.label.split(/[:(]/)[0]!.trim())]));
    expect(order).toEqual({
      CPU_CAPACITY: ['CPU or zIIP delay ≥ 10 % on the hurt class or its regions', 'the processor full'],
      CPU_PRIORITY: ['CPU or zIIP delay ≥ 10 % on the hurt class or its regions', 'a displaceable consumer on that host'],
      CAPPING: ['CPU delay ≥ 10 % on the hurt class or its regions', 'a cap held it'],
      DEPENDENCY: ['the server slow', 'the hurt class\'s own CPU delay < 10 %'],
      LOCK_CONTENTION: ['lock waits on the hurt work', 'the hurt class\'s own CPU delay < 10 %'],
      CF_SERVICE: ['CF time per transaction ≥ 5 ms or past its normal band', 'the CF itself slow'],
      QR_TCB: ['QR TCB wait ≥ 5 ms/txn', 'not the task limit or the CPU'],
      THREAD_LIMIT: ['queued for a slot', 'not slower work holding the slots'],
      ROUTING: ['transactions failed', 'the work itself unchanged'],
      IO: ['I/O waits on the hurt work', 'DASD itself slow'],
      STORAGE: ['storage waits', 'the hurt class\'s own CPU delay < 10 %'],
      JOB_FAILURE: ['critical jobs ABENDed', 'they failed rather than ran late'],
      DEMAND_SURGE: ['more work', 'at the same cost'],
      CHANGE_REGRESSION: ['the same work costs more', 'not more of it'],
      RUNAWAY_WORK: ['one class or job up by half an engine', 'without more work to show for it'],
      BATCH_OVERLAP: ['lock or I/O waits on the hurt work', 'batch running then'],
      POLICY: ['the hurt work delayed', 'the work itself unchanged'],
      HARDWARE_FAULT: ['the resource\'s own report', 'the work itself unchanged'],
      NEW_WORKLOAD: ['the hurt work delayed', 'work with no history'],
      GROWTH: ['the hurt work delayed', 'the work itself unchanged'],
      APPLICATION_ERROR: ['the software misbehaved', 'the work itself unchanged'],
    });
  });
});

describe('the three-pin limit (RT-13)', () => {
  it('carries both recipes in three pins for every mechanism × trigger pair but the listed ones', () => {
    expect(EVIDENCE.perRca).toBe(3);
    const over = MECHANISMS.flatMap((m) => TRIGGERS.filter((t) =>
      minPins([...MECHANISM_RECIPES[m].predicates, ...TRIGGER_RECIPES[t].predicates]).pins > EVIDENCE.perRca).map((t) => `${m}×${t}`));
    expect(over).toEqual(FOUR_PIN_PAIRS);
    // None of them needs more than four.
    for (const pair of over) {
      const [m, t] = pair.split('×') as [Mechanism, Trigger];
      expect(minPins([...MECHANISM_RECIPES[m].predicates, ...TRIGGER_RECIPES[t].predicates]).pins, pair).toBe(4);
    }
  });
});

describe('tier-0/1 paths (RT-13)', () => {
  const COMMON: (Mechanism | Trigger)[] = ['CPU_CAPACITY', 'CPU_PRIORITY', 'CAPPING', 'DEPENDENCY', 'DEMAND_SURGE', 'CHANGE_REGRESSION', 'RUNAWAY_WORK'];

  it.each(COMMON)('proves %s with Workload Activity, Monitor III and Partition Data rows only', (claim) => {
    const cheap = recipeOf(claim).predicates.map((p) => ({ ...p, options: p.options.filter((o) => METRIC_TIER[o.metric] <= 1) }));
    expect(cheap.every((p) => p.options.length > 0), claim).toBe(true);
    // And one such pin set really completes it (the fixture rows are WLMGL, CPC and PROCU).
    const done = KINDS.some((kind) => {
      const pins = cheap.map((pred, k) => pred.options.map((o) => pinFor(fixtureRun, kind, o, 1000 + k)).find((p) => p !== null) ?? null);
      if (pins.some((p) => p === null)) return false;
      expect(pins.every((p) => ['WLMGL', 'CPC', 'PROCU'].includes(p!.source)), claim).toBe(true);
      const isMech = MECHANISMS.includes(claim as Mechanism);
      const r = judgeProof(fixtureRun, MIDWEST, [fixtureIncident(fixtureRun, kind, { mechanism: 'CPU_PRIORITY', trigger: 'POLICY' })],
        isMech ? claim as Mechanism : 'CPU_PRIORITY', isMech ? 'POLICY' : claim as Trigger, pins as EvidencePin[]);
      return (isMech ? r.mechanism : r.trigger).complete;
    });
    expect(done, claim).toBe(true);
  });

  it('tiers each metric by the cheapest report that pins it: Workload Activity is tier 0', () => {
    const iv = noon.sim.rmf.intervals.length - 1;
    const rows = noon.sim.rmf.intervals[iv]!.wlm;
    for (const metric of Object.keys(EVIDENCE_METRICS) as EvidenceMetric[]) {
      const wlmgl = rows.some((w) => addPin(noon, MIDWEST, { source: 'WLMGL', index: iv, system: w.lparId, scKey: w.scKey, metric }).ok);
      expect(wlmgl, metric).toBe(METRIC_TIER[metric] === 0);
    }
    // Tier 1: Partition Data and Monitor III (CPC, PROCU, SYSWKM).
    for (const metric of ['CAPPED', 'LPAR_BUSY', 'PRSM_DELAY', 'CPC_BUSY', 'CAPACITY_ADJ'] as const) {
      expect(addPin(noon, MIDWEST, { source: 'CPC', index: iv, lparId: 'PROD1', metric }).ok, metric).toBe(true);
      expect(METRIC_TIER[metric], metric).toBe(1);
    }
    expect(METRIC_TIER.JOB_APPL).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Replays: real report rows from a midwest day, a change pushed at noon and an hour run on.

describe('proofs from replayed incidents (RT-13)', () => {
  const after = (mod: 'cpu' | 'rate', key: string, value: number): RunState =>
    advance({ ...day2, pendingCommands: [{ kind: 'SET_MODIFIER', mod, key, value }] }, MIDWEST, content, HOUR);
  const mobileIncident = (r: RunState, truth: Incident['truth']): Incident =>
    ({ ...fixtureIncident(r, 'DDF', truth), subjects: incidentSubjects(day2, MIDWEST, 'MOBILE', day2.day) });

  it('reads an ended rate against the same interval on earlier days, so the morning ramp is not a surge', () => {
    const i = last(day2);
    const { pins } = pinAll(day2, [{ source: 'WLMGL', index: i, system: 'PROD2', scKey: 'DDFPRD#1', metric: 'CPU_PER_TXN' }]);
    const p = pins[0]!;
    const yesterday = day2.sim.rmf.intervals.find((x) => x.endTick === day2.sim.rmf.intervals[i]!.endTick - TICKS_PER_DAY)!;
    expect(p.rate!.baseline).toBe(yesterday.wlm.find((w) => w.lparId === 'PROD2' && w.scKey === 'DDFPRD#1')!.endPerSec);
    expect(Math.abs(p.rate!.value / p.rate!.baseline! - 1)).toBeLessThan(PROOF.normalBand);
    // Unchanged work at noon proves neither trigger.
    const inc = mobileIncident(day2, { mechanism: 'CPU_CAPACITY', trigger: 'POLICY' });
    for (const t of ['DEMAND_SURGE', 'CHANGE_REGRESSION'] as const) expect(judgeProof(day2, MIDWEST, [inc], 'CPU_CAPACITY', t, pins).trigger.complete, t).toBe(false);
  });
  const pinAll = (r: RunState, reqs: Parameters<typeof addPin>[2][]): { run: RunState; pins: EvidencePin[] } => {
    let run = r;
    for (const req of reqs) {
      const out = addPin(run, MIDWEST, req);
      expect(out.ok, out.message).toBe(true);
      run = out.run;
    }
    return { run, pins: run.pins.slice(-reqs.length) };
  };
  const last = (r: RunState) => r.sim.rmf.intervals.length - 1;

  it('proves a change regression from one Workload Activity row and fails the surge recipe on it', () => {
    const r = after('cpu', 'MOBILE', 2);
    const { run, pins } = pinAll(r, [{ source: 'WLMGL', index: last(r), system: 'PROD2', scKey: 'DDFPRD#1', metric: 'CPU_PER_TXN' }]);
    const p = pins[0]!;
    expect(p.value / p.baseline!).toBeGreaterThan(PROOF.regressionRatio);
    expect(p.text).toMatch(/CP ms\/txn .* at \d+\.?\d* \/s$/);
    const inc = mobileIncident(run, { mechanism: 'CPU_CAPACITY', trigger: 'CHANGE_REGRESSION' });
    expect(judgeProof(run, MIDWEST, [inc], 'CPU_CAPACITY', 'CHANGE_REGRESSION', pins).trigger.complete).toBe(true);
    REPLAYED.add('CHANGE_REGRESSION');
    expect(judgeProof(run, MIDWEST, [inc], 'CPU_CAPACITY', 'DEMAND_SURGE', pins).trigger).toMatchObject({ complete: false });
  });

  it('proves a demand surge from the same row shape and fails the regression recipe on it', () => {
    const r = after('rate', 'MOBILE', 1.8);
    const { run, pins } = pinAll(r, [{ source: 'WLMGL', index: last(r), system: 'PROD1', scKey: 'DDFPRD#1', metric: 'CPU_PER_TXN' }]);
    const p = pins[0]!;
    expect(p.rate!.value / p.rate!.baseline!).toBeGreaterThan(PROOF.surgeRatio);
    const inc = mobileIncident(run, { mechanism: 'CPU_CAPACITY', trigger: 'DEMAND_SURGE' });
    expect(judgeProof(run, MIDWEST, [inc], 'CPU_CAPACITY', 'DEMAND_SURGE', pins).trigger.complete).toBe(true);
    REPLAYED.add('DEMAND_SURGE');
    expect(judgeProof(run, MIDWEST, [inc], 'CPU_CAPACITY', 'CHANGE_REGRESSION', pins).trigger.complete).toBe(false);
  });

  it('separates capacity from priority: a full processor proves one, a displaceable consumer the other', () => {
    // MOBILE costing twice as much fills CPCA (98 % CP busy) and its PROD2 rows wait for CPU.
    const r = after('cpu', 'MOBILE', 2);
    const i = last(r);
    const delay = { source: 'WLMGL' as const, index: i, system: 'PROD2', scKey: 'DDFPRD#1', metric: 'DELAY_CPU' as const };
    const full = pinAll(r, [delay, { source: 'CPC', index: i, lparId: 'PROD2', metric: 'CPC_BUSY' }]);
    const inc = mobileIncident(full.run, { mechanism: 'CPU_CAPACITY', trigger: 'CHANGE_REGRESSION' });
    expect(judgeProof(full.run, MIDWEST, [inc], 'CPU_CAPACITY', 'CHANGE_REGRESSION', full.pins).mechanism.complete).toBe(true);
    REPLAYED.add('CPU_CAPACITY');
    expect(judgeProof(full.run, MIDWEST, [inc], 'CPU_PRIORITY', 'CHANGE_REGRESSION', full.pins).mechanism.complete).toBe(false);
    // ADHOC's runaway queries in DDFPRD#2 (importance 4) beside MOBILE in DDFPRD#1 (importance 2): work WLM could have
    // taken the CPU from, on an image whose processor is not reported full by these pins.
    const runaway = after('cpu', 'ADHOC', 10);
    // The first full interval of the runaway (12:30): the next one's six-row normal already holds two runaway rows.
    // MOBILE's DDFPRD#1 waits for CPU there (25 %) while ADHOC's DDFPRD#2 takes an engine.
    const j = last(runaway) - 1;
    const hog = pinAll(runaway, [
      { source: 'WLMGL', index: j, system: 'PROD2', scKey: 'DDFPRD#1', metric: 'DELAY_CPU' },
      { source: 'WLMGL', index: j, system: 'PROD2', scKey: 'DDFPRD#2', metric: 'APPL_CP' },
    ]);
    const adhoc = mobileIncident(hog.run, { mechanism: 'CPU_PRIORITY', trigger: 'RUNAWAY_WORK' });
    const pr = judgeProof(hog.run, MIDWEST, [adhoc], 'CPU_PRIORITY', 'RUNAWAY_WORK', hog.pins);
    expect(pr.mechanism.complete).toBe(true);
    REPLAYED.add('CPU_PRIORITY');
    expect(pr.mechanism.predicates[1]!.pinIds).toEqual([hog.pins[1]!.id]);
    expect(judgeProof(hog.run, MIDWEST, [adhoc], 'CPU_CAPACITY', 'RUNAWAY_WORK', hog.pins).mechanism.complete).toBe(false);
    // The runaway's APPL rose by more than half an engine over its own recent rows.
    expect(pr.trigger.predicates[0]!.met).toBe(true);
  });

  it('does not read long-standing work as new: day-1 rates and the open hour have no slot baseline, but have history', () => {
    // Day 1 noon: MOBILE's own row has no ended-rate baseline yet, and many earlier rows.
    const wlm = pinAll(noon, [{ source: 'WLMGL', index: last(noon), system: 'PROD2', scKey: 'DDFPRD#1', metric: 'ENDED_RATE' }]);
    expect(wlm.pins[0]!.baseline).toBeUndefined();
    // Day 2, 20 minutes into the open hour of Db2 accounting.
    const db2 = pinAll(advance(day2, MIDWEST, content, 120), [{ source: 'DB2', hour: 'current', workloadId: 'MOBILE', metric: 'ENDED_RATE' }]);
    for (const [run, pins] of [[wlm.run, wlm.pins], [db2.run, db2.pins]] as const) {
      const inc = mobileIncident(run, { mechanism: 'CPU_CAPACITY', trigger: 'NEW_WORKLOAD' });
      expect(judgeProof(run, MIDWEST, [inc], 'CPU_CAPACITY', 'NEW_WORKLOAD', pins).trigger.predicates.find((x) => /no history/.test(x.label))!.met).toBe(false);
    }
  });

  it('does not read the first batch night as new work: the report had not held a day without it', () => {
    // D1 00:00: BATCHPRD's first rows on PROD1, eighteen hours into the report.
    const index = day2.sim.rmf.intervals.findIndex((iv) => iv.endTick === 18 * HOUR);
    expect(day2.sim.rmf.intervals[index]!.wlm.some((w) => w.lparId === 'PROD1' && w.scKey === 'BATCHPRD#1')).toBe(true);
    const { run, pins } = pinAll(day2, [{ source: 'WLMGL', index, system: 'PROD1', scKey: 'BATCHPRD#1', metric: 'APPL' }]);
    const inc = { ...mobileIncident(run, { mechanism: 'CPU_CAPACITY', trigger: 'NEW_WORKLOAD' }), startTick: 17 * HOUR, endTick: 18 * HOUR };
    expect(judgeProof(run, MIDWEST, [inc], 'CPU_CAPACITY', 'NEW_WORKLOAD', pins).trigger.predicates.find((x) => /no history/.test(x.label))!.met).toBe(false);
  });

  it('stores the PROCU row\'s service class on a real job pin', () => {
    const out = addPin(day2, MIDWEST, { source: 'PROCU', system: 'PROD1', jobname: 'MONAGENT' });
    expect(out.ok, out.message).toBe(true);
    expect(out.run.pins.at(-1)).toMatchObject({ metric: 'JOB_APPL', subject: 'MONAGENT', serviceClass: 'STCMED' });
  });

  it('judges a PROCU job by the service class its row shows: a batch job is displaceable, a started task above the work is not', () => {
    const inc = fixtureIncident(fixtureRun, 'CICS', { mechanism: 'CPU_PRIORITY', trigger: 'POLICY' });
    const job = (subject: string, serviceClass?: string): EvidencePin => ({
      id: 5000, source: 'PROCU', metric: 'JOB_APPL', subject, system: 'PROD1', tick: fixtureRun.sim.rmf.intervals.at(-1)!.endTick,
      value: 115, text: 'job', ...(serviceClass ? { serviceClass } : {}),
    });
    const consumer = (p: EvidencePin) => judgeProof(fixtureRun, MIDWEST, [inc], 'CPU_PRIORITY', 'POLICY', [p]).mechanism.predicates[1]!.met;
    // STL007, a critical batch job (BATCHPRD, importance 4), against RBANK's ONLHI (importance 1).
    expect(consumer(job('STL007', 'BATCHPRD'))).toBe(true);
    // A started task in STCHI (importance 1) is not below the work; without a class the job's address space decides.
    expect(consumer(job('MQ1AMSTR', 'STCHI'))).toBe(false);
    expect(consumer(job('MONAGENT'))).toBe(true);
    expect(consumer(job('STL007'))).toBe(false);
  });

  it('gives an open-hour Db2 101 cost pin the same hour yesterday as its rate baseline', () => {
    const { pins } = pinAll(advance(day2, MIDWEST, content, 120), [{ source: 'DB2', hour: 'current', workloadId: 'MOBILE', metric: 'CPU_VS_BASE' }]);
    expect(pins[0]!.rate!.baseline).toBeGreaterThan(0);
  });

  it('refuses the tier-0 cost for a CICS transaction row: its CPU is reported with the regions', () => {
    const i = last(noon);
    const row = noon.sim.rmf.intervals[i]!.wlm.find((w) => w.resourceSamples === false)!;
    expect(row).toBeDefined();
    const out = addPin(noon, MIDWEST, { source: 'WLMGL', index: i, system: row.lparId, scKey: row.scKey, metric: 'CPU_PER_TXN' });
    expect(out.ok).toBe(false);
    expect(out.message).toMatch(/regions' classes/);
  });

  it('carries the transaction rate on a Db2 101 cost pin, so Db2 accounting proves a regression on one row', () => {
    const r = after('cpu', 'MOBILE', 2);
    const h = r.smfHours.at(-1)!;
    const { run, pins } = pinAll(r, [{ source: 'DB2', hour: `${h.day}:${h.hourOfDay}`, workloadId: 'MOBILE', metric: 'CPU_VS_BASE' }]);
    // The rate's normal is the same hour the day before.
    const yesterday = r.smfHours.find((x) => x.day === h.day - 1 && x.hourOfDay === h.hourOfDay)!;
    expect(pins[0]!.rate!.baseline).toBeCloseTo(db2Accounting(r, MIDWEST, `${yesterday.day}:${yesterday.hourOfDay}`).find((x) => x.workloadId === 'MOBILE')!.txnPerSec);
    const inc = mobileIncident(run, { mechanism: 'CPU_CAPACITY', trigger: 'CHANGE_REGRESSION' });
    const proof = judgeProof(run, MIDWEST, [inc], 'CPU_CAPACITY', 'CHANGE_REGRESSION', pins);
    expect(proof.trigger.predicates[0]!.met).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------------------

describe('RCA scoring by proof (RT-13)', () => {
  const pinsFor = (r: RunState, kind: Kind, claims: (Mechanism | Trigger)[]): EvidencePin[] => {
    const out: EvidencePin[] = [];
    for (const claim of claims) for (const pred of recipeOf(claim).predicates) {
      if (out.some((p) => pred.options.some((o) => o.metric === p.metric))) continue;
      const pin = pred.options.map((o) => pinFor(r, kind, o, 2000 + out.length)).find((p) => p !== null)!;
      out.push(pin);
    }
    return out;
  };
  const file = (inc: Incident, pins: EvidencePin[], mechanism: Mechanism, trigger: Trigger) => {
    const r: RunState = { ...noon, pins, incidents: [inc] };
    const out = submitRca(r, inc.id, mechanism, trigger, MIDWEST, pins.map((p) => p.id));
    return { before: r, after: out, rca: out.incidents[0]!.rca! };
  };

  it('pays a complete recipe for the accepted mechanism three points, and both recipes strong evidence', () => {
    const inc = fixtureIncident(noon, 'DDF', { mechanism: 'CPU_PRIORITY', trigger: 'POLICY' });
    // CPU delay (also the POLICY symptom), a displaceable class, and the work's own rate at normal.
    const pins = pinsFor(noon, 'DDF', ['CPU_PRIORITY', 'POLICY']);
    expect(pins).toHaveLength(3);
    const { before, after, rca } = file(inc, pins, 'CPU_PRIORITY', 'POLICY');
    expect(rca.proof!.mechanism.complete).toBe(true);
    expect(rca.proof!.trigger.complete).toBe(true);
    expect(rca.evidencePoints).toBe(PROOF.recipePoints);
    expect(rca.strong).toBe(true);
    expect(rca.points).toBe(5 + PROOF.recipePoints);
    expect(after.insight - before.insight).toBe(5 + PROOF.recipePoints + EVIDENCE.strongInsight);
    expect(proofLines(rca.proof!)[0]).toMatch(/^Mechanism CPU_PRIORITY proven: ✓ CPU or zIIP delay .*; ✓ a displaceable consumer/);
  });

  it('pays the mechanism recipe without the strong bonus when the trigger recipe is incomplete', () => {
    const inc = fixtureIncident(noon, 'DDF', { mechanism: 'CPU_PRIORITY', trigger: 'POLICY' });
    const { before, after, rca } = file(inc, pinsFor(noon, 'DDF', ['CPU_PRIORITY']), 'CPU_PRIORITY', 'POLICY');
    expect(rca.evidencePoints).toBe(PROOF.recipePoints);
    expect(rca.strong).toBeUndefined();
    expect(after.insight - before.insight).toBe(5 + PROOF.recipePoints);
  });

  it('pays half a point for one predicate, the old non-specific weight (A9: two delay rows are not a proof)', () => {
    const inc = fixtureIncident(noon, 'DDF', { mechanism: 'CPU_PRIORITY', trigger: 'POLICY' });
    const delay = pinFor(noon, 'DDF', MECHANISM_RECIPES.CPU_PRIORITY.predicates[0].options[0]!, 3000)!;
    const zIIP = { ...delay, id: 3001, metric: 'DELAY_ZIIP' as const, subject: 'DDFPRD#2' };
    const { rca } = file(inc, [delay, zIIP], 'CPU_PRIORITY', 'POLICY');
    expect(rca.evidencePoints).toBe(PROOF.partialPoints);
    expect(rca.proof!.mechanism.predicates.map((x) => x.met)).toEqual([true, false]);
    expect(rca.proof!.mechanism.predicates[0]!.pinIds).toEqual([3000, 3001]);
  });

  it('pays nothing for a proven claim the truth does not accept, and no strong bonus for a wrong trigger', () => {
    const pins = pinsFor(noon, 'DDF', ['CPU_PRIORITY', 'POLICY']);
    const wrongMech = file(fixtureIncident(noon, 'DDF', { mechanism: 'IO', trigger: 'POLICY' }), pins, 'CPU_PRIORITY', 'POLICY');
    expect(wrongMech.rca.proof!.mechanism.complete).toBe(true);
    expect(wrongMech.rca.evidencePoints).toBe(0);
    expect(wrongMech.rca.strong).toBeUndefined();
    const wrongTrig = file(fixtureIncident(noon, 'DDF', { mechanism: 'CPU_PRIORITY', trigger: 'DEMAND_SURGE' }), pins, 'CPU_PRIORITY', 'POLICY');
    expect(wrongTrig.rca.evidencePoints).toBe(PROOF.recipePoints);
    expect(wrongTrig.rca.strong).toBeUndefined();
  });

  it('ignores pins outside the incident window', () => {
    const inc = fixtureIncident(noon, 'DDF', { mechanism: 'CPU_PRIORITY', trigger: 'POLICY' });
    const pins = pinsFor(noon, 'DDF', ['CPU_PRIORITY']).map((p) => ({ ...p, tick: inc.startTick - EVIDENCE.windowHours * HOUR - 1 }));
    expect(file(inc, pins, 'CPU_PRIORITY', 'POLICY').rca.evidencePoints).toBe(0);
  });

  it('pools a group\'s incidents: one pin per incident can complete the recipe', () => {
    const a = fixtureIncident(noon, 'DDF', { mechanism: 'CPU_PRIORITY', trigger: 'POLICY' });
    const b = { ...fixtureIncident(noon, 'CICS', a.truth), id: 1000, rcaGroup: 999 };
    const ddfDelay = pinFor(noon, 'DDF', MECHANISM_RECIPES.CPU_PRIORITY.predicates[0].options[0]!, 4000)!;
    // A less important class on PROD1, displaceable for RBANK's ONLHI as for MOBILE's DDFPRD.
    const consumer = pinFor(noon, 'CICS', MECHANISM_RECIPES.CPU_PRIORITY.predicates[1].options[0]!, 4001)!;
    const r: RunState = { ...noon, pins: [ddfDelay, consumer], incidents: [a, b] };
    const rca = submitRca(r, 999, 'CPU_PRIORITY', 'POLICY', MIDWEST, [4000, 4001]).incidents[0]!.rca!;
    expect(rca.proof!.mechanism.complete).toBe(true);
    expect(rca.evidencePoints).toBe(PROOF.recipePoints);
  });

  it('files no proof without pins, so an RCA without evidence keeps its old record', () => {
    const inc = fixtureIncident(noon, 'DDF', { mechanism: 'CPU_PRIORITY', trigger: 'POLICY' });
    const { rca } = file(inc, [], 'CPU_PRIORITY', 'POLICY');
    expect(rca.proof).toBeUndefined();
    expect(rca.evidencePoints).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Every claim proven from a replay (RT-13's "Done when"): a card's own commands pushed on day 2 and run on, then pins
// taken through addPin from the reports a player reads.

describe('every recipe from a replayed incident (RT-13)', () => {
  const run = (commands: Command[], hours: number, from: RunState = day2): RunState =>
    advance({ ...from, pendingCommands: commands }, MIDWEST, content, hours * HOUR);
  const pinAll = (r: RunState, reqs: Parameters<typeof addPin>[2][]): { run: RunState; pins: EvidencePin[] } => {
    let x = r;
    for (const req of reqs) {
      const out = addPin(x, MIDWEST, req);
      expect(out.ok, `${JSON.stringify(req)}: ${out.message}`).toBe(true);
      x = out.run;
    }
    return { run: x, pins: x.pins.slice(-reqs.length) };
  };
  const hour = (r: RunState) => { const h = r.smfHours.at(-1)!; return `${h.day}:${h.hourOfDay}`; };
  const last = (r: RunState) => r.sim.rmf.intervals.length - 1;
  const incidentOn = (r: RunState, workloadId: string): Incident => ({
    id: 999, workloadId, day: r.day, startTick: r.sim.tick - HOUR, endTick: null, hours: 1, worstAttainmentPct: 80,
    truth: { mechanism: 'CPU_PRIORITY', trigger: 'POLICY' }, rca: null, trustLost: 0,
    subjects: incidentSubjects(r, MIDWEST, workloadId, r.day),
  });
  /** Each claim's recipe complete over the pins (for an incident on `workloadId`), recorded as replayed. */
  const proves = (r: RunState, inc: Incident, pins: EvidencePin[], claims: (Mechanism | Trigger)[]) => {
    for (const claim of claims) {
      const isMech = MECHANISMS.includes(claim as Mechanism);
      const p = judgeProof(r, MIDWEST, [inc], isMech ? claim as Mechanism : 'CPU_PRIORITY', isMech ? 'POLICY' : claim as Trigger, pins);
      const c = isMech ? p.mechanism : p.trigger;
      expect(c.complete, `${claim}: ${proofLines(p).join(' | ')}`).toBe(true);
      REPLAYED.add(claim);
    }
  };

  it('CF_LINK: Db2 CF time past its normal, CF Activity slow, the work unchanged (CF_SERVICE, HARDWARE_FAULT)', () => {
    const r = run([{ kind: 'SET_CF', lparId: 'CF01', degrade: 6 }], 2);
    const { run: x, pins } = pinAll(r, [
      { source: 'DB2', hour: hour(r), workloadId: 'RBANK', metric: 'CF_WAIT' },
      // The fault's first interval: two hours on, the row's six-interval normal holds the fault itself (RT-10).
      { source: 'CF', cfLparId: 'CF01', metric: 'CF_SYNC', index: last(r) - 3 },
      // RBANK's rate holds within 1 % of the same hour yesterday; MOBILE's moves 10–16 % day to day.
      { source: 'DB2', hour: hour(r), workloadId: 'RBANK', metric: 'ENDED_RATE' },
    ]);
    proves(x, incidentOn(x, 'RBANK'), pins, ['CF_SERVICE', 'HARDWARE_FAULT']);
  });

  it('DASD_DEGRADED: Db2 sync I/O past its normal, DISC past twice normal (IO)', () => {
    const r = run([{ kind: 'SET_DASD', changes: { backendDegrade: 5 } }], 2);
    const { run: x, pins } = pinAll(r, [
      { source: 'DB2', hour: hour(r), workloadId: 'MOBILE', metric: 'SYNC_IO' },
      { source: 'DASD', lcuId: 'ALL', metric: 'DASD_DISC', index: last(r) - 3 },
    ]);
    proves(x, incidentOn(x, 'MOBILE'), pins, ['IO']);
  });

  it('QR_RELEASE: QR TCB wait with no MXT wait (QR_TCB)', () => {
    const r = run([{ kind: 'SET_CICS', name: 'CICSAOR1', qrFrac: 0.95 }, { kind: 'SET_CICS', name: 'CICSAOR3', qrFrac: 0.95 }], 2);
    const { run: x, pins } = pinAll(r, [
      { source: 'CICS', hour: hour(r), workloadId: 'TELLER', metric: 'QR_WAIT' },
      { source: 'CICS', hour: hour(r), workloadId: 'TELLER', metric: 'MXT_WAIT' },
    ]);
    proves(x, incidentOn(x, 'TELLER'), pins, ['QR_TCB']);
  });

  it('SICK_AOR shape: failed transactions at an unchanged cost, two pins (ROUTING, APPLICATION_ERROR)', () => {
    const r = run([{ kind: 'SET_MODIFIER', mod: 'regionFailFrac', key: 'RBANK@PROD1', value: 0.35 }], 1);
    const { run: x, pins } = pinAll(r, [
      { source: 'CICS', hour: hour(r), workloadId: 'RBANK', metric: 'FAIL_PCT' },
      { source: 'CICS', hour: hour(r), workloadId: 'RBANK', metric: 'CPU_VS_BASE' },
    ]);
    proves(x, incidentOn(x, 'RBANK'), pins, ['ROUTING', 'APPLICATION_ERROR']);
  });

  it('CICS_SOS: a region short on storage, MXT queueing at a normal cost, READY low (THREAD_LIMIT, STORAGE)', () => {
    const leak = { startMb: 420, mbPerHour: 40 };
    const r = run([{ kind: 'SET_CICS', name: 'CICSAOR2', leak }, { kind: 'SET_CICS', name: 'CICSAOR4', leak }], 4);
    const { run: x, pins } = pinAll(r, [
      { source: 'CICS_STORAGE', hour: hour(r), region: 'CICSAOR2' },
      { source: 'CICS', hour: hour(r), workloadId: 'RBANK', metric: 'MXT_WAIT' },
      { source: 'CICS', hour: hour(r), workloadId: 'RBANK', metric: 'CPU_VS_BASE' },
      { source: 'WLMGL', index: last(r), system: 'PROD2', scKey: 'ONLHI#1', metric: 'WM_READY' },
    ]);
    const inc = incidentOn(x, 'RBANK');
    proves(x, inc, pins.slice(1, 3), ['THREAD_LIMIT']);
    proves(x, inc, [pins[0]!, pins[3]!], ['STORAGE']);
    proves(x, inc, [pins[0]!, pins[2]!], ['APPLICATION_ERROR']);
  });

  it('a defined capacity: CPU delay on a capped image, the work\'s cost per transaction at normal (CAPPING, POLICY, GROWTH)', () => {
    const r = run([{ kind: 'SET_DEFINED_CAPACITY', lparId: 'PROD2', msu: 200 }], 2);
    const i = last(r);
    const { run: x, pins } = pinAll(r, [
      { source: 'WLMGL', index: i, system: 'PROD2', scKey: 'DDFPRD#1', metric: 'DELAY_CPU' },
      { source: 'CPC', index: i, lparId: 'PROD2', metric: 'CAPPED' },
      { source: 'DB2', hour: hour(r), workloadId: 'MOBILE', metric: 'CPU_VS_BASE' },
    ]);
    proves(x, incidentOn(x, 'MOBILE'), pins, ['CAPPING', 'POLICY', 'GROWTH']);
  });

  it('LOCK_ESCALATION in the batch window: Db2 lock wait, READY low, a batch class on the image (LOCK_CONTENTION, BATCH_OVERLAP)', () => {
    const r = run([{ kind: 'SET_LOCK_BOOST', value: 6 }], 1.5, run([], 8.5));
    const { run: x, pins } = pinAll(r, [
      { source: 'DB2', hour: hour(r), workloadId: 'RBANK', metric: 'LOCK_WAIT' },
      { source: 'WLMGL', index: last(r), system: 'PROD2', scKey: 'ONLHI#1', metric: 'WM_READY' },
      { source: 'WLMGL', index: last(r), system: 'PROD1', scKey: 'BATCHPRD#1', metric: 'APPL' },
    ]);
    proves(x, incidentOn(x, 'RBANK'), pins, ['LOCK_CONTENTION', 'BATCH_OVERLAP']);
  });

  it('JOB_ABEND: the night\'s SMF 30 records show an ABEND and little I/O wait (JOB_FAILURE)', () => {
    const { run: x, pins } = pinAll(day2, [
      { source: 'BATCH', day: 0, metric: 'JOB_ABEND' },
      { source: 'BATCH', day: 0, metric: 'JOB_IO' },
    ]);
    const night = x.reports.find((d) => d.day === 0)!.batch!;
    const inc: Incident = {
      id: 999, workloadId: 'BATCH', day: 0, startTick: 12 * HOUR, endTick: TICKS_PER_DAY, hours: 12, worstAttainmentPct: 0,
      truth: { mechanism: 'JOB_FAILURE', trigger: 'APPLICATION_ERROR' }, rca: null, trustLost: 0,
      subjects: incidentSubjects(x, MIDWEST, 'BATCH', 0, night),
    };
    proves(x, inc, pins, ['JOB_FAILURE']);
  });

  it('a runaway beside DDF starving its Db2: other/UNK up with little CPU delay (DEPENDENCY)', () => {
    const r = run([{ kind: 'SET_MODIFIER', mod: 'cpu', key: 'ADHOC', value: 10 }], 1);
    const { run: x, pins } = pinAll(r, [
      { source: 'WLMGL', index: last(r), system: 'PROD1', scKey: 'DDFPRD#1', metric: 'DELAY_OTHER' },
      { source: 'WLMGL', index: last(r), system: 'PROD1', scKey: 'DDFPRD#1', metric: 'DELAY_CPU' },
    ]);
    proves(x, incidentOn(x, 'MOBILE'), pins, ['DEPENDENCY']);
  });

  it('the runaway itself: an engine more for ADHOC\'s period while MOBILE\'s cost stays normal (RUNAWAY_WORK)', () => {
    const r = run([{ kind: 'SET_MODIFIER', mod: 'cpu', key: 'ADHOC', value: 10 }], 1);
    const j = last(r) - 1;
    const { run: x, pins } = pinAll(r, [
      { source: 'WLMGL', index: j, system: 'PROD2', scKey: 'DDFPRD#2', metric: 'APPL_CP' },
      { source: 'WLMGL', index: j, system: 'PROD2', scKey: 'DDFPRD#1', metric: 'CPU_PER_TXN' },
    ]);
    proves(x, incidentOn(x, 'MOBILE'), pins, ['RUNAWAY_WORK']);
  });

  it('NEW_APP_GOLIVE: a class row with no history beside MOBILE delayed (NEW_WORKLOAD)', () => {
    const golive = MIDWEST_EVENTS.find((e) => e.id === 'NEW_APP_GOLIVE')!;
    const r = run(golive.begin, 2);
    const { run: x, pins } = pinAll(r, [
      { source: 'WLMGL', index: last(r), system: 'PROD2', scKey: 'DDFPRD#1', metric: 'DELAY_CPU' },
      { source: 'WLMGL', index: last(r), system: 'PROD1', scKey: 'SYSOTHER#1', metric: 'APPL' },
    ]);
    proves(x, incidentOn(x, 'MOBILE'), pins, ['NEW_WORKLOAD']);
  });

  it('the replays above and earlier cover every mechanism and trigger', () => {
    expect([...CLAIMS].filter((c) => !REPLAYED.has(c))).toEqual([]);
  });
});
