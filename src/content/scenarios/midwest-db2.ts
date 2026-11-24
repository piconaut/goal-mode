import type { Db2ContentionProfile } from '../../sim/subsys/db2Contention';

// FICTIONAL: most writes touch other rows even on this partition. Bound the average lock delay
// from a saturated read cohort while leaving a larger footprint for RR than CS.
export const MIDWEST_DB2_CONTENTION: Db2ContentionProfile = {
  object: 'SETTLE.POSTINGS P1',
  members: ['DB1B', 'DB1A'],
  reader: 'ADHOC',
  writes: { RBANK: 0.8, TELLER: 0.5, MOBILE: 0.6 },
  isolation: 'CS',
  lockSecPerReader: { CS: 0.0012, UR: 0, RR: 0.004 },
  maxLockSec: 0.035,
  claimTimeoutSec: 30,
  // FICTIONAL: a short weekday drain phase during BI hours, with a longer wait budget than a claim attempt.
  drain: { name: 'Settlement REORG', member: 'DB1B', startMinute: 14 * 60 + 50, kind: 'ALL', waitSec: 120, runSec: 20 },
};
