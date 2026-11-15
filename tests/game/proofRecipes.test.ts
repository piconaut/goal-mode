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
  type PinRelation,
  type PredicateTest,
  type RecipeOption,
} from '../../src/content/evidence';
import { MIDWEST_GAME } from '../../src/content/game-midwest';
import { MIDWEST } from '../../src/content/scenarios';
import { TOOLS, type ToolFeature } from '../../src/content/tools';
import { addPin, incidentSubjects, judgeRecipe, scoreEvidence, type EvidencePin } from '../../src/game/evidence';
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

/** The batch night's incident shape: SMF 30 rows, a critical job's service class and the image it ran on. */
const batchIncident = (): Incident =>
  incident({ id: 998, workloadId: 'BATCH', subjects: { classes: ['BATCHPRD'], lpars: ['PROD1'], hosts: ['PROD1'], servers: [] } });

/** A DDF workload's incident: its own Workload Activity row carries resource samples, so CPU_PER_TXN is pinnable. */
const ddfIncident = (): Incident => incident({ id: 997, workloadId: 'ADHOC', subjects: incidentSubjects(run, MIDWEST, 'ADHOC', 0) });

/** The scenario's own knowledge of a workload's subsystem, used to keep the test's pins to rows a player can pin. */
const subsystemOf = (inc: Incident): string | undefined => MIDWEST.workloads.find((w) => w.id === inc.workloadId)?.subsystem;

/** Is this metric pinnable on the incident's own rows in this relation? A batch job metric needs a batch night.
 * CPU_PER_TXN needs a row that reports its own resource usage and an ended rate: not a CICS transaction row (RT-13
 * review; p.524), and not a batch class row as shipped, because the sim counts a job end only in a period with a
 * response-time goal and every shipped batch class is velocity or discretionary (RF-07, RT-13 review). A batch
 * incident's DEMAND_SURGE rate therefore has to come from a competitor's online row on the same image, which reports
 * its own END/S; a batch row's own `within`/`multipleAtLeast` reading would compare 0 with 0. */
const pinnable = (inc: Incident, metric: EvidenceMetric, relation: PinRelation = 'self'): boolean => {
  if (metric.startsWith('JOB_')) return inc.workloadId === 'BATCH';
  if (inc.workloadId === 'BATCH') return metric !== 'CPU_PER_TXN' && (metric !== 'ENDED_RATE' || relation === 'competitor');
  if (metric === 'CPU_PER_TXN') return subsystemOf(inc) !== 'CICS';
  return true;
};

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
    // A server's CPU is Monitor III PROCU's EAppl (RT-11); the Workload Activity report has no job rows.
    if (metric === 'JOB_APPL') return source('PROCU', s.servers[0]?.jobname ?? 'CICSAOR1', s.servers[0]?.lparId ?? host);
    return source('WLMGL', s.serverClasses?.[0] ?? 'STCHI#1', host);
  }
  // self
  if (metric === 'CPU_VS_BASE' || metric === 'LOCK_WAIT' || metric === 'SYNC_IO' || metric === 'CF_WAIT' || metric === 'DBAT_QUEUE')
    return source('Db2 101', inc.workloadId, '*PLEX');
  if (metric === 'QR_WAIT' || metric === 'MXT_WAIT' || metric === 'FAIL_PCT') return source('CICS 110', inc.workloadId, '*PLEX');
  if (metric.startsWith('JOB_')) {
    // SMF 30 is the batch night's record: an online incident has no such row to pin.
    if (inc.workloadId !== 'BATCH') throw new Error(`${metric} needs a batch incident, not ${inc.workloadId}`);
    return source('SMF 30', inc.workloadId, '*PLEX');
  }
  // A WLMGL row on the work is its service class row (a batch night's is a critical job's class).
  return source('WLMGL', s.classes.find((c) => !(s.serverClasses ?? []).includes(c)) ?? inc.workloadId, host);
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
function threePinProof(mechanism: Mechanism, trigger: Trigger, accept?: (inc: Incident, pins: EvidencePin[]) => boolean): { inc: Incident; pins: EvidencePin[] } | undefined {
  for (const inc of [incident(), ddfIncident(), batchIncident()]) {
    const found = threePinProofOn(inc, mechanism, trigger, accept);
    if (found) return { inc, pins: found };
  }
  return undefined;
}

/** Strong evidence: a complete mechanism recipe that pays, and either the trigger's recipe or the pins' own relevance
 * line (RT-13's second route), judged exactly as filing the RCA would. */
const strong = (inc: Incident, pins: EvidencePin[], mechanism: Mechanism, trigger: Trigger): boolean => {
  const filed = { ...inc, truth: { mechanism, trigger } };
  // The mechanism's recipe must actually complete: `points` is also the plain relevance sum, so it alone would let a
  // sum of exactly three stand in for a proof (RT-13 review).
  if (!judgeRecipe(run, MIDWEST, [filed], pins, { mechanism })!.complete) return false;
  const scored = scoreEvidence(run, MIDWEST, filed, [filed], { mechanism, trigger }, pins);
  return scored.points === EVIDENCE.recipeRelevance && scored.strong;
};

function threePinProofOn(inc: Incident, mechanism: Mechanism, trigger: Trigger, accept?: (inc: Incident, pins: EvidencePin[]) => boolean): EvidencePin[] | undefined {
  const mr = recipeFor({ mechanism })!;
  const tr = recipeFor({ trigger })!;
  const variants = (o: RecipeOption): PinVariant[] =>
    o.relations.filter((rel) => pinnable(inc, o.metric, rel)).map((rel) => {
      const p = pinFor(inc, { ...o, relations: [rel] });
      return { key: `${p.source}|${p.subject}|${p.system}|${o.metric}`, source: p.source, subject: p.subject, system: p.system, metric: o.metric, test: o.test };
    });
  const mine = mr.predicates[0].options.flatMap(variants);
  const mine2 = mr.predicates[1].options.flatMap(variants);
  const theirs = tr.predicates[0].options.flatMap(variants);
  const theirs2 = tr.predicates[1].options.flatMap(variants);
  // The mechanism's two predicates alone, which can still earn strong by the relevance line; then the four-way sets
  // that may complete both recipes with a shared row; then the three-pin sets that carry one of the trigger's pins as
  // a real symptom reading (a batch night's CPU-wait share against a batch failure's trigger, whose own normal half
  // has no row to read until RF-07). The bonus then comes by the relevance line, which is §4.6's second route.
  const trials: PinVariant[][] = [];
  for (const m1 of mine) for (const m2 of mine2) trials.push([m1, m2]);
  for (const m1 of mine) for (const m2 of mine2) for (const t1 of theirs) for (const t2 of theirs2) trials.push([m1, m2, t1, t2]);
  for (const m1 of mine) for (const m2 of mine2) for (const t of [...theirs, ...theirs2]) trials.push([m1, m2, t]);
  for (const trial of trials) {
    {
          const groups = new Map<string, PinVariant[]>();
          for (const v of trial) groups.set(v.key, [...(groups.get(v.key) ?? []), v]);
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
          const complete = judgeRecipe(run, MIDWEST, [inc], pins, { mechanism })!.complete && judgeRecipe(run, MIDWEST, [inc], pins, { trigger })!.complete;
          if (accept ? accept(inc, pins) : complete) return pins;
    }
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
          const pinInc = opt.metric.startsWith('JOB_') ? batchIncident() : opt.metric === 'CPU_PER_TXN' ? ddfIncident() : inc;
          expect(pinnable(pinInc, opt.metric), `${claimName(recipe.claim)} ${opt.metric} on ${pinInc.workloadId}`).toBe(true);
          const proof = judgeRecipe(run, MIDWEST, [pinInc], [pinFor(pinInc, opt)], recipe.claim)!;
          expect(proof.predicates[index]!.ok, `${claimName(recipe.claim)} / ${pred.label} / ${opt.metric}`).toBe(true);
          // The option's tier must be its report's own tier, both ways: an overstated tier would tell a player the
          // gate needs a tool it does not (RT-13 review).
          const pin = pinFor(pinInc, opt);
          expect(SOURCE_TIER[pin.source]!, `${claimName(recipe.claim)} ${opt.metric} from ${pin.source}`).toBe(opt.tier);
          // A tier-0 option is a Workload Activity row, and the Workload Activity pin form must offer it (RT-13):
          // a metric only the tests and the CLI can pin is not a player's tier-0 path.
          if (opt.tier === 0) expect(WLM_METRICS, `${claimName(recipe.claim)} ${opt.metric}`).toContain(opt.metric);
        }
      }
      // Both predicates together complete the recipe, on the incident kind that carries its rows.
      const recipeInc = recipe.predicates.some((p) => p.options[0]!.metric.startsWith('JOB_'))
        ? batchIncident()
        : recipe.predicates.some((p) => p.options[0]!.metric === 'CPU_PER_TXN') ? ddfIncident() : inc;
      const pins = recipe.predicates.map((pred) => pinFor(recipeInc, pred.options[0]!));
      const proof = judgeRecipe(run, MIDWEST, [recipeInc], pins, recipe.claim)!;
      expect(proof.complete, `${claimName(recipe.claim)}: ${JSON.stringify(proof.predicates)}`).toBe(true);
    }
  });

  it('rejects the look-alikes the entry names: a surge is not a regression and a regression is not a surge', () => {
    // A DDF workload: its own Workload Activity row carries both columns, so a player can pin either of these.
    const inc = ddfIncident();
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

  it('does not call a healthy server class delayed, and does call one under its goal', () => {
    // The re-review's repro: a quiet hour's server velocity (84 %) plus a flat ended rate completed DEPENDENCY and paid
    // the recipe's three points for two normal readings. Velocity is an absolute level, so it cannot mean "delayed": a
    // velocity goal is met at every reading above it (a 60 % goal read 83–96 % in a quiet day's rows). The reports' own
    // PI is the goal-to-achieved ratio, so PI > 1.2 is a server class more than 20 % short of its goal (RT-13 review).
    const inc = incident();
    const filed = { ...inc, truth: { mechanism: 'DEPENDENCY' as const, trigger: 'DEMAND_SURGE' as const } };
    const r = { ...run, incidents: [filed] };
    const velocity = { ...pinFor(filed, option('VELOCITY', ['server'], { kind: 'atMost', value: 90 }, 1)), value: 84 };
    const flat = { ...pinFor(filed, option('ENDED_RATE', ['self'], { kind: 'within', frac: 0.15 })), value: 100, baseline: 100 };
    r.pins = [velocity, flat];
    const healthy = judgeRecipe(r, MIDWEST, [filed], r.pins, { mechanism: 'DEPENDENCY' })!;
    expect(healthy.complete).toBe(false);
    expect(healthy.predicates.map((p) => p.ok)).toEqual([false, true]);
    const scored = submitRca(r, filed.id, 'DEPENDENCY', 'DEMAND_SURGE', MIDWEST, [velocity.id, flat.id]);
    expect(scored.incidents[0]!.rca!.evidencePoints).toBeLessThan(EVIDENCE.recipeRelevance);
    // A healthy PI (0.70 is the quiet hour's PROD1 STCHI#1 reading) is not a delayed server either, so the line is
    // a real threshold rather than any reading (RT-13 review).
    const healthyPi = { ...pinFor(filed, option('PI', ['server'], { kind: 'atLeast', value: 1.2 })), value: 0.7 };
    const quiet = { ...r, pins: [healthyPi, flat] };
    expect(judgeRecipe(quiet, MIDWEST, [filed], quiet.pins, { mechanism: 'DEPENDENCY' })!.predicates.map((p) => p.ok)).toEqual([false, true]);
    // The same server class under its goal (PI > 1.2) is the delayed server the recipe asks for.
    const delayed = pinFor(filed, option('PI', ['server'], { kind: 'atLeast', value: 1.2 }));
    const under = { ...r, pins: [delayed, flat] };
    expect(judgeRecipe(under, MIDWEST, [filed], under.pins, { mechanism: 'DEPENDENCY' })!.complete).toBe(true);
  });

  it('gives every common recipe a path that needs no tool beyond tier 1', () => {
    // The witness is the incident kind whose report rows carry those cheap options: a CICS transaction row has no
    // CPU per transaction (RT-13 review), so CHANGE_REGRESSION is witnessed on a DDF workload, whose own Workload
    // Activity row does carry it. The claim keeps a tier-0/1 path; the CICS workload reads that one column from CICS
    // monitoring, as on a real system.
    for (const claim of COMMON_RECIPES) {
      const recipe = recipeFor(claim)!;
      let witness: { inc: Incident; pins: EvidencePin[] } | undefined;
      for (const inc of [incident(), ddfIncident(), batchIncident()]) {
        const picked = recipe.predicates.map((pred) => {
          const cheap = pred.options.find((o) => o.tier <= 1 && pinnable(inc, o.metric));
          return cheap ? pinFor(inc, cheap) : null;
        });
        if (picked.some((x) => x === null)) continue;
        const pins = picked as EvidencePin[];
        if (judgeRecipe(run, MIDWEST, [inc], pins, claim)!.complete) {
          witness = { inc, pins };
          break;
        }
      }
      expect(witness, `${claimName(claim)}: no tier-0/1 witness`).toBeDefined();
      for (const p of witness!.pins) expect(SOURCE_TIER[p.source]!, `${claimName(claim)} from ${p.source}`).toBeLessThanOrEqual(1);
    }
    // A later report may be needed somewhere, but the gate must never require a tier-3 tool (§5.5). The type
    // (`0 | 1 | 2`) makes a tier-3 option unrepresentable, so there is nothing to assert here (RT-13 review).
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
    for (const [mechanism, trigger] of pairs) {
      const found = threePinProof(mechanism, trigger, (inc, pins) => strong(inc, pins, mechanism, trigger));
      expect(found, `${mechanism}/${trigger}: no strong three-pin proof`).toBeDefined();
      expect(found!.pins.length, `${mechanism}/${trigger}`).toBeLessThanOrEqual(EVIDENCE.perRca);
      expect(judgeRecipe(run, MIDWEST, [found!.inc], found!.pins, { mechanism })!.complete, mechanism).toBe(true);
    }
  });

  it('earns strong evidence for 104 of the 108 pairs inside three pins, the four batch failures waiting on RF-07', () => {
    // The bonus is reachable two ways: most pairs complete both recipes; the rest complete the mechanism's recipe and
    // clear the pins' own relevance line (RT-13's second route), which is what strong meant before. A batch failure
    // is the exception, because a batch incident's own rows report no END/S until RF-07 counts job ends.
    // The four that cannot are all batch failures: their trigger's half needs a rate or a newcomer's share, and the
    // only pins that point at JOB_FAILURE are SMF 30's job metrics, so the batch night's WLMGL row scores nothing
    // ("points elsewhere") and a competitor's rate is half weight (RT-13 review, B1). RF-07 gives batch rows their
    // END/S and lifts all four.
    const noProof = ['JOB_FAILURE/POLICY', 'JOB_FAILURE/NEW_WORKLOAD', 'JOB_FAILURE/GROWTH', 'JOB_FAILURE/DEMAND_SURGE'];
    const pairs: [Mechanism, Trigger][] = [];
    for (const mechanism of MECHANISMS) for (const trigger of TRIGGERS) pairs.push([mechanism, trigger]);
    let proved = 0;
    for (const [mechanism, trigger] of pairs) {
      const found = threePinProof(mechanism, trigger, (inc, pins) => strong(inc, pins, mechanism, trigger));
      if (mechanism === 'JOB_FAILURE' && trigger === 'DEMAND_SURGE') {
        expect(found, 'JOB_FAILURE/DEMAND_SURGE must not be provable from a row the sim cannot make').toBeUndefined();
        continue;
      }
      if (noProof.includes(`${mechanism}/${trigger}`)) {
        expect(found, `${mechanism}/${trigger} must not be provable from a row the sim cannot make`).toBeUndefined();
        continue;
      }
      expect(found, `${mechanism}/${trigger}: no strong three-pin proof`).toBeDefined();
      expect(found!.pins.length).toBeLessThanOrEqual(EVIDENCE.perRca);
      proved += 1;
    }
    expect(proved).toBe(104);
  });

  it('names the pairs the two recipes cannot both prove inside three pins', () => {
    // For six of these the two recipes need four distinct rows (a capacity adjustment beside a contender, a newcomer
    // beside a busy machine), so the trigger's recipe cannot tick fully in three pins. The strong bonus still arrives
    // by the relevance line above; the reply just shows one trigger predicate unticked. BACKLOG RT-26 asks whether the
    // limit should allow a paired proof's fourth pin.
    //
    // The seventh is a different cause: a batch incident's DEMAND_SURGE cost pin has no row to read, because the sim
    // counts a job end only in a period with a response-time goal and every shipped batch class is velocity or
    // discretionary (RF-07). No fourth pin helps there; the bonus comes from the mechanism's recipe plus the surge
    // pin's own relevance (RT-13 review, B3).
    const needMore: string[] = [];
    for (const mechanism of MECHANISMS)
      for (const trigger of TRIGGERS) if (!threePinProof(mechanism, trigger)) needMore.push(`${mechanism}/${trigger}`);
    expect(needMore.sort()).toEqual([
      'CAPPING/APPLICATION_ERROR',
      'CAPPING/BATCH_OVERLAP',
      'CAPPING/NEW_WORKLOAD',
      'CPU_CAPACITY/APPLICATION_ERROR',
      'CPU_CAPACITY/BATCH_OVERLAP',
      'CPU_CAPACITY/NEW_WORKLOAD',
      'CPU_PRIORITY/APPLICATION_ERROR',
      'CPU_PRIORITY/BATCH_OVERLAP',
      'CPU_PRIORITY/HARDWARE_FAULT',
      'JOB_FAILURE/BATCH_OVERLAP',
      'JOB_FAILURE/CHANGE_REGRESSION',
      'JOB_FAILURE/DEMAND_SURGE',
      'JOB_FAILURE/GROWTH',
      'JOB_FAILURE/HARDWARE_FAULT',
      'JOB_FAILURE/NEW_WORKLOAD',
      'JOB_FAILURE/POLICY',
      'JOB_FAILURE/RUNAWAY_WORK',
    ]);
    // Of the seventeen, thirteen still reach strong by the relevance line; the four batch failures whose trigger half
    // needs a mechanism-relevant symptom do not, until RF-07 gives a batch row its END/S.
    const cannotBeStrong = needMore.filter((pair) => {
      const [mechanism, trigger] = pair.split('/') as [Mechanism, Trigger];
      return !threePinProof(mechanism, trigger, (inc, pins) => strong(inc, pins, mechanism, trigger));
    });
    expect(cannotBeStrong.sort()).toEqual([
      'JOB_FAILURE/DEMAND_SURGE',
      'JOB_FAILURE/GROWTH',
      'JOB_FAILURE/NEW_WORKLOAD',
      'JOB_FAILURE/POLICY',
    ]);
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
    // The same two pins left loose (a pair that does not complete a recipe) never pay more than the completed one.
    const loosePair = [pinFor(inc, option('DELAY_CPU', ['self'], { kind: 'atLeast', value: 10 })), pinFor(inc, option('DELAY_ZIIP', ['self'], { kind: 'atLeast', value: 10 }))];
    r.pins = loosePair;
    const loose = submitRca(r, inc.id, 'CPU_CAPACITY', 'CHANGE_REGRESSION', MIDWEST, loosePair.map((p) => p.id));
    expect(loose.incidents[0]!.rca!.proof!.find((p) => p.claim === 'mechanism')!.complete).toBe(false);
    expect(complete.insight).toBeGreaterThanOrEqual(loose.insight);
  });

  it('makes the evidence strong when the trigger recipe completes, even under the relevance line', () => {
    // The competitor's APPL share is half weight, so this pair's own relevance is below the strong line: only the
    // trigger's recipe can make the evidence strong.
    const inc = ddfIncident();
    const filed = { ...inc, truth: { mechanism: 'CPU_PRIORITY' as const, trigger: 'DEMAND_SURGE' as const } };
    const r = { ...run, incidents: [filed] };
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
    const inc = ddfIncident();
    const cpu = pinFor(inc, option('DELAY_CPU', ['self'], { kind: 'atLeast', value: 10 }));
    const cost = pinFor(inc, option('CPU_PER_TXN', ['self'], { kind: 'within', frac: 0.15 }));
    expect(judgeRecipe(run, MIDWEST, [inc], [cpu, cost], { trigger: 'GROWTH' })!.complete).toBe(false);
    const arrivals = pinFor(inc, option('ENDED_RATE', ['self'], { kind: 'multipleAtLeast', multiple: 1.05 }));
    expect(judgeRecipe(run, MIDWEST, [inc], [cpu, arrivals], { trigger: 'GROWTH' })!.complete).toBe(true);
  });

  it('reads the work\'s report class row as its own (RC_ADVISOR)', () => {
    // The advisor gives a workload its own report class inside a shared service class; that row is about this work,
    // so a pin from it is `self` and not an unknown class (RT-13, §5.2's per-workload report class path). A DDF
    // workload, because its report class row carries the resource samples the cost pin reads.
    const def = structuredClone(run.sim.wlm.definition);
    const ddf = def.subsystems.find((s) => s.subsystem === 'DDF')!;
    ddf.rules.push({ qualifier: 'UI', pattern: 'MOBAPI', serviceClass: 'DDFPRD', reportClass: 'RMOBILE', children: [] });
    const r = { ...run, sim: { ...run.sim, wlm: { ...run.sim.wlm, definition: def } } };
    const subjects = incidentSubjects(r, MIDWEST, 'MOBILE', 0);
    expect(subjects.classes).toContain('RMOBILE');
    const inc = incident({ workloadId: 'MOBILE', subjects });
    const reportRow = { ...pinFor(inc, option('CPU_PER_TXN', ['self'], { kind: 'atLeast', value: 1.3 })), subject: 'RMOBILE#1', system: 'PROD1' };
    const rate = { ...pinFor(inc, option('ENDED_RATE', ['self'], { kind: 'within', frac: 0.15 })), subject: 'RMOBILE#1', system: 'PROD1' };
    const proof = judgeRecipe(r, MIDWEST, [inc], [reportRow, rate], { trigger: 'CHANGE_REGRESSION' })!;
    expect(proof.complete, JSON.stringify(proof.predicates)).toBe(true);
    // A player can point a second rule at the same report class (Rules editor). That row then aggregates another
    // workload's work, so it is not about MOBILE alone and must not relate as `self` (RT-13 review).
    const shared = structuredClone(def);
    shared.subsystems.find((s) => s.subsystem === 'DDF')!.rules
      .push({ qualifier: 'UI', pattern: 'BIUSER', serviceClass: 'DDFPRD', reportClass: 'RMOBILE', children: [] });
    const rShared = { ...run, sim: { ...run.sim, wlm: { ...run.sim.wlm, definition: shared } } };
    expect(incidentSubjects(rShared, MIDWEST, 'MOBILE', 0).classes).not.toContain('RMOBILE');
    // A workload that shares the name but is routed only to an image this work does not run on does not contaminate
    // this work's rows there: TSO takes RMOBILE as its default report class but is routed to DEVT alone (RT-13 review).
    const offImage = structuredClone(def);
    offImage.subsystems.find((s) => s.subsystem === 'TSO')!.defaultReportClass = 'RMOBILE';
    const rOff = {
      ...run,
      sim: { ...run.sim, wlm: { ...run.sim.wlm, definition: offImage }, routing: { ...run.sim.routing, TSO: { DEVT: 1 } } },
    };
    expect(incidentSubjects(rOff, MIDWEST, 'MOBILE', 0).classes).toContain('RMOBILE');
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
    // A CICS transaction row reports no resource usage (RMF Report Analysis p.524): its CPU is the regions'
    // address-space CPU, most of it other work, so the pin is refused and the answer names CICS monitoring. A region
    // class row has the address spaces' CPU but no transactions, so it has no quotient either.
    const last = run.sim.rmf.intervals.length - 1;
    const cicsRow = run.sim.rmf.intervals[last]!.wlm.find((w) => w.resourceSamples === false && w.endPerSec > 0)!;
    const refused = addPin(run, MIDWEST, { source: 'WLMGL', index: last, system: cicsRow.lparId, scKey: cicsRow.scKey, metric: 'CPU_PER_TXN' });
    expect(refused.ok).toBe(false);
    expect(refused.message).toMatch(/CICS monitoring/);
    const regionRow = run.sim.rmf.intervals[last]!.wlm.find((w) => w.resourceSamples !== false && w.endPerSec === 0 && w.applCpPct > 0)!;
    const noRate = addPin(run, MIDWEST, { source: 'WLMGL', index: last, system: regionRow.lparId, scKey: regionRow.scKey, metric: 'CPU_PER_TXN' });
    expect(noRate.ok).toBe(false);
    expect(noRate.message).toMatch(/no ended transactions or jobs/);

  });

  it('refuses a batch class row\'s cost per transaction until RF-07 counts job ends', () => {
    // The night's own BATCHPRD row (velocity goal 30 %) prints APPL% CP and END/S 0, because the sim counts a job end
    // only in a period with a response-time goal (RF-07). So the tier-0 cost pin a batch workload would use does not
    // exist yet, and the answer says so instead of dividing by zero (RT-13 review, B3).
    const night = advance(startDay(newRun(MIDWEST, content, 7), content), MIDWEST, content, 20 * HOUR);
    const index = night.sim.rmf.intervals.length - 1;
    const row = night.sim.rmf.intervals[index]!.wlm.find((w) => w.scKey.startsWith('BATCH') && w.resourceSamples !== false && w.applCpPct > 0)!;
    expect(row.endPerSec).toBe(0);
    const pin = addPin(night, MIDWEST, { source: 'WLMGL', index, system: row.lparId, scKey: row.scKey, metric: 'CPU_PER_TXN' });
    expect(pin.ok).toBe(false);
    expect(pin.message).toMatch(/no ended transactions or jobs/);
  });

  it('counts general-purpose CPU per transaction, not zIIP time', () => {
    // Two runs that differ only in the newest interval's zIIP column: the quotient is APPL% CP ÷ END/S, so the pin
    // must not move. Adding the zIIP column would multiply it by the row's CP:IIP ratio (RT-13 review).
    const index = run.sim.rmf.intervals.length - 1;
    const target = run.sim.rmf.intervals[index]!;
    const row = target.wlm.find((w) => w.resourceSamples !== false && w.endPerSec > 0 && w.applCpPct > 0)!;
    const withZiip: RunState = {
      ...run,
      sim: {
        ...run.sim,
        rmf: {
          ...run.sim.rmf,
          intervals: [...run.sim.rmf.intervals.slice(0, index), { ...target, wlm: target.wlm.map((w) => (w === row ? { ...w, applIipPct: w.applCpPct * 20 } : w)) }],
        },
      },
    };
    const pinOf = (r: RunState): EvidencePin => {
      const out = addPin(r, MIDWEST, { source: 'WLMGL', index, system: row.lparId, scKey: row.scKey, metric: 'CPU_PER_TXN' });
      expect(out.ok, out.message).toBe(true);
      return out.run.pins.at(-1)!;
    };
    expect(pinOf(withZiip).value).toBe(pinOf(run).value);
  });

  it('earns strong from a complete trigger recipe even when the mechanism recipe is incomplete', () => {
    // A filed, accepted trigger proved end to end is a discriminating reading; the mechanism's own recipe may still
    // have a predicate unticked (RT-13 review; §4.6 promises the trigger recipe makes the evidence strong).
    const filed = { ...ddfIncident(), truth: { mechanism: 'CAPPING' as const, trigger: 'DEMAND_SURGE' as const } };
    const rate = pinFor(filed, option('ENDED_RATE', ['self'], { kind: 'multipleAtLeast', multiple: 1.5 }));
    const cost = pinFor(filed, option('CPU_PER_TXN', ['self'], { kind: 'within', frac: 0.15 }));
    const scored = scoreEvidence(run, MIDWEST, filed, [filed], { mechanism: 'CAPPING', trigger: 'DEMAND_SURGE' }, [rate, cost]);
    expect(scored.proof.find((p) => p.claim === 'trigger')!.complete).toBe(true);
    expect(scored.proof.find((p) => p.claim === 'mechanism')!.complete).toBe(false);
    expect(scored.points).toBeGreaterThan(0);
    expect(scored.strong).toBe(true);
    // A wrong mechanism still earns nothing, however well the trigger is proven: the bonus rides on the points.
    const wrong = { ...filed, truth: { mechanism: 'IO' as const, trigger: 'DEMAND_SURGE' as const } };
    const r = { ...run, incidents: [wrong], pins: [rate, cost] };
    const filedWrong = submitRca(r, wrong.id, 'CAPPING', 'DEMAND_SURGE', MIDWEST, [rate.id, cost.id]);
    expect(filedWrong.incidents[0]!.rca!.evidencePoints).toBe(0);
    expect(filedWrong.insight - r.insight).toBe(2);
  });

  it('keeps the scoring numbers the design and the reply quote', () => {
    // A deliberate tripwire (RT-13 review): these literals are in docs/rca-design.md §4.6, SPEC §10 and the reply, so
    // changing one without its documentation is a finding, not a refactor.
    expect(EVIDENCE.recipeRelevance).toBe(3);
    expect(EVIDENCE.strongInsight).toBe(5);
    expect(EVIDENCE.symptomRelevance).toBe(0.5);
    expect(EVIDENCE.strongAt).toBe(2);
    expect(EVIDENCE.perRca).toBe(3);
    // One complete proof, nothing loose: the mechanism's 3, the trigger recipe's strong 5, and the answer's 3 + 2.
    const inc = incident({ truth: { mechanism: 'CPU_CAPACITY', trigger: 'CHANGE_REGRESSION' } });
    const r = { ...run, incidents: [inc] };
    const pins = [
      pinFor(inc, option('DELAY_CPU', ['self'], { kind: 'atLeast', value: 10 })),
      pinFor(inc, option('CPC_BUSY', ['host'], { kind: 'atLeast', value: 90 }, 1)),
      pinFor(inc, option('ENDED_RATE', ['self'], { kind: 'within', frac: 0.15 })),
    ];
    r.pins = pins;
    const out = submitRca(r, inc.id, 'CPU_CAPACITY', 'CHANGE_REGRESSION', MIDWEST, pins.map((p) => p.id));
    expect(out.incidents[0]!.rca!.points).toBe(3 + 2 + 3);
    expect(out.insight - r.insight).toBe(3 + 2 + 3 + 5);
  });

  it('keeps every recipe\'s predicates in the design\'s order: the symptom, then the discriminator', () => {
    // The design table, the reply and the proof lines all read the first predicate as "the work was hurt" and the
    // second as the discriminator. A golden table so swapping a recipe's halves cannot pass (RT-13 review).
    const labels = Object.fromEntries(RECIPES.map((r) => [claimName(r.claim), r.predicates.map((p) => p.label)]));
    expect(labels).toEqual({
      CPU_CAPACITY: ['the work was hurt: CPU delay, more CPU per transaction, or more arrivals than normal', 'the processor or the image was full'],
      CPU_PRIORITY: ['the work was hurt: CPU delay, more CPU per transaction, or more arrivals than normal', 'another class was using a host image'],
      CAPPING: ['the work was hurt: CPU delay, more CPU per transaction, or more arrivals than normal', 'a cap held the image or the class'],
      DEPENDENCY: ["a server's class was delayed, or the work's wait was elsewhere", 'the work itself was not the problem: no CPU wait, or its rate or cost per transaction was its normal'],
      LOCK_CONTENTION: ['the work waited on locks', 'the wait was not CPU, or nothing about the work changed'],
      CF_SERVICE: ['CF requests were slow', 'the work itself was not the limit'],
      QR_TCB: ['QR TCB dispatch waits were high', 'the work was neither short of CPU nor queued for a task slot'],
      THREAD_LIMIT: ['work queued for a thread, task slot or the region storage', 'the work itself was not the problem: no CPU wait, or its rate or cost per transaction was its normal'],
      ROUTING: ['one region or route failed work', 'the work itself was not the problem: no CPU wait, or its rate or cost per transaction was its normal'],
      IO: ['I/O waits or I/O queueing were high', 'the work itself was not the problem: no CPU wait, or its rate or cost per transaction was its normal'],
      STORAGE: ['the work waited on storage', 'the work itself was not the problem: no CPU wait, or its rate or cost per transaction was its normal'],
      JOB_FAILURE: ['critical jobs abended', "the night's CPU wait was low, or nothing about the work changed"],
      DEMAND_SURGE: ['the work arrived faster than its normal hour', 'each transaction still cost its normal CPU'],
      CHANGE_REGRESSION: ['each transaction cost more CPU', 'the work did not arrive faster'],
      RUNAWAY_WORK: ['one class or job used at least half an engine', "that work's rate did not rise"],
      BATCH_OVERLAP: ['the work waited on a lock, or the batch night lost its time to CPU waits', 'nothing about the work changed: its rate or its cost per transaction was its normal'],
      POLICY: ["the work was hurt in some report's terms", 'nothing about the work changed, so the configuration as set was what was left'],
      HARDWARE_FAULT: ["the resource's own report showed a fault", 'nothing about the work changed'],
      NEW_WORKLOAD: ['work that was not there before was using a host image', 'nothing about the work changed: its rate or its cost per transaction was its normal'],
      GROWTH: ['the work was hurt for CPU', 'more work arrived than its normal hour'],
      APPLICATION_ERROR: ['work failed or a region ran short of its own storage', 'the work itself was not the problem: no CPU wait, or its rate or cost per transaction was its normal'],
    });
  });

  it('pins a surge and its flat cost per transaction from the same report', () => {
    // A DDF workload's own WLMGL row carries both columns (a CICS transaction row has no cost to read).
    const noon = advance(startDay(newRun(MIDWEST, content, 7), content), MIDWEST, content, 6 * HOUR);
    const surged = advance({ ...noon, pendingCommands: [{ kind: 'SET_MODIFIER', mod: 'rate', key: 'ADHOC', value: 1.6 }] }, MIDWEST, content, HOUR);
    const index = surged.sim.rmf.intervals.length - 1;
    const subjects = incidentSubjects(surged, MIDWEST, 'ADHOC', 0);
    const cls = subjects.classes[0]!;
    const rows = surged.sim.rmf.intervals[index]!.wlm.filter((w) => subjects.hosts.includes(w.lparId) && w.scKey.startsWith(`${cls}#`) && w.endPerSec > 0);
    expect(rows.length).toBeGreaterThan(0);
    let proven = false;
    for (const row of rows) {
      const rate = addPin(surged, MIDWEST, { source: 'WLMGL', index, system: row.lparId, scKey: row.scKey, metric: 'ENDED_RATE' });
      expect(rate.ok, rate.message).toBe(true);
      const cost = addPin(rate.run, MIDWEST, { source: 'WLMGL', index, system: row.lparId, scKey: row.scKey, metric: 'CPU_PER_TXN' });
      expect(cost.ok, cost.message).toBe(true);
      const inc = incident({ workloadId: 'ADHOC', startTick: surged.sim.tick - HOUR, subjects });
      const proof = judgeRecipe(surged, MIDWEST, [inc], [rate.run.pins.at(-1)!, cost.run.pins.at(-1)!], { trigger: 'DEMAND_SURGE' })!;
      if (proof.complete) {
        proven = true;
        break;
      }
    }
    expect(proven, 'no ADHOC class row showed the surge and its flat cost').toBe(true);
  });
});
