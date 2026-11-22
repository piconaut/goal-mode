import type { CpuGrant, CpuWait } from '../sim/core/types';

/** Add reporting records without mutating either snapshot. Missing pre-RT-16 records contribute no samples. */
export function sumRecords<T>(a: Record<string, T> | undefined, b: Record<string, T> | undefined, add: (a: T | undefined, b: T) => T): Record<string, T> {
  const out = { ...a };
  if (b) for (const k in b) out[k] = add(out[k], b[k]!);
  return out;
}

export const sumCpuGrants = (a: Record<string, CpuGrant> | undefined, b: Record<string, CpuGrant> | undefined): Record<string, CpuGrant> =>
  // Earlier RT-16 saves lack iipcp in existing rows: start from zero, without reconstructing past grants.
  sumRecords(a, b, (a, b) => ({ cp: (a?.cp ?? 0) + b.cp, ziip: (a?.ziip ?? 0) + b.ziip, iipcp: (a?.iipcp ?? 0) + (b.iipcp ?? 0) }));

export const sumCpuWaits = (a: Record<string, CpuWait> | undefined, b: Record<string, CpuWait> | undefined): Record<string, CpuWait> =>
  sumRecords(a, b, (a, b) => ({ cp: (a?.cp ?? 0) + b.cp, ziip: (a?.ziip ?? 0) + b.ziip, backlog: (a?.backlog ?? 0) + b.backlog, completions: (a?.completions ?? 0) + b.completions }));

/** Add a tick's grants to rows owned by the active advance. */
export function accumulateCpuGrant(a: CpuGrant, cp: number, ziip: number, iipcp: number): void {
  a.cp += cp;
  a.ziip += ziip;
  a.iipcp = (a.iipcp ?? 0) + iipcp;
}

export function accumulateCpuGrants(into: Record<string, CpuGrant>, from: Record<string, CpuGrant>): void {
  for (const key in from) {
    const grant = from[key]!;
    const row = (into[key] ??= { cp: 0, ziip: 0, iipcp: 0 });
    accumulateCpuGrant(row, grant.cp, grant.ziip, grant.iipcp ?? 0);
  }
}

export function accumulateCpuWaits(into: Record<string, CpuWait>, from: Record<string, CpuWait>): void {
  for (const key in from) {
    const wait = from[key]!;
    const row = (into[key] ??= { cp: 0, ziip: 0, backlog: 0, completions: 0 });
    row.cp += wait.cp;
    row.ziip += wait.ziip;
    row.backlog += wait.backlog;
    row.completions += wait.completions;
  }
}

type CapSamples = { cap: number; samples: number };
export const sumCapSamples = (a: Record<string, CapSamples> | undefined, b: Record<string, CapSamples> | undefined): Record<string, CapSamples> =>
  sumRecords(a, b, (a, b) => ({ cap: (a?.cap ?? 0) + b.cap, samples: (a?.samples ?? 0) + b.samples }));
