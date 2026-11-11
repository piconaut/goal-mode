// RCA evidence (SPEC §10): pin data points from reports, attach up to three to an RCA, and score
// each against the incident's hidden truth, its time window and the work it hurt.

import { EVIDENCE, EVIDENCE_METRICS, JOB_DELAY_METRICS, type EvidenceMetric, type PinRelation } from '../content/evidence';
import { formatClock } from '../sim/core/clock';
import type { Scenario } from '../sim/core/scenario';
import { TICKS_PER_DAY, TICKS_PER_HOUR } from '../sim/core/units';
import { classify } from '../sim/wlm/classify';
import { buildMon3 } from './mon3';
import type { Mon3PinLookup, Mon3PinView } from './mon3PinHistory';
import { BATCH_INCIDENT } from './sla';
import type { NightSummary } from '../sim/subsys/batch';
import { cicsMonitoring, db2Accounting } from './smf';
import type { CpuRecord, WlmRecord } from '../sim/measure/rmf';
import type { Incident, IncidentSubjects, RunState } from './types';
import { allWorkloads } from './workloads';
import { idText } from './ids';

export interface EvidencePin {
  id: number;
  /** Where it came from, in report terms (WLMGL, DELAY, CPC, Db2 101, CICS 110, SMF 30). */
  source: string;
  metric: EvidenceMetric;
  /** Service-class period, workload, LPAR or SYSWKM server jobname the value belongs to. */
  subject: string;
  system: string;
  /** End of the measurement window the value describes. */
  tick: number;
  value: number;
  /** The value's baseline, when the report lets one be read (RT-12): the median of the same row over the six closed
   * hours before it, so a predicate can ask whether the value is normal. `CPU_VS_BASE` is already a ratio, so its
   * baseline is 1. Absent where no baseline exists (a new workload's first hours, a sysplex-wide only row). */
  baseline?: number;
  text: string;
}

/** Metrics a Partition Data or Monitor III CPC row can pin. */
export type CpcMetric = 'PRSM_DELAY' | 'CAPPED' | 'CPC_BUSY' | 'LPAR_BUSY' | 'CAPACITY_ADJ';

export type PinRequest =
  | { source: 'WLMGL'; index: number; system: string; scKey: string; metric: EvidenceMetric }
  /** tick: a past Monitor III range (the one ending at or before it, from the history); without it, now. */
  /** jobname: a SYSWKM server row ("Address Spaces Serving this Service Class" of transaction class scKey). */
  | { source: 'MON3'; system: string; scKey: string; metric: EvidenceMetric; tick?: number; jobname?: string }
  /** index: an RMF interval (Partition Data); without it, the Monitor III CPC view (now, or at `tick`).
   * The partition names the row; CPC_BUSY and CAPACITY_ADJ are about the CPC it runs on (the pin's subject). */
  | { source: 'CPC'; lparId: string; metric: CpcMetric; index?: number; tick?: number }
  | { source: 'DB2' | 'CICS'; hour: string; workloadId: string; metric: EvidenceMetric }
  /** SMF 30 for the batch night that followed played day `day` (critical jobs' delay accounting). */
  | { source: 'BATCH'; day: number; metric: EvidenceMetric };

type Located = Omit<EvidencePin, 'id' | 'text'>;

/** The CLI's Monitor III history keeps PI, CPU, the ended rate and the delay shares per class, and PR/SM delay and
 * capping per image: the busier CPC metrics are not in it. */
const TRIM_HISTORY = 'This Monitor III range keeps PI, CPU, ended rate and delay shares only; pin the value from a Partition Data interval';

/** Metrics that are a class's CPU total: a CICS region class reports the regions', not its transactions'. */
const APPL_METRICS = new Set<EvidenceMetric>(['APPL', 'APPL_CP', 'APPL_IIP', 'IIPCP']);


const NUM = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v);

/** How many closed hours back a pin's baseline looks (RT-12). */
const BASELINE_HOURS = 6;

/** Median of the earlier hours, or undefined when none reported the row: the baseline a "normal" predicate compares
 * against, so a recipe can ask whether a value is flat without knowing the report it came from (RT-12, §4.6). */
function median(xs: number[]): number | undefined {
  if (xs.length === 0) return undefined;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** One Workload Activity row's value for a metric, or null when the row has none. */
function wlmMetric(w: WlmRecord, metric: EvidenceMetric): number | null | undefined {
  const v: Partial<Record<EvidenceMetric, number | null>> = {
    PI: w.pi,
    APPL: w.applCpPct + w.applIipPct,
    APPL_CP: w.applCpPct,
    APPL_IIP: w.applIipPct,
    IIPCP: w.applIipcpPct,
    ENDED_RATE: w.endPerSec,
    DELAY_CPU: w.delayPct.cpu,
    DELAY_ZIIP: w.delayPct.ziip,
    DELAY_IO: w.delayPct.io,
    DELAY_STO: w.delayPct.storage,
    DELAY_CAP: w.delayPct.cap,
    DELAY_OTHER: w.delayPct.other,
  };
  return v[metric];
}

/** One Partition Data row's value for a metric, or null when the row has none. */
function cpuMetric(r: CpuRecord, metric: EvidenceMetric): number | null {
  if (metric === 'CAPPED') return r.cappedPct;
  if (metric === 'LPAR_BUSY') return r.logicalBusyPct;
  if (metric === 'PRSM_DELAY') return r.prsmDelayPct;
  return null;
}

/** A service class the definition knows: used to tell "another class" from "not a class at all" (RT-12). */
const knownClass = (run: RunState, c: string): boolean =>
  c === 'SYSTEM' || c === 'SYSSTC' || c === 'SYSOTHER' || run.sim.wlm.definition.classes.some((x) => x.id === c);

function locate(run: RunState, scenario: Scenario, req: PinRequest, history?: Mon3PinLookup): Located | string {
  const sim = run.sim;
  const mon3 = (tick: number | undefined): { tick: number; view: Mon3PinView } | string => {
    if (tick === undefined) return { tick: sim.tick, view: buildMon3(run, scenario) };
    return history?.(tick) ?? 'Monitor III history does not reach back that far';
  };
  switch (req.source) {
    case 'WLMGL': {
      const iv = sim.rmf.intervals[req.index];
      const w = iv?.wlm.find((x) => x.lparId === req.system && x.scKey === req.scKey);
      if (!iv || !w) return 'No such report row';
      if (w.resourceSamples === false && (APPL_METRICS.has(req.metric) || req.metric.startsWith('DELAY_')))
        return `CICS resource samples are reported with the regions' classes: ${w.workManager?.regionKeys.join(', ') ?? 'see the region service classes'}`;
      const value = wlmMetric(w, req.metric);
      if (value === undefined || value === null) return 'That metric is not in the Workload Activity report';
      const baseline = median(sim.rmf.intervals.slice(Math.max(0, req.index - BASELINE_HOURS), req.index)
        .map((x) => x.wlm.find((r) => r.lparId === req.system && r.scKey === req.scKey))
        .map((r) => (r ? wlmMetric(r, req.metric) : null))
        .filter(NUM));
      return { source: 'WLMGL', metric: req.metric, subject: req.scKey, system: req.system, tick: iv.endTick, value, ...(baseline !== undefined ? { baseline } : {}) };
    }
    case 'MON3': {
      const m = mon3(req.tick);
      if (typeof m === 'string') return m;
      if (req.jobname !== undefined) {
        const s = m.view.wkm?.find((w) => w.scKey === req.scKey)?.servers.find((x) => x.system === req.system && x.jobname === req.jobname);
        if (!s) return 'No such SYSWKM server';
        if (req.metric !== 'VELOCITY' || s.velocity === null) return 'That metric is not in this view';
        return { source: 'SYSWKM', metric: 'VELOCITY', subject: s.jobname, system: req.system, tick: m.tick, value: s.velocity };
      }
      const r = m.view.rows.find((x) => x.system === req.system && x.scKey === req.scKey);
      if (!r) return 'No such Monitor III row';
      if (r.resourceSamples === false && (APPL_METRICS.has(req.metric) || req.metric.startsWith('DELAY_')))
        return `CICS resource samples are reported with the regions' classes: see the region service classes`;
      const v: Partial<Record<EvidenceMetric, number | null>> = {
        PI: r.pi,
        APPL: 100 * r.cpuEngines,
        APPL_CP: 100 * r.cpuEngines,
        APPL_IIP: r.ziipEngines === undefined ? null : 100 * r.ziipEngines,
        IIPCP: r.iipcpEngines === undefined ? null : 100 * r.iipcpEngines,
        ENDED_RATE: r.endedPerSec,
        DELAY_CPU: 100 * r.delay.cpu,
        DELAY_ZIIP: 100 * r.delay.ziip,
        DELAY_IO: 100 * r.delay.io,
        DELAY_STO: 100 * r.delay.stor,
        DELAY_CAP: 100 * r.delay.cap,
        DELAY_OTHER: 100 * r.delay.other,
      };
      const value = v[req.metric];
      if (value === undefined) return 'That metric is not in this view';
      if (value === null) return TRIM_HISTORY;
      const view = req.metric.startsWith('DELAY') ? 'DELAY' : APPL_METRICS.has(req.metric) ? 'PROCU' : req.system === '*PLEX' ? 'SYSSUM' : 'SYSINFO';
      return { source: view, metric: req.metric, subject: req.scKey, system: req.system, tick: m.tick, value };
    }
    case 'CPC': {
      const cpcId = run.sim.config.lpars.find((l) => l.id === req.lparId)?.cpcId ?? '';
      if (req.index !== undefined) {
        const iv = sim.rmf.intervals[req.index];
        const r = iv?.cpu.find((x) => x.lparId === req.lparId);
        if (!iv || !r) return 'No such Partition Data row';
        if (req.metric === 'CPC_BUSY' || req.metric === 'CAPACITY_ADJ') {
          const c = iv.cpcBusy.find((x) => x.cpcId === cpcId && x.pool === 'CP');
          if (!c) return 'No such CPC row';
          const value = req.metric === 'CPC_BUSY' ? c.physicalBusyPct : 100 - (c.capacityAdjustmentPct ?? 100);
          const baseline = median(sim.rmf.intervals.slice(Math.max(0, req.index - BASELINE_HOURS), req.index)
            .map((x) => x.cpcBusy.find((y) => y.cpcId === cpcId && y.pool === 'CP'))
            .map((y) => (y === undefined ? null : req.metric === 'CPC_BUSY' ? y.physicalBusyPct : 100 - (y.capacityAdjustmentPct ?? 100)))
            .filter(NUM));
          return { source: 'CPC', metric: req.metric, subject: cpcId, system: cpcId, tick: iv.endTick, value, ...(baseline !== undefined ? { baseline } : {}) };
        }
        const value = cpuMetric(r, req.metric)!;
        const baseline = median(sim.rmf.intervals.slice(Math.max(0, req.index - BASELINE_HOURS), req.index)
          .map((x) => x.cpu.find((y) => y.lparId === req.lparId))
          .map((y) => (y === undefined ? null : cpuMetric(y, req.metric)))
          .filter(NUM));
        return { source: 'CPC', metric: req.metric, subject: req.lparId, system: req.lparId, tick: iv.endTick, value, ...(baseline !== undefined ? { baseline } : {}) };
      }
      const m = mon3(req.tick);
      if (typeof m === 'string') return m;
      const c = m.view.cpc.find((x) => x.lparId === req.lparId);
      if (!c) return 'No such LPAR';
      if (req.metric === 'LPAR_BUSY' && c.busyPct === undefined) return TRIM_HISTORY;
      if (req.metric === 'CPC_BUSY' || req.metric === 'CAPACITY_ADJ') {
        if (c.cpcId === undefined || (req.metric === 'CAPACITY_ADJ' && c.capacityAdjPct === undefined)) return TRIM_HISTORY;
        // The CPC report's *CP row: physical utilisation (Total, i.e. LPAR management included) summed over the
        // box's partitions (RMF Report Analysis 3.1 p.99), and the capacity loss the view was built with.
        const busy = m.view.cpc
          .filter((x) => x.cpcId === c.cpcId && x.kind === 'ZOS')
          .reduce((a, x) => a + (x.physTotalPct ?? 0), 0);
        const value = req.metric === 'CPC_BUSY' ? busy : c.capacityAdjPct!;
        return { source: 'CPC', metric: req.metric, subject: c.cpcId, system: c.cpcId, tick: m.tick, value };
      }
      const value = req.metric === 'CAPPED' ? c.cappedPct : req.metric === 'LPAR_BUSY' ? c.busyPct! : c.prsmDelayPct;
      return { source: 'CPC', metric: req.metric, subject: req.lparId, system: req.lparId, tick: m.tick, value };
    }
    case 'DB2':
    case 'CICS': {
      const tick = hourEndTick(run, req.hour);
      if (tick === null) return 'No such hour';
      // The same row read from any closed hour: the pinned one and the earlier ones a baseline is the median of.
      const read = (key: string): Partial<Record<EvidenceMetric, number | null>> | null => {
        if (req.source === 'DB2') {
          const r = db2Accounting(run, scenario, key).find((x) => x.workloadId === req.workloadId);
          return r ? { CPU_VS_BASE: r.cpuVsBaseline, LOCK_WAIT: r.lockMs, SYNC_IO: r.syncIoMs, CF_WAIT: r.cfMs, DBAT_QUEUE: r.dbatQueueMs, ENDED_RATE: r.txnPerSec } : null;
        }
        const r = cicsMonitoring(run, scenario, key).find((x) => x.workloadId === req.workloadId);
        return r ? { CPU_VS_BASE: r.cpuVsBaseline, QR_WAIT: r.qrWaitMs, MXT_WAIT: r.mxtWaitMs, FAIL_PCT: r.failedPct, ENDED_RATE: r.txnPerSec } : null;
      };
      const row = read(req.hour);
      const missing = req.source === 'DB2' ? 'No such package row' : 'No such transaction row';
      if (!row) return missing;
      const value = row[req.metric];
      if (value === undefined || value === null)
        return req.source === 'DB2' ? 'That metric is not in Db2 accounting' : 'That metric is not in CICS monitoring';
      const i = run.smfHours.findIndex((h) => `${h.day}:${h.hourOfDay}` === req.hour);
      const upto = i < 0 ? run.smfHours.length : i;
      const earlier = run.smfHours.slice(Math.max(0, upto - BASELINE_HOURS), upto);
      const baseline = req.metric === 'CPU_VS_BASE'
        ? 1
        : median(earlier.map((h) => read(`${h.day}:${h.hourOfDay}`)?.[req.metric]).filter(NUM));
      return { source: req.source === 'DB2' ? 'Db2 101' : 'CICS 110', metric: req.metric, subject: req.workloadId, system: '*PLEX', tick, value, ...(baseline !== undefined ? { baseline } : {}) };
    }
    case 'BATCH': {
      const night = run.reports.find((x) => x.day === req.day)?.batch;
      if (!night) return 'No batch night for that day';
      let value: number;
      if (req.metric === 'JOB_ABEND') value = (night.criticalAbended ?? []).length;
      else if (req.metric in JOB_DELAY_METRICS) {
        const d = night.criticalDelaySec;
        const total = d ? Object.values(d).reduce((a, x) => a + x, 0) : 0;
        if (!d || total <= 0) return 'The critical jobs lost no time that night';
        value = (100 * d[JOB_DELAY_METRICS[req.metric as keyof typeof JOB_DELAY_METRICS]]) / total;
      } else return 'That metric is not in the batch job records';
      // Stamped at the night's 06:00 end, inside the night's incident window.
      return { source: 'SMF 30', metric: req.metric, subject: BATCH_INCIDENT, system: '*PLEX', tick: (req.day + 1) * TICKS_PER_DAY, value };
    }
  }
}

/**
 * What the evidence judge derives for an incident opened now (RT-04): its service classes (the workload's and its
 * CICS region classes), its images and the region jobnames serving it. Stored on the incident at open, so a later
 * `ACTIVATE_POLICY` or `SET_ROUTING` cannot turn a good pin into "not about X" (A10).
 * `night` is the missed night when the caller has it (the day's report is written after the incident).
 */
export function incidentSubjects(
  run: RunState,
  scenario: Scenario,
  workloadId: string,
  day: number,
  night?: NightSummary | null,
): IncidentSubjects {
  // A missed night's critical jobs: WLMGL or Monitor III pins on their classes and images are about BATCH.
  if (workloadId === BATCH_INCIDENT) {
    const hosts = night?.criticalHosts ?? run.reports.find((x) => x.day === day)?.batch?.criticalHosts ?? [];
    const lpars = hosts.map((j) => j.lparId);
    return {
      classes: hosts.map((j) => classify(run.sim.wlm.definition, { subsystem: 'JES', TN: j.name, TC: j.jobClass, SY: j.lparId }).serviceClass).filter((x): x is string => !!x),
      lpars,
      hosts: [...lpars],
      servers: [],
    };
  }
  const w = allWorkloads(scenario, run).find((x) => x.id === workloadId);
  const classes = w ? [classify(run.sim.wlm.definition, w.work).serviceClass].filter((x): x is string => !!x) : [];
  const routing = run.sim.routing[workloadId] ?? w?.routing ?? {};
  const lpars = Object.keys(routing);
  // Images the work actually runs on. A static routing table keeps a 0 weight for an image it was routed away from
  // (`SET_ROUTING`), and that image is not a host of the work any more.
  const hosts = Object.entries(routing).filter(([, share]) => share > 0).map(([id]) => id);
  const servers: { jobname: string; lparId: string }[] = [];
  // Resource evidence on a CICS region class is evidence about its hosted transactions, not about a class of its own
  // (RT-12 keeps the two apart so a region's row is a `server` pin, not the work's own).
  const serverClasses: string[] = [];
  if (w?.subsystem === 'CICS') for (const a of [...scenario.addressSpaces, ...run.sim.extraAddressSpaces]) {
    if (!lpars.includes(a.lparId) || (a.role !== 'CICS.AOR' && a.role !== 'CICS.TOR')) continue;
    if (a.role === 'CICS.AOR' && (routing[a.lparId] ?? 0) > 0) servers.push({ jobname: a.jobname, lparId: a.lparId });
    const sc = classify(run.sim.wlm.definition, { subsystem: a.subsystem, TN: a.jobname, SY: a.lparId }).serviceClass;
    if (sc && !classes.includes(sc)) classes.push(sc);
    if (sc && !serverClasses.includes(sc)) serverClasses.push(sc);
  }
  return { classes, lpars, hosts, servers, ...(serverClasses.length > 0 ? { serverClasses } : {}) };
}

function hourEndTick(run: RunState, key: string): number | null {
  if (key === 'current') return run.sim.tick;
  const i = run.smfHours.findIndex((h) => `${h.day}:${h.hourOfDay}` === key);
  if (i < 0) return null;
  // Closed hours are stored in order, the newest ending at the most recent hour boundary.
  const newestEnd = Math.floor(run.sim.tick / TICKS_PER_HOUR) * TICKS_PER_HOUR;
  return newestEnd - (run.smfHours.length - 1 - i) * TICKS_PER_HOUR;
}

const fmtValue = (m: EvidenceMetric, v: number) => {
  const d = EVIDENCE_METRICS[m];
  return d.unit === '×' ? `×${v.toFixed(2)}` : `${v >= 100 ? v.toFixed(0) : v.toFixed(1)}${d.unit ? ` ${d.unit}` : ''}`.replace(' %', '%');
};

// Db2 101 and CICS 110 pins sit at their SMF hour's end tick; label the hour itself (10:00–11:00).
const pinWhen = (p: Located): string =>
  p.source === 'Db2 101' || p.source === 'CICS 110'
    ? `${formatClock(p.tick - TICKS_PER_HOUR).slice(0, -3)}–${formatClock(p.tick).slice(-8, -3)}`
    : formatClock(p.tick).slice(0, -3);

export function pinText(p: Located): string {
  return `${p.source} ${pinWhen(p)} ${p.system !== p.subject && p.system !== '*PLEX' ? `${p.system} ` : ''}${p.subject} ${EVIDENCE_METRICS[p.metric].label.replace(/ %$/, '')} ${fmtValue(p.metric, p.value)}`;
}

/** history: where a pin with a past `tick` reads its Monitor III range (the worker's or the play CLI's history). */
export function addPin(run: RunState, scenario: Scenario, req: PinRequest, history?: Mon3PinLookup): { run: RunState; ok: boolean; message: string } {
  const loc = locate(run, scenario, req, history);
  if (typeof loc === 'string') return { run, ok: false, message: loc };
  const pins = run.pins ?? [];
  if (pins.some((p) => p.source === loc.source && p.metric === loc.metric && p.subject === loc.subject && p.system === loc.system && p.tick === loc.tick)) return { run, ok: false, message: 'Already pinned' };
  const pin: EvidencePin = { ...loc, id: run.nextId, text: pinText(loc) };
  // Oldest pins fall off the board.
  const kept = [...pins, pin].slice(-EVIDENCE.maxPins);
  return { run: { ...run, pins: kept, nextId: run.nextId + 1 }, ok: true, message: `Pinned ${idText('pin', pin.id)}: ${pin.text}` };
}

export const removePin = (run: RunState, id: number): RunState => ({ ...run, pins: (run.pins ?? []).filter((p) => p.id !== id) });

export interface PinVerdict {
  pinId: number;
  text: string;
  relevance: number;
  why: string;
}

interface RankedVerdict {
  verdict: PinVerdict;
  checksPassed: number;
}

const RELATION_TEXT: Record<PinRelation, string> = {
  self: 'the work itself',
  server: 'a server of the work',
  competitor: 'another class',
  host: 'the host',
};

/** A pin's relation to the incident (RT-12, docs/rca-design.md §4.6), from the subjects recorded when it opened (A10).
 * `self` is the hurt work's own class, region accounting or workload row; `server` is a region serving it; `host` is
 * an image or processor of the incident; `competitor` is another class, and only placeable on a host image. Null when
 * nothing ties the row to the incident. */
export function pinRelation(run: RunState, inc: Incident, p: EvidencePin, s: IncidentSubjects): PinRelation | null {
  switch (p.source) {
    case 'SYSWKM':
      return s.servers.some((a) => p.subject === a.jobname && p.system === a.lparId) ? 'server' : null;
    case 'Db2 101':
    case 'CICS 110':
    case 'SMF 30':
      return p.subject === inc.workloadId ? 'self' : null;
    case 'CPC':
      return s.hosts.includes(p.subject) ||
        s.hosts.some((lparId) => run.sim.config.lpars.find((l) => l.id === lparId)?.cpcId === p.subject)
        ? 'host'
        : null;
    default: {
      // WLMGL and the Monitor III views report class rows.
      const cls = p.subject.split('#')[0]!;
      if (p.subject === inc.workloadId || (s.classes.includes(cls) && !(s.serverClasses ?? []).includes(cls))) return 'self';
      if ((s.serverClasses ?? []).includes(cls)) return 'server';
      // A class no definition knows is not a competitor, just an unrelated row.
      if (!knownClass(run, cls)) return null;
      // Another class's row is only proof of what ran where from an image the hurt work runs on: a `*PLEX` row is the
      // roll-up of every image, so it cannot say whether that competitor shared the host (RT-12 closes A9's hole).
      return p.system !== '*PLEX' && s.hosts.includes(p.system) ? 'competitor' : null;
    }
  }
}

/** Why a pin is not about the incident at all, in the words the reply shows. */
function notRelatedWhy(run: RunState, inc: Incident, p: EvidencePin, s: IncidentSubjects): string {
  if (knownClass(run, p.subject.split('#')[0]!) && !s.hosts.includes(p.system))
    return p.system === '*PLEX'
      ? 'a *PLEX row does not show which image the class ran on'
      : `not on a system ${inc.workloadId} runs on`;
  return `not about ${inc.workloadId}`;
}

function judgeEvidenceRanked(run: RunState, scenario: Scenario, inc: Incident, pins: readonly EvidencePin[]): RankedVerdict[] {
  // Judged against what the incident recorded when it opened (RT-04), so a reclassification or rerouting after the
  // fact keeps the verdicts a player would have got at the time; incidents from old saves derive them now.
  const subjects = inc.subjects ?? incidentSubjects(run, scenario, inc.workloadId, inc.day);
  const lo = inc.startTick - EVIDENCE.windowHours * TICKS_PER_HOUR;
  const hi = (inc.endTick ?? run.sim.tick) + EVIDENCE.windowHours * TICKS_PER_HOUR;
  return pins.map((p) => {
    const d = EVIDENCE_METRICS[p.metric];
    const result = (relevance: number, why: string, checksPassed: number): RankedVerdict => ({
      verdict: { pinId: p.id, text: p.text, relevance, why }, checksPassed,
    });
    if (p.tick < lo || p.tick > hi) return result(0, 'outside the incident window', 0);
    // The metric says which relations it is evidence for (RT-12): a competitor's CPU delay is not the hurt work's own,
    // and the work's own delay is not the host's busy.
    const relation = pinRelation(run, inc, p, subjects);
    if (relation === null) return result(0, notRelatedWhy(run, inc, p, subjects), 1);
    if (!d.relations.includes(relation))
      return result(0, relation === 'competitor' ? "another class's row, not the hurt work's" : `about ${RELATION_TEXT[relation]}, not ${inc.workloadId}'s own work`, 1);
    if (d.weight === 0) return result(0, 'a symptom, not a cause', 2);
    if (Math.abs(p.value) < d.notableAt) return result(0, 'value is unremarkable', 3);
    const hit = d.mechanisms.includes(inc.truth.mechanism) || d.triggers.includes(inc.truth.trigger);
    return result(hit ? d.weight : 0, hit ? (d.weight < 1 ? 'consistent with the cause (but not specific)' : 'points at the cause') : 'points elsewhere', 4);
  });
}

/** Score pins against an incident's truth. Pure; shown after the RCA. */
export function judgeEvidence(run: RunState, scenario: Scenario, inc: Incident, pins: readonly EvidencePin[]): PinVerdict[] {
  return judgeEvidenceRanked(run, scenario, inc, pins).map((v) => v.verdict);
}

/** Highest relevance per pin; on ties, prefer the most informative failure, then the first incident. */
export function judgeGroupEvidence(run: RunState, scenario: Scenario, group: readonly Incident[], pins: readonly EvidencePin[]): PinVerdict[] {
  return group.map((inc) => judgeEvidenceRanked(run, scenario, inc, pins)).reduce<RankedVerdict[]>((best, verdicts) =>
    verdicts.map((v, k) => {
      const b = best[k];
      return !b || v.verdict.relevance > b.verdict.relevance ||
        (v.verdict.relevance === b.verdict.relevance && v.checksPassed > b.checksPassed) ? v : b;
    }), []).map((v) => v.verdict);
}
