// Monitor III PROCU attribution: the address spaces and running jobs behind each class. Split from `mon3.ts`
// (CL-33): the code is moved unchanged.
import { jobShape } from '../../sim/subsys/batch';
import type { Scenario } from '../../sim/core/scenario';
import { classify } from '../../sim/wlm/classify';
import type { RunState } from '../types';
import { allWorkloads } from '../workloads';
import type { Mon3ProcJob, Mon3Row } from './types';

interface ClassUnit {
  name: string;
  cx: 'S' | 'B';
  engines: number;
}

const byEngines = (cands: ClassUnit[]): ClassUnit[] => cands.sort((a, b) => b.engines - a.engines || (a.name < b.name ? -1 : 1));

/** The address spaces and running batch jobs of a service class on one system, each with its estimated CP engines:
 * a space's base load (transaction servers also share the row's CPU not explained by the others, i.e. their hosted
 * transactions), a job its unconstrained CP rate times its last pace. APPROX: estimates, not per-job measurements
 * (the sim keeps class totals). */
function classUnitsOf(run: RunState, scenario: Scenario): (system: string, serviceClass: string, rowCpu: number) => ClassUnit[] {
  const sim = run.sim;
  const def = sim.wlm.definition;
  const spaces = [...scenario.addressSpaces, ...sim.extraAddressSpaces];
  const seqRtSec = sim.env.dasd?.classes?.SEQ?.rtSec ?? 0;
  const hostRoles = new Set(allWorkloads(scenario, run).map((w) => w.hostRole).filter((r): r is string => !!r));
  return (system, serviceClass, rowCpu) => {
    const own = spaces.filter((a) => a.lparId === system && classify(def, { subsystem: a.subsystem, TN: a.jobname, SY: system }).serviceClass === serviceClass);
    const jobs = sim.batch.jobs.filter(
      (j) => j.status === 'RUNNING' && j.lparId === system && classify(def, { subsystem: 'JES', TN: j.def.name, TC: j.def.jobClass, SY: system }).serviceClass === serviceClass,
    );
    const cands = [
      ...own.map((a) => ({ name: a.jobname, cx: 'S' as const, engines: a.baseEnginesRef, server: a.role !== null && hostRoles.has(a.role) })),
      ...jobs.map((j) => ({ name: j.def.name, cx: 'B' as const, engines: jobShape(j.def, 1, 1, seqRtSec).cpRate * (j.cpPace ?? 1), server: false })),
    ];
    const servers = cands.filter((c) => c.server);
    const rest = Math.max(0, rowCpu - cands.reduce((a, c) => a + c.engines, 0));
    for (const c of servers) c.engines += rest / servers.length;
    return cands.map(({ name, cx, engines }) => ({ name, cx, engines }));
  };
}

/** PROCU lists jobs, not classes (RMF Report Analysis p.188): each system row's CPU is shared among the class's
 * address spaces and running batch jobs in proportion to their estimated engines (classUnitsOf); TSO classes show
 * under their user id. DDF enclave CPU counts in the EAppl % of the Db2 DIST address space and not in its Time on
 * CP % (p.189). Transaction classes carry no CPU of their own: it is in their regions' rows. APPROX: shares, not
 * per-job measurements. */
export function procuJobs(run: RunState, scenario: Scenario, rows: Mon3Row[], ddfClasses: ReadonlySet<string>): Mon3ProcJob[] {
  const def = run.sim.wlm.definition;
  const spaces = [...scenario.addressSpaces, ...run.sim.extraAddressSpaces];
  const workloads = allWorkloads(scenario, run);
  const units = classUnitsOf(run, scenario);
  const out = new Map<string, Mon3ProcJob>();
  const add = (system: string, jobname: string, cx: Mon3ProcJob['cx'], serviceClass: string, cp: number, iipcp: number, eCp: number, eZiip: number) => {
    const k = `${system}|${jobname}`;
    const j = out.get(k) ?? { system, jobname, cx, serviceClass, cpEngines: 0, iipcpEngines: 0, eapplCpEngines: 0, eapplZiipEngines: 0 };
    j.cpEngines += cp;
    j.iipcpEngines += iipcp;
    j.eapplCpEngines += eCp;
    j.eapplZiipEngines += eZiip;
    out.set(k, j);
  };
  for (const r of rows) {
    if (r.system === '*PLEX' || r.cpuEngines + r.ziipEngines <= 1e-6) continue;
    if (ddfClasses.has(r.serviceClass)) {
      const dist = spaces.find((a) => a.lparId === r.system && a.role === 'DB2.DIST');
      if (dist) add(r.system, dist.jobname, 'S', classify(def, { subsystem: dist.subsystem, TN: dist.jobname, SY: r.system }).serviceClass, 0, 0, r.cpuEngines, r.ziipEngines);
      continue;
    }
    const cands = units(r.system, r.serviceClass, r.cpuEngines);
    const total = cands.reduce((a, c) => a + c.engines, 0);
    if (cands.length > 0) {
      for (const c of cands) {
        const f = total > 0 ? c.engines / total : 1 / cands.length;
        add(r.system, c.name, c.cx, r.serviceClass, r.cpuEngines * f, r.iipcpEngines * f, r.cpuEngines * f, r.ziipEngines * f);
      }
      continue;
    }
    const tso = workloads.find((w) => w.work.UI && classify(def, { ...w.work, SY: r.system }).serviceClass === r.serviceClass);
    add(r.system, tso?.work.UI ?? `*${r.serviceClass}`, tso ? 'T' : 'S', r.serviceClass, r.cpuEngines, r.iipcpEngines, r.cpuEngines, r.ziipEngines);
  }
  return [...out.values()].sort((a, b) => b.eapplCpEngines - a.eapplCpEngines || (a.system + a.jobname < b.system + b.jobname ? -1 : 1));
}

/** DELAY Primary Reason (RMF Report Analysis Table 20, p.110), filled in once all rows exist.
 * APPROX: rows are service-class period summaries, not jobs, so PRC names the main address space of the
 * class that used that processor most. The row's own class competes with the share of its other units (n − 1 of
 * n running jobs or address spaces): "the job that used the processor most while the reported job was delayed"
 * is often another job of the same class, e.g. batch behind batch (p.110). DEV the LCU with the slowest response time in
 * the DASD report (real RMF gives the volser), and STR is always LOCL (the sim models paging only). */
export function primaryReasons(run: RunState, scenario: Scenario, rows: Mon3Row[], ddfClasses: ReadonlySet<string>): void {
  const sim = run.sim;
  const def = sim.wlm.definition;
  const lcus = sim.env.dasd?.lcus ?? [];
  const worstLcu = lcus.reduce<(typeof lcus)[number] | null>((w, l) => (!w || l.rtSec > w.rtSec ? l : w), null);
  const spaces = [...scenario.addressSpaces, ...sim.extraAddressSpaces];
  const workloads = allWorkloads(scenario, run);
  const names = new Map<string, string | null>();
  const units = classUnitsOf(run, scenario);
  // The jobname RMF would show for a class's heaviest processor user on one system. Transaction classes name
  // their host (CICS AOR) or TSO user; otherwise the class's address spaces and running batch jobs compete by
  // estimated CP engines (classUnitsOf).
  const jobOf = (system: string, serviceClass: string, rowCpu: number): string | null => {
    const k = `${system}|${serviceClass}`;
    if (names.has(k)) return names.get(k)!;
    let name: string | null = null;
    if (ddfClasses.has(serviceClass)) name = '*ENCLAVE';
    for (const w of workloads) {
      if (name) break;
      if (classify(def, { ...w.work, SY: system }).serviceClass !== serviceClass) continue;
      // CICS transactions run in the AORs; TSO users show under their user id.
      if (w.hostRole) name = spaces.filter((a) => a.lparId === system && a.role === w.hostRole).map((a) => a.jobname).sort()[0] ?? null;
      else if (w.work.UI) name = w.work.UI;
    }
    if (!name) name = byEngines(units(system, serviceClass, rowCpu))[0]?.name ?? null;
    names.set(k, name);
    return name;
  };
  // Running jobs and address spaces of a class on one system: the units another job of the same class can be.
  const unitsOf = (system: string, serviceClass: string): number => {
    if (ddfClasses.has(serviceClass)) return Infinity;
    const jobs = sim.batch.jobs.filter(
      (j) => j.status === 'RUNNING' && j.lparId === system && classify(def, { subsystem: 'JES', TN: j.def.name, TC: j.def.jobClass, SY: system }).serviceClass === serviceClass,
    ).length;
    const own = spaces.filter((a) => a.lparId === system && classify(def, { subsystem: a.subsystem, TN: a.jobname, SY: system }).serviceClass === serviceClass).length;
    return jobs + own;
  };
  for (const r of rows) {
    if (r.primaryDelay === 'CAP') r.primaryReason = 'RG-Cap';
    else if (r.primaryDelay === 'DEV') r.primaryReason = worstLcu ? `LCU ${worstLcu.id}` : null;
    else if (r.primaryDelay === 'STR') r.primaryReason = 'LOCL';
    else if (r.primaryDelay === 'PRC') {
      const use = r.delay.ziip > r.delay.cpu ? (x: Mon3Row) => x.ziipEngines : (x: Mon3Row) => x.cpuEngines;
      const others = (x: Mon3Row): number => {
        if (x.scKey !== r.scKey) return use(x);
        const n = unitsOf(x.system, x.serviceClass);
        return n > 1 ? (use(x) * (n === Infinity ? 1 : n - 1)) / (n === Infinity ? 1 : n) : 0;
      };
      const top = rows
        .filter((x) => x.system !== '*PLEX' && (r.system === '*PLEX' || x.system === r.system) && others(x) > 1e-6)
        .reduce<Mon3Row | null>((b, x) => (!b || others(x) > others(b) ? x : b), null);
      r.primaryReason = top ? jobOf(top.system, top.serviceClass, top.cpuEngines) : null;
    }
  }
}
