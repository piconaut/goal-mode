// Build this tick's slices: each workload × LPAR × service-class period, plus each
// address space. Classification and period splitting happen here.

import { mpFactor, cpSpeed, generationOf, suPerCpuSecOf, ziipSpeed } from '../hw/cpc';
import type { CpcConfig, LparConfig } from '../core/types';
import { classify } from '../wlm/classify';
import type { ServiceDefinition } from '../wlm/types';
import { SYSOTHER, SYSSTC, SYSTEM } from '../wlm/types';
import { sliceSpec, type SliceSpec } from '../wlm/evaluate';
import { periodAtService, splitPeriods } from './periods';
import type { AddressSpaceDef, WorkloadDef } from './types';

export const scKeyOf = (serviceClass: string, period: number) => `${serviceClass}#${period + 1}`;

/** Service-class period of work that has consumed `serviceSu` so far (Infinity: a long-running
 * address space, which has aged into the last period). */
export function scKeyAtService(def: ServiceDefinition, serviceClass: string, serviceSu: number): string {
  return scKeyOf(serviceClass, periodAtService(periodsOf(def, serviceClass).map((p) => p.durationSu), serviceSu));
}

/** Whether zIIP-eligible work in this period may overflow to CPs: never for discretionary goals, nor
 * with Honor Priority NO (z/OS MVS Planning: WLM, "Honor Priority"). */
export function honorsPriority(def: ServiceDefinition, serviceClass: string, scKey: string): boolean {
  const period = Number(scKey.slice(scKey.lastIndexOf('#') + 1)) - 1;
  return periodsOf(def, serviceClass)[period]?.honor ?? true;
}


export interface SliceBuildInput {
  def: ServiceDefinition;
  cpc: CpcConfig;
  lpar: LparConfig;
  workloads: readonly WorkloadDef[];
  /** Arrival rate per workload id for the whole sysplex this tick (incl. retries). */
  rates: Readonly<Record<string, number>>;
  addressSpaces: readonly AddressSpaceDef[];
  /** Global CPU-per-transaction multipliers per workload (events, regressions). */
  cpuMultiplier?: Readonly<Record<string, number>>;
  /**
   * Routing-free identity of `workloads` (same content per id, only shares differ). With it, templates
   * are cached per LPAR by that LPAR's shares, so a share change elsewhere doesn't rebuild them.
   */
  scope?: object;
}

function periodsOf(def: ServiceDefinition, sc: string) {
  if (sc === SYSTEM || sc === SYSSTC || sc === SYSOTHER) {
    return [{ goal: sc === SYSOTHER ? ({ kind: 'DISC' } as const) : null, durationSu: null, honor: sc !== SYSOTHER }];
  }
  const c = def.classes.find((x) => x.id === sc);
  if (!c) return [{ goal: { kind: 'DISC' } as const, durationSu: null, honor: false }];
  return c.periods.map((p) => ({ goal: p.goal, durationSu: p.durationSu, honor: c.honorPriority && p.goal.kind !== 'DISC' }));
}

/** Rate-independent slice template: demand fields are per unit of the driving rate. */
interface SliceTemplate {
  spec: SliceSpec;
  workloadId: string | null;
  /** For transactions: share of the workload's sysplex rate that lands on this slice. */
  rateCoef: number;
  cpCoef: number;
  ziCoef: number;
  /** For address spaces: base engines plus server CPU per dependent workload's rate. */
  cpBase: number;
  ziBase: number;
  roleTerms: { workloadId: string; cpCoef: number; ziCoef: number }[];
}

// Templates depend only on (definition, lpar config, cpc config, content); memoise on the
// definition object and a config key. Pure memoisation: same inputs, same templates.
const templateCache = new WeakMap<ServiceDefinition, WeakMap<object, WeakMap<readonly AddressSpaceDef[], Map<string, SliceTemplate[]>>>>();
// Cache bound: dynamic routing produces many share signatures over a long run.
const MAX_TEMPLATE_SETS = 512;

function templateKey(input: SliceBuildInput): string {
  const { cpc, lpar } = input;
  const cp = lpar.pools.find((p) => p.pool === 'CP');
  const mult = input.cpuMultiplier ? JSON.stringify(input.cpuMultiplier) : '';
  return `${lpar.id}|${cpc.generation}|${cpc.capacitySetting}|${cp?.logical ?? 0}|${mult}|${input.workloads.length}|${input.addressSpaces.length}`;
}

function buildTemplates(input: SliceBuildInput): SliceTemplate[] {
  const { def, cpc, lpar } = input;
  const cpPool = lpar.pools.find((p) => p.pool === 'CP');
  const mp = 1 / mpFactor(cpPool?.logical ?? 1, generationOf(cpc).mpK);
  const cpSp = cpSpeed(cpc);
  const zSp = ziipSpeed(cpc);
  const suRate = suPerCpuSecOf(cpc);
  const out: SliceTemplate[] = [];
  const roleTerms: Record<string, { workloadId: string; cpuSecRef: number }[]> = {};

  for (const w of input.workloads) {
    const share = w.routing[lpar.id] ?? 0;
    if (share <= 0) continue;
    const mult = input.cpuMultiplier?.[w.id] ?? 1;
    for (const srv of w.servers) {
      (roleTerms[srv.role] ??= []).push({ workloadId: w.id, cpuSecRef: (share * srv.cpuMsRef) / 1000 });
    }
    const cls = classify(def, { ...w.work, SY: lpar.id });
    const periods = periodsOf(def, cls.serviceClass);
    const cpSecRef = (w.cpuMsRef / 1000) * mult * mp;
    const cpSec = (cpSecRef * (1 - w.ziipFrac)) / cpSp;
    const zSec = (cpSecRef * w.ziipFrac) / zSp;
    const meanSu = (cpSec + zSec) * suRate;
    const shares = splitPeriods(
      periods.map((p) => p.durationSu),
      meanSu,
      w.cpuSigma,
    );
    shares.forEach((ps, k) => {
      const p = periods[k]!;
      if (ps.cpuFrac <= 1e-9 && ps.endFrac <= 1e-9) return;
      const enderScale = meanSu > 0 ? ps.meanSuOfEnders / meanSu : 1;
      const goal = p.goal;
      out.push({
        workloadId: w.id,
        rateCoef: share * ps.endFrac,
        cpCoef: share * cpSec * ps.cpuFrac,
        ziCoef: share * zSec * ps.cpuFrac,
        cpBase: 0,
        ziBase: 0,
        roleTerms: [],
        spec: sliceSpec({
          key: `${w.id}@${lpar.id}${scKeyOf(cls.serviceClass, k)}`,
          reportClass: cls.reportClass,
          scKey: scKeyOf(cls.serviceClass, k),
          kind: 'TXN',
          workloadId: w.id,
          jobname: null,
          role: null,
          rate: 0,
          cpEngines: 0,
          ziipEngines: 0,
          mayOverflow: p.honor,
          cpuSecPerTxn: cpSec * enderScale,
          ziipSecPerTxn: zSec * enderScale,
          ioPerTxn: w.ioPerTxn * enderScale,
          baseLatencySec: w.baseLatencySec,
          rtSigma: w.rtSigma,
          timeoutSec: w.mq ? Infinity : w.timeoutSec,
          ...(w.mq ? { mqQueueFrac: ps.endFrac } : {}),
          servers: w.servers.map((s) => ({ role: s.role, latencySec: s.latencySec })),
          goalRtSec: goal && (goal.kind === 'PCT' || goal.kind === 'AVG') ? goal.rtSec : null,
          slaRtSec: w.sla.kind === 'NONE' ? null : w.sla.rtSec,
          ioClass: 'RANDOM',
          ioRate: 0,
          extraOtherSec: 0,
          failFrac: 0,
          outsideWaitSec: 0,
        }),
      });
    });
  }

  for (const a of input.addressSpaces) {
    if (a.lparId !== lpar.id) continue;
    const cls = classify(def, { subsystem: a.subsystem, TN: a.jobname, SY: lpar.id });
    const periods = periodsOf(def, cls.serviceClass);
    const last = periods.length - 1;
    const terms = (a.role ? (roleTerms[a.role] ?? []) : []).map((t) => ({
      workloadId: t.workloadId,
      cpCoef: (t.cpuSecRef * mp * (1 - a.ziipFrac)) / cpSp,
      ziCoef: (t.cpuSecRef * mp * a.ziipFrac) / zSp,
    }));
    out.push({
      workloadId: null,
      rateCoef: 0,
      cpCoef: 0,
      ziCoef: 0,
      cpBase: (a.baseEnginesRef * mp * (1 - a.ziipFrac)) / cpSp,
      ziBase: (a.baseEnginesRef * mp * a.ziipFrac) / zSp,
      roleTerms: terms,
      spec: sliceSpec({
        key: `${a.jobname}@${lpar.id}`,
        reportClass: cls.reportClass,
        scKey: scKeyOf(cls.serviceClass, last),
        kind: 'AS',
        workloadId: null,
        jobname: a.jobname,
        role: a.role,
        rate: 0,
        cpEngines: 0,
        ziipEngines: 0,
        mayOverflow: periods[last]?.honor ?? true,
        cpuSecPerTxn: 0,
        ziipSecPerTxn: 0,
        ioPerTxn: 0,
        baseLatencySec: 0,
        rtSigma: 0,
        timeoutSec: Infinity,
        servers: [],
        goalRtSec: null,
        slaRtSec: null,
        ioClass: 'RANDOM',
        ioRate: 0,
        extraOtherSec: 0,
        failFrac: 0,
        outsideWaitSec: 0,
      }),
    });
  }
  return out;
}

function shareSignature(input: SliceBuildInput): string {
  let sig = '';
  for (const w of input.workloads) sig += `${w.routing[input.lpar.id] ?? 0},`;
  return sig;
}

function templatesFor(input: SliceBuildInput): SliceTemplate[] {
  let byWl = templateCache.get(input.def);
  if (!byWl) {
    byWl = new WeakMap();
    templateCache.set(input.def, byWl);
  }
  const scope = input.scope ?? input.workloads;
  let byAs = byWl.get(scope);
  if (!byAs) {
    byAs = new WeakMap();
    byWl.set(scope, byAs);
  }
  let byKey = byAs.get(input.addressSpaces);
  if (!byKey) {
    byKey = new Map();
    byAs.set(input.addressSpaces, byKey);
  }
  const key = input.scope ? `${templateKey(input)}|${shareSignature(input)}` : templateKey(input);
  let templates = byKey.get(key);
  if (!templates) {
    if (byKey.size >= MAX_TEMPLATE_SETS) byKey.clear();
    templates = buildTemplates(input);
    byKey.set(key, templates);
  }
  return templates;
}

interface LastTemplates {
  def: ServiceDefinition;
  cpc: CpcConfig;
  workloads: readonly WorkloadDef[];
  addressSpaces: readonly AddressSpaceDef[];
  templates: SliceTemplate[];
}

// Per-LPAR shortcut past the key string and nested lookups while every input object is the same
// one as last tick (config edits clone the whole config, so any change is a new LparConfig).
const lastByLpar = new WeakMap<LparConfig, LastTemplates>();

function cachedTemplates(input: SliceBuildInput): SliceTemplate[] {
  if (input.cpuMultiplier) return templatesFor(input);
  const last = lastByLpar.get(input.lpar);
  if (last && last.def === input.def && last.cpc === input.cpc && last.workloads === input.workloads && last.addressSpaces === input.addressSpaces) {
    return last.templates;
  }
  const templates = templatesFor(input);
  lastByLpar.set(input.lpar, { def: input.def, cpc: input.cpc, workloads: input.workloads, addressSpaces: input.addressSpaces, templates });
  return templates;
}

export function buildSlices(input: SliceBuildInput): SliceSpec[] {
  const templates = cachedTemplates(input);
  // Spread copies keep the template's hidden class, shared with the other slice copies (CPU
  // modifiers, evaluator); a field-by-field literal measured ~40% slower overall.
  const out: SliceSpec[] = [];
  for (const t of templates) {
    if (t.workloadId) {
      const r = input.rates[t.workloadId] ?? 0;
      out.push({ ...t.spec, rate: r * t.rateCoef, cpEngines: r * t.cpCoef, ziipEngines: r * t.ziCoef });
      continue;
    }
    let cp = t.cpBase;
    let zi = t.ziBase;
    for (const term of t.roleTerms) {
      const r = input.rates[term.workloadId] ?? 0;
      cp += r * term.cpCoef;
      zi += r * term.ziCoef;
    }
    out.push({ ...t.spec, cpEngines: cp, ziipEngines: zi });
  }
  return out;
}
