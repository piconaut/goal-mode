// Workload and address-space content types (SPEC §5.2, §5.6).

import type { SubsystemType, WorkAttributes } from '../wlm/types';

export interface Peak {
  hour: number;
  height: number;
  widthHours: number;
}

export interface ArrivalShape {
  /** Rate multiplier outside peaks (fraction of peak rate). */
  floor: number;
  /** Gaussian bumps summed on top of the floor, normalised so the max hour ≈ 1. */
  peaks: Peak[];
  /** Day-of-week multipliers, Monday first. */
  weekly: [number, number, number, number, number, number, number];
  /** Calendar multipliers: payday (1st/15th) and month-end (last 2 days). */
  payday: number;
  monthEnd: number;
}

export interface WorkloadDef {
  id: string;
  name: string;
  /** Which business stakeholder owns the SLA. */
  stakeholder: 'Retail' | 'Cards' | 'Digital' | 'Payments' | 'Internal';
  work: WorkAttributes;
  subsystem: SubsystemType;
  /** Peak arrival rate on day 1, transactions per second. */
  peakRatePerSec: number;
  shape: ArrivalShape;
  /** Compounded growth per played day. */
  growthPerDay: number;
  /** AR(1) log-noise: stationary σ and per-tick autocorrelation. */
  noiseSigma: number;
  noisePhi: number;
  /** Share of arrivals per LPAR (sysplex distributor / CICSPlex SM routing). */
  routing: Record<string, number>;
  /** CPU per transaction in reference-engine milliseconds. */
  cpuMsRef: number;
  /** Log-σ of CPU per transaction (drives multi-period ageing). */
  cpuSigma: number;
  ziipFrac: number;
  ioPerTxn: number;
  /** Fixed non-CPU latency per transaction (network, think, downstream), seconds. */
  baseLatencySec: number;
  /** Log-σ of response time around its mean. */
  rtSigma: number;
  timeoutSec: number;
  /** Interactive users: think time closes the loop (slow responses reduce arrivals). */
  thinkTimeSec?: number;
  /** Fraction of timed-out requests that are retried. */
  retryFrac: number;
  /** Server roles this work depends on, with CPU charged to the server per transaction. */
  servers: { role: string; cpuMsRef: number; latencySec: number }[];
  /** SLA used by the game layer (not the WLM goal). */
  sla: { kind: 'PCT'; pct: number; rtSec: number } | { kind: 'AVG'; rtSec: number } | { kind: 'NONE' };
}

export interface AddressSpaceDef {
  /** Jobname, e.g. DB1AMSTR. Unique per LPAR. */
  jobname: string;
  lparId: string;
  /** Server role used by workloads' dependency lists, e.g. DB2.MSTR. */
  role: string | null;
  subsystem: 'STC' | 'JES';
  /** CPU this address space always needs, reference-engine count. */
  baseEnginesRef: number;
  ziipFrac: number;
}
