import type { Db2ContentionProfile } from '../../sim/subsys/db2Contention';

// FICTIONAL: a shared settlement partition gives BI a small CS footprint under normal service.
// RR exposes a larger set of rows. UR contributes read claims without data-lock pressure in this model.
export const MIDWEST_DB2_CONTENTION: Db2ContentionProfile = {
  object: 'SETTLE.POSTINGS P1',
  members: ['DB1B', 'DB1A'],
  reader: 'ADHOC',
  writes: { RBANK: 0.8, TELLER: 0.5, MOBILE: 0.6 },
  isolation: 'CS',
  lockSecPerReader: { CS: 0.018, UR: 0, RR: 0.060 },
  maxLockSec: 0.40,
  claimTimeoutSec: 30,
  // FICTIONAL: a short weekday drain phase during BI hours, with a longer wait budget than a claim attempt.
  drain: { name: 'Settlement REORG', member: 'DB1B', startMinute: 14 * 60 + 50, kind: 'ALL', waitSec: 120, runSec: 20 },
};
