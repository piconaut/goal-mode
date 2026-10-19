import { INSIGHT, toolDef, TOOLS, type ToolDef, type ToolFeature } from '../content/tools';
import type { Command } from '../sim/core/commands';
import type { Scenario } from '../sim/core/scenario';
import type { ChangeOutcome } from './run';
import { allWorkloads } from './workloads';
import { emptyAlerts } from './alerts';
import { emptyPolicyBook } from './policies';
import type { RunState } from './types';

/** Fill fields added after a run was saved (IndexedDB autosaves outlive releases). */
export function normalizeRun(run: RunState, scenario?: Scenario): RunState {
  let config = run.sim.config.cfStructures || !scenario ? run.sim.config : { ...run.sim.config, cfStructures: structuredClone(scenario.world.cfStructures) };
  // Saves from before per-LCU DASD: take the scenario's LCU layout.
  if (scenario && !config.dasd.lcus) config = { ...config, dasd: { ...structuredClone(scenario.world.dasd), backendDegrade: config.dasd.backendDegrade ?? 1 } };
  return {
    ...run,
    tools: run.tools ?? [],
    toolsOff: run.toolsOff ?? [],
    reportsOpenedToday: run.reportsOpenedToday ?? [],
    smfHours: run.smfHours ?? [],
    mon3Charts: run.mon3Charts ?? null,
    pins: run.pins ?? [],
    alerts: run.alerts ?? emptyAlerts(),
    policies: run.policies ?? emptyPolicyBook(),
    capacityDays: run.capacityDays ?? [],
    capacityToday: run.capacityToday ?? null,
    sim: { ...run.sim, config, mods: { ...run.sim.mods, measureCpu: run.sim.mods.measureCpu ?? {} } },
  };
}

export const activeTools = (run: RunState): string[] => run.tools.filter((t) => !run.toolsOff.includes(t));

export function features(run: RunState): Set<ToolFeature> {
  const out = new Set<ToolFeature>();
  for (const id of activeTools(run)) for (const f of toolDef(id)?.unlocks ?? []) out.add(f);
  return out;
}

export const hasFeature = (run: RunState, f: ToolFeature): boolean => features(run).has(f);

/** Why a tool can't be bought right now, or null. */
export function buyBlocker(run: RunState, tool: ToolDef): string | null {
  if (run.tools.includes(tool.id)) return 'Owned';
  if (tool.comingSoon) return 'Not available yet';
  if (run.phase === 'GAMEOVER') return 'The run is over';
  const missing = tool.prereqs.filter((p) => !run.tools.includes(p));
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
  const r = withMeasurement({ ...run, insight: run.insight - tool.insightCost, tools: [...run.tools, tool.id], log: [...run.log, `Analytics: ${tool.name} installed (−${tool.insightCost} Insight)`] }, scenario);
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
