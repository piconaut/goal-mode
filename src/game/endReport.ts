import { BEST_GRADE_WITHOUT_VICTORY, GRADE_BANDS, GRADE_SLA, GRADE_WEIGHTS } from '../content/endReport';
import type { RunState } from './types';

export interface EndReport {
  daysPlayed: number;
  victory: boolean;
  grade: 'S' | 'A' | 'B' | 'C' | 'D';
  points: number;
  meanSlaPct: number;
  overallTrust: number;
  /** One row per played day: score, worst SLA, peak R4HA sum and critical batch end. */
  days: { day: number; score: number; worstSlaPct: number; peakR4haSum: number | null; batchMissed: boolean }[];
  /** Applied changes in order (the decisions timeline). */
  decisions: { day: number; label: string; emergency: boolean }[];
  biggestIncident: { workloadId: string; day: number; hours: number; cause: string } | null;
  bestRca: { workloadId: string; day: number; points: number; cause: string } | null;
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const words = (id: string) => id.toLowerCase().replace(/_/g, ' ');
const causeOf = (m: string, t: string) => `${words(m)} (${words(t)})`;

export function gradeFor(daysFrac: number, victory: boolean, meanSlaPct: number, overallTrust: number) {
  const points =
    GRADE_WEIGHTS.survival * (victory ? 1 : clamp01(daysFrac)) +
    GRADE_WEIGHTS.sla * clamp01((meanSlaPct - GRADE_SLA.floorPct) / (GRADE_SLA.fullPct - GRADE_SLA.floorPct)) +
    GRADE_WEIGHTS.trust * clamp01(overallTrust / 100);
  const cap = victory ? 0 : GRADE_BANDS.findIndex((b) => b.grade === BEST_GRADE_WITHOUT_VICTORY);
  const grade = GRADE_BANDS.slice(cap).find((b) => points >= b.minPoints)!.grade;
  return { points: Math.round(points), grade };
}

/** End-of-run summary (SPEC §11.2) from the run's own records; pure, so it also works for bots and tests. */
export function endReport(run: RunState, overallTrust: number): EndReport {
  const reports = run.reports;
  const allSla = reports.flatMap((r) => r.sla.map((s) => s.attainmentPct));
  const meanSlaPct = allSla.length > 0 ? allSla.reduce((a, b) => a + b, 0) / allSla.length : 100;
  const victory = run.phase === 'VICTORY';
  const daysPlayed = reports.length;
  const cap = new Map((run.capacityDays ?? []).map((c) => [c.day, c.peakR4haSum]));
  const days = reports.map((r) => ({
    day: r.day,
    score: r.score,
    worstSlaPct: r.sla.reduce((a, s) => Math.min(a, s.attainmentPct), 100),
    peakR4haSum: cap.get(r.day) ?? null,
    batchMissed: r.batchMissed,
  }));
  const decisions = run.changes
    .filter((c) => c.status === 'APPLIED')
    .map((c) => ({ day: c.activateDay, label: c.label, emergency: c.emergency }))
    .sort((a, b) => a.day - b.day);
  let biggestIncident: EndReport['biggestIncident'] = null;
  let bestRca: EndReport['bestRca'] = null;
  for (const i of run.incidents) {
    if (!biggestIncident || i.hours > biggestIncident.hours)
      biggestIncident = { workloadId: i.workloadId, day: i.day, hours: i.hours, cause: causeOf(i.truth.mechanism, i.truth.trigger) };
    const pts = (i.rca?.points ?? 0) + (i.rca?.evidencePoints ?? 0);
    if (i.rca && pts > 0 && (!bestRca || pts > bestRca.points)) bestRca = { workloadId: i.workloadId, day: i.day, points: pts, cause: causeOf(i.truth.mechanism, i.truth.trigger) };
  }
  const { points, grade } = gradeFor(daysPlayed / run.maxDays, victory, meanSlaPct, overallTrust);
  return { daysPlayed, victory, grade, points, meanSlaPct, overallTrust, days, decisions, biggestIncident, bestRca };
}
