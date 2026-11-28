// The world's entities the general operations target (PT-20 design §2 rule 7, §3; BACKLOG PT-52): daily rosters of
// DDF threads and TSO userids, the nightly Db2 utility schedule, and the site automation that restarts a cancelled
// started task.

/** FICTIONAL: daily roster sizes and spread. Shape: a dozen BI threads per member and a few dozen developers on the
 *  test image, with a Pareto spread (alpha near 1.2, the 80/20 shape) so the top entry often holds a third or more of
 *  the workload's CPU on a quiet day; a card's culprit still stands out because it holds several times the rest. */
export const ROSTERS = {
  ddfThreadsPerImage: 12,
  /** TSO userids logged on to an image: this many per unit of the image's routing share, at least `tsoMinUsers`. */
  tsoUsersPerShare: 40,
  tsoMinUsers: 2,
  paretoAlpha: 1.2,
  /** Db2 thread tokens are drawn from this range (DISPLAY THREAD prints them as decimal numbers). */
  tokenRange: [1000, 99_999] as const,
  /** FICTIONAL: resolution at which a card's usual hours are averaged when its load is sized (RF-11). */
  sizingSampleMin: 15,
  /** FICTIONAL: hours a card's excess is averaged over when its definition gives no duration. Shape: a working day
   *  (RF-11). */
  sizingHours: 8,
};

/** The Db2 utilities a nightly schedule runs. */
export type UtilityKind = 'REORG' | 'COPY' | 'RUNSTATS';

/** A Db2 utility in a scenario's nightly schedule (`-DISPLAY UTILITY` shows it by utility ID). */
export interface UtilityDef {
  /** Utility ID, as -DISPLAY UTILITY prints it. */
  id: string;
  kind: UtilityKind;
  /** Db2 member it runs on. */
  member: string;
  /** Table space it works on. */
  object: string;
  /** LCU whose hot volumes carry its I/O. */
  lcuId: string;
  /** Wall-clock start hour (hours below 6 are the next morning, as for batch). */
  startHour: number;
  durationMin: number;
  /** Sequential I/O per second while it runs, on its LCU's hot volumes. */
  seqIops: number;
  /** Share of nights it is scheduled (drawn per played day from the seed). */
  nightFrac: number;
}

/** FICTIONAL: the DBAs' nightly utilities. Shape: an online REORG of the settlement table spaces before the batch
 *  peak, image copies at midnight and RUNSTATS in the small hours, each a few thousand sequential I/Os a second on
 *  its LCU (a light load next to batch; REORG_OVERRUN's 55,000 is what exhausts LCU 21's aliases). Most nights, not
 *  all, so a missing utility is normal. */
const utilities = (member: string, settlement: string, data: string): UtilityDef[] => [
  { id: 'REORGSET', kind: 'REORG', member, object: settlement, lcuId: '21', startHour: 20.25, durationMin: 50, seqIops: 4_000, nightFrac: 0.85 },
  { id: 'COPYDAT', kind: 'COPY', member, object: data, lcuId: '10', startHour: 23.5, durationMin: 40, seqIops: 3_000, nightFrac: 0.9 },
  { id: 'RUNSTDAT', kind: 'RUNSTATS', member, object: data, lcuId: '11', startHour: 2.5, durationMin: 20, seqIops: 1_500, nightFrac: 0.8 },
];

export const MIDWEST_UTILITIES = utilities('DB1A', 'SETTLE.POSTINGS', 'RETAIL.ACCOUNTS');
export const HARBOURLINE_UTILITIES = utilities('DB1A', 'SETTLE.POSTINGS', 'RETAIL.ACCOUNTS');
export const REVENUE_UTILITIES = utilities('DB1A', 'REFUND.LEDGER', 'TAXPAYER.ACCOUNTS');

/** Started-task handling by site automation and the CANCEL command. */
export const STC_AUTOMATION = {
  /** FICTIONAL: site automation restarts a cancelled started task after this many minutes. Shape: a cancel stops a
   *  fault in an STC only for a few minutes, so cancelling is not a cure for anything the STC does on restart. */
  restartMin: 10,
  /** Address spaces whose programs the PPT marks non-cancelable: CANCEL is refused and only FORCE ARM ends them
   *  (z/OS 3.1 MVS Initialization and Tuning Reference (SA23-1380-60) PDF p.754 (printed 718), SCHEDxx
   *  CANCEL|NOCANCEL; z/OS 3.1 MVS System Commands (SA38-0666-60) PDF p.506 (printed 478)). APPROX: which system
   *  address spaces are on the list is a game choice; the IBM-supplied PPT values were not checked per program. */
  noCancel: ['*MASTER*', 'XCFAS', 'GRS', 'CATALOG', 'SMF'] as readonly string[],
};
