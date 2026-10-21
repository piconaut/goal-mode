import type { ServiceDefinition } from '../sim/wlm/types';
import { INSIGHT, toolDef, TOOLS, type ToolDef, type ToolFeature } from '../content/tools';
import type { Command } from '../sim/core/commands';
import type { Scenario } from '../sim/core/scenario';
import type { ChangeOutcome } from './run';
import { allWorkloads } from './workloads';
import { emptyAlerts } from './alerts';
import { emptyAutomation } from './automation';
import { emptyPolicyBook } from './policies';
import type { RunState } from './types';

/** Fill fields added after a run was saved (IndexedDB autosaves outlive releases). */
export function normalizeRun(run: RunState, scenario?: Scenario): RunState {
  let config = run.sim.config.cfStructures || !scenario ? run.sim.config : { ...run.sim.config, cfStructures: structuredClone(scenario.world.cfStructures) };
  // Saves from before CF failure/duplexing: structures lack size, preference list and loss impact.
  if (scenario && config.cfStructures.some((x) => x.sizeGb === undefined || x.prefList === undefined || x.lostImpact === undefined)) {
    const def = (name: string) => scenario.world.cfStructures.find((x) => x.name === name);
    config = {
      ...config,
      cfStructures: config.cfStructures.map((x) => ({
        ...x,
        sizeGb: x.sizeGb ?? def(x.name)?.sizeGb,
        prefList: x.prefList ?? (def(x.name)?.prefList ? [...def(x.name)!.prefList!] : undefined),
        lostImpact: x.lostImpact ?? def(x.name)?.lostImpact,
      })),
    };
  }
  // Saves from before per-LCU DASD: take the scenario's LCU layout.
  if (scenario && !config.dasd.lcus) config = { ...config, dasd: { ...structuredClone(scenario.world.dasd), backendDegrade: config.dasd.backendDegrade ?? 1 } };
  return {
    ...run,
    tools: run.tools ?? [],
    toolsOff: run.toolsOff ?? [],
    reportsOpenedToday: run.reportsOpenedToday ?? [],
    codexReports: run.codexReports ?? [],
    smfHours: run.smfHours ?? [],
    mon3Charts: run.mon3Charts ?? null,
    pins: run.pins ?? [],
    alerts: run.alerts ?? emptyAlerts(),
    automation: run.automation ?? emptyAutomation(),
    policies: run.policies ?? emptyPolicyBook(),
    projects: run.projects ?? [],
    capacityDays: run.capacityDays ?? [],
    capacityToday: run.capacityToday ?? null,
    sim: { ...run.sim, config, mods: { ...run.sim.mods, measureCpu: run.sim.mods.measureCpu ?? {} }, wlm: { ...run.sim.wlm, definition: normalizeDefinition(run.sim.wlm.definition) } },
  };
}

/** Older saves (and hand-edited policy JSON) can lack a period's durationSu; the model means null. */
export function normalizeDefinition(d: ServiceDefinition): ServiceDefinition {
  if (d.classes.every((c) => c.periods.every((p) => p.durationSu !== undefined))) return d;
  return { ...d, classes: d.classes.map((c) => ({ ...c, periods: c.periods.map((p) => ({ ...p, durationSu: p.durationSu ?? null })) })) };
}

export const activeTools = (run: RunState): string[] => run.tools.filter((t) => !run.toolsOff.includes(t));

export function features(run: RunState): Set<ToolFeature> {
  const out = new Set<ToolFeature>();
  for (const id of activeTools(run)) for (const f of toolDef(id)?.unlocks ?? []) out.add(f);
  return out;
}

export const hasFeature = (run: RunState, f: ToolFeature): boolean => features(run).has(f);

export const onTrial = (run: RunState, id: string): boolean => (run.toolTrials ?? []).some((t) => t.id === id);

/**
 * The tool a vendor trial would lend: the costliest buyable-by-prereqs tool with no measurement overhead (a
 * lent reporting tool needs no data gatherer), so the trial never changes the sim's CPU.
 */
export function trialTool(run: RunState): ToolDef | null {
  const owned = (id: string) => run.tools.includes(id) && !onTrial(run, id);
  const c = TOOLS.filter((t) => !run.tools.includes(t.id) && !t.comingSoon && t.overhead === null && t.prereqs.every(owned));
  c.sort((a, b) => b.insightCost - a.insightCost || (a.id < b.id ? -1 : 1));
  return c[0] ?? null;
}

/** End of `day`: trials that run out are uninstalled (no overhead to reset: trial tools have none). */
export function expireToolTrials(run: RunState, day: number): RunState {
  const expired = (run.toolTrials ?? []).filter((t) => t.untilDay <= day + 1).map((t) => t.id);
  if (!expired.length) return run;
  return {
    ...run,
    tools: run.tools.filter((t) => !expired.includes(t)),
    toolsOff: run.toolsOff.filter((t) => !expired.includes(t)),
    toolTrials: (run.toolTrials ?? []).filter((t) => !expired.includes(t.id)),
    log: [...run.log, ...expired.map((id) => `Analytics: ${toolDef(id)?.name ?? id} trial ended`)],
  };
}

/** Why a tool can't be bought right now, or null. */
export function buyBlocker(run: RunState, tool: ToolDef): string | null {
  if (run.tools.includes(tool.id) && !onTrial(run, tool.id)) return 'Owned';
  if (tool.comingSoon) return 'Not available yet';
  if (run.phase === 'GAMEOVER') return 'The run is over';
  const missing = tool.prereqs.filter((p) => !run.tools.includes(p) || onTrial(run, p));
  if (missing.length) return `Needs ${missing.map((m) => toolDef(m)?.name ?? m).join(', ')}`;
  if (run.insight < tool.insightCost) return `Needs ${tool.insightCost} Insight (have ${run.insight})`;
  return null;
}

/**
 * Measurement overhead of the active tools as SET_MODIFIER commands on mods.measureCpu, including
 * resets (value 1) for keys no longer covered. Multiple tools on one workload multiply.
 */
export function measurementCommands(run: RunState, scenario: Scenario): Command[] {
  const want: Record<string, number> = {};
  const workloads = allWorkloads(scenario, run);
  for (const id of activeTools(run)) {
    const o = toolDef(id)?.overhead;
    if (!o) continue;
    if (o.subsystems) for (const w of workloads) if (o.subsystems.types.includes(w.subsystem)) want[w.id] = (want[w.id] ?? 1) * (1 + o.subsystems.cpuFrac);
    if (o.addressSpaces) for (const j of o.addressSpaces.jobnames) want[j] = (want[j] ?? 1) * (1 + o.addressSpaces.cpuFrac);
  }
  const have = run.sim.mods.measureCpu ?? {};
  const keys = [...new Set([...Object.keys(have), ...Object.keys(want)])].sort();
  const cmds: Command[] = [];
  for (const k of keys) {
    const v = want[k] ?? 1;
    if ((have[k] ?? 1) !== v) cmds.push({ kind: 'SET_MODIFIER', mod: 'measureCpu', key: k, value: v });
  }
  return cmds;
}

function withMeasurement(run: RunState, scenario: Scenario): RunState {
  const cmds = measurementCommands(run, scenario);
  // Drop stale measurement commands still queued; the fresh set supersedes them.
  const kept = run.pendingCommands.filter((c) => !(c.kind === 'SET_MODIFIER' && c.mod === 'measureCpu'));
  return cmds.length ? { ...run, pendingCommands: [...kept, ...cmds] } : { ...run, pendingCommands: kept };
}

export function buyTool(run: RunState, scenario: Scenario, toolId: string): ChangeOutcome {
  const tool = toolDef(toolId);
  if (!tool) return { run, ok: false, message: `Unknown tool ${toolId}` };
  const blocker = buyBlocker(run, tool);
  if (blocker) return { run, ok: false, message: `${tool.name}: ${blocker}` };
  const trial = onTrial(run, tool.id);
  const r = withMeasurement({ ...run, insight: run.insight - tool.insightCost, tools: trial ? run.tools : [...run.tools, tool.id], toolTrials: (run.toolTrials ?? []).filter((t) => t.id !== tool.id), log: [...run.log, `Analytics: ${tool.name} installed (−${tool.insightCost} Insight)`] }, scenario);
  return { run: r, ok: true, message: `${tool.name} installed. ${tool.reveals}` };
}

/** Switch an owned tool off (stop paying its CPU, lose its data) or back on. */
export function setToolActive(run: RunState, scenario: Scenario, toolId: string, active: boolean): ChangeOutcome {
  const tool = toolDef(toolId);
  if (!tool || !run.tools.includes(toolId)) return { run, ok: false, message: 'Tool not owned' };
  const off = active ? run.toolsOff.filter((t) => t !== toolId) : [...new Set([...run.toolsOff, toolId])].sort();
  const r = withMeasurement({ ...run, toolsOff: off }, scenario);
  return { run: r, ok: true, message: `${tool.name} ${active ? 'on' : 'off'}` };
}

/** Insight for reading: +1 per distinct report per played day, capped. */
export function noteReportOpened(run: RunState, key: string): RunState {
  const kind = key.split(':')[0]!;
  if (!(run.codexReports ?? []).includes(kind)) run = { ...run, codexReports: [...(run.codexReports ?? []), kind] };
  if (run.reportsOpenedToday.includes(key)) return run;
  const earned = run.reportsOpenedToday.length < INSIGHT.reportCapPerDay ? INSIGHT.perReport : 0;
  return { ...run, reportsOpenedToday: [...run.reportsOpenedToday, key], insight: run.insight + earned };
}

export interface ToolView {
  id: string;
  name: string;
  tier: number;
  insightCost: number;
  prereqs: string[];
  reveals: string;
  overhead: string | null;
  owned: boolean;
  active: boolean;
  comingSoon: boolean;
  blocker: string | null;
  /** Last day of a free trial, or null if not on trial. */
  trialLastDay: number | null;
}

export function overheadText(t: ToolDef): string | null {
  const o = t.overhead;
  if (!o) return null;
  const parts: string[] = [];
  if (o.subsystems) parts.push(`+${(o.subsystems.cpuFrac * 100).toFixed(0)}% CPU per ${o.subsystems.types.join('/')} transaction`);
  if (o.addressSpaces) parts.push(`${o.addressSpaces.jobnames.join(', ')} CPU ×${(1 + o.addressSpaces.cpuFrac).toFixed(1)}`);
  return parts.join('; ');
}

export function toolsView(run: RunState): ToolView[] {
  return TOOLS.map((t) => ({
    id: t.id,
    name: t.name,
    tier: t.tier,
    insightCost: t.insightCost,
    prereqs: t.prereqs,
    reveals: t.reveals,
    overhead: overheadText(t),
    owned: run.tools.includes(t.id),
    active: run.tools.includes(t.id) && !run.toolsOff.includes(t.id),
    comingSoon: t.comingSoon ?? false,
    blocker: buyBlocker(run, t),
    trialLastDay: (() => { const tr = (run.toolTrials ?? []).find((x) => x.id === t.id); return tr ? tr.untilDay - 1 : null; })(),
  }));
}

/** Which RMF Postprocessor reports need a tool (null = tier 0). */
export const REPORT_FEATURE: Record<string, ToolFeature | null> = {
  WLM_SUMMARY: null,
  WLM_DETAIL: null,
  PARTITION: 'PARTITION_REPORT',
  CF: 'CF_REPORT',
  DASD: 'DASD_REPORT',
};

/** Which tool feature each SMF analytics view needs. */
export const SMF_FEATURE = { DB2: 'DB2_ACCOUNTING', CICS: 'CICS_MONITORING', BATCH: 'BATCH_GANTT', SMF113: 'SMF113' } as const satisfies Record<string, ToolFeature>;
