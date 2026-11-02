// CICS/IMS resource samples belong to region classes; transaction classes carry work manager states
// (WLM Planning 3.1 p.113; RMF Report Analysis p.536–537). This projection never feeds WLM decisions.
import { emptyScpTick, type LparEvalInput, type ReportClassTick, type ScpTick, type SliceResult, type SliceSpec } from './evaluate';

export interface WorkManagerSamples {
  /** Analytic EXE state weights; normalize their sum for STATE SAMPLES BREAKDOWN (%).
   * ACTIVE combines SUB/APPL. The first-region (normally TOR) BTE phase is not simulated. */
  active: number;
  ready: number;
  idle: number;
  waitingIo: number;
  waitingOther: number;
  /** Region service-class periods that own the resource samples. */
  regionKeys: string[];
}

function mergeRegionKeys(a: string[], b: string[]): string[] {
  if (a === b || (a.length === b.length && a.every((k, i) => k === b[i]))) return a;
  const keys: string[] = [];
  let i = 0, j = 0;
  while (i < a.length || j < b.length) {
    const k = j === b.length || (i < a.length && a[i]! < b[j]!) ? a[i++]! : b[j++]!;
    if (keys[keys.length - 1] !== k) keys.push(k);
  }
  return keys;
}

export function mergeWorkManager(a?: WorkManagerSamples, b?: WorkManagerSamples, decay = 1): WorkManagerSamples {
  return {
    active: (a?.active ?? 0) * decay + (b?.active ?? 0),
    ready: (a?.ready ?? 0) * decay + (b?.ready ?? 0),
    idle: (a?.idle ?? 0) * decay + (b?.idle ?? 0),
    waitingIo: (a?.waitingIo ?? 0) * decay + (b?.waitingIo ?? 0),
    waitingOther: (a?.waitingOther ?? 0) * decay + (b?.waitingOther ?? 0),
    regionKeys: a && b ? mergeRegionKeys(a.regionKeys, b.regionKeys) : (a ?? b)?.regionKeys ?? [],
  };
}

/** Immutable topology, cached by system/policy in core/step; never persisted in SimState. */
export interface CicsReportPlan {
  transactionKeys: ReadonlySet<string>;
  serviceClasses: ReadonlySet<string>;
  reportClasses: ReadonlySet<string>;
  regionKeys: string[];
  aors: { scKey: string; reportClass: string | null | undefined }[];
  share: number;
}

export function cicsReportPlan(slices: readonly SliceSpec[], transactionKeys: ReadonlySet<string>, regionKey: string): CicsReportPlan {
  const serviceClasses = new Set<string>();
  const reportClasses = new Set<string>();
  const aors: CicsReportPlan['aors'] = [];
  for (const s of slices) {
    if (!transactionKeys.has(s.key) && !(s.kind === 'AS' && s.role === 'CICS.AOR')) continue;
    serviceClasses.add(s.scKey);
    if (s.reportClass) reportClasses.add(s.reportClass);
    if (s.kind === 'AS') aors.push({ scKey: s.scKey, reportClass: s.reportClass });
  }
  const regionKeys = [...new Set(aors.length ? aors.map((s) => s.scKey) : [regionKey])].sort();
  for (const k of regionKeys) serviceClasses.add(k);
  return { transactionKeys, serviceClasses, reportClasses, regionKeys, aors, share: aors.length ? 1 / aors.length : 1 };
}

function reportingTick(t: ScpTick): ScpTick {
  const out: ScpTick = {
    scKey: t.scKey, dp: t.dp,
    cpEngines: 0, ziipEngines: 0, iipcpEngines: 0,
    usingCpu: 0, usingZiip: 0, usingIo: 0,
    delayCpu: 0, delayZiip: 0, delayIo: 0, delayOther: 0, delayStorage: 0, delayCap: 0,
    completions: t.completions, failed: t.failed, rtSumSec: t.rtSumSec, buckets: t.buckets,
    resourceSamples: false,
  };
  if (t.delayQueue !== undefined) out.delayQueue = t.delayQueue;
  return out;
}

function addResources(t: ScpTick | undefined, r: SliceResult, share = 1): void {
  if (!t) return;
  t.resourceSamples = true;
  t.cpEngines += r.cpGranted * share;
  t.ziipEngines += r.ziipGranted * share;
  t.iipcpEngines += r.iipcpGranted * share;
  t.usingCpu += r.usingCpu * share;
  t.usingZiip += r.usingZiip * share;
  t.usingIo += r.usingIo * share;
  t.delayCpu += r.delayCpu * share;
  t.delayZiip += r.delayZiip * share;
  t.delayIo += r.delayIo * share;
  t.delayOther += r.delayOther * share;
  t.delayStorage += r.delayStorage * share;
  t.delayCap += r.delayCap * share;
}

function addWorkManager(t: ScpTick, active: number, ready: number, waitingIo: number, waitingOther: number, regionKeys: string[]): void {
  if (!t.workManager) t.workManager = { active, ready, idle: 0, waitingIo, waitingOther, regionKeys };
  else {
    t.workManager.active += active;
    t.workManager.ready += ready;
    t.workManager.waitingIo += waitingIo;
    t.workManager.waitingOther += waitingOther;
  }
}

export function projectCicsReports(input: LparEvalInput, results: readonly SliceResult[], scps: readonly ScpTick[], rcs: readonly ReportClassTick[]): { reportedScps: ScpTick[]; reportedScpsByKey: Record<string, ScpTick>; rcs?: ReportClassTick[] } {
  const reg = input.regions!;
  const plan = reg.reportingPlan ?? cicsReportPlan(input.slices,
    reg.transactionKeys ?? new Set(input.slices.filter((s) => s.kind === 'TXN' && reg.keys.includes(s.scKey)).map((s) => s.key)), reg.regionKey);
  const byKey: Record<string, ScpTick> = {};
  const rcByKey: Record<string, ReportClassTick> = {};
  const reportedScps = scps.map((t) => plan.serviceClasses.has(t.scKey) ? (byKey[t.scKey] = reportingTick(t)) : t);
  const reportedRcs = rcs.map((t) => {
    if (!plan.reportClasses.has(t.scKey)) return t;
    const out = reportingTick(t) as ReportClassTick;
    out.members = t.members;
    rcByKey[t.scKey] = out;
    return out;
  });
  for (const k of plan.regionKeys) if (!byKey[k]) {
    const t = reportingTick(emptyScpTick(k, input.dpOf(k)));
    reportedScps.push(t);
    byKey[k] = t;
  }
  for (let i = 0; i < input.slices.length; i++) {
    const s = input.slices[i]!, r = results[i]!;
    const t = byKey[s.scKey];
    const rc = s.reportClass ? rcByKey[s.reportClass] : undefined;
    if (!plan.transactionKeys.has(s.key)) {
      addResources(t, r);
      addResources(rc, r);
      continue;
    }
    // CICS Running vs Dispatchable: Monitoring CICS v6 p.55; BCP waits need not be READY (RMF p.536).
    // APPROX: QR contention is the modeled CICS dispatcher wait; BCP waits remain ACTIVE.
    const parts = r.parts;
    const ready = s.rate * (parts?.extra.qr ?? 0);
    const waitingIo = s.rate * (parts?.io ?? 0);
    const cpuPhaseSec = parts ? parts.cpu + parts.cpuQueue + parts.ziip + parts.paging + parts.backlogWait : 0;
    const workPerTxn = s.cpuSecPerTxn + s.ziipSecPerTxn;
    const backlogTasks = workPerTxn > 0 ? r.newBacklog / workPerTxn : 0;
    const active = Math.max(s.rate * cpuPhaseSec, r.usingCpu + r.usingZiip, backlogTasks);
    const waitingOther = Math.max(0, s.rate * r.rtMeanSec - active - ready - waitingIo);
    // These aggregates belong exclusively to this new tick; older frames are never mutated.
    addWorkManager(t!, active, ready, waitingIo, waitingOther, plan.regionKeys);
    if (rc) addWorkManager(rc, active, ready, waitingIo, waitingOther, plan.regionKeys);
    // APPROX: equal per-AOR accounting; preserve the slice/AOR summation order.
    if (plan.aors.length) for (const a of plan.aors) {
      addResources(byKey[a.scKey], r, plan.share);
      if (a.reportClass) addResources(rcByKey[a.reportClass], r, plan.share);
    }
    else addResources(byKey[reg.regionKey], r);
  }
  if (input.ioPriority === false) for (const t of [...Object.values(byKey), ...Object.values(rcByKey)]) {
    t.usingIoNoVel = t.usingIo;
    t.delayIoNoVel = t.delayIo;
  }
  return { reportedScps, reportedScpsByKey: byKey, ...(reportedRcs.length ? { rcs: reportedRcs } : {}) };
}
