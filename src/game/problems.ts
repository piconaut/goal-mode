// Problem records (RT-22, docs/rca-design.md §5.1): a diagnosis the player opens on a subject and a window, for the
// cards, standing faults and quiet regressions that never page. An incident is the record the game opened; this
// module judges a player's record with the same truth rules and the same recipe judge, and prices the anti-fishing
// limits of §5.4. It unlocks no fix: D1's gating (RT-24) is still a separate decision (Q8b).

import { PROBLEM, triggerLabel } from '../content/rca';
import type { GameContent } from '../content/types';
import { classify } from '../sim/wlm/classify';
import { formatClock } from '../sim/core/clock';
import { TICKS_PER_HOUR } from '../sim/core/units';
import { judgeGroupEvidence, smfHourEndTick } from './evidence';
import { clampTrust, facetOf, logLine } from './run/shared';
import { spendHours } from './run/changes';
import { creditedEpisode } from './run/rca';
import { allWorkloads } from './workloads';
import { EVIDENCE, PROOF } from '../content/evidence';
import { MECHANISMS, TRIGGERS, scoreAccepted } from './sla';
import { judgeProof, pinVerdictLines, proofLines } from './proof';
import { BATCH_INCIDENT } from './sla';
import { incidentSubjects } from './evidence';
import { idText } from './ids';
import type {
  Facet,
  Incident,
  IncidentTruth,
  Mechanism,
  ProblemCandidate,
  ProblemFiling,
  ProblemRecord,
  ProblemSubject,
  ProblemTruth,
  ProblemWindow,
  RunState,
  Trigger,
} from './types';
import type { Scenario } from '../sim/core/scenario';
import type { WorkloadDef } from '../sim/workload/types';

/** An absolute clock-hour index: the played day starts at 06:00, so 05 and the next day's 06 are adjacent. */
const absHour = (day: number, hourOfDay: number): number => day * 24 + ((hourOfDay - 6 + 24) % 24);

/** One closed clock hour the reports still hold, as a window endpoint. */
export interface ProblemHour {
  key: string;
  day: number;
  hourOfDay: number;
  startTick: number;
  endTick: number;
  label: string;
}

export const problemHours = (run: RunState): ProblemHour[] => {
  const hours = run.smfHours ?? [];
  return hours.map((h, i) => {
    const endTick = smfHourEndTick(run, i);
    return {
      key: `${h.day}:${h.hourOfDay}`,
      day: h.day,
      hourOfDay: h.hourOfDay,
      startTick: endTick - TICKS_PER_HOUR,
      endTick,
      label: `D${h.day + 1} ${String(h.hourOfDay).padStart(2, '0')}:00`,
    };
  });
};

/** The window from two half-open ticks on closed-hour boundaries, or the reason it is not one. */
export function problemWindowOf(run: RunState, fromTick: number, toTick: number): ProblemWindow | string {
  if (toTick <= fromTick) return 'The window must be at least one closed clock hour';
  const hours = problemHours(run);
  if (hours.length === 0) return 'No closed hours yet: finish an hour first';
  const fi = hours.findIndex((h) => h.startTick === fromTick);
  const ti = hours.findIndex((h) => h.endTick === toTick);
  if (fi < 0 || ti < 0 || ti < fi) return 'The window must be whole closed clock hours from the reports';
  const count = ti - fi + 1;
  if (count > PROBLEM.maxWindowHours) return `A record may cover at most ${PROBLEM.maxWindowHours} clock hours`;
  for (let i = fi; i <= ti; i++) {
    if (hours[i]!.startTick !== fromTick + (i - fi) * TICKS_PER_HOUR) return 'The window must be consecutive clock hours';
    if (i > fi && absHour(hours[i]!.day, hours[i]!.hourOfDay) !== absHour(hours[i - 1]!.day, hours[i - 1]!.hourOfDay) + 1) return 'The window must be consecutive clock hours';
  }
  const first = hours[fi]!;
  return { fromTick, toTick, day: first.day, hourOfDay: first.hourOfDay, hours: count };
}

export const problemWindowLabel = (w: ProblemWindow): string =>
  `${formatClock(w.fromTick).replace(/:00$/, '')}–${formatClock(w.toTick).replace(/:00$/, '')} (${w.hours} h)`;

export const subjectLabel = (subject: ProblemSubject, workloads: readonly WorkloadDef[] = []): string => {
  if (subject.kind === 'WORKLOAD') {
    const w = workloads.find((x) => x.id === subject.id);
    return `workload ${w ? `${w.name} (${subject.id})` : subject.id}`;
  }
  if (subject.kind === 'CLASS') return `class ${subject.id}`;
  if (subject.kind === 'IMAGE') return `image ${subject.id}`;
  return `job ${subject.id}`;
};

/** The subject exists in this run (a record on a nonexistent class or image is a typo, not a no-problem window). */
export function subjectExists(run: RunState, scenario: Scenario, subject: ProblemSubject): boolean {
  const id = subject.id.trim();
  if (!id) return false;
  if (subject.kind === 'WORKLOAD') return allWorkloads(scenario, run).some((w) => w.id === id);
  if (subject.kind === 'IMAGE') return run.sim.config.lpars.some((l) => l.id === id);
  if (subject.kind === 'CLASS') {
    const [cls, period] = id.split('#');
    const c = run.sim.wlm.definition.classes.find((x) => x.id === cls);
    if (!c) return false;
    if (period === undefined) return true;
    const n = Number(period);
    return Number.isInteger(n) && n >= 1 && n <= c.periods.length;
  }
  return run.sim.batch.jobs.some((j) => j.def.name === id)
    || [...scenario.addressSpaces, ...run.sim.extraAddressSpaces].some((a) => a.jobname === id);
}

/** The workloads a subject covers, for facts, incidents and pin relations. APPROX: an image or a job covers the
 *  work routed to it; a CICS region covers its served transactions; a class covers the workloads classified into it
 *  (or, for a region class, the workloads it serves). */
export function subjectWorkloads(run: RunState, scenario: Scenario, subject: ProblemSubject): string[] {
  const workloads = allWorkloads(scenario, run);
  const hostsOf = (w: WorkloadDef) => Object.entries(run.sim.routing[w.id] ?? w.routing).filter(([, f]) => f > 0).map(([id]) => id);
  if (subject.kind === 'WORKLOAD') return workloads.some((w) => w.id === subject.id) ? [subject.id] : [];
  if (subject.kind === 'IMAGE') return workloads.filter((w) => hostsOf(w).includes(subject.id)).map((w) => w.id);
  if (subject.kind === 'CLASS') {
    const [cls, period] = subject.id.split('#');
    const n = period === undefined ? null : Number(period);
    return workloads.filter((w) => {
      const own = hostsOf(w).map((h) => classify(run.sim.wlm.definition, { ...w.work, SY: h }).serviceClass).filter((x): x is string => !!x);
      const classes = incidentSubjects(run, scenario, w.id, run.day).classes;
      if (!classes.includes(cls!) && !own.includes(cls!)) return false;
      if (n === null) return true;
      if (own.includes(cls!)) {
        const c = run.sim.wlm.definition.classes.find((x) => x.id === cls);
        return !!c && n >= 1 && n <= c.periods.length;
      }
      // A CICS region's class is a server class in `classes`; its first period is the one a record can name.
      return n === 1;
    }).map((w) => w.id);
  }
  // JOB: a batch job, or an address space. A CICS region covers the work it serves; a Db2 member the DDF work routed
  // there; TSO the TSO users; any other address space the work on its image.
  const batch = run.sim.batch.jobs.find((j) => j.def.name === subject.id);
  if (batch) return [BATCH_INCIDENT];
  const space = [...scenario.addressSpaces, ...run.sim.extraAddressSpaces].find((a) => a.jobname === subject.id);
  if (!space) return [];
  if (space.role === 'CICS.AOR' || space.role === 'CICS.TOR') return workloads.filter((w) => w.subsystem === 'CICS' && hostsOf(w).includes(space.lparId)).map((w) => w.id);
  if (space.role?.startsWith('DB2.')) return workloads.filter((w) => w.subsystem === 'DDF' && hostsOf(w).includes(space.lparId)).map((w) => w.id);
  return workloads.filter((w) => hostsOf(w).includes(space.lparId)).map((w) => w.id);
}

interface Found extends ProblemCandidate {
  /** The hour's end, for ordering; an incident still open counts as the window end. */
  endTick: number;
  /** An incident outranks a quiet hour at the same time. */
  incident: boolean;
}

const inWindow = (day: number, hourOfDay: number, win: ProblemWindow): boolean => {
  const h = absHour(day, hourOfDay);
  return h >= absHour(win.day, win.hourOfDay) && h < absHour(win.day, win.hourOfDay) + win.hours;
};

const overlap = (startTick: number, endTick: number | null, win: ProblemWindow, now: number): boolean =>
  startTick < win.toTick && (endTick ?? now) > win.fromTick;

/** A synthetic incident from a candidate hour, so the incident proof judge can read the record's window and
 *  subjects. Its id is negative: it never collides with a real incident or record. */
const candidateIncident = (record: Pick<ProblemRecord, 'id' | 'window'>, c: ProblemCandidate): Incident => ({
  id: -record.id,
  workloadId: c.workloadId,
  day: record.window.day,
  startTick: record.window.fromTick,
  endTick: record.window.toTick,
  hours: record.window.hours,
  worstAttainmentPct: 100,
  truth: c.truth,
  ...(c.basis ? { basis: c.basis } : {}),
  subjects: c.subjects,
  rca: null,
  trustLost: 0,
});

/** A job that ABENDed in the window with no incident or quiet hour behind it: JOB_FAILURE, application error or the
 *  policy that sent it where it could not run (RT-04's DSNE100I trigger). */
function jobAbendCandidate(run: RunState, scenario: Scenario, subject: ProblemSubject, win: ProblemWindow): Found | null {
  if (subject.kind !== 'JOB') return null;
  let j: (typeof run.sim.batch.jobs)[number] | undefined;
  let at: number | null = null;
  for (const x of run.sim.batch.jobs) {
    if (x.def.name !== subject.id || x.abended !== true) continue;
    const t = x.failTick ?? x.endTick;
    if (t === null || !overlap(t, t + 1, win, run.sim.tick)) continue;
    j = x;
    at = t;
    break;
  }
  if (!j || at === null) return null;
  const connect = j.failCode === 'DSNE100I';
  const trigger: Trigger = connect ? 'POLICY' : 'APPLICATION_ERROR';
  const truth: IncidentTruth = {
    mechanism: 'JOB_FAILURE',
    trigger,
    accepted: { mechanisms: ['JOB_FAILURE'], triggers: [trigger, ...(connect ? ['APPLICATION_ERROR' as Trigger] : ['POLICY' as Trigger])] },
    notes: connect ? { POLICY: 'the job class sent it to an image without Db2 (DSNE100I)' } : { POLICY: 'the job class or its setup may have caused the failure' },
    cause: `none:JOB_FAILURE:${j.lparId ?? ''}:${j.def.name}`,
  };
  return {
    workloadId: BATCH_INCIDENT,
    day: j.day,
    startTick: at,
    endTick: at,
    truth,
    subjects: incidentSubjects(run, scenario, BATCH_INCIDENT, j.day),
    incident: false,
  };
}

/** The window's truth and its candidate hours. A card that touches the subject is already baked into the hour's
 *  fact (the quiet-hour judge reads the footprint), so this reads facts and incidents side by side. */
export function problemTruthOf(run: RunState, scenario: Scenario, subject: ProblemSubject, workloads: readonly string[], win: ProblemWindow): { truth: ProblemTruth; candidates: ProblemCandidate[] } {
  const found: Found[] = [];
  for (const f of run.quietHours ?? []) {
    if (!workloads.includes(f.workloadId) || !inWindow(f.day, f.hourOfDay, win)) continue;
    found.push({ workloadId: f.workloadId, day: f.day, startTick: f.startTick, endTick: f.endTick, truth: f.truth, subjects: f.subjects, ...(f.basis ? { basis: f.basis } : {}), incident: false });
  }
  for (const inc of run.incidents) {
    if (!workloads.includes(inc.workloadId) || !overlap(inc.startTick, inc.endTick, win, run.sim.tick)) continue;
    // A job subject sees the night's BATCH incident only when that incident is about this critical job; a non-critical
    // job's own failure comes from `jobAbendCandidate`.
    if (subject.kind === 'JOB' && inc.workloadId === BATCH_INCIDENT) {
      const night = run.sim.batch.nights.find((n) => n.day === inc.day) ?? run.reports.find((r) => r.day === inc.day)?.batch;
      if (!night?.criticalAbended?.includes(subject.id)) continue;
    }
    found.push({ workloadId: inc.workloadId, day: inc.day, startTick: inc.startTick, endTick: inc.endTick ?? win.toTick, truth: inc.truth, subjects: inc.subjects, ...(inc.basis ? { basis: inc.basis } : {}), incident: true });
  }
  const abend = jobAbendCandidate(run, scenario, subject, win);
  if (abend) found.push(abend);
  // Newest first; an incident outranks a quiet hour at the same time.
  found.sort((a, b) => b.endTick - a.endTick || Number(b.incident) - Number(a.incident) || (a.workloadId < b.workloadId ? -1 : 1));
  if (found.length === 0) {
    return {
      truth: { mechanism: null, trigger: null, accepted: { mechanisms: [], triggers: [] }, cause: 'none:no-problem' },
      candidates: [],
    };
  }
  const mechanisms: Mechanism[] = [];
  const triggers: Trigger[] = [];
  const notes: Record<string, string> = {};
  const noteFrom: Record<string, string> = {};
  let nearMiss: Partial<Record<Mechanism, string>> | undefined;
  const multiple = new Set(found.map((x) => x.workloadId)).size > 1;
  for (const c of found) {
    for (const m of c.truth.accepted.mechanisms) if (!mechanisms.includes(m)) mechanisms.push(m);
    for (const t of c.truth.accepted.triggers) if (!triggers.includes(t)) triggers.push(t);
    for (const [answer, why] of Object.entries(c.truth.notes ?? {})) {
      if (notes[answer] !== undefined) continue;
      notes[answer] = why;
      noteFrom[answer] = c.workloadId;
    }
    if (!nearMiss && c.truth.nearMiss) nearMiss = c.truth.nearMiss;
  }
  const primary = found[0]!;
  const withFrom = Object.fromEntries(Object.entries(notes).map(([answer, why]) => [answer, multiple ? `${noteFrom[answer]}: ${why}` : why]));
  const candidates: ProblemCandidate[] = found.map(({ incident: _i, ...c }) => c);
  return {
    truth: {
      mechanism: primary.truth.mechanism,
      trigger: primary.truth.trigger,
      accepted: { mechanisms, triggers },
      ...(Object.keys(withFrom).length > 0 ? { notes: withFrom } : {}),
      ...(nearMiss ? { nearMiss } : {}),
      cause: primary.truth.cause,
    },
    candidates,
  };
}

/** The facet a filing's trust lands on: the primary hour's workload stakeholder, or the subject's first workload. */
function recordFacet(run: RunState, scenario: Scenario, subject: ProblemSubject, workloads: readonly string[], primary?: string): Facet | null {
  // An image or job subject with no hurt hour has no facet to blame (the entry's "or none"); a workload or class
  // subject has its own stakeholder even when the window is clean.
  if (!primary && (subject.kind === 'IMAGE' || subject.kind === 'JOB')) return null;
  const all = allWorkloads(scenario, run);
  const id = primary ?? workloads[0];
  const w = all.find((x) => x.id === id) ?? (subject.kind === 'WORKLOAD' ? all.find((x) => x.id === subject.id) : undefined);
  const facet = w ? facetOf(w) : null;
  return facet && facet in run.trust ? facet : null;
}

/** One record as the card and the CLI see it: the subject, the window and every filed diagnosis. The window's truth
 *  and its candidate hours stay on the run, not in the view, until a filing's reply reveals what it accepted. */
export interface ProblemRecordView {
  id: number;
  subject: ProblemSubject;
  subjectLabel: string;
  window: ProblemWindow;
  windowLabel: string;
  filings: ProblemFiling[];
  /** Filings used in the current played day, and when the next one is allowed (null when now). */
  attemptsToday: number;
  nextAt: string | null;
  canFile: boolean;
}

export interface ProblemsView {
  records: ProblemRecordView[];
  /** Everything a player can open a record on in this run. */
  subjects: { kind: ProblemSubject['kind']; id: string; label: string }[];
  hours: ProblemHour[];
  costHours: number;
  filingsPerDay: number;
  maxWindowHours: number;
}

export function problemsView(run: RunState, scenario: Scenario): ProblemsView {
  const workloads = allWorkloads(scenario, run);
  const classes = new Map<string, string>();
  for (const c of run.sim.wlm.definition.classes) {
    for (const [i] of c.periods.entries()) classes.set(`${c.id}#${i + 1}`, `${c.id} period ${i + 1}`);
  }
  const jobs = new Map<string, string>();
  for (const j of run.sim.batch.jobs) jobs.set(j.def.name, `batch job ${j.def.name}${j.def.critical ? ' (critical)' : ''}`);
  for (const a of [...scenario.addressSpaces, ...run.sim.extraAddressSpaces]) jobs.set(a.jobname, `address space ${a.jobname} (${a.lparId})`);
  const subjects: ProblemsView['subjects'] = [
    ...workloads.map((w) => ({ kind: 'WORKLOAD' as const, id: w.id, label: `${w.name} (${w.id})` })),
    ...[...classes].map(([id, label]) => ({ kind: 'CLASS' as const, id, label })),
    ...run.sim.config.lpars.map((l) => ({ kind: 'IMAGE' as const, id: l.id, label: `image ${l.id}` })),
    ...[...jobs].map(([id, label]) => ({ kind: 'JOB' as const, id, label })),
  ];
  const records: ProblemRecordView[] = [...(run.problemRecords ?? [])].reverse().map((record) => {
    const today = record.filings.filter((f) => f.day === run.day).length;
    const last = record.filings.at(-1);
    const nextTick = last ? last.tick + PROBLEM.refileHours * TICKS_PER_HOUR : null;
    const nextAt = nextTick !== null && nextTick > run.sim.tick ? formatClock(nextTick).replace(/:00$/, '') : null;
    return {
      id: record.id,
      subject: record.subject,
      subjectLabel: subjectLabel(record.subject, workloads),
      window: record.window,
      windowLabel: problemWindowLabel(record.window),
      filings: record.filings,
      attemptsToday: today,
      nextAt,
      canFile: today < PROBLEM.filingsPerDay && nextAt === null && run.hoursLeft >= PROBLEM.hours,
    };
  });
  return {
    records,
    subjects,
    hours: problemHours(run),
    costHours: PROBLEM.hours,
    filingsPerDay: PROBLEM.filingsPerDay,
    maxWindowHours: PROBLEM.maxWindowHours,
  };
}

/** Open a record on a subject and a whole-hour window. Opening is free; a filing costs hours (§5.4). */
export interface OpenProblemResult {
  run: RunState;
  ok: boolean;
  message: string;
  record?: ProblemRecord;
}

export function openProblemRecord(run: RunState, content: GameContent, scenario: Scenario, subject: ProblemSubject, fromTick: number, toTick: number): OpenProblemResult {
  if (run.phase === 'GAMEOVER' || run.phase === 'VICTORY') return { run, ok: false, message: 'The run is over; there is nothing to diagnose.' };
  const win = problemWindowOf(run, fromTick, toTick);
  if (typeof win === 'string') return { run, ok: false, message: win };
  if (!subjectExists(run, scenario, subject)) return { run, ok: false, message: `No such ${subject.kind.toLowerCase()} ${subject.id} in this run.` };
  const same = run.problemRecords?.find((r) => r.subject.kind === subject.kind && r.subject.id === subject.id && r.window.fromTick === fromTick && r.window.toTick === toTick);
  if (same) return { run, ok: false, message: `Problem ${idText('record', same.id)} already covers ${subjectLabel(subject, allWorkloads(scenario, run))} for ${problemWindowLabel(same.window)}; file on it instead of opening another.` };
  const workloads = subjectWorkloads(run, scenario, subject);
  if (workloads.length === 0) return { run, ok: false, message: `No work is visible for ${subjectLabel(subject, allWorkloads(scenario, run))} in this run.` };
  const { truth, candidates } = problemTruthOf(run, scenario, subject, workloads, win);
  const record: ProblemRecord = {
    id: run.nextId,
    subject,
    window: win,
    openedDay: run.day,
    openedTick: run.sim.tick,
    truth,
    candidates,
    filings: [],
  };
  let records = [...(run.problemRecords ?? []), record];
  if (records.length > PROBLEM.maxRecords) {
    // Drop the oldest record that has not been filed; a filed record is part of the run's history.
    const drop = records.findIndex((r) => r.filings.length === 0);
    records = drop >= 0 ? records.filter((_, i) => i !== drop) : records.slice(-PROBLEM.maxRecords);
  }
  const r = logLine(
    { ...run, problemRecords: records, nextId: run.nextId + 1 },
    `PROBLEM ${idText('record', record.id)} opened: ${subjectLabel(subject, allWorkloads(scenario, run))} ${problemWindowLabel(win)}`,
  );
  return {
    run: r,
    ok: true,
    message: `Problem ${idText('record', record.id)} opened on ${subjectLabel(subject, allWorkloads(scenario, run))} for ${problemWindowLabel(win)}. File a diagnosis on it (${PROBLEM.hours} h).`,
    record,
  };
}

export interface FileProblemResult {
  run: RunState;
  ok: boolean;
  message: string;
  filing?: ProblemFiling;
}

/** File one diagnosis on a record: the answer, the proof over the attached pins, and §5.4's cost and limits. */
export function fileProblemDiagnosis(
  run: RunState,
  content: GameContent,
  scenario: Scenario,
  recordId: number,
  mechanism: Mechanism,
  trigger: Trigger,
  evidenceIds: readonly number[] = [],
): FileProblemResult {
  const record = run.problemRecords?.find((r) => r.id === recordId);
  if (!record) return { run, ok: false, message: `No problem record ${idText('record', recordId)}` };
  if (!MECHANISMS.includes(mechanism) || !TRIGGERS.includes(trigger)) return { run, ok: false, message: `Mechanism one of ${MECHANISMS.join(' ')}; trigger one of ${TRIGGERS.join(' ')}` };
  const today = record.filings.filter((f) => f.day === run.day);
  if (today.length >= PROBLEM.filingsPerDay) return { run, ok: false, message: `Problem ${idText('record', record.id)} has had ${PROBLEM.filingsPerDay} filings today; try again tomorrow.` };
  const last = record.filings.at(-1);
  if (last && run.sim.tick - last.tick < PROBLEM.refileHours * TICKS_PER_HOUR) {
    const at = last.tick + PROBLEM.refileHours * TICKS_PER_HOUR;
    return { run, ok: false, message: `Problem ${idText('record', record.id)} may be filed again after ${formatClock(at).replace(/:00$/, '')}.` };
  }
  if (run.hoursLeft < PROBLEM.hours) return { run, ok: false, message: `A filing costs ${PROBLEM.hours} engineer-hours; ${run.hoursLeft.toFixed(2)} left.` };
  const pins = (run.pins ?? []).filter((p) => evidenceIds.includes(p.id)).slice(0, EVIDENCE.perRca);
  if (evidenceIds.length > 0 && pins.length !== evidenceIds.length) return { run, ok: false, message: `No pinned evidence ${evidenceIds.filter((id) => !pins.some((p) => p.id === id)).map((id) => idText('pin', id)).join(' ')}` };

  const accepted = record.truth.accepted;
  const mechanismAccepted = accepted.mechanisms.includes(mechanism);
  const triggerAccepted = accepted.triggers.includes(trigger);
  const points = scoreAccepted(accepted, { mechanism, trigger });
  const noProblem = record.truth.mechanism === null;
  // The cause a correct mechanism names: a window can hold several hours' causes; credit the one the answer matches.
  const matching = record.candidates.find((c) => c.truth.accepted.mechanisms.includes(mechanism))
    ?? record.candidates.find((c) => c.truth.accepted.triggers.includes(trigger))
    ?? (record.candidates[0] as ProblemCandidate | undefined);
  const cause = matching?.truth.cause ?? record.truth.cause;
  const episode = {
    cause,
    day: matching?.day ?? record.window.day,
    startTick: matching?.startTick ?? record.window.fromTick,
    endTick: matching?.endTick ?? record.window.toTick,
  };
  const duplicateOf = points > 0 ? creditedEpisode(run, episode) : null;
  const group = matching ? [candidateIncident(record, matching)] : [];
  const verdicts = group.length > 0 && pins.length > 0 ? judgeGroupEvidence(run, scenario, group, pins) : [];
  const judged = group.length > 0 && pins.length > 0 ? judgeProof(run, scenario, group, mechanism, trigger, pins) : null;
  const nearMiss = matching?.truth.nearMiss?.[mechanism] ?? record.truth.nearMiss?.[mechanism];
  const proof = judged
    ? {
        mechanism: { ...judged.mechanism, accepted: mechanismAccepted, ...(nearMiss ? { why: nearMiss } : {}) },
        trigger: { ...judged.trigger, accepted: triggerAccepted },
      }
    : undefined;
  const mechanismProven = mechanismAccepted && !!proof?.mechanism.complete;
  const mechanismShown = mechanismAccepted && !!proof?.mechanism.predicates.some((x) => x.met);
  const evidencePoints = duplicateOf === null && mechanismProven ? PROOF.recipePoints : duplicateOf === null && mechanismShown ? PROOF.partialPoints : 0;
  const strong = duplicateOf === null && mechanismProven && triggerAccepted && !!proof?.trigger.complete;
  const facet = recordFacet(run, scenario, record.subject, subjectWorkloads(run, scenario, record.subject), matching?.workloadId);
  const wrongToday = record.filings.some((f) => f.day === run.day && f.trust < 0);
  const trustDelta = duplicateOf !== null
    ? 0
    : points >= 3
      ? facet ? 1 : 0
      : points > 0
        ? facet ? 0.25 : 0
        : facet && !wrongToday ? -PROBLEM.wrongTrust : 0;
  const awarded = duplicateOf === null ? points + evidencePoints : 0;
  let r = spendHours(run, PROBLEM.hours);
  if (trustDelta !== 0 && facet && facet in r.trust) r = { ...r, trust: { ...r.trust, [facet]: clampTrust(r.trust[facet]! + trustDelta) } };
  if (awarded > 0) {
    r = {
      ...r,
      insight: r.insight + awarded + (strong ? EVIDENCE.strongInsight : 0),
      score: r.score + awarded,
    };
  }
  const filing: ProblemFiling = {
    day: run.day,
    tick: run.sim.tick,
    mechanism,
    trigger,
    points: awarded,
    ...(verdicts.length > 0 ? { evidence: verdicts } : {}),
    ...(evidencePoints > 0 ? { evidencePoints } : {}),
    ...(strong ? { strong } : {}),
    ...(proof ? { proof } : {}),
    trust: trustDelta,
    trustFacet: facet,
    ...(noProblem ? { noProblem: true as const } : {}),
    ...(duplicateOf !== null ? { duplicateOf: duplicateOf ?? 0 } : {}),
    cause,
    episode,
    reply: [],
  };
  filing.reply = problemReply(record, filing, {
    mechanismAccepted,
    triggerAccepted,
    mechanismProven,
    mechanismShown,
    duplicateOf,
    remaining: PROBLEM.filingsPerDay - today.length - 1,
    nextAt: run.sim.tick + PROBLEM.refileHours * TICKS_PER_HOUR,
    wrongToday,
  });
  const updated: ProblemRecord = { ...record, filings: [...record.filings, filing] };
  r = { ...r, problemRecords: (r.problemRecords ?? []).map((x) => (x.id === record.id ? updated : x)) };
  r = logLine(r, `PROBLEM ${idText('record', record.id)} filed: ${mechanism}/${triggerLabel(trigger)} → ${awarded > 0 ? `+${awarded}` : duplicateOf !== null ? 'no second credit' : 'no points'}`);
  return { run: r, ok: true, message: filing.reply.join('\n'), filing };
}

/** The reply, shared by the card and the play CLI. Every number comes from the filed claims and their proof. */
function problemReply(
  record: ProblemRecord,
  filing: ProblemFiling,
  facts: {
    mechanismAccepted: boolean;
    triggerAccepted: boolean;
    mechanismProven: boolean;
    mechanismShown: boolean;
    duplicateOf: number | null;
    remaining: number;
    nextAt: number;
    wrongToday: boolean;
  },
): string[] {
  const lines = [
    `Problem ${idText('record', record.id)} · ${subjectLabel(record.subject)} · ${problemWindowLabel(record.window)}`,
    filing.noProblem
      ? 'The window shows no problem: any mechanism or trigger is wrong.'
      : `Mechanism ${filing.mechanism} ${facts.mechanismAccepted ? 'accepted' : 'not accepted'}, trigger ${triggerLabel(filing.trigger)} ${facts.triggerAccepted ? 'accepted' : 'not accepted'}` +
        (record.truth.mechanism && (filing.mechanism !== record.truth.mechanism || filing.trigger !== record.truth.trigger)
          ? ` (primary ${record.truth.mechanism}/${triggerLabel(record.truth.trigger!)})`
          : ''),
    facts.duplicateOf !== null
      ? `Correct answer: 0 points, this episode already earned.`
      : filing.points > 0
        ? `Correct answer: ${filing.points} point${filing.points === 1 ? '' : 's'}${filing.evidencePoints ? ` (${filing.evidencePoints} from evidence)` : ''}.`
        : 'No points: the filed answer is not an accepted answer.',
  ];
  if (facts.duplicateOf !== null) lines.push(facts.duplicateOf > 0 ? `Same episode as #${facts.duplicateOf}: no second credit.` : 'This episode already earned a diagnosis: no second credit.');
  if (filing.trust !== 0 && filing.trustFacet) lines.push(`Trust ${filing.trust > 0 ? '+' : ''}${filing.trust} on ${filing.trustFacet}.`);
  else if (!filing.trustFacet) lines.push('No trust change: this subject has no stakeholder facet.');
  else if (filing.trust === 0 && !filing.noProblem && facts.duplicateOf === null) lines.push('No trust change.');
  if (facts.wrongToday && filing.points === 0 && facts.duplicateOf === null) lines.push('The wrong-answer trust loss was already taken on this record today.');
  if (filing.strong) lines.push(`Strong evidence: +${EVIDENCE.strongInsight} Insight.`);
  if (filing.proof) {
    lines.push(...proofLines(filing.proof, (id) => idText('pin', id)));
    const pinLines = pinVerdictLines(filing.proof, filing.evidence ?? [], (id) => idText('pin', id));
    if (pinLines.length > 0) lines.push(`Pins: ${pinLines.join('; ')}`);
  }
  lines.push(`Filing cost: ${PROBLEM.hours} engineer-hours. ${facts.remaining} filing${facts.remaining === 1 ? '' : 's'} left today; the next after ${formatClock(facts.nextAt).replace(/:00$/, '')}.`);
  return lines;
}
