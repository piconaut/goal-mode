// RT-13 (docs/rca-design.md §4.6): evidence proves a claim when the attached pins satisfy a two-predicate recipe.
// These tests check the recipe vocabulary, the matcher, the look-alike rejections the entry names, the tier-0/1 paths
// for the common recipes, and the scoring: a complete recipe replaces the relevance sum, the trigger's recipe makes
// the evidence strong, and a proof only pays for an accepted claim.
import { describe, expect, it } from 'vitest';
import {
  EVIDENCE,
  EVIDENCE_METRICS,
  RECIPES,
  COMMON_RECIPES,
  recipeFor,
  type EvidenceMetric,
  type PredicateTest,
  type RecipeOption,
} from '../../src/content/evidence';
import { MIDWEST_GAME } from '../../src/content/game-midwest';
import { MIDWEST } from '../../src/content/scenarios';
import { addPin, incidentSubjects, judgeRecipe, type EvidencePin } from '../../src/game/evidence';
import { advance, newRun, startDay, submitRca } from '../../src/game/run';
import { MECHANISMS, TRIGGERS } from '../../src/game/sla';
import type { Incident, Mechanism, RunState, Trigger } from '../../src/game/types';

const HOUR = 360;
const content = { ...MIDWEST_GAME, events: [] };
const claimName = (claim: { mechanism: Mechanism } | { trigger: Trigger }): string =>
  'mechanism' in claim ? claim.mechanism : claim.trigger;
/** The tool tier of each pin source: 0 = WLMGL (no tool), 1 = Monitor III / Partition Data / PROCU, 2 = a paid
 * report. Matches REPORT_FEATURE/SMF_FEATURE and the tools' tiers (RT-13 keeps every option's own tier honest). */
const SOURCE_TIER: Record<string, number> = {
  WLMGL: 0,
  SYSWKM: 1,
  CPC: 1,
  PROCU: 1,
  'Db2 101': 2,
  'CICS 110': 2,
  'SMF 30': 2,
  CF: 2,
  DASD: 2,
};

let run: RunState;
beforeAll(() => {
  const noon = advance(startDay(newRun(MIDWEST, content, 7), content), MIDWEST, content, 6 * HOUR);
  // A replayed regression: RBANK's CPU per transaction tripled for the last hour.
  run = advance({ ...noon, pendingCommands: [{ kind: 'SET_MODIFIER', mod: 'cpu', key: 'RBANK', value: 3 }] }, MIDWEST, content, HOUR);
});

/** An incident as the game opens them on the replayed run (subjects recorded, truth set). */
const incident = (over: Partial<Incident> = {}): Incident => ({
  id: 999,
  workloadId: 'RBANK',
  day: 0,
  startTick: run.sim.tick - HOUR,
  endTick: null,
  hours: 1,
  worstAttainmentPct: 80,
  truth: { mechanism: 'CPU_CAPACITY', trigger: 'CHANGE_REGRESSION' },
  subjects: incidentSubjects(run, MIDWEST, 'RBANK', 0),
  rca: null,
  trustLost: 0,
  ...over,
});

/** A value (and baseline) that passes one predicate test. */
function valueFor(t: PredicateTest, metric: EvidenceMetric): { value: number; baseline?: number } {
  const base = EVIDENCE_METRICS[metric].unit === '×' ? 1 : 100;
  switch (t.kind) {
    case 'atLeast':
      return { value: t.value * 1.2 };
    case 'atMost':
      return { value: t.value * 0.5 };
    case 'multipleAtLeast':
      return { value: t.multiple * base * 1.2, baseline: base };
    case 'within':
      return { value: base, baseline: base };
  }
}

let nextPinId = 1000;
/** A pin that satisfies an option, placed on the subject its first accepted relation names, from a source the option's
 * tier covers. Values are shaped by the test; subjects, images and relations come from the replayed incident. */
function pinFor(inc: Incident, option: RecipeOption): EvidencePin {
  const s = inc.subjects ?? incidentSubjects(run, MIDWEST, inc.workloadId, inc.day);
  const host = s.hosts[0] ?? 'PROD1';
  const cpc = run.sim.config.lpars.find((l) => l.id === host)?.cpcId ?? host;
  const relation = option.relations[0]!;
  const { value, baseline } = valueFor(option.test, option.metric);
  const metric = option.metric;
  const cpcBusy = metric === 'CPC_BUSY' || metric === 'CAPACITY_ADJ';
  const source = (name: string, subject: string, system: string): EvidencePin => ({
    id: nextPinId++,
    source: name,
    metric,
    subject,
    system,
    tick: run.sim.tick,
    value,
    text: `${name} ${subject} ${EVIDENCE_METRICS[metric].label}`,
    ...(baseline !== undefined ? { baseline } : {}),
  });
  if (relation === 'host') return source('CPC', cpcBusy ? cpc : host, cpcBusy ? cpc : host);
  if (relation === 'competitor') return metric === 'JOB_APPL' ? source('PROCU', 'MONAGENT', host) : source('WLMGL', 'BATCHHI#1', host);
  if (relation === 'server') {
    if (metric === 'CF_SYNC' || metric === 'CF_ASYNC_PCT') return source('CF', 'CF02', 'CF02');
    if (metric.startsWith('DASD_')) return source('DASD', 'LCU 21', '*PLEX');
    if (metric === 'SOS_MIN') return source('CICS 110', s.servers[0]?.jobname ?? 'CICSAOR1', '*PLEX');
    if (metric === 'VELOCITY') return source('SYSWKM', s.servers[0]?.jobname ?? 'CICSAOR1', s.servers[0]?.lparId ?? host);
    return source('WLMGL', s.serverClasses?.[0] ?? 'STCHI#1', host);
  }
  // self
  if (metric === 'CPU_VS_BASE' || metric === 'LOCK_WAIT' || metric === 'SYNC_IO' || metric === 'CF_WAIT' || metric === 'DBAT_QUEUE')
    return source('Db2 101', inc.workloadId, '*PLEX');
  if (metric === 'QR_WAIT' || metric === 'MXT_WAIT' || metric === 'FAIL_PCT') return source('CICS 110', inc.workloadId, '*PLEX');
  if (metric.startsWith('JOB_')) return source('SMF 30', inc.workloadId, '*PLEX');
  return source('WLMGL', inc.workloadId, host);
}

/** A pin for one explicit metric, relation and test (for the look-alike pairs). */
const option = (metric: EvidenceMetric, relations: RecipeOption['relations'], test: PredicateTest, tier: RecipeOption['tier'] = 0): RecipeOption =>
  ({ metric, relations, test, tier });

describe('proof recipes (RT-13)', () => {
  it('covers every mechanism and trigger exactly once, with every option satisfiable from a replayed incident', () => {
    const inc = incident();
    const mechanisms = RECIPES.filter((r) => 'mechanism' in r.claim).map((r) => (r.claim as { mechanism: Mechanism }).mechanism);
    const triggers = RECIPES.filter((r) => 'trigger' in r.claim).map((r) => (r.claim as { trigger: Trigger }).trigger);
    expect([...mechanisms].sort()).toEqual([...MECHANISMS].sort());
    expect([...triggers].sort()).toEqual([...TRIGGERS].sort());
    expect(new Set([...mechanisms, ...triggers]).size).toBe(mechanisms.length + triggers.length);
    for (const recipe of RECIPES) {
      for (const pred of recipe.predicates) {
        for (const opt of pred.options) {
          // Every option is tried on its own: the pin it makes must satisfy that predicate.
          const proof = judgeRecipe(run, MIDWEST, [inc], [pinFor(inc, opt)], recipe.claim)!;
          expect(proof.predicates[0]!.ok || proof.predicates[1]!.ok, `${claimName(recipe.claim)} / ${pred.label}`).toBe(true);
          // The option's tool tier must cover the pin source the recipe can actually be read from.
          expect(SOURCE_TIER[pinFor(inc, opt).source]!, `${claimName(recipe.claim)} ${opt.metric}`).toBeLessThanOrEqual(opt.tier);
        }
      }
      // Both predicates together complete the recipe.
      const pins = recipe.predicates.map((pred) => pinFor(inc, pred.options[0]!));
      const proof = judgeRecipe(run, MIDWEST, [inc], pins, recipe.claim)!;
      expect(proof.complete, `${claimName(recipe.claim)}: ${JSON.stringify(proof.predicates)}`).toBe(true);
    }
  });

  it('rejects the look-alikes the entry names: a surge is not a regression and a regression is not a surge', () => {
    const inc = incident();
    const surge = [
      pinFor(inc, option('ENDED_RATE', ['self'], { kind: 'multipleAtLeast', multiple: 1.25 })),
      pinFor(inc, option('CPU_PER_TXN', ['self'], { kind: 'within', frac: 0.15 })),
    ];
    expect(judgeRecipe(run, MIDWEST, [inc], surge, { trigger: 'DEMAND_SURGE' })!.complete).toBe(true);
    const asRegression = judgeRecipe(run, MIDWEST, [inc], surge, { trigger: 'CHANGE_REGRESSION' })!;
    expect(asRegression.complete).toBe(false);
    expect(asRegression.predicates.map((p) => p.ok)).toEqual([false, false]);

    const regression = [
      pinFor(inc, option('CPU_PER_TXN', ['self'], { kind: 'atLeast', value: 1.3 })),
      pinFor(inc, option('ENDED_RATE', ['self'], { kind: 'within', frac: 0.15 })),
    ];
    expect(judgeRecipe(run, MIDWEST, [inc], regression, { trigger: 'CHANGE_REGRESSION' })!.complete).toBe(true);
    const asSurge = judgeRecipe(run, MIDWEST, [inc], regression, { trigger: 'DEMAND_SURGE' })!;
    expect(asSurge.complete).toBe(false);
    expect(asSurge.predicates.map((p) => p.ok)).toEqual([false, false]);
  });

  it('rejects capacity for priority and priority for capacity', () => {
    const inc = incident();
    const capacity = [
      pinFor(inc, option('DELAY_CPU', ['self'], { kind: 'atLeast', value: 10 })),
      pinFor(inc, option('CPC_BUSY', ['host'], { kind: 'atLeast', value: 90 }, 1)),
    ];
    expect(judgeRecipe(run, MIDWEST, [inc], capacity, { mechanism: 'CPU_CAPACITY' })!.complete).toBe(true);
    const asPriority = judgeRecipe(run, MIDWEST, [inc], capacity, { mechanism: 'CPU_PRIORITY' })!;
    expect(asPriority.complete).toBe(false);
    expect(asPriority.predicates.map((p) => p.ok)).toEqual([true, false]);

    const priority = [
      pinFor(inc, option('DELAY_CPU', ['self'], { kind: 'atLeast', value: 10 })),
      pinFor(inc, option('APPL', ['competitor'], { kind: 'atLeast', value: 10 })),
    ];
    expect(judgeRecipe(run, MIDWEST, [inc], priority, { mechanism: 'CPU_PRIORITY' })!.complete).toBe(true);
    const asCapacity = judgeRecipe(run, MIDWEST, [inc], priority, { mechanism: 'CPU_CAPACITY' })!;
    expect(asCapacity.complete).toBe(false);
    expect(asCapacity.predicates.map((p) => p.ok)).toEqual([true, false]);
  });

  it('gives every common recipe a path that needs no tool beyond tier 1', () => {
    const inc = incident();
    for (const claim of COMMON_RECIPES) {
      const recipe = recipeFor(claim)!;
      const pins = recipe.predicates.map((pred) => {
        const cheap = pred.options.find((o) => o.tier <= 1);
        expect(cheap, `${claimName(claim)} / ${pred.label}`).toBeDefined();
        const p = pinFor(inc, cheap!);
        expect(SOURCE_TIER[p.source]!, `${claimName(claim)} / ${pred.label} from ${p.source}`).toBeLessThanOrEqual(1);
        return p;
      });
      expect(judgeRecipe(run, MIDWEST, [inc], pins, claim)!.complete, claimName(claim)).toBe(true);
    }
    // A later report may be needed somewhere, but the gate must never require a tier-3 tool (§5.5).
    for (const recipe of RECIPES) for (const pred of recipe.predicates) for (const o of pred.options) expect(o.tier).toBeLessThan(3);
  });

  it('proves a common claim pair (mechanism and trigger) inside the three-pin limit', () => {
    const inc = incident();
    const pairs: { filed: { mechanism: Mechanism; trigger: Trigger }; pins: EvidencePin[] }[] = [
      {
        filed: { mechanism: 'CPU_CAPACITY', trigger: 'CHANGE_REGRESSION' },
        // The CPU/txn pin is the shared symptom: the work cost more and waited for a machine that was full.
        pins: [
          pinFor(inc, option('CPU_PER_TXN', ['self'], { kind: 'atLeast', value: 1.3 })),
          pinFor(inc, option('CPC_BUSY', ['host'], { kind: 'atLeast', value: 90 }, 1)),
          pinFor(inc, option('ENDED_RATE', ['self'], { kind: 'within', frac: 0.15 })),
        ],
      },
      {
        filed: { mechanism: 'CPU_PRIORITY', trigger: 'DEMAND_SURGE' },
        // The rate pin is shared: more arrivals, and another class was using the image to serve them.
        pins: [
          pinFor(inc, option('ENDED_RATE', ['self'], { kind: 'multipleAtLeast', multiple: 1.25 })),
          pinFor(inc, option('APPL', ['competitor'], { kind: 'atLeast', value: 10 })),
          pinFor(inc, option('CPU_PER_TXN', ['self'], { kind: 'within', frac: 0.15 })),
        ],
      },
      {
        filed: { mechanism: 'CPU_PRIORITY', trigger: 'RUNAWAY_WORK' },
        // The competitor's APPL pin is shared: it is who was ahead, and the class that ran away.
        pins: [
          pinFor(inc, option('DELAY_CPU', ['self'], { kind: 'atLeast', value: 10 })),
          pinFor(inc, option('APPL', ['competitor'], { kind: 'atLeast', value: 50 })),
          pinFor(inc, option('ENDED_RATE', ['self'], { kind: 'within', frac: 0.15 })),
        ],
      },
      {
        filed: { mechanism: 'LOCK_CONTENTION', trigger: 'BATCH_OVERLAP' },
        // The lock state and the low CPU delay each satisfy a predicate of both recipes.
        pins: [
          pinFor(inc, option('WM_LOCK', ['self'], { kind: 'atLeast', value: 35 })),
          pinFor(inc, option('DELAY_CPU', ['self'], { kind: 'atMost', value: 10 })),
        ],
      },
      {
        filed: { mechanism: 'THREAD_LIMIT', trigger: 'APPLICATION_ERROR' },
        pins: [
          pinFor(inc, option('SOS_MIN', ['server'], { kind: 'atLeast', value: 1 }, 2)),
          pinFor(inc, option('DELAY_CPU', ['self'], { kind: 'atMost', value: 10 })),
        ],
      },
    ];
    for (const { filed, pins } of pairs) {
      expect(pins.length, `${filed.mechanism}/${filed.trigger}`).toBeLessThanOrEqual(EVIDENCE.perRca);
      const mech = judgeRecipe(run, MIDWEST, [inc], pins, { mechanism: filed.mechanism })!;
      const trig = judgeRecipe(run, MIDWEST, [inc], pins, { trigger: filed.trigger })!;
      expect(mech.complete, `${filed.mechanism}: ${JSON.stringify(mech.predicates)}`).toBe(true);
      expect(trig.complete, `${filed.trigger}: ${JSON.stringify(trig.predicates)}`).toBe(true);
    }
  });

  it('pays a complete mechanism recipe three pins worth, and the trigger recipe makes it strong', () => {
    const inc = incident({ truth: { mechanism: 'CPU_CAPACITY', trigger: 'CHANGE_REGRESSION' } });
    const r = { ...run, incidents: [inc] };
    const cpu = pinFor(inc, option('CPU_PER_TXN', ['self'], { kind: 'atLeast', value: 1.3 }));
    const busy = pinFor(inc, option('CPC_BUSY', ['host'], { kind: 'atLeast', value: 90 }, 1));
    const rate = pinFor(inc, option('ENDED_RATE', ['self'], { kind: 'within', frac: 0.15 }));
    r.pins = [cpu, busy, rate];

    const mechanismOnly = submitRca(r, inc.id, 'CPU_CAPACITY', 'CHANGE_REGRESSION', MIDWEST, [cpu.id, busy.id]);
    const filed = mechanismOnly.incidents[0]!.rca!;
    expect(filed.evidencePoints).toBe(EVIDENCE.recipeRelevance);
    expect(filed.points).toBe(5 + EVIDENCE.recipeRelevance);
    expect(filed.proof!.find((p) => p.claim === 'mechanism')!.complete).toBe(true);
    expect(filed.proof!.find((p) => p.claim === 'trigger')!.complete).toBe(false);
    // A complete mechanism recipe alone is not "strong": that needs the trigger's recipe too.
    expect(mechanismOnly.insight - r.insight).toBe(5 + EVIDENCE.recipeRelevance);

    const both = submitRca(r, inc.id, 'CPU_CAPACITY', 'CHANGE_REGRESSION', MIDWEST, [cpu.id, busy.id, rate.id]);
    expect(both.incidents[0]!.rca!.evidencePoints).toBe(EVIDENCE.recipeRelevance);
    expect(both.incidents[0]!.rca!.proof!.every((p) => p.complete)).toBe(true);
    expect(both.insight - r.insight).toBe(5 + EVIDENCE.recipeRelevance + EVIDENCE.strongInsight);
  });

  it('pays nothing for a complete recipe the game does not accept', () => {
    // The truth is CPU capacity: a well-proven priority reading is still the wrong answer (RT-07's rule).
    const inc = incident({ truth: { mechanism: 'CPU_CAPACITY', trigger: 'CHANGE_REGRESSION' } });
    const r = { ...run, incidents: [inc] };
    const cpu = pinFor(inc, option('DELAY_CPU', ['self'], { kind: 'atLeast', value: 10 }));
    const contender = pinFor(inc, option('APPL', ['competitor'], { kind: 'atLeast', value: 10 }));
    r.pins = [cpu, contender];
    expect(judgeRecipe(r, MIDWEST, [inc], r.pins, { mechanism: 'CPU_PRIORITY' })!.complete).toBe(true);
    const out = submitRca(r, inc.id, 'CPU_PRIORITY', 'CHANGE_REGRESSION', MIDWEST, [cpu.id, contender.id]);
    expect(out.incidents[0]!.rca!.evidencePoints).toBe(0);
    // The right half of the answer (the trigger) still pays its 2, but the mechanism's 3 does not.
    expect(out.insight - r.insight).toBe(2);
  });

  it('pins the tier-0 service-per-transaction path from Workload Activity on a replayed regression', () => {
    // ADHOC (a low-volume DDF workload) runs at three times the CPU per transaction for one hour on a machine with
    // room: its own WLMGL row shows both the cost and the unchanged rate, so the proof needs no tool.
    const noon = advance(startDay(newRun(MIDWEST, content, 7), content), MIDWEST, content, 6 * HOUR);
    const tripled = advance({ ...noon, pendingCommands: [{ kind: 'SET_MODIFIER', mod: 'cpu', key: 'ADHOC', value: 3 }] }, MIDWEST, content, HOUR);
    const index = tripled.sim.rmf.intervals.length - 1;
    const subjects = incidentSubjects(tripled, MIDWEST, 'ADHOC', 0);
    const cls = subjects.classes[0]!;
    // ADHOC runs in a later period of its class, so pin each of the class's rows and keep the one whose cost rose.
    const attempts = tripled.sim.rmf.intervals[index]!.wlm
      .filter((w) => w.scKey.startsWith(`${cls}#`) && w.endPerSec > 0)
      .map((w) => ({ row: w, pin: addPin(tripled, MIDWEST, { source: 'WLMGL', index, system: w.lparId, scKey: w.scKey, metric: 'CPU_PER_TXN' }) }))
      .filter((x) => x.pin.ok);
    expect(attempts.length, `${cls} rows that report both columns`).toBeGreaterThan(0);
    const best = attempts.reduce((a, b) => (b.pin.run.pins.at(-1)!.value > a.pin.run.pins.at(-1)!.value ? b : a));
    const row = best.row;
    const cpuPin = best.pin.run.pins.at(-1)!;
    // ADHOC's CPU per transaction tripled, so the ratio clears the regression line; the pin is a ratio to the row's
    // own normal, so "flat" means a baseline of 1.
    expect(cpuPin.value).toBeGreaterThan(1.3);
    expect(cpuPin.baseline).toBe(1);
    expect(cpuPin.source).toBe('WLMGL');
    expect(cpuPin.text).toContain('APPL÷ENDED vs baseline');
    const rate = addPin(best.pin.run, MIDWEST, { source: 'WLMGL', index, system: row.lparId, scKey: row.scKey, metric: 'ENDED_RATE' });
    expect(rate.ok, rate.message).toBe(true);
    const inc = incident({ workloadId: 'ADHOC', startTick: tripled.sim.tick - HOUR, subjects });
    const proof = judgeRecipe(tripled, MIDWEST, [inc], [cpuPin, rate.run.pins.at(-1)!], { trigger: 'CHANGE_REGRESSION' })!;
    expect(proof.complete, JSON.stringify(proof.predicates)).toBe(true);
    // A CICS transaction row reports no resource samples: its quotient comes from the regions' class row, and a row
    // with no ended transactions has none at all.
    const cics = incident();
    const cicsClass = cics.subjects!.classes[0]!;
    const cicsRow = run.sim.rmf.intervals[run.sim.rmf.intervals.length - 1]!.wlm.find((w) => cics.subjects!.hosts.includes(w.lparId) && w.scKey.startsWith(`${cicsClass}#`) && w.endPerSec > 0)!;
    const cicsPin = addPin(run, MIDWEST, { source: 'WLMGL', index: run.sim.rmf.intervals.length - 1, system: cicsRow.lparId, scKey: cicsRow.scKey, metric: 'CPU_PER_TXN' });
    expect(cicsPin.ok, cicsPin.message).toBe(true);
    const emptyRow = run.sim.rmf.intervals[run.sim.rmf.intervals.length - 1]!.wlm.find((w) => w.endPerSec === 0)!;
    expect(addPin(run, MIDWEST, { source: 'WLMGL', index: run.sim.rmf.intervals.length - 1, system: emptyRow.lparId, scKey: emptyRow.scKey, metric: 'CPU_PER_TXN' }).ok).toBe(false);
  });

  it('pins a surge and its flat cost per transaction from the same report', () => {
    const noon = advance(startDay(newRun(MIDWEST, content, 7), content), MIDWEST, content, 6 * HOUR);
    const surged = advance({ ...noon, pendingCommands: [{ kind: 'SET_MODIFIER', mod: 'rate', key: 'RBANK', value: 1.6 }] }, MIDWEST, content, HOUR);
    const index = surged.sim.rmf.intervals.length - 1;
    const subjects = incidentSubjects(surged, MIDWEST, 'RBANK', 0);
    const cls = subjects.classes[0]!;
    const row = surged.sim.rmf.intervals[index]!.wlm.find((w) => subjects.hosts.includes(w.lparId) && w.scKey.startsWith(`${cls}#`) && w.endPerSec > 0)!;
    const rate = addPin(surged, MIDWEST, { source: 'WLMGL', index, system: row.lparId, scKey: row.scKey, metric: 'ENDED_RATE' });
    expect(rate.ok, rate.message).toBe(true);
    const cost = addPin(rate.run, MIDWEST, { source: 'WLMGL', index, system: row.lparId, scKey: row.scKey, metric: 'CPU_PER_TXN' });
    expect(cost.ok, cost.message).toBe(true);
    const inc = incident({ startTick: surged.sim.tick - HOUR });
    const proof = judgeRecipe(surged, MIDWEST, [inc], [rate.run.pins.at(-1)!, cost.run.pins.at(-1)!], { trigger: 'DEMAND_SURGE' })!;
    expect(proof.complete, JSON.stringify(proof.predicates)).toBe(true);
  });
});
