// State Revenue Agency story beats and event deck. The deck is the Midwest cards that name no Midwest
// workload, plus agency adaptations of the workload-specific ones (same mechanics, retargeted at the
// agency's workloads, with agency clue text and facet-correct fixes). Bank-only stories are left out.

import type { Command } from '../../sim/core/commands';
import type { WorkloadDef } from '../../sim/workload/types';
import { MIDWEST_EVENTS, type EventDef, type ScriptedBeat } from './midwest-events';

const NEUTRAL_CARDS = ['REORG_OVERRUN', 'JOB_ABEND', 'CP_SPARING', 'HIRING_FREEZE', 'VENDOR_PRICE', 'GREEN_IT_COD', 'SMF_AUDIT', 'AUDIT_UNCLASSIFIED'];
// A strict regulator: audit cards come up more often than at the bank.
const WEIGHT_MULT: Record<string, number> = { SMF_AUDIT: 1.5, AUDIT_UNCLASSIFIED: 1.5 };

const midwestCard = (id: string): EventDef => {
  const c = MIDWEST_EVENTS.find((e) => e.id === id);
  if (!c) throw new Error(`No Midwest card ${id}`);
  return c;
};

/** Clone a Midwest card with overrides, retargeting workload ids in its begin/end commands (and affects). */
function adapt(id: string, overrides: Partial<EventDef>, retarget: Record<string, string> = {}): EventDef {
  let json = JSON.stringify(midwestCard(id));
  for (const [from, to] of Object.entries(retarget)) json = json.split(`"${from}"`).join(`"${to}"`);
  return { ...(JSON.parse(json) as EventDef), ...overrides };
}

const ALL_ONLINE = ['EFILE', 'ACCOUNT', 'REFSTAT', 'AGENTS', 'EMPLOYER'];

const AGENCY_CARDS: EventDef[] = [
  adapt('CAMPAIGN', {
    id: 'FILE_EARLY_CAMPAIGN',
    name: '"File early" campaign',
    forewarning: 'Communications: "Heads up, the file-early, get-your-refund-sooner campaign starts tomorrow. Could be big."',
    clue: 'DDF END/S for the e-filing site jumps ×2–3 on both systems; CPU per transaction unchanged.',
  }, { MOBILE: 'EFILE' }),
  adapt('RUNAWAY', {
    id: 'RUNAWAY_COMPLIANCE',
    name: 'Runaway compliance query',
    clue: 'WEBDDF APPL% and zIIP busy soar on PROD2 with the analytics end rate flat; with IIPHONORPRIORITY=NO the zIIP work queues instead of overflowing, so e-filing on PROD2 shows zIIP delay (Mon III DELAY, Partition Data). Fixes: cancel the thread, give e-filing a goal class of its own, or let zIIP work overflow to the CPs.',
  }, { MOBILE: 'EFILE', ADHOC: 'ANALYTICS' }),
  adapt('REGRESSION', {
    id: 'EFILE_REGRESSION',
    name: 'Access-path regression after REBIND',
    fix: 'EFILE_REBIND_REVERT',
    forewarning: 'Change board: "Db2 package REBINDs for the e-filing app are scheduled overnight."',
    perkTip: { perk: 'DB2_WHISPERER', from: 'DBA team', text: "EXPLAIN diff after last night's REBIND: package EF01 changed access path (index probe → tablespace scan). Expect more CPU per e-filing transaction." },
    clue: 'WLMGL: e-filing service per transaction ×3 (APPL% up, END/S flat). Db2 accounting by package would point at EF01. Fixes: restore the previous access path, or absorb it with capacity.',
  }, { RBANK: 'EFILE' }),
  adapt('BOT_ATTACK', {
    id: 'FILING_BOTS',
    name: 'Credential stuffing on taxpayer login',
    fix: 'BLOCK_FILING_BOTS',
    clue: 'E-filing END/S ×4 with lower CPU per transaction; TCP/IP busier; DBAT usage spikes. Fixes: block the source addresses at the edge (Taxpayers trust), or protect refund and agent work and ride it out.',
  }, { MOBILE: 'EFILE' }),
  adapt('RETRY_STORM', {
    id: 'REFUND_RETRY_STORM',
    name: 'Refund status retry storm',
    fix: 'REFSTAT_BACKOFF',
    clue: 'Refund-status END/S ×2.5 at midday with CPU per transaction unchanged (bot traffic would be cheaper per transaction); CICS RFST transaction rate and APPL% up in step. Fixes: have the status page say "check back tomorrow" and back off retries (Refunds trust), or protect refund status and ride it out.',
  }, { MOBILE: 'REFSTAT' }),
  adapt('ENCRYPTION_MANDATE', {
    id: 'TAXDATA_ENCRYPTION',
    name: 'Taxpayer data encryption mandate',
    forewarning: 'Regulator: "All taxpayer data sets must be encrypted at rest from tomorrow. We will check the key labels."',
    clue: 'WLMGL: CPU per transaction up ~6% on account, refund status and employer filing from one morning, END/S flat; MSU/R4HA up. Fixes: agree a narrower scope with the regulator (Regulator trust), or absorb it with tuning and capacity.',
  }, { CARDAUTH: 'ACCOUNT', TELLER: 'REFSTAT', PAYMQ: 'EMPLOYER' }),
  adapt('ZIIP_LOSS', {
    fix: 'NATIVE_SQL_PROCS_REV',
    forewarning: 'Change board: "E-filing stored procedures are being redeployed overnight (new COBOL versions)."',
    clue: 'WLMGL: WEBDDF (or e-filing\'s own class) APPL% on CP up and IIP% down on PROD1 with END/S and total CPU per transaction flat; MSU and R4HA rise. Fixes: redeploy as native SQL procedures (Taxpayers trust), or absorb it (cap, more CP).',
  }, { MOBILE: 'EFILE' }),
  adapt('XLOG_LOOP', { affects: ['ACCOUNT', 'AGENTS'] }),
  adapt('CF_LINK', { affects: ALL_ONLINE }),
  adapt('CF_FAILURE', { affects: ALL_ONLINE }),
  adapt('DASD_DEGRADED', { affects: ALL_ONLINE }),
  adapt('LOCK_ESCALATION', {
    name: 'Lock escalation in refund batch',
    affects: ['ACCOUNT', 'REFSTAT'],
    clue: 'Account and refund-status response time up with little CPU delay; UNK delay up; IRLM healthy; batch running.',
  }),
  adapt('MONITOR_CREEP', { affects: ['EFILE', 'ACCOUNT'] }),
  adapt('POWER_CAP', { affects: ['EFILE', 'ACCOUNT'] }),
  adapt('HSM_RECALL_STORM', { affects: ['ACCOUNT', 'AGENTS', 'EMPLOYER', 'EFILE'], fix: 'HOLD_HSM_RECALLS_REV' }),
  adapt('CICS_SOS', {
    affects: ['AGENTS', 'ACCOUNT'],
    fix: 'RECYCLE_PROD2_AORS_REV',
    clue: 'CICS report / Mon III: MXT wait per transaction up on PROD2 regions only (CPU and QR wait normal); DFHSM0131 SOS messages in the region logs. Fixes: recycle the PROD2 AORs (Agents trust), or route agent work to PROD1.',
  }),
];

export const REVENUE_EVENTS: EventDef[] = [
  ...MIDWEST_EVENTS.filter((e) => NEUTRAL_CARDS.includes(e.id)).map((e) => ({ ...e, weight: e.weight * (WEIGHT_MULT[e.id] ?? 1) })),
  ...AGENCY_CARDS,
];

// FICTIONAL: pre-filled returns, a Java service on USS that no REVPOL rule classifies (it lands in SYSOTHER).
export const PREFILL_APP: WorkloadDef = {
  id: 'PREFILL',
  name: 'Pre-filled returns API',
  stakeholder: 'Taxpayers',
  subsystem: 'OMVS',
  work: { subsystem: 'OMVS', UI: 'PFILSVC' },
  peakRatePerSec: 90,
  shape: { floor: 0.05, peaks: [{ hour: 12.5, height: 0.7, widthHours: 1.5 }, { hour: 20, height: 1, widthHours: 2.2 }], weekly: [0.9, 0.9, 0.9, 0.9, 0.85, 1.05, 1.1], payday: 1, monthEnd: 1 },
  growthPerDay: 0.02,
  noiseSigma: 0.1,
  noisePhi: 0.95,
  routing: { PROD1: 0.5, PROD2: 0.5 },
  cpuMsRef: 4,
  cpuSigma: 0.6,
  ziipFrac: 0.5,
  ioPerTxn: 6,
  baseLatencySec: 0.06,
  rtSigma: 0.6,
  timeoutSec: 15,
  retryFrac: 0.6,
  servers: [
    { role: 'TCPIP', cpuMsRef: 0.02, latencySec: 0.0005 },
    { role: 'DB2.DBM1', cpuMsRef: 0.15, latencySec: 0.012 },
    { role: 'DB2.MSTR', cpuMsRef: 0.03, latencySec: 0.006 },
    { role: 'DB2.IRLM', cpuMsRef: 0.02, latencySec: 0.004 },
  ],
  sla: { kind: 'PCT', pct: 90, rtSec: 0.5 },
};

const rate = (key: string, value: number): Command => ({ kind: 'SET_MODIFIER', mod: 'rate', key, value });

/** FICTIONAL: the deadline-week surge, on top of the season's daily growth. */
export const DEADLINE_SURGE = { EFILE: 1.35, PREFILL: 1.35, REFSTAT: 1.25, AGENTS: 1.2 } as Record<string, number>;

export const REVENUE_STORY: ScriptedBeat[] = [
  { day: 0, id: 'WELCOME', from: 'Commissioner', title: 'Welcome to filing season', body: 'Six weeks to the filing deadline. Keep the e-filing site up, the refunds flowing and the auditors happy. The previous team tuned this sysplex in the summer, when it was quiet.' },
  { day: 14, id: 'REG_DEADLINE', from: 'Regulator', title: 'Refund files due by 05:00', body: 'The Treasury now takes the nightly refund file at 05:00, not 06:00. Critical batch must complete by then.', constraint: 'DEADLINE_0500' },
  { day: 16, id: 'CFO_MANDATE', from: 'Finance', title: 'Appropriations cut', body: 'The legislature trimmed our IT appropriation. Next month the software bill must be 10% lower than this month.', constraint: 'CFO_MANDATE' },
  {
    day: 22,
    id: 'PREFILL',
    from: 'Commissioner',
    title: 'Pre-filled returns go live',
    body: 'The pre-filled returns API launches today on both production images. The vendor says "it just runs on USS".',
    commands: [{ kind: 'ADD_WORKLOAD', workload: PREFILL_APP }],
  },
  {
    day: 33,
    id: 'DEADLINE_WEEK',
    from: 'Commissioner',
    title: 'Deadline week',
    body: 'Filing closes in four days. Expect a third more e-filing traffic than last week, and the call centre on overtime. Only emergency changes until the deadline passes.',
    constraint: 'FREEZE',
    commands: Object.entries(DEADLINE_SURGE).map(([k, v]) => rate(k, v)),
  },
  { day: 37, id: 'DEADLINE_PASSED', from: 'Commissioner', title: 'Filing deadline passed', body: 'The deadline has passed. Late filers and refund enquiries carry on, but the surge is over.', commands: Object.keys(DEADLINE_SURGE).map((k) => rate(k, 1)) },
];
