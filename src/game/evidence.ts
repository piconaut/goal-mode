// RCA evidence (SPEC §10): pin data points from reports, attach up to three to an RCA, and score
// each against the incident's hidden truth, its time window and the work it hurt.

import { EVIDENCE, EVIDENCE_METRICS, JOB_DELAY_METRICS, type EvidenceMetric } from '../content/evidence';
import { CAPACITY_SETTING_FRAC } from '../content/hardware';
import { formatClock } from '../sim/core/clock';
import type { Scenario } from '../sim/core/scenario';
import { TICKS_PER_DAY, TICKS_PER_HOUR } from '../sim/core/units';
import { classify } from '../sim/wlm/classify';
import { buildMon3 } from './mon3';
import type { Mon3PinLookup, Mon3PinView } from './mon3PinHistory';
import { BATCH_INCIDENT } from './sla';
import type { NightSummary } from '../sim/subsys/batch';
import { cicsMonitoring, db2Accounting } from './smf';
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

/** The CLI's Monitor III history keeps PR/SM delay and capping per image only. */
const TRIM_HISTORY = 'This Monitor III range keeps PR/SM delay and capping only; pin a Partition Data interval';

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
      if (w.resourceSamples === false && (req.metric === 'APPL' || req.metric.startsWith('DELAY_')))
        return `CICS resource samples are reported with the regions' classes: ${w.workManager?.regionKeys.join(', ') ?? 'see the region service classes'}`;
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
      const value = v[req.metric];
      if (value === undefined || value === null) return 'That metric is not in the Workload Activity report';
      return { source: 'WLMGL', metric: req.metric, subject: req.scKey, system: req.system, tick: iv.endTick, value };
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
      if (r.resourceSamples === false && (req.metric === 'APPL' || req.metric.startsWith('DELAY_')))
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
      const view = req.metric.startsWith('DELAY') ? 'DELAY' : req.metric === 'APPL' ? 'PROCU' : req.system === '*PLEX' ? 'SYSSUM' : 'SYSINFO';
      return { source: view, metric: req.metric, subject: req.scKey, system: req.system, tick: m.tick, value };
    }
    case 'CPC': {
      const cpcId = run.sim.config.lpars.find((l) => l.id === req.lparId)?.cpcId ?? '';
      // SMF70CAI as a loss: the processor runs at this percentage below its normal setting.
      const capacityAdj = (id: string): number => {
        const c = sim.config.cpcs.find((x) => x.id === id);
        const peak = c?.peakCapacitySetting;
        if (!c || peak === undefined || CAPACITY_SETTING_FRAC[c.capacitySetting] >= CAPACITY_SETTING_FRAC[peak]) return 0;
        return Math.max(1, Math.round(100 - (100 * CAPACITY_SETTING_FRAC[c.capacitySetting]) / CAPACITY_SETTING_FRAC[peak]));
      };
      if (req.index !== undefined) {
        const iv = sim.rmf.intervals[req.index];
        const r = iv?.cpu.find((x) => x.lparId === req.lparId);
        if (!iv || !r) return 'No such Partition Data row';
        if (req.metric === 'CPC_BUSY' || req.metric === 'CAPACITY_ADJ') {
          const c = iv.cpcBusy.find((x) => x.cpcId === cpcId && x.pool === 'CP');
          if (!c) return 'No such CPC row';
          const value = req.metric === 'CPC_BUSY' ? c.physicalBusyPct : 100 - (c.capacityAdjustmentPct ?? 100);
          return { source: 'CPC', metric: req.metric, subject: cpcId, system: cpcId, tick: iv.endTick, value };
        }
        const value = req.metric === 'CAPPED' ? r.cappedPct : req.metric === 'LPAR_BUSY' ? r.logicalBusyPct : r.prsmDelayPct;
        return { source: 'CPC', metric: req.metric, subject: req.lparId, system: req.lparId, tick: iv.endTick, value };
      }
      const m = mon3(req.tick);
      if (typeof m === 'string') return m;
      const c = m.view.cpc.find((x) => x.lparId === req.lparId);
      if (!c) return 'No such LPAR';
      if (req.metric === 'LPAR_BUSY' && c.busyPct === undefined) return TRIM_HISTORY;
      if (req.metric === 'CPC_BUSY' || req.metric === 'CAPACITY_ADJ') {
        if (c.cpcId === undefined) return TRIM_HISTORY;
        // The CPC report's *CP row: physical utilisation summed over the box's partitions.
        const busy = m.view.cpc
          .filter((x) => x.cpcId === c.cpcId && x.kind === 'ZOS')
          .reduce((a, x) => a + (x.physLparPct ?? 0), 0);
        const value = req.metric === 'CPC_BUSY' ? busy : capacityAdj(c.cpcId);
        return { source: 'CPC', metric: req.metric, subject: c.cpcId, system: c.cpcId, tick: m.tick, value };
      }
      const value = req.metric === 'CAPPED' ? c.cappedPct : req.metric === 'LPAR_BUSY' ? c.busyPct! : c.prsmDelayPct;
      return { source: 'CPC', metric: req.metric, subject: req.lparId, system: req.lparId, tick: m.tick, value };
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
  // Resource evidence on a CICS region class is evidence about its hosted transactions.
  if (w?.subsystem === 'CICS') for (const a of [...scenario.addressSpaces, ...run.sim.extraAddressSpaces]) {
    if (!lpars.includes(a.lparId) || (a.role !== 'CICS.AOR' && a.role !== 'CICS.TOR')) continue;
    if (a.role === 'CICS.AOR' && (routing[a.lparId] ?? 0) > 0) servers.push({ jobname: a.jobname, lparId: a.lparId });
    const sc = classify(run.sim.wlm.definition, { subsystem: a.subsystem, TN: a.jobname, SY: a.lparId }).serviceClass;
    if (sc && !classes.includes(sc)) classes.push(sc);
  }
  return { classes, lpars, hosts, servers };
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

function judgeEvidenceRanked(run: RunState, scenario: Scenario, inc: Incident, pins: readonly EvidencePin[]): RankedVerdict[] {
  // Judged against what the incident recorded when it opened (RT-04), so a reclassification or rerouting after the
  // fact keeps the verdicts a player would have got at the time; incidents from old saves derive them now.
  const { classes, lpars, hosts: hostLpars, servers } = inc.subjects ?? incidentSubjects(run, scenario, inc.workloadId, inc.day);
  // CPC-level pins (busy, capacity adjustment) relate through the images of the incident that sit on the processor.
  const cpcOfImage = (lparId: string) => run.sim.config.lpars.find((l) => l.id === lparId)?.cpcId;
  const onIncidentCpc = (cpcId: string) => lpars.some((lparId) => cpcOfImage(lparId) === cpcId);
  const lo = inc.startTick - EVIDENCE.windowHours * TICKS_PER_HOUR;
  const hi = (inc.endTick ?? run.sim.tick) + EVIDENCE.windowHours * TICKS_PER_HOUR;
  return pins.map((p) => {
    const d = EVIDENCE_METRICS[p.metric];
    const result = (relevance: number, why: string, checksPassed: number): RankedVerdict => ({
      verdict: { pinId: p.id, text: p.text, relevance, why }, checksPassed,
    });
    if (p.tick < lo || p.tick > hi) return result(0, 'outside the incident window', 0);
    // An `anySubject` metric may name another class, but it must still come from an image the hurt work runs on (a
    // host image, not one it was routed away from) or a sysplex-wide row: a TSO or SYSTEM row on a test image says
    // nothing about an incident on the production images. `*PLEX` has to stay open here (it is a roll-up of every
    // image, and the report views default to it), so the hole that remains is a `*PLEX` row for a class that only runs
    // elsewhere; RT-12's pin relations replace this test.
    const onImage = p.system === '*PLEX' || hostLpars.includes(p.system);
    const related = d.anySubject
      ? onImage
      : (d.cpcSubject === true && onIncidentCpc(p.subject)) ||
        p.subject === inc.workloadId ||
        (p.source === 'SYSWKM' && servers.some((a) => p.subject === a.jobname && p.system === a.lparId)) ||
        classes.some((sc) => p.subject === sc || p.subject.startsWith(`${sc}#`)) ||
        lpars.includes(p.subject) ||
        p.subject === '*PLEX';
    if (!related)
      return result(0, d.anySubject ? `not on a system ${inc.workloadId} runs on` : `not about ${inc.workloadId}`, 1);
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
