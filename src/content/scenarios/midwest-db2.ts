import type { Db2ContentionProfile } from '../../sim/subsys/db2Contention';

// FICTIONAL: retail posting updates hit this partition most often. CS lock avoidance keeps
// the average cursor-lock wait below the wider RR footprint even with many held queries.
export const MIDWEST_DB2_CONTENTION: Db2ContentionProfile = {
  object: 'SETTLE.POSTINGS P1',
  members: ['DB1B', 'DB1A'],
  reader: 'ADHOC',
  writes: { RBANK: 0.8, TELLER: 0.25, MOBILE: 0.06 },
  isolation: 'CS',
  lockSecPerReader: { CS: 0.00065, UR: 0, RR: 0.004 },
  maxLockSec: { CS: 0.018, UR: 0, RR: 0.035 },
  claimTimeoutSec: 30,
  // FICTIONAL: a short weekday drain phase during BI hours, with a longer wait budget than a claim attempt.
  drain: { name: 'Settlement REORG', member: 'DB1B', startMinute: 14 * 60 + 50, kind: 'ALL', waitSec: 120, runSec: 20 },
};
