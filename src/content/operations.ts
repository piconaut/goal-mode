// FICTIONAL: hands-on operation costs. A TSO logout also loses a developer's work.
export const OPERATIONS = {
  cancelHours: 0.5,
  terminateUtilityHours: 0.5,
  tsoHoursLost: 0.5,
  tsoTrust: 1,
  journalTrust: 1,
  utilityTrust: 1,
  // FICTIONAL: stale statistics make Db2 work on the affected member a little more expensive until RUNSTATS completes.
  staleStatsCpuMult: 1.05,
  cicsHours: 1,
  cicsTrust: 1,
  gatewayHours: 1,
  gatewayTrust: 1,
  hsmHours: 0.5,
  hsmTrustPerHour: 1,
};

// Who loses trust for an operation: the first facet the scenario has from each list (game rule). The journal STC is
// the one whose cancellation the regulator notices.
export const OPERATION_TRUST = {
  tsoFacets: ['Digital', 'Taxpayers', 'Retail'],
  hsmFacets: ['Agents', 'Retail'],
  journalFacets: ['Regulator'],
  journalJobname: 'CICSXLOG',
  utilityFacets: ['Finance'],
} as const;

/** The Monitor III data gatherer's started task (z/OS 3.1 RMF User's Guide SC27-4936 PDF p.247 (printed 223)). Its
 *  SMF 74.4 records are the Postprocessor CF Activity report, unlike Monitor I's 70.1/72.3/74.1 (RF-12). */
export const RMF_GATHERER_JOBNAME = 'RMFGAT';

// What cancelling a started task stops, shown before the player issues it (N4 of the PT-56 review). RMFGAT is the
// Monitor III data gatherer (z/OS 3.1 RMF User's Guide SC27-4936 PDF p.247 (printed 223)); MONAGENT running the alert
// rules and the Regulator watching CICSXLOG are game rules.
export const CANCEL_WARNINGS: Readonly<Record<string, string>> = {
  RMFGAT: 'Monitor III data gatherer: no Monitor III samples from this system until automation restarts it.',
  MONAGENT: 'Monitoring agent: every alert rule stops until automation restarts it.',
  CICSXLOG: 'CICS log archiver: the Regulator notices it stopping (trust).',
};

// FICTIONAL: brief rolling CICS outage; normally work can move, but affinities still strand some requests.
export const CICS_RECYCLE = { restartMin: 3, affinityFrac: 0.15 };

// FICTIONAL: deliberate edge degradation with a cost even on a quiet day.
export const GATEWAY = { limitShedFrac: 0.25, retryPassFrac: 0.15, backoffShedFrac: 0.03, sharedSourceFrac: 0.02 };

// FICTIONAL: quiesced asynchronous recalls replay at a controlled rate; some scheduled jobs need WAIT recalls.
export const HSM_RECALL = { lcuId: '30', drainIops: 12_000, waitJobFrac: 0.2 };

// FICTIONAL: the recall storm's extra random I/O on the recall LCU (roughly doubles LCU 30's response at day-0 load).
export const HSM_RECALL_STORM = { randomIops: 60_000 };

// FICTIONAL: approximate backout time from how long the current batch attempt has run.
export const SETTLEMENT_BACKOUT_ELAPSED_MULT = 1;
