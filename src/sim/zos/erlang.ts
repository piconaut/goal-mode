// M/M/c queueing helpers for CPU and device queueing. APPROX: real z/OS dispatching
// is preemptive-priority and far more complex; Erlang-C captures the engine-count effect.

/** Erlang B blocking probability for c servers and offered load a (Erlangs). */
export function erlangB(c: number, a: number): number {
  let b = 1;
  for (let k = 1; k <= c; k++) b = (a * b) / (k + a * b);
  return b;
}

/** Erlang C probability of waiting, c integer servers, offered load a = c·ρ. */
export function erlangC(c: number, a: number): number {
  if (c <= 0) return 1;
  const rho = a / c;
  if (rho >= 1) return 1;
  const b = erlangB(c, a);
  return b / (1 - rho * (1 - b));
}

export const MAX_RHO = 0.995;

/**
 * Mean queueing delay as a multiple of mean service time (Wq / S) for an M/M/c queue
 * at utilisation ρ. ρ is clamped below 1; overload is handled as backlog by callers.
 */
export function queueDelayRatio(servers: number, rho: number): number {
  const c = Math.max(1, Math.round(servers));
  const r = Math.min(Math.max(rho, 0), MAX_RHO);
  if (r <= 0) return 0;
  return erlangC(c, c * r) / (c * (1 - r));
}
