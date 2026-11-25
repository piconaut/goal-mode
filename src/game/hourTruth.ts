// One workload-hour's ground truth, shared by incident opening and RT-22's quiet-hour facts (docs/rca-design.md
// §4.2, §4.4). The rules are the incident judge's: the same baseline, footprint, delay groups and CPU split, so a
// problem record cannot disagree with an incident about the same hour.

import type { GameContent } from '../content/types';
import type { Scenario } from '../sim/core/scenario';
import type { WorkloadDef } from '../sim/workload/types';
import { classify } from '../sim/wlm/classify';
import { TICKS_PER_HOUR } from '../sim/core/units';
import { snapshotCpuConsumers } from './displaceable';
import { incidentSubjects } from './evidence';
import { hostImages } from './footprint';
import { peersOf } from './peerSlow';
import { acceptedAnswers, truthCause } from './rcaTruth';
import { capacityBasis, cappingVerdict, coDominantGroups, cpuAlternates, cpuMechanismOf, failureMechanismOf, importanceRank, mechanismOf, perTxnParts, triggerOf } from './sla';
import type { CapacityBasis, HourAcc, IncidentSubjects, IncidentTruth, Mechanism, RunState, Trigger, WorkloadHour } from './types';
import { isNewWorkload } from './workloads';

export interface WorkloadHourTruth {
  mechanism: Mechanism;
  trigger: Trigger;
  truth: IncidentTruth;
  basis: CapacityBasis | null;
  subjects: IncidentSubjects;
}

/**
 * The truth of one workload-hour, computed against the baseline in force during that hour. The caller passes the
 * hour's clock-hour baseline (`base`), its accumulator (`h`) and the tick that closed it (`hourEnd`).
 *
 * `snapshot` keeps the observed CPU grants and exclusions an incident records; a quiet hour keeps the cheaper
 * subjects (the importance-donor split) because a met hour is not opening an RCA and the grant ledger is the
 * expensive part. Either way the accepted answers come from the same rules.
 */
export function judgeWorkloadHour(
  run: RunState,
  scenario: Scenario,
  content: GameContent,
  w: WorkloadDef,
  wh: WorkloadHour,
  h: HourAcc,
  workloads: readonly WorkloadDef[],
  base: Record<string, number>,
  hourEnd: number,
  snapshot: boolean,
): WorkloadHourTruth {
  const parts = perTxnParts(wh);
  const hosts = hostImages(run.sim.routing[w.id] ?? w.routing).map((lparId) => {
    const sc = classify(run.sim.wlm.definition, { ...w.work, SY: lparId }).serviceClass;
    return { lparId, cpcId: run.sim.config.lpars.find((l) => l.id === lparId)?.cpcId ?? '', importance: importanceRank(run.sim.wlm.definition, `${sc}#1`) };
  });
  const baseSubjects = incidentSubjects(run, scenario, w.id, run.day);
  const subjects = snapshot ? snapshotCpuConsumers(run, scenario, h, w, workloads, baseSubjects) : baseSubjects;
  // The policy's class and role definitions, for the CAPPING cause's identity (RT-33): a resource group's name comes
  // from the class definition, and a server role's from the region class holding it on that image.
  const def = run.sim.wlm.definition;
  const classGroup = (classId: string) => def.classes.find((c) => c.id === classId)?.resourceGroup ?? null;
  const roleGroup = (lparId: string, role: string) => {
    const space = [...scenario.addressSpaces, ...run.sim.extraAddressSpaces]
      .filter((a) => a.lparId === lparId && a.role === role)
      .sort((a, b) => (a.jobname < b.jobname ? -1 : a.jobname > b.jobname ? 1 : 0))[0];
    if (!space) return null;
    const cls = classify(def, { subsystem: space.subsystem, TN: space.jobname, SY: lparId }).serviceClass;
    return cls ? classGroup(cls) : null;
  };
  const serverRoles = [...new Set([...(w.servers ?? []).map((s) => s.role), ...(w.hostRole ? [w.hostRole] : [])])].sort();
  // A discretionary class has no response-time goal: no floor, as before RT-17.
  const slaRtSec = 'rtSec' in w.sla ? w.sla.rtSec : 0;
  const cpu = {
    workloadId: w.id, baseline: base, subjects, serverRoles, slaRtSec,
    groupOf: classGroup, roleGroupOf: roleGroup,
    // IIPHONORPRIORITY=NO means CPs never examine eligible work:
    // SA23-1380-60 PDF p.430 (printed 394). A service class with Honor Priority=NO gets no CP help
    // (SC34-2662-60 PDF p.121 (printed 101)). APPROX: the hurt class alone decides; a CICS region overflows
    // unless all its transaction classes say NO (PDF p.122 (printed 102)), which this judge does not check.
    overflowBlockedHosts: hosts.filter((host) => {
      const cls = classify(run.sim.wlm.definition, { ...w.work, SY: host.lparId }).serviceClass;
      return run.sim.config.systems.find((s) => s.lparId === host.lparId)?.iipHonorPriority === false ||
        run.sim.wlm.definition.classes.find((c) => c.id === cls)?.honorPriority === false;
    }).map((h) => h.lparId),
  };
  const mechanism = failureMechanismOf(w, wh, run.events, h) ?? mechanismOf(parts, base, h, hosts, cpu);
  const cpuSide = ['CPU_CAPACITY', 'CPU_PRIORITY', 'CAPPING'].includes(mechanism);
  const basis = cpuSide ? capacityBasis(h, hosts, cpu) : null;
  // The cap that decided a CAPPING hour is the incident's cause, whatever host the basis picked on a legacy hour.
  if (basis && mechanism === 'CAPPING') {
    const cap = cappingVerdict(h, hosts, cpu);
    if (cap) {
      basis.capBy = cap.by;
      if (cap.group !== null) basis.capGroup = cap.group;
    }
  }
  // A second delay group with a third of the excess is an accepted answer too (RT-17, §4.2(2)). The CPU group is
  // mapped to the answer the CPU drill-down would give, as the primary does.
  const coDominant = coDominantGroups(parts, base, slaRtSec, cpuSide ? 'CPU' : mechanism).map(({ group, sharePct }) => ({
    mechanism: group === 'CPU' ? cpuMechanismOf(h, hosts, cpu) : (group as Mechanism),
    why: `${sharePct.toFixed(1)} % of the delay excess grew beside the primary`,
  }));
  const isNew = isNewWorkload(run, content, w.id, h.hourIndex);
  const trigger = triggerOf(w.id, mechanism, run.events, h, isNew, { hosts, servers: subjects.servers });
  // The interval that closed this hour, for the peer-slow source (RT-35): a CF's sync/async reading against the best
  // CF, an LCU's DISC/response against the all-LCU median. The peer readings are that interval's (the hour's last
  // 30 minutes) while the share is the whole hour's; a constant fault makes the two agree (RT-35's shape).
  const rmf = [...run.sim.rmf.intervals].reverse().find((iv) => iv.endTick <= hourEnd && iv.endTick > hourEnd - TICKS_PER_HOUR);
  const peers = rmf ? peersOf(rmf, hosts.map((host) => host.lparId)) : undefined;
  const ctx = {
    workloadId: w.id, mechanism, trigger, hour: h, events: run.events, basis, hosts,
    servers: subjects.servers, lpars: run.sim.config.lpars, content, isNew,
    ...(peers ? { peers } : {}),
    ...(cpuSide ? { cpu: cpuAlternates(h, hosts, cpu) } : {}),
    ...(coDominant.length ? { coDominant } : {}),
  };
  const { accepted, notes, nearMiss } = acceptedAnswers(ctx);
  const truth: IncidentTruth = {
    mechanism, trigger, accepted,
    ...(Object.keys(notes).length > 0 ? { notes } : {}),
    ...(nearMiss ? { nearMiss } : {}),
    cause: truthCause(ctx),
  };
  return { mechanism, trigger, truth, basis, subjects };
}
