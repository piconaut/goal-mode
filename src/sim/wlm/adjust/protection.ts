import { canonical, ladderOf, levelOf, moveToLevel, type Ladder } from '../ladder';
import type { ScpGoalInfo } from '../runtime';

/** CPU-protected periods: CPU Critical, or a first or only period at or above the CCIMP importance. */
export const cpuProtected = (g: Pick<ScpGoalInfo, 'cpuCritical' | 'period' | 'importance'>, ccImp: number): boolean =>
  g.cpuCritical || (g.period === 0 && g.importance <= ccImp);

/** The DPs of `dps` with its goal periods (`keys`) on `ladder`'s canonical DPs; other periods keep theirs. */
export const withLadder = (dps: Readonly<Record<string, number>>, ladder: Ladder): Record<string, number> => ({ ...dps, ...canonical(ladder) });

/** The ladder of the goal periods `keys` at `dps`. */
export const ladderAt = (dps: Readonly<Record<string, number>>, keys: readonly string[]): Ladder => {
  const goal: Record<string, number> = {};
  for (const k of keys) if (dps[k] !== undefined) goal[k] = dps[k]!;
  return ladderOf(goal);
};

/**
 * Make the goal periods' DPs canonical (docs/wlm-design.md §5.6; an old save's are on the first interval, order kept)
 * and restore long-term CPU protection: every period less important than a protected period goes to a new level
 * directly below the lowest protected level above it. WLM enforces the protection rather than refusing to manage
 * (WLM Planning 3.1, PDF p.120 (printed 100): "less important work will generally have a lower dispatch priority"). A policy activation can break
 * it (CPU Critical newly set while batch holds a DP it earned under the old policy); DPs carry over by period. APPROX:
 * the less important period is lowered rather than the protected one raised, so the protection costs only the work
 * it is meant to cost. Importance order makes one pass enough: a protected period's level is final before any less
 * important period is checked against it.
 */
export function enforceCpuProtection(
  dps: Readonly<Record<string, number>>,
  info: Readonly<Record<string, Pick<ScpGoalInfo, 'cpuCritical' | 'period' | 'importance'>>>,
  ccImp: number,
): { dps: Record<string, number>; moves: string[] } {
  const keys = Object.keys(info).filter((k) => dps[k] !== undefined).sort();
  let L = ladderAt(dps, keys);
  const moved: [string, string][] = [];
  // Everything moved below one protected level shares one new level there, whatever its importance (as one DP did).
  const belowOf: Record<string, string> = {};
  for (let imp = 2; imp <= 5; imp++) {
    // The lowest level holding a protected period more important than `imp`, named by a period on it.
    let floorKey: string | null = null;
    for (const k of keys) {
      if (info[k]!.importance < imp && cpuProtected(info[k]!, ccImp) && (floorKey === null || levelOf(L, k) > levelOf(L, floorKey))) floorKey = k;
    }
    if (floorKey === null) continue;
    for (const k of keys) {
      if (info[k]!.importance !== imp || levelOf(L, k) > levelOf(L, floorKey)) continue;
      const first = belowOf[floorKey];
      L = first === undefined ? moveToLevel(L, k, levelOf(L, floorKey), 'below') : moveToLevel(L, k, levelOf(L, first));
      belowOf[floorKey] ??= k;
      moved.push([k, floorKey]);
    }
  }
  const out = withLadder(dps, L);
  // Named by the DPs before and after all the moves: a protected period can itself be lowered before it is the floor
  // of a later move, so targets in any intermediate numbering would contradict each other.
  const moves = moved.map(([k, floorKey]) => `${k} DP ${hex(dps[k]!)}→${hex(out[k]!)} below ${floorKey}`);
  return { dps: out, moves };
}

export const hex = (n: number) => n.toString(16).toUpperCase();
