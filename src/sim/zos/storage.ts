// Real storage per image (SPEC §5.8): over-commitment produces paging delay.

/** FICTIONAL: paging delay fraction grows with the over-commitment ratio. */
export function pagingDelayFrac(demandGb: number, memoryGb: number): number {
  if (memoryGb <= 0) return 0.5;
  const over = Math.max(0, demandGb - memoryGb) / memoryGb;
  return Math.min(0.6, 2.5 * over);
}
