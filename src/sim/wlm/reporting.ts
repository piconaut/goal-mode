// CICS/IMS resource samples belong to region classes; transaction classes carry work manager states
// (WLM Planning 3.1 p.113; RMF Report Analysis p.524, p.536–537). WLM manages from the unmoved ticks; RMF and
// Monitor III read the projection below. Nothing here feeds WLM decisions.
import type { ScpTick, SliceResult, SliceSpec } from './evaluate';
import type { ScpAcc } from './runtime';

export interface WorkManagerSamples {
  /** Analytic EXE state weights; normalize their sum for STATE SAMPLES BREAKDOWN (%).
   * ACTIVE combines SUB/APPL. The first-region (normally TOR) BTE phase is not simulated. */
  active: number;
  ready: number;
  idle: number;
  waitingIo: number;
  /** WAITING FOR LOCK: Db2 lock waits. */
  waitingLock: number;
  /** WAITING FOR PROD (another product): Db2, MQ and other server waits, Db2's CF requests. */
  waitingProd: number;
  /** WAITING FOR MISC: everything else (base latency, paging). */
  waitingMisc: number;
  /** Region service-class periods that own the resource samples. */
  regionKeys: string[];
}

const SAMPLE_FIELDS = ['cpEngines', 'ziipEngines', 'iipcpEngines', 'usingCpu', 'usingZiip', 'usingIo', 'delayCpu', 'delayZiip', 'delayIo', 'delayOther', 'delayStorage', 'delayCap'] as const;
const NOVEL_FIELDS = ['usingIoNoVel', 'delayIoNoVel'] as const;

/** The resource accounting of a tick's CICS transactions, which RMF reports with the region classes (in WLM's
 * accumulator: its decayed sum, for Monitor III). */
export type MovedSamples = Record<(typeof SAMPLE_FIELDS)[number], number> & Partial<Record<(typeof NOVEL_FIELDS)[number], number>>;

/** Where an image's CICS transaction samples are reported: its AORs' service and report classes, equal shares. */
export interface CicsTargets {
  regions: { scKey: string; reportClass: string | null; share: number }[];
  /** Sorted distinct region service classes. */
  regionKeys: string[];
}

/** APPROX: equal per-AOR accounting; without AOR slices, the declared region class. */
export function cicsTargets(slices: readonly SliceSpec[], regionKey: string): CicsTargets {
  const aors = slices.filter((s) => s.kind === 'AS' && s.role === 'CICS.AOR');
  const regions = aors.length
    ? aors.map((s) => ({ scKey: s.scKey, reportClass: s.reportClass ?? null, share: 1 / aors.length }))
    : [{ scKey: regionKey, reportClass: null, share: 1 }];
  return { regions, regionKeys: [...new Set(regions.map((r) => r.scKey))].sort() };
}

function mergeRegionKeys(a: string[], b: string[]): string[] {
  if (a === b || (a.length === b.length && a.every((k, i) => k === b[i]))) return a;
  return [...new Set([...a, ...b])].sort();
}

export function mergeWorkManager(a?: WorkManagerSamples, b?: WorkManagerSamples, decay = 1): WorkManagerSamples {
  return {
    active: (a?.active ?? 0) * decay + (b?.active ?? 0),
    ready: (a?.ready ?? 0) * decay + (b?.ready ?? 0),
    idle: (a?.idle ?? 0) * decay + (b?.idle ?? 0),
    waitingIo: (a?.waitingIo ?? 0) * decay + (b?.waitingIo ?? 0),
    waitingLock: (a?.waitingLock ?? 0) * decay + (b?.waitingLock ?? 0),
    waitingProd: (a?.waitingProd ?? 0) * decay + (b?.waitingProd ?? 0),
    waitingMisc: (a?.waitingMisc ?? 0) * decay + (b?.waitingMisc ?? 0),
    regionKeys: a && b ? mergeRegionKeys(a.regionKeys, b.regionKeys) : (a ?? b)?.regionKeys ?? [],
  };
}

const emptyMoved = (): MovedSamples => ({
  cpEngines: 0, ziipEngines: 0, iipcpEngines: 0, usingCpu: 0, usingZiip: 0, usingIo: 0,
  delayCpu: 0, delayZiip: 0, delayIo: 0, delayOther: 0, delayStorage: 0, delayCap: 0,
});

/** Tags a CICS transaction slice's samples on its tick (same accumulation order as the tick itself, so a pure
 * CICS class nets to exactly zero) and adds its work manager states. `breakdown: false`: REGION mode, where the
 * response times and the breakdown reach report classes only (WLM Planning p.123). */
export function tagCicsSlice(t: ScpTick, s: SliceSpec, r: SliceResult, regionKeys: string[], breakdown = true): void {
  const m = (t.moved ??= emptyMoved());
  m.cpEngines += r.cpGranted;
  m.ziipEngines += r.ziipGranted;
  m.iipcpEngines += r.iipcpGranted;
  m.usingCpu += r.usingCpu;
  m.usingZiip += r.usingZiip;
  m.usingIo += r.usingIo;
  m.delayCpu += r.delayCpu;
  m.delayZiip += r.delayZiip;
  m.delayIo += r.delayIo;
  m.delayOther += r.delayOther;
  m.delayStorage += r.delayStorage;
  m.delayCap += r.delayCap;
  if (!breakdown) return;
  // CICS Running vs Dispatchable: Monitoring CICS v6 p.55; BCP waits need not be READY (RMF p.536).
  // APPROX: QR contention is the modeled CICS dispatcher wait; BCP waits remain ACTIVE.
  const parts = r.parts;
  const ready = s.rate * (parts?.extra.qr ?? 0);
  const waitingIo = s.rate * (parts?.io ?? 0);
  const cpuPhaseSec = parts ? parts.cpu + parts.cpuQueue + parts.ziip + parts.paging + parts.backlogWait : 0;
  const workPerTxn = s.cpuSecPerTxn + s.ziipSecPerTxn;
  const backlogTasks = workPerTxn > 0 ? r.newBacklog / workPerTxn : 0;
  const active = Math.max(s.rate * cpuPhaseSec, r.usingCpu + r.usingZiip, backlogTasks);
  // RMF WAITING FOR states (Report Analysis p.536): Db2 lock waits are LOCK; waits for Db2, MQ or a slow server
  // and Db2's CF requests are PROD; the rest of the response time is MISC. APPROX: the mapping from the sim's
  // response-time parts.
  const waitingLock = s.rate * (parts?.extra.lock ?? 0);
  const waitingProd = s.rate * ((parts?.dependency ?? 0) + (parts?.extra.cf ?? 0));
  const waitingMisc = Math.max(0, s.rate * r.rtMeanSec - active - ready - waitingIo - waitingLock - waitingProd);
  const w = t.workManager;
  if (!w) t.workManager = { active, ready, idle: 0, waitingIo, waitingLock, waitingProd, waitingMisc, regionKeys };
  else {
    w.active += active;
    w.ready += ready;
    w.waitingIo += waitingIo;
    w.waitingLock += waitingLock;
    w.waitingProd += waitingProd;
    w.waitingMisc += waitingMisc;
  }
}

/** I/O priority management off: the moved I/O samples leave velocity too. */
export function excludeMovedIo(t: ScpTick): void {
  if (!t.moved) return;
  t.moved.usingIoNoVel = t.moved.usingIo;
  t.moved.delayIoNoVel = t.moved.delayIo;
}

function minus(t: ScpTick, m: MovedSamples): ScpTick {
  const { moved: _moved, ...out } = t;
  for (const f of SAMPLE_FIELDS) out[f] = t[f] - m[f];
  if (t.usingIoNoVel !== undefined) for (const f of NOVEL_FIELDS) out[f] = (t[f] ?? 0) - (m[f] ?? 0);
  return out;
}

function plus(t: ScpTick, m: MovedSamples, share: number): void {
  for (const f of SAMPLE_FIELDS) t[f] += m[f] * share;
  if (m.usingIoNoVel !== undefined) for (const f of NOVEL_FIELDS) t[f] = (t[f] ?? 0) + (m[f] ?? 0) * share;
}

/** One image's ticks as RMF reports them: CICS transaction samples moved to the region classes. Pure; ticks
 * without moved samples are returned as they are. */
export function reportedTicks<T extends ScpTick>(ticks: readonly T[], targets: CicsTargets | undefined, reportClasses = false): T[] {
  if (!targets || !ticks.some((t) => t.moved)) return ticks as T[];
  const out = ticks.map((t) => (t.moved ? (minus(t, t.moved) as T) : t));
  const at: Record<string, number> = {};
  out.forEach((t, i) => (at[t.scKey] = i));
  for (const t of ticks) {
    if (!t.moved) continue;
    for (const r of targets.regions) {
      const key = reportClasses ? r.reportClass : r.scKey;
      if (!key) continue;
      let i = at[key];
      // A report class the image never reported takes nothing (no members to show); a region class always exists.
      if (i === undefined) {
        if (reportClasses) continue;
        i = at[key] = out.push({ scKey: key, dp: 0, ...emptyMoved(), completions: 0, failed: 0, rtSumSec: 0, buckets: [] } as unknown as T) - 1;
      } else if (out[i] === ticks[i]) out[i] = { ...out[i]! };
      plus(out[i]!, t.moved, r.share);
    }
  }
  return out;
}

/** Decays the moved part kept in WLM's accumulator; drops it once nothing is left. */
export function decayMoved(a: MovedSamples | undefined, m: MovedSamples | undefined, d: number): MovedSamples | undefined {
  if (!a && !m) return undefined;
  const out = emptyMoved();
  let left = 0;
  for (const f of SAMPLE_FIELDS) left += Math.abs((out[f] = (a?.[f] ?? 0) * d + (m?.[f] ?? 0)));
  if (a?.usingIoNoVel !== undefined || m?.usingIoNoVel !== undefined) for (const f of NOVEL_FIELDS) out[f] = (a?.[f] ?? 0) * d + (m?.[f] ?? 0);
  return m || left > 1e-12 ? out : undefined;
}

/** The moved samples in WLM accumulator terms (runtime.decayInto). */
function asAcc(m: MovedSamples): Pick<ScpAcc, 'using' | 'delay' | 'delayCpu' | 'delayZiip' | 'delayIo' | 'delayOther' | 'delayCap' | 'cpuEngines' | 'usingIoNoVel' | 'delayIoNoVel'> {
  return {
    using: m.usingCpu + m.usingZiip + m.usingIo,
    delay: m.delayCpu + m.delayZiip + m.delayIo + m.delayStorage + m.delayCap,
    delayCpu: m.delayCpu,
    delayZiip: m.delayZiip,
    delayIo: m.delayIo,
    delayOther: m.delayOther,
    delayCap: m.delayCap,
    cpuEngines: m.cpEngines + m.iipcpEngines,
    ...(m.usingIoNoVel !== undefined ? { usingIoNoVel: m.usingIoNoVel, delayIoNoVel: m.delayIoNoVel ?? 0 } : {}),
  };
}
const ACC_FIELDS = ['using', 'delay', 'delayCpu', 'delayZiip', 'delayIo', 'delayOther', 'delayCap', 'cpuEngines', ...NOVEL_FIELDS] as const;

/** Decayed sums drift apart by rounding (and the moved part expires first): treat what is left at that scale as none. */
const net = (a: number, m: number): number => (Math.abs(a - m) <= 1e-9 * Math.max(1, Math.abs(a)) ? 0 : a - m);

/** One image's WLM accumulators as Monitor III reports them (the attribution of reportedTicks). */
export function reportedAccs(accs: Readonly<Record<string, ScpAcc>>, targets: CicsTargets | undefined): Record<string, ScpAcc> {
  const out: Record<string, ScpAcc> = { ...accs };
  if (!targets) return out;
  for (const [k, a] of Object.entries(accs)) {
    if (!a.moved) continue;
    const m = asAcc(a.moved);
    const own: ScpAcc = { ...a };
    delete own.moved;
    for (const f of ACC_FIELDS) if (m[f] !== undefined && a[f] !== undefined) own[f] = net(a[f], m[f]);
    out[k] = own;
    for (const r of targets.regions) {
      const reg = (out[r.scKey] = { ...(out[r.scKey] ?? { completions: 0, rtSumSec: 0, buckets: [], using: 0, delay: 0, delayCpu: 0, delayZiip: 0, delayIo: 0, delayOther: 0, delayCap: 0, cpuEngines: 0 }) });
      for (const f of ACC_FIELDS) if (m[f] !== undefined) reg[f] = (reg[f] ?? 0) + m[f] * r.share;
    }
  }
  return out;
}

/** CICS transaction rows show '-' for resources: work manager data and nothing left of their own. */
export const noResources = (a: { workManager?: WorkManagerSamples; using: number; delay: number; delayOther: number; cpuEngines: number }): boolean =>
  !!a.workManager && Math.abs(a.using) + Math.abs(a.delay) + Math.abs(a.delayOther) + Math.abs(a.cpuEngines) <= 1e-9;

