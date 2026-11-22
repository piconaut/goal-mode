import type { AdjustContext } from './context';

export function selectCandidates({ input, info, tickOf, localPi }: AdjustContext) {
  const { system } = input;
  // APPROX: only periods missing their goals are receivers. IBM's last case, a period meeting its goal (largest PI
  // first, SG24-6472-03, March 2008, PDF p.63 (printed 45)), is not modelled, so the ladder stays as it is while every period meets its goal.
  const ordered = (piOf: Record<string, number | null>) =>
    Object.keys(info)
      .filter((k) => (piOf[k] ?? 0) > 1 && tickOf[k])
      .sort((a, b) => info[a]!.importance - info[b]!.importance || (piOf[b] ?? 0) - (piOf[a] ?? 0) || (a < b ? -1 : 1));

  const tried = new Set<string>();
  const global = ordered(input.sysplexPi as Record<string, number | null>);
  const local = ordered(localPi);
  const candidates = [1, 2, 3, 4, 5].flatMap((importance) => [
    ...global.filter((k) => info[k]!.importance === importance),
    ...local.filter((k) => info[k]!.importance === importance),
  ]).filter((k) => {
    if (tried.has(k)) return false;
    tried.add(k);
    return true;
  });
  // A search the budget stopped resumes at the receiver it stopped on, then wraps to the top, so receivers behind a
  // run of hopeless ones are reached in turn (I12). APPROX: real WLM assesses every receiver each interval.
  const resumeKey = system.scps.find((s) => s.resumeSearch)?.scKey ?? null;
  const start = resumeKey === null ? -1 : candidates.indexOf(resumeKey);
  if (start > 0) candidates.push(...candidates.splice(0, start));
  const resumedAt = start >= 0 ? resumeKey : null;
  /** The candidate after `k` in this interval's order, wrapping: where the next search starts when the budget is
   * spent and no skip clock is available to step over the receiver that spent it (RF-03). */
  const nextCandidateAfter = (k: string): string | null => {
    const i = candidates.indexOf(k);
    return i < 0 ? null : (candidates[(i + 1) % candidates.length] ?? null);
  };
  return { candidates, resumedAt, nextCandidateAfter };
}
