/** FNV-1a over the ISO date, folded to 0..999999 so it fits the same range as random seeds. */
export function dailySeed(isoDate: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < isoDate.length; i++) {
    h ^= isoDate.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % 1_000_000;
}

export interface ShareInput {
  seed: number;
  difficulty: string;
  daysPlayed: number;
  /** Quarter length; omit to print only the days played. */
  maxDays?: number;
  /** Days survived after the quarter closed (endless mode). */
  endlessDays?: number | null;
  grade: string;
  points: number;
  score: number;
  daily: string | null;
}

export function shareText(r: ShareInput): string {
  const parts = [
    'GOAL MODE',
    ...(r.daily ? [`daily ${r.daily}`] : []),
    r.difficulty,
    `seed ${r.seed}`,
    r.endlessDays != null ? `quarter closed + ${r.endlessDays} endless days` : `day ${r.daysPlayed}${r.maxDays !== undefined ? `/${r.maxDays}` : ''}`,
    `grade ${r.grade} (${r.points})`,
    `score ${r.score}`,
  ];
  return parts.join(' · ');
}
