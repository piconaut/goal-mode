// RCA evidence (SPEC §10): pin data points from reports, attach up to three to an RCA, and score
// each against the incident's hidden truth, its time window and the work it hurt.

import { EVIDENCE, EVIDENCE_METRICS, type EvidenceMetric } from '../content/evidence';
import { formatClock } from '../sim/core/clock';
import type { Scenario } from '../sim/core/scenario';
import { TICKS_PER_HOUR } from '../sim/core/units';
import { classify } from '../sim/wlm/classify';
import { buildMon3 } from './mon3';
import { cicsMonitoring, db2Accounting } from './smf';
import type { Incident, RunState } from './types';
import { allWorkloads } from './workloads';

export interface EvidencePin {
  id: number;
  /** Where it came from, in report terms (WLMGL, DELAY, CPC, Db2 101, CICS 110). */
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
  | { source: 'MON3'; system: string; scKey: string; metric: EvidenceMetric }
  | { source: 'CPC'; lparId: string; metric: 'PRSM_DELAY' | 'CAPPED' }
  | { source: 'DB2' | 'CICS'; hour: string; workloadId: string; metric: EvidenceMetric };

type Located = Omit<EvidencePin, 'id' | 'text'>;

function locate(run: RunState, scenario: Scenario, req: PinRequest): Located | string {
  const sim = run.sim;
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
      const r = buildMon3(run, scenario).rows.find((x) => x.system === req.system && x.scKey === req.scKey);
      if (!r) return 'No such Monitor III row';
      const v: Partial<Record<EvidenceMetric, number | null>> = {
        PI: r.pi,
        APPL: 100 * r.cpuEngines,
        ENDED_RATE: r.endedPerSec,
        DELAY_CPU: 100 * r.delay.cpu,
        DELAY_ZIIP: 100 * r.delay.ziip,
        DELAY_IO: 100 * r.delay.io,
        DELAY_CAP: 100 * r.delay.cap,
        DELAY_OTHER: 100 * r.delay.other,
      };
      const value = v[req.metric];
      if (value === undefined || value === null) return 'That metric is not in this view';
      return { source: req.metric.startsWith('DELAY') ? 'DELAY' : 'SYSINFO', metric: req.metric, subject: req.scKey, system: req.system, tick: sim.tick, value };
    }
    case 'CPC': {
      const c = buildMon3(run, scenario).cpc.find((x) => x.lparId === req.lparId);
      if (!c) return 'No such LPAR';
      return { source: 'CPC', metric: req.metric, subject: req.lparId, system: req.lparId, tick: sim.tick, value: req.metric === 'CAPPED' ? c.cappedPct : c.prsmDelayPct };
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
      const v: Partial<Record<EvidenceMetric, number | null>> = { CPU_VS_BASE: r.cpuVsBaseline, QR_WAIT: r.qrWaitMs, MXT_WAIT: r.mxtWaitMs, ENDED_RATE: r.txnPerSec };
      const value = v[req.metric];
      if (value === undefined || value === null) return 'That metric is not in CICS monitoring';
      return { source: 'CICS 110', metric: req.metric, subject: req.workloadId, system: '*PLEX', tick, value };
    }
  }
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

export function pinText(p: Located): string {
  return `${p.source} ${formatClock(p.tick).slice(-8, -3)} ${p.system !== p.subject && p.system !== '*PLEX' ? `${p.system} ` : ''}${p.subject} ${EVIDENCE_METRICS[p.metric].label.replace(/ %$/, '')} ${fmtValue(p.metric, p.value)}`;
}

export function addPin(run: RunState, scenario: Scenario, req: PinRequest): { run: RunState; ok: boolean; message: string } {
  const loc = locate(run, scenario, req);
  if (typeof loc === 'string') return { run, ok: false, message: loc };
  const pins = run.pins ?? [];
  if (pins.some((p) => p.source === loc.source && p.metric === loc.metric && p.subject === loc.subject && p.system === loc.system && p.tick === loc.tick)) return { run, ok: false, message: 'Already pinned' };
  const pin: EvidencePin = { ...loc, id: run.nextId, text: pinText(loc) };
  // Oldest pins fall off the board.
  const kept = [...pins, pin].slice(-EVIDENCE.maxPins);
  return { run: { ...run, pins: kept, nextId: run.nextId + 1 }, ok: true, message: `Pinned: ${pin.text}` };
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
  const sc = w ? classify(run.sim.wlm.definition, w.work).serviceClass : null;
  const lpars = Object.keys(run.sim.routing[inc.workloadId] ?? w?.routing ?? {});
  const lo = inc.startTick - EVIDENCE.windowHours * TICKS_PER_HOUR;
  const hi = (inc.endTick ?? run.sim.tick) + EVIDENCE.windowHours * TICKS_PER_HOUR;
  return pins.map((p) => {
    const d = EVIDENCE_METRICS[p.metric];
    const base = { pinId: p.id, text: p.text };
    if (p.tick < lo || p.tick > hi) return { ...base, relevance: 0, why: 'outside the incident window' };
    const related =
      d.anySubject ||
      p.subject === inc.workloadId ||
      (sc !== null && (p.subject === sc || p.subject.startsWith(`${sc}#`))) ||
      lpars.includes(p.subject) ||
      p.subject === '*PLEX';
    if (!related) return { ...base, relevance: 0, why: `not about ${inc.workloadId}` };
    if (d.weight === 0) return { ...base, relevance: 0, why: 'a symptom, not a cause' };
    if (Math.abs(p.value) < d.notableAt) return { ...base, relevance: 0, why: 'value is unremarkable' };
    const hit = d.mechanisms.includes(inc.truth.mechanism) || d.triggers.includes(inc.truth.trigger);
    return hit ? { ...base, relevance: d.weight, why: d.weight < 1 ? 'consistent with the cause (but not specific)' : 'points at the cause' } : { ...base, relevance: 0, why: 'points elsewhere' };
  });
}
