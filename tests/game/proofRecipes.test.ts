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
import { TOOLS, type ToolFeature } from '../../src/content/tools';
import { addPin, incidentSubjects, judgeRecipe, type EvidencePin } from '../../src/game/evidence';
import { REPORT_FEATURE, SMF_FEATURE } from '../../src/game/tools';
import { WLM_METRICS } from '../../src/ui/Reports';
import { advance, newRun, startDay, submitRca } from '../../src/game/run';
import { MECHANISMS, TRIGGERS } from '../../src/game/sla';
import type { Incident, Mechanism, RunState, Trigger } from '../../src/game/types';

const HOUR = 360;
const content = { ...MIDWEST_GAME, events: [] };
const claimName = (claim: { mechanism: Mechanism } | { trigger: Trigger }): string =>
  'mechanism' in claim ? claim.mechanism : claim.trigger;
/** The tool tier each pin source needs, read from the real tool table rather than a copied list, so a tool's tier
 * change and a recipe's annotation cannot drift apart (RT-13). */
const toolTier = (feature: ToolFeature | null | undefined): number => (feature ? TOOLS.find((t) => t.unlocks.includes(feature))?.tier ?? 0 : 0);
const mon3Tier = TOOLS.find((t) => t.id === 'RMF_MON3')!.tier;
const SOURCE_TIER: Record<string, number> = {
  WLMGL: toolTier(REPORT_FEATURE.WLM_SUMMARY),
  SYSWKM: mon3Tier,
  PROCU: mon3Tier,
  CPC: toolTier(REPORT_FEATURE.PARTITION),
  CF: toolTier(REPORT_FEATURE.CF),
  DASD: toolTier(REPORT_FEATURE.DASD),
  'Db2 101': toolTier(SMF_FEATURE.DB2),
  'CICS 110': toolTier(SMF_FEATURE.CICS),
  'SMF 30': toolTier(SMF_FEATURE.BATCH),
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

/** One way a pin can be built for an option: each accepted relation names a different subject row. */
interface PinVariant {
  key: string;
  source: string;
  subject: string;
  system: string;
  metric: EvidenceMetric;
  test: PredicateTest;
}

/** The value and baseline a real pin would need to satisfy every test of a merged group, or null when two tests
 * disagree (a row cannot be both above and below the same line). */
function mergeValue(variants: PinVariant[]): { value: number; baseline?: number } | null {
  const base = EVIDENCE_METRICS[variants[0]!.metric].unit === '×' ? 1 : 100;
  let high = 0;
  let low = Infinity;
  let ratio: { baseline: number; value: number } | null = null;
  let needsBaseline = false;
  for (const v of variants) {
    const t = v.test;
    if (t.kind === 'atLeast') high = Math.max(high, t.value, t.multipleOf !== undefined ? t.multipleOf * base : 0);
    else if (t.kind === 'atMost') low = Math.min(low, t.value);
    else if (t.kind === 'multipleAtLeast') {
      high = Math.max(high, t.multiple * base);
      needsBaseline = true;
    } else {
      ratio = { baseline: base, value: base };
      needsBaseline = true;
    }
  }
  if (high > 0 && low < Infinity) return null;
  if (high > 0) return { value: high * 1.05, ...(needsBaseline ? { baseline: base } : {}) };
  if (ratio) return ratio;
  if (low < Infinity) return { value: low * 0.5 };
  return null;
}

/** The first set of at most three pins that completes both recipes: one option per predicate, each option tried on
 * every relation it accepts, and options that name the same report row merged into one pin whose value satisfies all
 * of them (a shared symptom, or a shared normal reading). Undefined when no such set exists. */
function threePinProof(inc: Incident, mechanism: Mechanism, trigger: Trigger): EvidencePin[] | undefined {
  const mr = recipeFor({ mechanism })!;
  const tr = recipeFor({ trigger })!;
  const variants = (o: RecipeOption): PinVariant[] =>
    o.relations.map((rel) => {
      const p = pinFor(inc, { ...o, relations: [rel] });
      return { key: `${p.source}|${p.subject}|${p.system}|${o.metric}`, source: p.source, subject: p.subject, system: p.system, metric: o.metric, test: o.test };
    });
  for (const m1 of mr.predicates[0].options.flatMap(variants))
    for (const m2 of mr.predicates[1].options.flatMap(variants))
      for (const t1 of tr.predicates[0].options.flatMap(variants))
        for (const t2 of tr.predicates[1].options.flatMap(variants)) {
          const groups = new Map<string, PinVariant[]>();
          for (const v of [m1, m2, t1, t2]) groups.set(v.key, [...(groups.get(v.key) ?? []), v]);
          if (groups.size > EVIDENCE.perRca) continue;
          const pins: EvidencePin[] = [];
          let ok = true;
          for (const group of groups.values()) {
            const merged = mergeValue(group);
            if (!merged) {
              ok = false;
              break;
            }
            const first = group[0]!;
            pins.push({ id: 1000 + pins.length, source: first.source, metric: first.metric, subject: first.subject, system: first.system, tick: run.sim.tick, text: '', ...merged });
          }
          if (!ok) continue;
          if (judgeRecipe(run, MIDWEST, [inc], pins, { mechanism })!.complete && judgeRecipe(run, MIDWEST, [inc], pins, { trigger })!.complete)
            return pins;
        }
  return undefined;
}

describe('proof recipes (RT-13)', () => {
  it('covers every mechanism and trigger exactly once, with every option satisfiable from a replayed incident', () => {
    const inc = incident();
    const mechanisms = RECIPES.filter((r) => 'mechanism' in r.claim).map((r) => (r.claim as { mechanism: Mechanism }).mechanism);
    const triggers = RECIPES.filter((r) => 'trigger' in r.claim).map((r) => (r.claim as { trigger: Trigger }).trigger);
    expect([...mechanisms].sort()).toEqual([...MECHANISMS].sort());
    expect([...triggers].sort()).toEqual([...TRIGGERS].sort());
    expect(new Set([...mechanisms, ...triggers]).size).toBe(mechanisms.length + triggers.length);
    for (const recipe of RECIPES) {
      for (const [index, pred] of recipe.predicates.entries()) {
        for (const opt of pred.options) {
          // Every option is tried on its own: the pin it makes must satisfy that predicate, at that predicate's
          // position (a pin on the wrong relation, test or predicate index fails here).
          const proof = judgeRecipe(run, MIDWEST, [inc], [pinFor(inc, opt)], recipe.claim)!;
          expect(proof.predicates[index]!.ok, `${claimName(recipe.claim)} / ${pred.label} / ${opt.metric}`).toBe(true);
          // The option's tool tier must cover the pin source the recipe can actually be read from.
          const pin = pinFor(inc, opt);
          expect(SOURCE_TIER[pin.source]!, `${claimName(recipe.claim)} ${opt.metric} from ${pin.source}`).toBeLessThanOrEqual(opt.tier);
          // A tier-0 option is a Workload Activity row, and the Workload Activity pin form must offer it (RT-13):
          // a metric only the tests and the CLI can pin is not a player's tier-0 path.
          if (opt.tier === 0) expect(WLM_METRICS, `${claimName(recipe.claim)} ${opt.metric}`).toContain(opt.metric);
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

  it('proves every co-occurring mechanism × trigger pair — strong — inside the three-pin limit', () => {
    // The cards' triggers against the mechanisms their incidents carry (events/midwest-events.ts and the SLA rules),
    // including the pairs that share no symptom (a hardware fault on an I/O incident, a QR release, a lock dinner).
    const pairs: [Mechanism, Trigger][] = [
      ['CPU_CAPACITY', 'CHANGE_REGRESSION'],
      ['CPU_PRIORITY', 'DEMAND_SURGE'],
      ['CPU_PRIORITY', 'RUNAWAY_WORK'],
      ['CPU_CAPACITY', 'POLICY'],
      ['CAPPING', 'POLICY'],
      ['CPU_PRIORITY', 'NEW_WORKLOAD'],
      ['CPU_CAPACITY', 'GROWTH'],
      ['DEPENDENCY', 'DEMAND_SURGE'],
      ['DEPENDENCY', 'CHANGE_REGRESSION'],
      ['THREAD_LIMIT', 'DEMAND_SURGE'],
      ['THREAD_LIMIT', 'APPLICATION_ERROR'],
      ['IO', 'HARDWARE_FAULT'],
      ['IO', 'DEMAND_SURGE'],
      ['LOCK_CONTENTION', 'BATCH_OVERLAP'],
      ['LOCK_CONTENTION', 'HARDWARE_FAULT'],
      ['CF_SERVICE', 'HARDWARE_FAULT'],
      ['QR_TCB', 'CHANGE_REGRESSION'],
      ['QR_TCB', 'DEMAND_SURGE'],
      ['STORAGE', 'APPLICATION_ERROR'],
      ['JOB_FAILURE', 'APPLICATION_ERROR'],
      ['ROUTING', 'POLICY'],
      // The audit's own combos (docs/rca-design.md §2.1): a power cap at priority, a lost structure's aftermath,
      // a vendor creep's collateral work, and a lock dinner during growth.
      ['CF_SERVICE', 'GROWTH'],
      ['CPU_CAPACITY', 'HARDWARE_FAULT'],
      ['CPU_PRIORITY', 'HARDWARE_FAULT'],
      ['CPU_PRIORITY', 'POLICY'],
      ['DEPENDENCY', 'HARDWARE_FAULT'],
      ['DEPENDENCY', 'POLICY'],
      ['LOCK_CONTENTION', 'GROWTH'],
      ['QR_TCB', 'POLICY'],
      ['THREAD_LIMIT', 'POLICY'],
    ];
    const inc = incident();
    for (const [mechanism, trigger] of pairs) {
      const pins = threePinProof(inc, mechanism, trigger);
      expect(pins, `${mechanism}/${trigger}: no three-pin proof`).toBeDefined();
      expect(pins!.length, `${mechanism}/${trigger}`).toBeLessThanOrEqual(EVIDENCE.perRca);
      const mech = judgeRecipe(run, MIDWEST, [inc], pins!, { mechanism })!;
      const trig = judgeRecipe(run, MIDWEST, [inc], pins!, { trigger })!;
      expect(mech.complete, `${mechanism}: ${JSON.stringify(mech.predicates)}`).toBe(true);
      expect(trig.complete, `${trigger}: ${JSON.stringify(trig.predicates)}`).toBe(true);
    }
  });

  it('leaves only the claim pairs that never co-occur unprovable in three pins', () => {
    // Exhaustive: every mechanism against every trigger. The three that need a fourth observation are claims the
    // game never puts together — an application error carries STORAGE or THREAD_LIMIT, and a hardware fault's CPU
    // truth is CPU_CAPACITY, never CAPPING (§2.1) — so a real incident always has a three-pin strong proof.
    const inc = incident();
    const unprovable: string[] = [];
    for (const mechanism of MECHANISMS)
      for (const trigger of TRIGGERS) if (!threePinProof(inc, mechanism, trigger)) unprovable.push(`${mechanism}/${trigger}`);
    expect(unprovable.sort()).toEqual(['CAPPING/APPLICATION_ERROR', 'CAPPING/HARDWARE_FAULT', 'CPU_CAPACITY/APPLICATION_ERROR']);
  });

  it('pays a complete mechanism recipe three pins worth, and never less than the same pins did loose', () => {
    // Two specific pins clear the strong line on their own, so completing the recipe (3 instead of their 2) must not
    // cost the bonus: the recipe replaces the sum, not the strong award.
    const inc = incident({ truth: { mechanism: 'CPU_CAPACITY', trigger: 'CHANGE_REGRESSION' } });
    const r = { ...run, incidents: [inc] };
    const cpu = pinFor(inc, option('DELAY_CPU', ['self'], { kind: 'atLeast', value: 10 }));
    const busy = pinFor(inc, option('CPC_BUSY', ['host'], { kind: 'atLeast', value: 90 }, 1));
    r.pins = [cpu, busy];
    const complete = submitRca(r, inc.id, 'CPU_CAPACITY', 'CHANGE_REGRESSION', MIDWEST, [cpu.id, busy.id]);
    expect(complete.incidents[0]!.rca!.evidencePoints).toBe(EVIDENCE.recipeRelevance);
    expect(complete.insight - r.insight).toBe(5 + EVIDENCE.recipeRelevance + EVIDENCE.strongInsight);
    // The same two pins left loose never pay more than the completed recipe.
    const loose = submitRca(r, inc.id, 'CPU_CAPACITY', 'CHANGE_REGRESSION', MIDWEST, []);
    expect(complete.insight).toBeGreaterThanOrEqual(loose.insight);
  });

  it('makes the evidence strong when the trigger recipe completes, even under the relevance line', () => {
    // The competitor's APPL share is half weight, so this pair's own relevance is below the strong line: only the
    // trigger's recipe can make the evidence strong.
    const inc = incident({ truth: { mechanism: 'CPU_PRIORITY', trigger: 'DEMAND_SURGE' } });
    const r = { ...run, incidents: [inc] };
    const rate = pinFor(inc, option('ENDED_RATE', ['self'], { kind: 'multipleAtLeast', multiple: 1.25 }));
    const contender = pinFor(inc, option('APPL', ['competitor'], { kind: 'atLeast', value: 10 }));
    const cost = pinFor(inc, option('CPU_PER_TXN', ['self'], { kind: 'within', frac: 0.15 }));
    r.pins = [rate, contender, cost];
    const mechanismOnly = submitRca(r, inc.id, 'CPU_PRIORITY', 'DEMAND_SURGE', MIDWEST, [rate.id, contender.id]);
    const mech = mechanismOnly.incidents[0]!.rca!;
    expect(mech.proof!.find((p) => p.claim === 'mechanism')!.complete).toBe(true);
    expect(mech.proof!.find((p) => p.claim === 'trigger')!.complete).toBe(false);
    expect(mech.evidencePoints).toBe(EVIDENCE.recipeRelevance);
    expect(mechanismOnly.insight - r.insight).toBe(5 + EVIDENCE.recipeRelevance);

    const both = submitRca(r, inc.id, 'CPU_PRIORITY', 'DEMAND_SURGE', MIDWEST, [rate.id, contender.id, cost.id]);
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

  it('rejects a predicate pin from outside the incident window', () => {
    const inc = incident();
    const cpu = { ...pinFor(inc, option('DELAY_CPU', ['self'], { kind: 'atLeast', value: 10 })), tick: run.sim.tick - 10 * HOUR };
    const busy = pinFor(inc, option('CPC_BUSY', ['host'], { kind: 'atLeast', value: 90 }, 1));
    const proof = judgeRecipe(run, MIDWEST, [inc], [cpu, busy], { mechanism: 'CPU_CAPACITY' })!;
    // The out-of-window pin ticks nothing; the in-window one still does.
    expect(proof.predicates.map((p) => p.ok)).toEqual([false, true]);
    expect(proof.complete).toBe(false);
  });

  it('also requires a CF or LCU row to clear its own normal (the metric\'s notableMultiple)', () => {
    const inc = incident();
    const normal = pinFor(inc, option('DELAY_CPU', ['self'], { kind: 'atLeast', value: 10 }));
    // A CF02 that is chronically slow is not evidence for every fault: 60 µs against a 40 µs normal is only ×1.5.
    const slowRow = { ...pinFor(inc, option('CF_SYNC', ['server'], { kind: 'atLeast', value: 50 }, 2)), baseline: 40 };
    expect(judgeRecipe(run, MIDWEST, [inc], [normal, slowRow], { trigger: 'HARDWARE_FAULT' })!.predicates[0]!.ok).toBe(false);
    expect(judgeRecipe(run, MIDWEST, [inc], [normal, { ...slowRow, baseline: 20 }], { trigger: 'HARDWARE_FAULT' })!.predicates[0]!.ok).toBe(true);
  });

  it('does not prove growth from a flat cost alone, and does from an arrival rise', () => {
    const inc = incident();
    const cpu = pinFor(inc, option('DELAY_CPU', ['self'], { kind: 'atLeast', value: 10 }));
    const cost = pinFor(inc, option('CPU_PER_TXN', ['self'], { kind: 'within', frac: 0.15 }));
    expect(judgeRecipe(run, MIDWEST, [inc], [cpu, cost], { trigger: 'GROWTH' })!.complete).toBe(false);
    const arrivals = pinFor(inc, option('ENDED_RATE', ['self'], { kind: 'multipleAtLeast', multiple: 1.05 }));
    expect(judgeRecipe(run, MIDWEST, [inc], [cpu, arrivals], { trigger: 'GROWTH' })!.complete).toBe(true);
  });

  it('reads the work\'s report class row as its own (RC_ADVISOR)', () => {
    // The advisor gives a workload its own report class inside a shared service class; that row is about this work,
    // so a pin from it is `self` and not an unknown class (RT-13, §5.2's per-workload report class path).
    const def = structuredClone(run.sim.wlm.definition);
    const cics = def.subsystems.find((s) => s.subsystem === 'CICS')!;
    cics.defaultReportClass = 'RRBANK';
    const r = { ...run, sim: { ...run.sim, wlm: { ...run.sim.wlm, definition: def } } };
    const subjects = incidentSubjects(r, MIDWEST, 'RBANK', 0);
    expect(subjects.classes).toContain('RRBANK');
    const inc = incident({ subjects });
    const reportRow = { ...pinFor(inc, option('CPU_PER_TXN', ['self'], { kind: 'atLeast', value: 1.3 })), subject: 'RRBANK#1', system: 'PROD1' };
    const rate = { ...pinFor(inc, option('ENDED_RATE', ['self'], { kind: 'within', frac: 0.15 })), subject: 'RRBANK#1', system: 'PROD1' };
    const proof = judgeRecipe(r, MIDWEST, [inc], [reportRow, rate], { trigger: 'CHANGE_REGRESSION' })!;
    expect(proof.complete, JSON.stringify(proof.predicates)).toBe(true);
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
