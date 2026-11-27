import type { Db2ContentionProfile } from '../../sim/subsys/db2Contention';

// FICTIONAL: retail posting updates hit this partition most often. CS lock avoidance keeps
// the average cursor-lock wait below the wider RR footprint even with many held queries.
export const MIDWEST_DB2_CONTENTION: Db2ContentionProfile = {
  object: 'SETTLE.POSTINGS P1',
  members: ['DB1B', 'DB1A'],
  reader: 'ADHOC',
  // FICTIONAL: the BI client pool has a bounded number of outstanding queries.
  clientConcurrency: 48,
  writes: { RBANK: 0.8, TELLER: 0.25, MOBILE: 0.06 },
  isolation: 'CS',
  lockSecPerReader: { CS: 0.00065, UR: 0, RR: 0.004 },
  maxLockSec: { CS: 0.018, UR: 0, RR: 0.035 },
  // IRLMRWT's default resource timeout, which also covers claim waits (Db2 13 Installation and Migration Guide
  // PDF p.284 (printed 266)). APPROX: IRLM detects it on its deadlock timer, so the real wait is rarely exactly this.
  claimTimeoutSec: 30,
  // FICTIONAL: an online posting commits per transaction, so its write claim lasts about its own response time; the
  // floor keeps a sub-100 ms posting's claim alive to the commit that releases it.
  writerClaimFloorSec: 0.2,
  // FICTIONAL: a short weekday drain phase during BI hours, with a longer wait budget than a claim attempt.
  // The drain is REORG TABLESPACE SHRLEVEL CHANGE's last log iteration and switch phase (Db2 13 Utility Guide and
  // Reference PDF p.628 (printed 606)).
  drain: { name: 'Settlement REORG', member: 'DB1B', startMinute: 14 * 60 + 50, kind: 'ALL', waitSec: 120, runSec: 20 },
};
