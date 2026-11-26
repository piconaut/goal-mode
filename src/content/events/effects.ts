import type { GatewayMode, Operation } from '../../sim/core/operations';

export type EventEffect =
  | Extract<Operation, { kind: 'CANCEL_ADDRESS_SPACE' | 'RECYCLE_CICS' }>
  | { kind: 'SET_GATEWAY'; workloadId: string; mode: GatewayMode }
  | { kind: 'CANCEL_SESSION' | 'CANCEL_JOB' | 'TERM_UTILITY' | 'BACKOUT_CHANGE' };

