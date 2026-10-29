// Workload and address-space content types (SPEC §5.2, §5.6).

import type { SubsystemType, WorkAttributes } from '../wlm/types';
import type { RoutingPolicy } from './routing';

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
  /** Optional traffic bursts on top of the smooth curve (trading floors, news, bots). */
  bursts?: BurstShape;
}

export interface ScheduledBurst {
  /** Wall-clock start hour (fractional). */
  hour: number;
  /** Rate multiplier at the start; decays linearly to 1 over durationSec. */
  heightMult: number;
  durationSec: number;
  weekdaysOnly: boolean;
}

export interface BurstShape {
  /** Expected random bursts per hour (seeded per tick). */
  ratePerHour: number;
  /** A random burst's flat multiplier and length are drawn uniformly from these ranges. */
  heightMult: [number, number];
  durationSec: [number, number];
  /** Fixed-time bursts, e.g. a market open. */
  scheduled: ScheduledBurst[];
}

export interface WorkloadDef {
  id: string;
  name: string;
  /** Which business stakeholder owns the SLA ('Internal' = none; scenarios name the rest). */
  stakeholder: string;
  work: WorkAttributes;
  subsystem: SubsystemType;
  /** Region role the transactions' CPU is consumed in ('CICS.AOR'); a resource group on that region's class
   *  caps them (WLM Planning p.60 note 1). Unset for DDF, which runs in enclaves under its own class. */
  hostRole?: string;
  /** Peak arrival rate on day 1, transactions per second. */
  peakRatePerSec: number;
  shape: ArrivalShape;
  /** Compounded growth per played day. */
  growthPerDay: number;
  /** AR(1) log-noise: stationary σ and per-tick autocorrelation. */
  noiseSigma: number;
  noisePhi: number;
  /** Share of arrivals per LPAR (sysplex distributor / CICSPlex SM routing); its keys are the candidate systems. */
  routing: Record<string, number>;
  /** How shares are set; default STATIC (the routing above, changed only by the player). */
  routingPolicy?: RoutingPolicy;
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
  /** Message-driven work: requests wait on an MQ queue (no timeout) and puts fail only past MAXDEPTH. */
  mq?: { queue: string; maxDepthMsgs: number; msgBytes: number };
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
