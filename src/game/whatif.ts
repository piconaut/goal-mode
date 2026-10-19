// What-if simulator (tool WHAT_IF, SPEC §8 tier 3): fork the run at the briefing and play today
// headlessly with and without a proposal. The fork has no hidden events and a re-seeded noise
// stream, so it forecasts with the arrival model only and can't leak the real day.

import { seedRng } from '../sim/core/rng';
import type { Command } from '../sim/core/commands';
import type { RunState } from './types';
import { startDay, type GameContent } from './run';

export interface WhatIfSummary {
  sla: { workloadId: string; target: string; attainmentPct: number; breachHours: number }[];
  breachHours: number;
  incidents: number;
  criticalEndSec: number | null;
  batchMissed: boolean;
  peakR4haSum: number;
  peakCpcBusyPct: number;
  mlcEstimate: number;
}

/** Content for forks: no event deck, so nothing hidden is drawn or started. */
export const whatIfContent = (content: GameContent): GameContent => ({ ...content, events: [] });

/** A briefing-time fork with today's planned changes applied (no failure rolls) plus the proposal. */
export function forkForWhatIf(run: RunState, content: GameContent, proposal: readonly Command[]): RunState {
  const f = structuredClone(run);
  const planned = f.changes.filter((c) => c.status === 'PLANNED' && c.activateDay === f.day);
  const fork: RunState = {
    ...f,
    events: [],
    // Re-seeded noise: same arrival model, different draw from the real day.
    sim: { ...f.sim, rng: seedRng((f.seed ^ 0x2f6b9e1d ^ (f.day * 7919)) >>> 0) },
    changes: f.changes.map((c) => (planned.includes(c) ? { ...c, status: 'APPLIED' as const } : c)),
    pendingCommands: [...f.pendingCommands, ...planned.flatMap((c) => c.commands), ...structuredClone(proposal)],
    inbox: [],
  };
  return startDay(fork, whatIfContent(content));
}

export function summarizeWhatIf(fork: RunState): WhatIfSummary {
  const rep = fork.reports.at(-1);
  const cap = fork.capacityDays.at(-1);
  const sla = (rep?.sla ?? []).map((x) => ({ workloadId: x.workloadId, target: x.target, attainmentPct: x.attainmentPct, breachHours: x.breachHours }));
  return {
    sla,
    breachHours: sla.reduce((a, x) => a + x.breachHours, 0),
    incidents: fork.incidents.filter((i) => i.day === (rep?.day ?? fork.day)).length,
    criticalEndSec: rep?.batch?.criticalEndSec ?? null,
    batchMissed: rep?.batchMissed ?? false,
    peakR4haSum: cap?.peakR4haSum ?? 0,
    peakCpcBusyPct: cap?.peakCpcBusyPct ?? 0,
    mlcEstimate: rep?.mlcEstimate ?? 0,
  };
}
