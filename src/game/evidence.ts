// RCA evidence (SPEC §10): pin data points from reports, attach up to three to an RCA, and score
// each against the incident's hidden truth, its time window and the work it hurt.

import { EVIDENCE, EVIDENCE_METRICS, JOB_DELAY_METRICS, type EvidenceMetric } from '../content/evidence';
import { formatClock } from '../sim/core/clock';
import type { Scenario } from '../sim/core/scenario';
import { TICKS_PER_DAY, TICKS_PER_HOUR } from '../sim/core/units';
import { classify } from '../sim/wlm/classify';
import { buildMon3 } from './mon3';
import type { Mon3PinLookup, Mon3PinView } from './mon3PinHistory';
import { BATCH_INCIDENT } from './sla';
import { cicsMonitoring, db2Accounting } from './smf';
import type { Incident, RunState } from './types';
import { allWorkloads } from './workloads';
import { idText } from './ids';

export interface EvidencePin {
  id: number;
  /** Where it came from, in report terms (WLMGL, DELAY, CPC, Db2 101, CICS 110, SMF 30). */
  source: string;
  metric: EvidenceMetric;
  /** Service-class period, workload or LPAR the value belongs to. */
  subject: string;
  system: string;
  /** End of the measurement window the value describes. */
  tick: number;
  value: number;
  text: string;
}

export type PinRequest =
  | { source: 'WLMGL'; index: number; system: string; scKey: string; metric: EvidenceMetric }
  /** tick: a past Monitor III range (the one ending at or before it, from the history); without it, now. */
  | { source: 'MON3'; system: string; scKey: string; metric: EvidenceMetric; tick?: number }
  /** index: an RMF interval (Partition Data); without it, the Monitor III CPC view (now, or at `tick`). */
  | { source: 'CPC'; lparId: string; metric: 'PRSM_DELAY' | 'CAPPED'; index?: number; tick?: number }
  | { source: 'DB2' | 'CICS'; hour: string; workloadId: string; metric: EvidenceMetric }
  /** SMF 30 for the batch night that followed played day `day` (critical jobs' delay accounting). */
  | { source: 'BATCH'; day: number; metric: EvidenceMetric };

type Located = Omit<EvidencePin, 'id' | 'text'>;

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
      const v: Partial<Record<EvidenceMetric, number | null>> = {
        PI: w.pi,
        APPL: w.applCpPct + w.applIipPct,
        ENDED_RATE: w.endPerSec,
        DELAY_CPU: w.delayPct.cpu,
        DELAY_ZIIP: w.delayPct.ziip,
        DELAY_IO: w.delayPct.io,
        DELAY_STO: w.delayPct.storage,
        DELAY_CAP: w.delayPct.cap,
        DELAY_OTHER: w.delayPct.other,
      };
      const value = v[req.metric];
      if (value === undefined || value === null) return 'That metric is not in the Workload Activity report';
      return { source: 'WLMGL', metric: req.metric, subject: req.scKey, system: req.system, tick: iv.endTick, value };
    }
    case 'MON3': {
      const m = mon3(req.tick);
      if (typeof m === 'string') return m;
      const r = m.view.rows.find((x) => x.system === req.system && x.scKey === req.scKey);
      if (!r) return 'No such Monitor III row';
      const v: Partial<Record<EvidenceMetric, number | null>> = {
        PI: r.pi,
        APPL: 100 * r.cpuEngines,
        ENDED_RATE: r.endedPerSec,
        DELAY_CPU: 100 * r.delay.cpu,
        DELAY_ZIIP: 100 * r.delay.ziip,
        DELAY_IO: 100 * r.delay.io,
        DELAY_STO: 100 * r.delay.stor,
        DELAY_CAP: 100 * r.delay.cap,
        DELAY_OTHER: 100 * r.delay.other,
      };
      const value = v[req.metric];
      if (value === undefined || value === null) return 'That metric is not in this view';
      const view = req.metric.startsWith('DELAY') ? 'DELAY' : req.metric === 'APPL' ? 'PROCU' : req.system === '*PLEX' ? 'SYSSUM' : 'SYSINFO';
      return { source: view, metric: req.metric, subject: req.scKey, system: req.system, tick: m.tick, value };
    }
    case 'CPC': {
      if (req.index !== undefined) {
        const iv = sim.rmf.intervals[req.index];
        const r = iv?.cpu.find((x) => x.lparId === req.lparId);
        if (!iv || !r) return 'No such Partition Data row';
        return { source: 'CPC', metric: req.metric, subject: req.lparId, system: req.lparId, tick: iv.endTick, value: req.metric === 'CAPPED' ? r.cappedPct : r.prsmDelayPct };
      }
      const m = mon3(req.tick);
      if (typeof m === 'string') return m;
      const c = m.view.cpc.find((x) => x.lparId === req.lparId);
      if (!c) return 'No such LPAR';
      return { source: 'CPC', metric: req.metric, subject: req.lparId, system: req.lparId, tick: m.tick, value: req.metric === 'CAPPED' ? c.cappedPct : c.prsmDelayPct };
    }
    case 'DB2':
    case 'CICS': {
      const tick = hourEndTick(run, req.hour);
      if (tick === null) return 'No such hour';
      if (req.source === 'DB2') {
        const r = db2Accounting(run, scenario, req.hour).find((x) => x.workloadId === req.workloadId);
        if (!r) return 'No such package row';
        const v: Partial<Record<EvidenceMetric, number | null>> = { CPU_VS_BASE: r.cpuVsBaseline, LOCK_WAIT: r.lockMs, SYNC_IO: r.syncIoMs, CF_WAIT: r.cfMs, DBAT_QUEUE: r.dbatQueueMs, ENDED_RATE: r.txnPerSec };
        const value = v[req.metric];
        if (value === undefined || value === null) return 'That metric is not in Db2 accounting';
        return { source: 'Db2 101', metric: req.metric, subject: req.workloadId, system: '*PLEX', tick, value };
      }
      const r = cicsMonitoring(run, scenario, req.hour).find((x) => x.workloadId === req.workloadId);
      if (!r) return 'No such transaction row';
      const v: Partial<Record<EvidenceMetric, number | null>> = { CPU_VS_BASE: r.cpuVsBaseline, QR_WAIT: r.qrWaitMs, MXT_WAIT: r.mxtWaitMs, FAIL_PCT: r.failedPct, ENDED_RATE: r.txnPerSec };
      const value = v[req.metric];
      if (value === undefined || value === null) return 'That metric is not in CICS monitoring';
      return { source: 'CICS 110', metric: req.metric, subject: req.workloadId, system: '*PLEX', tick, value };
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

/** Service classes and images of a missed night's critical jobs: WLMGL or Monitor III pins on them are about BATCH. */
function batchSubjects(run: RunState, inc: Incident): { classes: string[]; lpars: string[] } {
  const hosts = run.reports.find((x) => x.day === inc.day)?.batch?.criticalHosts ?? [];
  return {
    classes: hosts.map((j) => classify(run.sim.wlm.definition, { subsystem: 'JES', TN: j.name, TC: j.jobClass, SY: j.lparId }).serviceClass).filter((x): x is string => !!x),
    lpars: hosts.map((j) => j.lparId),
  };
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

/** Score pins against an incident's truth. Pure; used by submitRca and shown after the RCA. */
export function judgeEvidence(run: RunState, scenario: Scenario, inc: Incident, pins: readonly EvidencePin[]): PinVerdict[] {
  const w = allWorkloads(scenario, run).find((x) => x.id === inc.workloadId);
  const batch = inc.workloadId === BATCH_INCIDENT ? batchSubjects(run, inc) : null;
  const classes = batch ? batch.classes : w ? [classify(run.sim.wlm.definition, w.work).serviceClass].filter((x): x is string => !!x) : [];
  const lpars = batch ? batch.lpars : Object.keys(run.sim.routing[inc.workloadId] ?? w?.routing ?? {});
  const lo = inc.startTick - EVIDENCE.windowHours * TICKS_PER_HOUR;
  const hi = (inc.endTick ?? run.sim.tick) + EVIDENCE.windowHours * TICKS_PER_HOUR;
  return pins.map((p) => {
    const d = EVIDENCE_METRICS[p.metric];
    const base = { pinId: p.id, text: p.text };
    if (p.tick < lo || p.tick > hi) return { ...base, relevance: 0, why: 'outside the incident window' };
    const related =
      d.anySubject ||
      p.subject === inc.workloadId ||
      classes.some((sc) => p.subject === sc || p.subject.startsWith(`${sc}#`)) ||
      lpars.includes(p.subject) ||
      p.subject === '*PLEX';
    if (!related) return { ...base, relevance: 0, why: `not about ${inc.workloadId}` };
    if (d.weight === 0) return { ...base, relevance: 0, why: 'a symptom, not a cause' };
    if (Math.abs(p.value) < d.notableAt) return { ...base, relevance: 0, why: 'value is unremarkable' };
    const hit = d.mechanisms.includes(inc.truth.mechanism) || d.triggers.includes(inc.truth.trigger);
    return hit ? { ...base, relevance: d.weight, why: d.weight < 1 ? 'consistent with the cause (but not specific)' : 'points at the cause' } : { ...base, relevance: 0, why: 'points elsewhere' };
  });
}
