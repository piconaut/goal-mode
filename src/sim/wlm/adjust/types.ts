import type { LparEvalInput, ScpTick } from '../evaluate';
import type { BatchProjectionSlice } from '../batchProjection';
import type { WlmSystemState } from '../runtime';
import type { ServiceDefinition } from '../types';

export interface AdjustInput {
  def: ServiceDefinition;
  system: WlmSystemState;
  /** This tick's evaluation input; dpOf is replaced during projection. */
  evalInput: Omit<LparEvalInput, 'dpOf'>;
  current: readonly ScpTick[];
  sysplexPi: Readonly<Record<string, number | null>>;
  clockText: string;
  /** IEAOPT CCIMP on this system. */
  ccImp?: number;
  /** This interval's tick: skip clocks are compared with it and set from it (absent = 0). */
  nowTick?: number;
  /** Measured demand and next-tick demand already enabled by execution's grants. */
  batch?: readonly BatchProjectionSlice[];
}

export interface AdjustOutput {
  /** Every goal period's DP (a served period's is its holder's), and the server period's (`servers`). */
  dps: Record<string, number>;
  /** The image's server period after this interval (holders.ts), absent with none. */
  servers?: { key: string; dp: number }[];
  log: string | null;
  /** DPs lowered to restore long-term CPU protection before any receiver was assessed. */
  protect: string | null;
  /** Skip clocks still running after this interval (period → first tick it may be assessed again). */
  skipUntil: Record<string, number>;
  /** Where the next interval's search starts (`ScpState.resumeSearch`): set when the projection budget stopped this
   * one, kept when a move was accepted, null once a search reached the end of the list. */
  resumeAt: string | null;
  /** First rejection notes when a receiver starts a skip clock, including off the periodic log cadence; at five or
   * fewer missing, every rejected receiver's note at the five-minute cadence (RF-03). */
  clockNotes: string[];
}
