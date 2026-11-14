// One seeded headless run per scenario for the cross-report invariant suite (tests/sim/report-invariants.test.ts):
// a played day driven through the game layer, with stress phases derived from the scenario's own configuration
// through ordinary commands. Nothing here names a scenario, LPAR, service class or workload.
//
// The run keeps what the player can read at each RMF interval end (the interval, Monitor III, the header view) and,
// beside it, sums of the sim state taken tick by tick, so an identity can compare a report with its source.

import { packOf } from '../../src/content/packs';
import { buildMon3, type Mon3View } from '../../src/game/mon3';
import { advance, newRun, startDay, type GameContent } from '../../src/game/run';
import { quoteTfp } from '../../src/game/tfp';
import type { RunState } from '../../src/game/types';
import { CAPACITY_SETTING_FRAC } from '../../src/content/hardware';
import type { Command } from '../../src/sim/core/commands';
import type { Scenario } from '../../src/sim/core/scenario';
import type { LparConfig, WorldConfig } from '../../src/sim/core/types';
import { TICKS_PER_HOUR, TICK_SEC } from '../../src/sim/core/units';
import { msuPerCp } from '../../src/sim/hw/cpc';
import { classify } from '../../src/sim/wlm/classify';
import { allWorkloads } from '../../src/game/workloads';
import type { RmfInterval } from '../../src/sim/measure/rmf';
import { goalInfo } from '../../src/sim/wlm/runtime';
import { SYSOTHER, SYSSTC, type ClassificationRule, type ServiceDefinition } from '../../src/sim/wlm/types';

/** Per-tick sums of one LPAR's sim state over an RMF interval. */
export interface LparSum {
  deliveredCp: number;
  effectiveCp: number;
  deliveredZiip: number;
  effectiveZiip: number;
  deliveredIcf: number;
  msu: number;
  cappedTicks: number;
  softCappedTicks: number;
  /** Ticks the image entered with its soft cap on (the capping decision of the previous 5-minute boundary). */
  capFlagTicks: number;
  /** Highest MSU rate in a tick the image entered soft-capped, and the limit in force then. */
  cappedMsuMax: number;
}

export interface IntervalObs {
  phase: string;
  iv: RmfInterval;
  /** Run state at the interval's end. */
  end: RunState;
  mon3: Mon3View;
  /** Configuration at the interval's start and whether any command was applied inside it. */
  config: WorldConfig;
  def: ServiceDefinition;
  steady: boolean;
  lpars: Record<string, LparSum>;
  /** Completions and failures per workload, summed from the sim's per-tick workload results. */
  workloads: Record<string, { completions: number; failed: number }>;
  dasdIops: number;
  /** CF requests per second the z/OS images sent, per tick, summed. */
  cfRequests: number;
}

/** Monitor III built after every tick of one RMF interval (views[0] is the reading at the interval's start). */
export interface Mon3Window {
  phase: string;
  iv: RmfInterval;
  views: Mon3View[];
}

export interface HourObs {
  phase: string;
  /** Run state at the hour's end (tick % 360 = 0), after the hour closed. */
  end: RunState;
  workloads: Record<string, { completions: number; failed: number }>;
}

export interface ReportRun {
  scenario: Scenario;
  content: GameContent;
  seed: number;
  intervals: IntervalObs[];
  windows: Mon3Window[];
  hours: HourObs[];
  /** Stress phases that applied on this scenario (a phase whose feature the scenario lacks is absent). */
  phases: string[];
  /** Run state when Tailored Fit Pricing started, and at the end of the run. */
  tfpStart: RunState | null;
  final: RunState;
  /** Report class generated for each service class by the report-class policy. */
  reportClassOf: Record<string, string>;
  /** Service classes that hold work no classification rule reaches (forced SYSTEM, subsystems without rules). */
  unruledClasses: string[];
  /** The resource group the run put on its largest goal class, and the type it had in each phase. */
  resourceGroup: { serviceClass: string; id: string } | null;
}

/** A new capacity group's rolling average starts empty, so its limit must sit well below the members' demand to
 * bind inside the phase: an hour fills a quarter of the 4-hour window. */
const GROUP_LIMIT_FRAC = 0.15;

const zosOf = (c: WorldConfig): LparConfig[] => c.lpars.filter((l) => l.kind === 'ZOS');
const cpOf = (l: LparConfig) => l.pools.find((p) => p.pool === 'CP');

/** The policy with one report class per service class, on every rule and default, so each class's work is also
 * reported as a homogeneous report class (WLM Planning 3.1 p.113). */
export function withReportClasses(def: ServiceDefinition): { def: ServiceDefinition; reportClassOf: Record<string, string> } {
  const out = structuredClone(def);
  const reportClassOf: Record<string, string> = {};
  const rc = (serviceClass: string) => (reportClassOf[serviceClass] ??= `RC${String(Object.keys(reportClassOf).length).padStart(3, '0')}`);
  const walk = (rules: ClassificationRule[], inherited: string) => {
    for (const r of rules) {
      const sc = r.serviceClass ?? inherited;
      r.reportClass = rc(sc);
      walk(r.children, sc);
    }
  };
  for (const ss of out.subsystems) {
    const dflt = ss.defaultServiceClass ?? (ss.subsystem === 'STC' ? SYSSTC : SYSOTHER);
    ss.defaultReportClass = rc(dflt);
    walk(ss.rules, dflt);
  }
  out.reportClasses = Object.values(reportClassOf).sort();
  return { def: out, reportClassOf };
}

interface Phase {
  name: string;
  hours: number;
  /** Commands derived from the run as it stands, with the commands that undo them; null when the scenario lacks
   * the feature. */
  apply: (run: RunState) => { commands: Command[]; revert: Command[]; atNight?: Command[] } | null;
  /** The commands don't depend on the previous phase being undone, so they go in the same tick as its revert
   * (the phase then starts exactly on an RMF interval boundary). */
  sameTick?: true;
}

function lastInterval(run: RunState): RmfInterval {
  return run.sim.rmf.intervals.at(-1)!;
}

/** The goal class using the most general-CP time across the sysplex in the last interval. */
function largestGoalClass(run: RunState): string | null {
  const def = run.sim.wlm.definition;
  const use: Record<string, number> = {};
  for (const r of lastInterval(run).wlm) {
    if (r.lparId !== '*PLEX' || r.reportClass) continue;
    const g = goalInfo(def, r.scKey);
    if (!g || g.goal.kind === 'DISC' || g.resourceGroup !== null || !def.classes.some((c) => c.id === g.serviceClass)) continue;
    use[g.serviceClass] = (use[g.serviceClass] ?? 0) + r.applCpPct;
  }
  const best = Object.keys(use).sort((a, b) => use[b]! - use[a]! || (a < b ? -1 : 1))[0];
  return best !== undefined && use[best]! > 0 ? best : null;
}

function phasesFor(scenario: Scenario, note: { reportClassOf: Record<string, string>; resourceGroup: ReportRun['resourceGroup'] }): Phase[] {
  const rgId = 'RGSTRESS';
  const withGroup = (run: RunState, type: 1 | 2 | 3, max: number, serviceClass: string) => {
    const before = run.sim.wlm.definition;
    const def = structuredClone(before);
    def.resourceGroups = [...def.resourceGroups.filter((g) => g.id !== rgId), { id: rgId, type, min: null, max }];
    def.classes.find((c) => c.id === serviceClass)!.resourceGroup = rgId;
    note.resourceGroup = { serviceClass, id: rgId };
    return { commands: [{ kind: 'ACTIVATE_POLICY', definition: def } as Command], revert: [{ kind: 'ACTIVATE_POLICY', definition: before } as Command] };
  };
  /** The class's general-CP use in the last interval: per system in engines, and across the sysplex in SU/s. */
  const classUse = (run: RunState, serviceClass: string) => {
    const def = run.sim.wlm.definition;
    const byLpar: Record<string, number> = {};
    for (const r of lastInterval(run).wlm) {
      if (r.lparId === '*PLEX' || r.reportClass || goalInfo(def, r.scKey)?.serviceClass !== serviceClass) continue;
      byLpar[r.lparId] = (byLpar[r.lparId] ?? 0) + r.applCpPct / 100;
    }
    return byLpar;
  };
  return [
    // The scenario as shipped: its own policy and configuration, while the R4HA window fills.
    { name: 'baseline', hours: 4, apply: () => ({ commands: [], revert: [] }) },
    // Report classes on every rule, and another RMF interval length (so identities over intervals don't lean on one
    // length, and each short phase closes several intervals). Both stay until the night; the report classes to the end.
    {
      name: 'report-classes',
      hours: 0.5,
      apply: (run) => {
        const { def, reportClassOf } = withReportClasses(run.sim.wlm.definition);
        Object.assign(note.reportClassOf, reportClassOf);
        const now = run.sim.config.rmfIntervalMin;
        return { commands: [{ kind: 'ACTIVATE_POLICY', definition: def }, { kind: 'SET_RMF_INTERVAL', minutes: now === 5 ? 10 : 5 }], revert: [], atNight: [{ kind: 'SET_RMF_INTERVAL', minutes: now }] };
      },
    },
    // Defined capacity below each image's measured demand: soft capping.
    {
      name: 'defined-capacity',
      hours: 0.5,
      apply: (run) => {
        const lpars = zosOf(run.sim.config).filter((l) => (run.sim.capping.lpars.find((x) => x.id === l.id)?.r4ha ?? 0) >= 2);
        if (lpars.length === 0) return null;
        const r4 = (id: string) => run.sim.capping.lpars.find((x) => x.id === id)!.r4ha;
        return {
          commands: lpars.map((l) => ({ kind: 'SET_DEFINED_CAPACITY', lparId: l.id, msu: Math.max(1, Math.floor(0.6 * r4(l.id))) })),
          revert: lpars.map((l) => ({ kind: 'SET_DEFINED_CAPACITY', lparId: l.id, msu: l.definedCapacityMsu })),
        };
      },
    },
    // A capacity group below its members' measured demand, on each CPC with two z/OS images or more.
    {
      name: 'capacity-group',
      hours: 1,
      apply: (run) => {
        const commands: Command[] = [];
        const revert: Command[] = [];
        for (const cpc of run.sim.config.cpcs) {
          const members = zosOf(run.sim.config).filter((l) => l.cpcId === cpc.id && l.capacityGroup === null);
          if (members.length < 2) continue;
          const sum = members.reduce((a, l) => a + (run.sim.capping.lpars.find((x) => x.id === l.id)?.r4ha ?? 0), 0);
          if (sum < 4) continue;
          const groupId = `GS${run.sim.config.cpcs.indexOf(cpc)}`;
          commands.push({ kind: 'SET_CAPACITY_GROUP', groupId, limitMsu: Math.max(1, Math.floor(GROUP_LIMIT_FRAC * sum)), members: members.map((l) => l.id) });
          revert.push({ kind: 'SET_CAPACITY_GROUP', groupId, limitMsu: null, members: [] });
        }
        return commands.length ? { commands, revert } : null;
      },
    },
    // An absolute cap below the busiest image's measured use: LPAR capping that is not WLM's.
    {
      name: 'absolute-cap',
      hours: 0.5,
      apply: (run) => {
        const busiest = [...lastInterval(run).cpu].filter((r) => r.logicalCps > 0).sort((a, b) => b.physicalEngines - a.physicalEngines)[0];
        const l = busiest && run.sim.config.lpars.find((x) => x.id === busiest.lparId);
        if (!busiest || !l || busiest.physicalEngines <= 0 || cpOf(l)?.dedicated) return null;
        return {
          commands: [{ kind: 'SET_ABSOLUTE_CAP', lparId: l.id, engines: 0.6 * busiest.physicalEngines }],
          revert: [{ kind: 'SET_ABSOLUTE_CAP', lparId: l.id, engines: cpOf(l)?.absoluteCapEngines ?? null }],
        };
      },
    },
    // A resource-group maximum on the largest goal class, in each of the three unit types.
    {
      name: 'resource-group-type3',
      hours: 0.5,
      apply: (run) => {
        const sc = largestGoalClass(run);
        if (!sc) return null;
        const most = Math.max(...Object.values(classUse(run, sc)));
        return withGroup(run, 3, Math.max(1, Math.round(100 * 0.5 * most)), sc);
      },
    },
    {
      name: 'resource-group-type1',
      hours: 0.5,
      apply: (run) => {
        const sc = largestGoalClass(run);
        if (!sc) return null;
        const cpcOf = (lparId: string) => run.sim.config.cpcs.find((c) => c.id === run.sim.config.lpars.find((l) => l.id === lparId)!.cpcId)!;
        const su = Object.entries(classUse(run, sc)).reduce((a, [lparId, engines]) => a + (engines * msuPerCp(cpcOf(lparId)) * 1e6) / 3600, 0);
        return withGroup(run, 1, Math.max(1, Math.round(0.5 * su)), sc);
      },
    },
    {
      name: 'resource-group-type2',
      hours: 0.5,
      apply: (run) => {
        const sc = largestGoalClass(run);
        if (!sc) return null;
        // Half the class's largest share of an image's entitlement.
        const use = classUse(run, sc);
        const share = Math.max(...Object.keys(use).map((id) => {
          const ent = run.sim.lpars.find((l) => l.id === id)?.pools.find((p) => p.pool === 'CP')?.entitlementEngines ?? 0;
          return ent > 0 ? use[id]! / ent : 0;
        }));
        return withGroup(run, 2, Math.max(1, Math.round(100 * 0.5 * share)), sc);
      },
    },
    // Each coupling facility fails in turn and comes back.
    ...[0, 1, 2, 3].map((i): Phase => ({
      name: `cf-failure-${i}`,
      hours: 0.5,
      apply: (run) => {
        const cf = run.sim.config.cfs[i];
        if (!cf || cf.failed) return null;
        return { commands: [{ kind: 'FAIL_CF', lparId: cf.lparId, failed: true }], revert: [{ kind: 'FAIL_CF', lparId: cf.lparId, failed: false }] };
      },
    })),
    // Every structure that has a second CF on its preference list is duplexed.
    {
      name: 'duplex',
      hours: 0.5,
      apply: (run) => {
        const up = run.sim.config.cfs.filter((c) => !c.failed).map((c) => c.lparId);
        const able = run.sim.config.cfStructures.filter((x) => !x.duplexed && !x.lost && (x.prefList ?? up).some((id) => id !== x.cfLparId && up.includes(id)));
        if (able.length === 0) return null;
        return { commands: able.map((x) => ({ kind: 'SET_DUPLEX', name: x.name, on: true })), revert: able.map((x) => ({ kind: 'SET_DUPLEX', name: x.name, on: false })) };
      },
    },
    // zIIP capacity lost: half of each CPC's zIIPs, then all of them.
    ...([0.5, 0] as const).map((keep): Phase => ({
      name: keep ? 'ziip-half' : 'ziip-none',
      hours: 0.5,
      apply: (run) => {
        const cpcs = run.sim.config.cpcs.filter((c) => c.engines.ZIIP > 0);
        if (cpcs.length === 0) return null;
        return {
          commands: cpcs.map((c) => ({ kind: 'SET_CPC_ENGINES', cpcId: c.id, pool: 'ZIIP', engines: Math.floor(c.engines.ZIIP * keep) })),
          revert: cpcs.map((c) => ({ kind: 'SET_CPC_ENGINES', cpcId: c.id, pool: 'ZIIP', engines: c.engines.ZIIP })),
        };
      },
    })),
    // A capacity-setting reduction for an external reason (SMF70CAI/SMF70CCR).
    {
      name: 'capacity-setting',
      hours: 0.5,
      apply: (run) => {
        const cpcs = run.sim.config.cpcs.filter((c) => c.capacitySetting > 4 && CAPACITY_SETTING_FRAC[(c.capacitySetting - 1) as 4 | 5 | 6] < CAPACITY_SETTING_FRAC[c.capacitySetting]);
        if (cpcs.length === 0) return null;
        return {
          commands: cpcs.map((c) => ({ kind: 'SET_CPC_CAPACITY', cpcId: c.id, capacitySetting: (c.capacitySetting - 1) as 4 | 5 | 6, reason: 2 })),
          revert: cpcs.map((c) => ({ kind: 'SET_CPC_CAPACITY', cpcId: c.id, capacitySetting: c.capacitySetting })),
        };
      },
    },
    // I/O priority management off: I/O samples leave velocity but stay in the reports.
    {
      name: 'io-priority-off',
      hours: 0.5,
      apply: (run) => {
        const before = run.sim.wlm.definition;
        if (before.ioPriorityManagement === false) return null;
        return { commands: [{ kind: 'ACTIVATE_POLICY', definition: { ...structuredClone(before), ioPriorityManagement: false } }], revert: [{ kind: 'ACTIVATE_POLICY', definition: before }] };
      },
    },
    // Consumption pricing from here on, on the terms the game itself would quote, and a list-price change.
    {
      name: 'tailored-fit-pricing',
      hours: 1,
      sameTick: true,
      apply: (run) => (run.sim.cost.tfp ? null : { commands: [{ kind: 'SET_PRICING', tfp: quoteTfp(run, scenario).terms }, { kind: 'SET_MLC_PRICE', mult: 1.25 }], revert: [] }),
    },
  ];
}

/** A response time goal on the batch service class with the most jobs still to end tonight, so job ends are WLM
 * transactions with a response time (WLM Planning 3.1 p.71). The goal is the mean queue + elapsed time of the jobs
 * that have ended so far (half an hour when none has). */
function batchResponseGoal(scenario: Scenario, run: RunState): Command[] {
  const def = run.sim.wlm.definition;
  const taken = new Set(allWorkloads(scenario, run).flatMap((w) => zosOf(run.sim.config).map((l) => classify(def, { ...w.work, SY: l.id }).serviceClass)));
  const pending: Record<string, number> = {};
  for (const j of run.sim.batch.jobs) {
    if (j.status === 'DONE' || j.status === 'ABENDED') continue;
    const home = j.lparId ?? j.def.sysaff ?? zosOf(run.sim.config)[0]!.id;
    const sc = classify(def, { subsystem: 'JES', TN: j.def.name, TC: j.def.jobClass, SY: home }).serviceClass;
    if (!taken.has(sc) && def.classes.some((c) => c.id === sc)) pending[sc] = (pending[sc] ?? 0) + 1;
  }
  const sc = Object.keys(pending).sort((a, b) => pending[b]! - pending[a]! || (a < b ? -1 : 1))[0];
  if (sc === undefined) return [];
  const ended = run.sim.rmf.intervals.flatMap((iv) => iv.jobs);
  const rtSec = ended.length ? ended.reduce((a, j) => a + j.queuedSec + j.elapsedSec, 0) / ended.length : 1800;
  const next = structuredClone(def);
  for (const p of next.classes.find((c) => c.id === sc)!.periods) p.goal = { kind: 'AVG', rtSec };
  return [{ kind: 'ACTIVATE_POLICY', definition: next }];
}

const emptyLparSum = (): LparSum => ({ deliveredCp: 0, effectiveCp: 0, deliveredZiip: 0, effectiveZiip: 0, deliveredIcf: 0, msu: 0, cappedTicks: 0, softCappedTicks: 0, capFlagTicks: 0, cappedMsuMax: 0 });

/** Runs the scenario from 06:00 through the stress phases, then on into the evening batch until `nightUntilHour`
 * hours after the day's start. */
export function runReportScenario(scenario: Scenario, seed = 7, nightUntilHour = 16): ReportRun {
  // The scenario's own game content without its event deck: the stress comes from the phases below, so a new
  // card cannot change what this suite covers.
  const content: GameContent = { ...packOf(scenario.id).game, events: [] };
  let run = startDay(newRun(scenario, content, seed), content);
  const out: ReportRun = { scenario, content, seed, intervals: [], windows: [], hours: [], phases: [], tfpStart: null, final: run, reportClassOf: {}, unruledClasses: [], resourceGroup: null };
  const note = { reportClassOf: out.reportClassOf, resourceGroup: null as ReportRun['resourceGroup'] };

  let phase = 'baseline';
  let lpars: Record<string, LparSum> = {};
  let ivWorkloads: Record<string, { completions: number; failed: number }> = {};
  let hourWorkloads: Record<string, { completions: number; failed: number }> = {};
  let dasdIops = 0;
  let cfRequests = 0;
  let ivConfig = run.sim.config;
  let ivDef = run.sim.wlm.definition;
  let steady = true;
  let window: Mon3View[] | null = null;

  const tick = (commands: Command[] = []) => {
    const before = run;
    if (commands.length) run = { ...run, pendingCommands: [...run.pendingCommands, ...commands] };
    run = advance(run, scenario, content, 1);
    const sim = run.sim;
    if (commands.length) {
      steady = false;
      const errors = sim.commandLog.slice(-commands.length).filter((m) => m.startsWith('ERR'));
      if (errors.length) throw new Error(`${scenario.id} ${phase}: ${errors.join('; ')}`);
    }
    for (const l of sim.lpars) {
      const s = (lpars[l.id] ??= emptyLparSum());
      const pool = (p: string) => l.pools.find((x) => x.pool === p);
      const cp = pool('CP');
      s.deliveredCp += cp?.deliveredEngines ?? 0;
      s.effectiveCp += cp?.effectiveEngines ?? 0;
      s.deliveredZiip += pool('ZIIP')?.deliveredEngines ?? 0;
      s.effectiveZiip += pool('ZIIP')?.effectiveEngines ?? 0;
      s.deliveredIcf += pool('ICF')?.deliveredEngines ?? 0;
      s.msu += l.msuRate;
      if ((cp?.cappedFrac ?? 0) > 0) s.cappedTicks++;
      if ((cp?.softCappedFrac ?? 0) > 0) s.softCappedTicks++;
      if (before.sim.capping.lpars.find((x) => x.id === l.id)?.capped) {
        s.capFlagTicks++;
        s.cappedMsuMax = Math.max(s.cappedMsuMax, l.msuRate);
      }
    }
    for (const w of sim.last.workloads) {
      for (const acc of [ivWorkloads, hourWorkloads]) {
        const a = (acc[w.id] ??= { completions: 0, failed: 0 });
        a.completions += w.completions;
        a.failed += w.failed;
      }
    }
    dasdIops += sim.env.dasd?.totalIops ?? 0;
    cfRequests += (sim.env.cf ?? []).reduce((a, r) => a + r.requestRate, 0);
    if (window) window.push(buildMon3(run, scenario));

    const closed = sim.rmf.intervals.at(-1);
    if (closed && closed.endTick === sim.tick) {
      out.intervals.push({ phase, iv: closed, end: run, mon3: buildMon3(run, scenario), config: ivConfig, def: ivDef, steady, lpars, workloads: ivWorkloads, dasdIops, cfRequests });
      if (window) out.windows.push({ phase, iv: closed, views: window });
      window = null;
      lpars = {};
      ivWorkloads = {};
      dasdIops = 0;
      cfRequests = 0;
      ivConfig = sim.config;
      ivDef = sim.wlm.definition;
      steady = true;
    }
    if (sim.tick % TICKS_PER_HOUR === 0) {
      out.hours.push({ phase, end: run, workloads: hourWorkloads });
      hourWorkloads = {};
    }
  };

  /** Advance `ticks`, building Monitor III after every tick of the last RMF interval that fits. */
  const play = (ticks: number, first: Command[]) => {
    for (let i = 0; i < ticks; i++) {
      const intervalTicks = Math.round((run.sim.config.rmfIntervalMin * 60) / TICK_SEC);
      if (i > 0 && ticks - i === intervalTicks && run.sim.tick % intervalTicks === 0) window = [buildMon3(run, scenario)];
      tick(i === 0 ? first : []);
    }
  };

  // Each phase first undoes the one before it (one tick), then derives its own commands from the run as it stands.
  let revert: Command[] = [];
  let debt = 0;
  const atNight: Command[] = [];
  for (const p of phasesFor(scenario, note)) {
    if (revert.length && !p.sameTick) {
      tick(revert);
      revert = [];
      debt++;
    }
    const step = p.apply(run);
    if (!step) continue;
    phase = p.name;
    out.phases.push(p.name);
    if (p.name === 'tailored-fit-pricing') out.tfpStart = run;
    play(p.hours * TICKS_PER_HOUR - debt, [...revert, ...step.commands]);
    debt = 0;
    revert = step.revert;
    atNight.push(...(step.atNight ?? []));
  }
  out.resourceGroup = note.resourceGroup;
  // The evening batch, with every stress undone except the report classes and the pricing.
  phase = 'night';
  out.phases.push(phase);
  const left = nightUntilHour * TICKS_PER_HOUR - (run.sim.tick % (24 * TICKS_PER_HOUR)) + debt;
  if (revert.length) {
    tick(revert);
    debt++;
  }
  if (left > 0) play(left - debt, [...atNight, ...batchResponseGoal(scenario, run)]);
  out.final = run;
  return out;
}
