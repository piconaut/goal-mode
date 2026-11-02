// CICS/IMS resource samples belong to region classes; transaction classes carry work manager states
// (WLM Planning 3.1 p.113; RMF Report Analysis p.536–537). This projection never feeds WLM decisions.
import { emptyScpTick, type LparEvalInput, type ReportClassTick, type ScpTick, type SliceResult } from './evaluate';

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

export function mergeWorkManager(a?: WorkManagerSamples, b?: WorkManagerSamples, decay = 1): WorkManagerSamples {
  return {
    active: (a?.active ?? 0) * decay + (b?.active ?? 0),
    ready: (a?.ready ?? 0) * decay + (b?.ready ?? 0),
    idle: (a?.idle ?? 0) * decay + (b?.idle ?? 0),
    waitingIo: (a?.waitingIo ?? 0) * decay + (b?.waitingIo ?? 0),
    waitingOther: (a?.waitingOther ?? 0) * decay + (b?.waitingOther ?? 0),
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
    // CICS tasks are Running (ACTIVE) or Dispatchable (READY): Monitoring CICS v6 p.55.
    // BCP CPU waits need not be READY to CICS (RMF p.536). APPROX: QR contention is the
    // only modeled CICS dispatcher wait; BCP CPU/backlog/paging waits remain ACTIVE.
    const parts = r.parts;
    const ready = s.rate * (parts?.extra.qr ?? 0);
    const waitingIo = s.rate * (r.parts?.io ?? 0);
    const cpuPhaseSec = parts ? parts.cpu + parts.cpuQueue + parts.ziip + parts.paging + parts.backlogWait : 0;
    const workPerTxn = s.cpuSecPerTxn + s.ziipSecPerTxn;
    const backlogTasks = workPerTxn > 0 ? r.newBacklog / workPerTxn : 0;
    const active = Math.max(s.rate * cpuPhaseSec, r.usingCpu + r.usingZiip, backlogTasks);
    const wm: WorkManagerSamples = {
      active, ready, idle: 0,
      waitingIo,
      // No product-switch or TOR state machine: unclassified suspension remains MISC.
      waitingOther: Math.max(0, s.rate * r.rtMeanSec - active - ready - waitingIo),
      regionKeys,
    };
    // RT tracking and this reporting-only state estimate are independent. WLM Planning p.123
    // defines the REGION-mode RT rule; this estimate does not infer further state suppression.
    t.workManager = mergeWorkManager(t.workManager, wm);
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
