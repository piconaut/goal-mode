// CICS/IMS resource samples belong to region classes; transaction classes carry work manager states
// (WLM Planning 3.1 p.113; RMF Report Analysis p.536–537). This projection never feeds WLM decisions.
import { emptyScpTick, type LparEvalInput, type ReportClassTick, type ScpTick, type SliceResult } from './evaluate';

export interface WorkManagerSamples {
  /** Average transaction concurrency, not percentages of region resource samples. */
  active: number;
  ready: number;
  idle: number;
  waitingIo: number;
  waitingOther: number;
  bte: number;
  exe: number;
  /** Region service-class periods that own the resource samples. */
  regionKeys: string[];
}

export function mergeWorkManager(a?: WorkManagerSamples, b?: WorkManagerSamples, decay = 1): WorkManagerSamples {
  return {
    active: (a?.active ?? 0) * decay + (b?.active ?? 0),
    ready: (a?.ready ?? 0) * decay + (b?.ready ?? 0),
    idle: (a?.idle ?? 0) * decay + (b?.idle ?? 0),
    waitingIo: (a?.waitingIo ?? 0) * decay + (b?.waitingIo ?? 0),
    waitingOther: (a?.waitingOther ?? 0) * decay + (b?.waitingOther ?? 0),
    bte: (a?.bte ?? 0) * decay + (b?.bte ?? 0),
    exe: (a?.exe ?? 0) * decay + (b?.exe ?? 0),
    regionKeys: [...new Set([...(a?.regionKeys ?? []), ...(b?.regionKeys ?? [])])].sort(),
  };
}

const RESOURCES = ['cpEngines', 'ziipEngines', 'iipcpEngines', 'usingCpu', 'usingZiip', 'usingIo',
  'delayCpu', 'delayZiip', 'delayIo', 'delayOther', 'delayStorage', 'delayCap'] as const;

export function projectCicsReports(input: LparEvalInput, results: readonly SliceResult[], scps: readonly ScpTick[], rcs: readonly ReportClassTick[]): { reportedScps: ScpTick[]; rcs?: ReportClassTick[] } {
  const reg = input.regions!;
  const reportedScps = scps.map((t) => ({ ...t, resourceSamples: false }));
  const reportedRcs = rcs.map((t) => ({ ...t, resourceSamples: false }));
  for (const t of [...reportedScps, ...reportedRcs]) {
    for (const k of RESOURCES) t[k] = 0;
    delete t.srvUsing;
    delete t.srvDelay;
  }
  const byKey = new Map(reportedScps.map((t) => [t.scKey, t]));
  const rcByKey = new Map(reportedRcs.map((t) => [t.scKey, t]));
  // APPROX: the fluid model does not route individual transactions to AORs. Split their resource
  // accounting equally across the AORs on this image, independently of region management mode.
  const aors = input.slices.filter((s) => s.kind === 'AS' && s.role === 'CICS.AOR');
  const regionKeys = [...new Set(aors.length ? aors.map((s) => s.scKey) : [reg.regionKey])].sort();
  for (const k of regionKeys) if (!byKey.has(k)) {
    const t = { ...emptyScpTick(k, input.dpOf(k)), resourceSamples: false };
    reportedScps.push(t);
    byKey.set(k, t);
  }
  const addResources = (t: ScpTick | undefined, r: SliceResult, share = 1) => {
    if (!t) return;
    t.resourceSamples = true;
    for (const k of RESOURCES) {
      const value = k === 'cpEngines' ? r.cpGranted : k === 'ziipEngines' ? r.ziipGranted : k === 'iipcpEngines' ? r.iipcpGranted : r[k];
      t[k] += value * share;
    }
  };
  for (let i = 0; i < input.slices.length; i++) {
    const s = input.slices[i]!, r = results[i]!;
    const t = byKey.get(s.scKey)!;
    const rc = s.reportClass ? rcByKey.get(s.reportClass) : undefined;
    const cics = s.kind === 'TXN' && (reg.transactionKeys ? reg.transactionKeys.includes(s.key) : reg.keys.includes(s.scKey));
    if (!cics) {
      addResources(t, r);
      addResources(rc, r);
      continue;
    }
    // APPROX: Little's-law concurrency from existing RT parts. No pre-execution phase or idle
    // transaction population is simulated: BTE and IDLE stay zero. MXT admission wait is outside WLM.
    const ready = r.delayCpu + r.delayZiip + r.delayCap;
    const waitingIo = s.rate * (r.parts?.io ?? 0);
    // Existing CPU backlog still represents active work after arrivals stop.
    const active = Math.max(s.rate * r.rtMeanSec, r.usingCpu + r.usingZiip + ready + waitingIo);
    const wm: WorkManagerSamples = {
      active, ready, idle: 0,
      waitingIo,
      waitingOther: Math.max(0, active - r.usingCpu - r.usingZiip - ready - waitingIo),
      bte: 0, exe: active, regionKeys,
    };
    // REGION-only mode suppresses service-class transaction reporting, including work manager states.
    if (reg.rtTracked !== false) t.workManager = mergeWorkManager(t.workManager, wm);
    if (rc) rc.workManager = mergeWorkManager(rc.workManager, wm);
    if (aors.length) for (const a of aors) {
      addResources(byKey.get(a.scKey), r, 1 / aors.length);
      if (a.reportClass) addResources(rcByKey.get(a.reportClass), r, 1 / aors.length);
    }
    else addResources(byKey.get(reg.regionKey), r);
  }
  for (const t of [...reportedScps, ...reportedRcs]) {
    if (input.ioPriority === false) { t.usingIoNoVel = t.usingIo; t.delayIoNoVel = t.delayIo; }
  }
  return { reportedScps, ...(reportedRcs.length ? { rcs: reportedRcs } : {}) };
}
