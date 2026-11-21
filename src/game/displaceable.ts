// APPROX: RCA's displaceable CPU is a game rule, not a prediction of a WLM adjustment.
import { CPU_SPLIT } from '../content/incidents';
import type { Scenario } from '../sim/core/scenario';
import { classify } from '../sim/wlm/classify';
import type { WorkloadDef } from '../sim/workload/types';
import type { CpuGrant } from '../sim/core/types';
import { TICKS_PER_DAY, TICKS_PER_HOUR } from '../sim/core/units';
import { batchAtRiskFromSec, nightStartTick } from './night';
import type { CpuConsumers, HourAcc, IncidentSubjects, RunState } from './types';

export const poolUse = (g: CpuGrant | undefined, pool: 'CP' | 'ZIIP'): number =>
  pool === 'CP' ? (g?.cp ?? 0) + (g?.iipcp ?? 0) : g?.ziip ?? 0;

export function slaAtRisk(w: WorkloadDef, hour: HourAcc): boolean {
  const h = hour.workloads[w.id];
  if (!h || h.completions + h.failed < 1 || w.sla.kind === 'NONE') return false;
  if (w.sla.kind === 'PCT') return 100 * h.withinSla / (h.completions + h.failed) < w.sla.pct + CPU_SPLIT.atRiskMargin * (100 - w.sla.pct);
  // Margin expressed as remaining headroom: 1 / (1 + 0.25) = 0.8 of the RT budget.
  return h.failed > 0 || h.rtSumSec / Math.max(h.completions, 1e-9) > w.sla.rtSec / (1 + CPU_SPLIT.atRiskMargin);
}

/** Snapshot the observed grants and exclusions at incident opening. No later policy or attainment is consulted. */
export function snapshotCpuConsumers(run: RunState, scenario: Scenario, hour: HourAcc, hurt: WorkloadDef, workloads: readonly WorkloadDef[], subjects: IncidentSubjects): IncidentSubjects {
  if (!hour.cpByScpLpar || !hour.cpByWorkloadLpar || !hour.cpByRoleLpar) return subjects;
  const spaces = [...scenario.addressSpaces, ...run.sim.extraAddressSpaces];
  const scOf = (w: WorkloadDef, host: string) => classify(run.sim.wlm.definition, { ...w.work, SY: host }).serviceClass;
  const roleClass = (role: string, host: string) => spaces.filter((a) => a.role === role && a.lparId === host)
    .map((a) => classify(run.sim.wlm.definition, { subsystem: a.subsystem, TN: a.jobname, SY: host }).serviceClass);
  const cpu: NonNullable<IncidentSubjects['cpu']> = {};
  // The game's own batch night (18:00 to the day end), with the deadline margin as a share of that window.
  const hourStartTick = hour.hourIndex * TICKS_PER_HOUR;
  const nightDay = Math.floor(hourStartTick / TICKS_PER_DAY);
  const inNight = hourStartTick >= nightStartTick(nightDay) && hourStartTick < (nightDay + 1) * TICKS_PER_DAY;
  const atRiskFromSec = batchAtRiskFromSec(nightDay, run.batchDeadlineSec);
  for (const host of subjects.hosts) {
    const activeOnHost = (w: WorkloadDef) => {
      const g = hour.cpByWorkloadLpar?.[host]?.[w.id];
      return poolUse(g, 'CP') + poolUse(g, 'ZIIP') > 0 || (hour.cpuWaitByWorkloadLpar?.[w.id]?.[host]?.completions ?? 0) > 0;
    };
    const pools = {} as Record<'CP' | 'ZIIP', CpuConsumers>;
    for (const pool of ['CP', 'ZIIP'] as const) {
      const grants = hour.cpByScpLpar[host] ?? {};
      const n = Math.max(1, hour.ticks);
      const classes: CpuConsumers['classes'] = Object.fromEntries(Object.entries(grants).map(([key, g]) => [key, {
        used: poolUse(g, pool) / n, displaceable: poolUse(g, pool) / n, workloads: [],
      }]));
      const keysOf = (cls: string | undefined) => Object.keys(classes).filter((k) => k.split('#')[0] === cls);
      const subtract = (cls: string | undefined, engines: number) => {
        const keys = keysOf(cls);
        const used = keys.reduce((a, k) => a + classes[k]!.used, 0);
        for (const k of keys) classes[k]!.displaceable = Math.max(0, classes[k]!.displaceable - (used > 0 ? engines * classes[k]!.used / used : 0));
      };
      // APPROX: mirror the shipped equal-per-AOR report projection using the hour's workload grants.
      // The accumulator keeps WLM's unmoved periods; the basis/proof must read the WLMGL region rows instead.
      const regions = spaces.filter((a) => a.lparId === host && a.role === 'CICS.AOR');
      const regionClasses = regions.map((a) => classify(run.sim.wlm.definition, { subsystem: a.subsystem, TN: a.jobname, SY: host }).serviceClass);
      const targets = (w: WorkloadDef): (string | undefined)[] => w.subsystem === 'CICS' && regionClasses.length ? regionClasses : [scOf(w, host)];
      for (const w of workloads.filter((w) => w.subsystem === 'CICS' && regionClasses.length)) {
        const use = poolUse(hour.cpByWorkloadLpar?.[host]?.[w.id], pool) / n;
        const keys = keysOf(scOf(w, host));
        const used = keys.reduce((s, k) => s + classes[k]!.used, 0);
        for (const key of keys) {
          const moved = used > 0 ? use * classes[key]!.used / used : 0;
          classes[key]!.used = Math.max(0, classes[key]!.used - moved);
          classes[key]!.displaceable = classes[key]!.used;
        }
        for (const cls of regionClasses) {
          if (!cls) continue;
          const key = `${cls}#1`;
          const row = classes[key] ??= { used: 0, displaceable: 0, workloads: [] };
          row.used += use / regionClasses.length;
          row.displaceable = row.used;
        }
      }
      const protectedRoles = new Set(hurt.servers.map((s) => s.role));
      const atRiskClasses = new Set<string>();
      const excludedRoleShares: Record<string, number> = {};
      if (hurt.hostRole) protectedRoles.add(hurt.hostRole);
      for (const w of workloads) {
        const cls = targets(w);
        const use = poolUse(hour.cpByWorkloadLpar?.[host]?.[w.id], pool) / n;
        if (use > 0) for (const c of new Set(cls)) for (const key of keysOf(c)) classes[key]!.workloads.push(w.id);
        if (w.id === hurt.id) for (const c of cls) subtract(c, use / cls.length);
        else if (slaAtRisk(w, hour) && activeOnHost(w)) {
          for (const c of cls) if (c) {
            atRiskClasses.add(c);
            for (const key of keysOf(c)) classes[key]!.displaceable = 0;
          }
          for (const s of w.servers) protectedRoles.add(s.role);
          if (w.hostRole) protectedRoles.add(w.hostRole);
        }
      }
      for (const role of protectedRoles) {
        let use = poolUse(hour.cpByRoleLpar?.[host]?.[role], pool) / n;
        let excludedShare = 1;
        // APPROX: shared regions' base CPU follows their workloads' completion shares, not importance.
        if (role === hurt.hostRole && !workloads.some((w) => w.id !== hurt.id && w.hostRole === role && activeOnHost(w) && slaAtRisk(w, hour))) {
          const served = workloads.filter((w) => w.hostRole === role);
          const completions = (w: WorkloadDef) => hour.cpuWaitByWorkloadLpar?.[w.id]?.[host]?.completions ?? 0;
          const total = served.reduce((a, w) => a + completions(w), 0);
          excludedShare = total > 0 ? completions(hurt) / total : 1;
          use *= excludedShare;
        }
        excludedRoleShares[role] = excludedShare;
        const cls = [...new Set(roleClass(role, host))];
        // APPROX: all shipped instances of a role on an image use the same class; split equally otherwise.
        for (const c of cls) subtract(c, use / cls.length);
      }
      const forecast = run.sim.batch.projectedCriticalEndSec;
      const protectedJobs = new Set<string>();
      if (inNight && forecast !== null) for (const j of run.sim.batch.jobs) {
        if (!j.def.critical || j.status !== 'RUNNING' || j.lparId !== host || forecast < atRiskFromSec) continue;
        const cls = classify(run.sim.wlm.definition, { subsystem: 'JES', TN: j.def.name, TC: j.def.jobClass, SY: host }).serviceClass;
        if (cls) atRiskClasses.add(cls);
        for (const key of keysOf(cls)) classes[key]!.displaceable = 0;
        protectedJobs.add(j.def.name);
      }
      for (const [key, row] of Object.entries(classes)) if (['SYSTEM', 'SYSSTC'].includes(key.split('#')[0]!)) row.displaceable = 0;
      const jobs: CpuConsumers['jobs'] = {};
      for (const a of spaces.filter((a) => a.lparId === host)) {
        const cls = classify(run.sim.wlm.definition, { subsystem: a.subsystem, TN: a.jobname, SY: host }).serviceClass;
        // A specific protected server can never be proved displaceable through its mixed STC class.
        jobs[a.jobname] = { used: 1, displaceable: !cls || ['SYSTEM', 'SYSSTC'].includes(cls) || atRiskClasses.has(cls) || protectedJobs.has(a.jobname)
          ? 0 : 1 - (a.role ? excludedRoleShares[a.role] ?? 0 : 0) };
      }
      for (const j of run.sim.batch.jobs.filter((j) => j.lparId === host && j.status === 'RUNNING')) {
        const cls = classify(run.sim.wlm.definition, { subsystem: 'JES', TN: j.def.name, TC: j.def.jobClass, SY: host }).serviceClass;
        jobs[j.def.name] = { used: 1, displaceable: !cls || ['SYSTEM', 'SYSSTC'].includes(cls) || atRiskClasses.has(cls) ? 0 : 1 };
      }
      pools[pool] = { engines: Object.values(classes).reduce((s, r) => s + r.used, 0), classes, jobs };
    }
    cpu[host] = pools;
  }
  return { ...subjects, cpu };
}

/** Shared truth/proof reader; null means this old incident/hour did not record consumer accounting. */
export function displaceable(subjects: IncidentSubjects, host: string, pool: 'CP' | 'ZIIP', consumer?: { name: string; job?: boolean }): number | null {
  const data = subjects.cpu?.[host]?.[pool];
  if (!data) return null;
  if (consumer) {
    const row = (consumer.job ? data.jobs : data.classes)[consumer.name];
    return row && row.used > 0 ? row.displaceable / row.used : 0;
  }
  return data.engines > 0 ? Object.values(data.classes).reduce((s, r) => s + r.displaceable, 0) / data.engines : 0;
}
