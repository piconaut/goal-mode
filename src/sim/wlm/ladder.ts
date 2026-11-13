// The DP ladder (docs/wlm-design.md §5.6): the goal periods of an image as an order of levels, top first. Policy
// adjustment changes the order; DPs are a function of it. After a priority change WLM remaps periods "such that there
// is an unoccupied priority between each occupied priority" (WLM Services p.139, priority unbunching), and its moves
// go to occupied or unoccupied priorities (action codes 530/540 for donors, 620/635 for receivers, p.706–707).

import { DP } from '../zos/dispatcher';

/** Levels from the top; each holds its periods' keys, sorted. */
export type Ladder = readonly (readonly string[])[];

/** Levels the managed range holds with a free priority between each and `MANAGED_MAX` itself free. */
export const MAX_LEVELS = Math.floor((DP.MANAGED_MAX - 1 - DP.MANAGED_MIN) / 2) + 1;

/** Level `i` from the top gets this DP. `MANAGED_MAX` is never occupied. */
export const levelDp = (i: number): number => DP.MANAGED_MAX - 1 - 2 * i;

/** Group periods by DP, highest first. Only the order of the DPs matters. */
export function ladderOf(dps: Readonly<Record<string, number>>): Ladder {
  const by = new Map<number, string[]>();
  for (const k of Object.keys(dps).sort()) {
    const d = dps[k]!;
    const lv = by.get(d);
    if (lv) lv.push(k);
    else by.set(d, [k]);
  }
  return [...by.keys()].sort((a, b) => b - a).map((d) => by.get(d)!);
}

/** The ladder's DPs. APPROX: more levels than the range holds merge from the bottom (no shipped policy has 22 active
 * goal periods on an image). */
export function canonical(ladder: Ladder): Record<string, number> {
  let L = ladder;
  if (L.length > MAX_LEVELS) {
    const merged = [...L.slice(MAX_LEVELS - 1)].flat().sort();
    L = [...L.slice(0, MAX_LEVELS - 1), merged];
  }
  const out: Record<string, number> = {};
  L.forEach((lv, i) => {
    for (const k of lv) out[k] = levelDp(i);
  });
  return out;
}

export const levelOf = (ladder: Ladder, holder: string): number => ladder.findIndex((lv) => lv.includes(holder));

const sorted = (lv: readonly string[]) => [...lv].sort();

/**
 * One step up: a period that shares its level moves alone to a new level directly above it (an unoccupied priority
 * between its level and the next); a period alone on its level joins the next level above. Alone on the top level:
 * no step (the same ladder is returned).
 */
export function raiseOneStep(ladder: Ladder, holder: string): Ladder {
  const i = levelOf(ladder, holder);
  if (i < 0) return ladder;
  if (ladder[i]!.length > 1) return moveToLevel(ladder, holder, i, 'above');
  if (i === 0) return ladder;
  return moveToLevel(ladder, holder, i - 1);
}

/**
 * Move a period onto level `level` of `ladder` ('join'), or alone onto a new level directly above or below it.
 * `level` is an index into `ladder` as given; levels the move empties are dropped.
 */
export function moveToLevel(ladder: Ladder, holder: string, level: number, where: 'join' | 'above' | 'below' = 'join'): Ladder {
  const out: string[][] = ladder.map((lv) => lv.filter((k) => k !== holder));
  if (where === 'join') out[level] = sorted([...out[level]!, holder]);
  else out.splice(where === 'above' ? level : level + 1, 0, [holder]);
  return out.filter((lv) => lv.length > 0);
}

/**
 * Where a period seen for the first time goes: the level of the lowest period of its importance; if there is none, a
 * new level directly below the lowest level that holds a more important period (the top if there is none). Placing
 * the periods of an empty image one by one gives one level per importance present, importance 1 on top, in any order.
 */
export function placeNew(ladder: Ladder, holder: string, importance: number, importanceOf: (k: string) => number | undefined): Ladder {
  const out: string[][] = ladder.map((lv) => lv.filter((k) => k !== holder)).filter((lv) => lv.length > 0);
  let same = -1;
  let above = -1;
  out.forEach((lv, i) => {
    for (const k of lv) {
      const imp = importanceOf(k);
      if (imp === importance) same = i;
      else if (imp !== undefined && imp < importance) above = i;
    }
  });
  if (same >= 0) out[same] = sorted([...out[same]!, holder]);
  else out.splice(above + 1, 0, [holder]);
  return out;
}
