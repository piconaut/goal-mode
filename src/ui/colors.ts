/** Blue (overachieving) ↔ neutral ↔ orange/red (missing goal): colour-blind safe diverging scale. */
export function piColor(pi: number | null): string {
  if (pi === null) return 'var(--panel-2)';
  if (pi < 0.8) return 'rgba(88,166,255,0.35)';
  if (pi <= 1) return 'rgba(88,166,255,0.15)';
  if (pi <= 1.5) return 'rgba(240,136,62,0.35)';
  return 'rgba(255,107,107,0.55)';
}

export const seriesColor = (i: number) => `var(--series-${i + 1})`;
