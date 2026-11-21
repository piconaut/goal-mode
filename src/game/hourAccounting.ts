import type { CpuGrant, CpuWait } from '../sim/core/types';

/** Add reporting records without mutating either snapshot. Missing pre-RT-16 records contribute no samples. */
export function sumRecords<T>(a: Record<string, T> | undefined, b: Record<string, T> | undefined, add: (a: T | undefined, b: T) => T): Record<string, T> {
  const out = { ...a };
  if (b) for (const k in b) out[k] = add(out[k], b[k]!);
  return out;
}

export const sumCpuGrants = (a: Record<string, CpuGrant> | undefined, b: Record<string, CpuGrant> | undefined): Record<string, CpuGrant> =>
  sumRecords(a, b, (a, b) => ({ cp: (a?.cp ?? 0) + b.cp, ziip: (a?.ziip ?? 0) + b.ziip }));

export const sumCpuWaits = (a: Record<string, CpuWait> | undefined, b: Record<string, CpuWait> | undefined): Record<string, CpuWait> =>
  sumRecords(a, b, (a, b) => ({ cp: (a?.cp ?? 0) + b.cp, ziip: (a?.ziip ?? 0) + b.ziip, backlog: (a?.backlog ?? 0) + b.backlog, completions: (a?.completions ?? 0) + b.completions }));

type CapSamples = { cap: number; samples: number };
export const sumCapSamples = (a: Record<string, CapSamples> | undefined, b: Record<string, CapSamples> | undefined): Record<string, CapSamples> =>
  sumRecords(a, b, (a, b) => ({ cap: (a?.cap ?? 0) + b.cap, samples: (a?.samples ?? 0) + b.samples }));
