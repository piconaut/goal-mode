// FICTIONAL: end-of-run grade (SPEC §11.2). Survival dominates, then service quality, then goodwill; a run that
// ended early is capped at B so closing the quarter is always worth more than a polished early exit.
export const GRADE_WEIGHTS = { survival: 40, sla: 35, trust: 25 } as const;

/** Mean SLA attainment at or below `floorPct` earns nothing; `fullPct` or above earns the full weight. */
export const GRADE_SLA = { floorPct: 95, fullPct: 99.5 } as const;

/** Minimum points (of 100) per grade, best first. */
export const GRADE_BANDS: readonly { grade: 'S' | 'A' | 'B' | 'C' | 'D'; minPoints: number }[] = [
  { grade: 'S', minPoints: 92 },
  { grade: 'A', minPoints: 80 },
  { grade: 'B', minPoints: 65 },
  { grade: 'C', minPoints: 50 },
  { grade: 'D', minPoints: 0 },
];

export const BEST_GRADE_WITHOUT_VICTORY = 'B' as const;
