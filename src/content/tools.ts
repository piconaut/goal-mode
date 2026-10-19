import type { SubsystemType } from '../sim/wlm/types';

/**
 * Analytics tool tree (SPEC §8). Tools are bought with Insight and unlock data; measurement tools
 * also cost CPU while active, which is the deliberate "seeing vs paying" tension.
 */

/** Feature flags that game/view and the UI check before showing data. */
export type ToolFeature =
  | 'MON3'
  | 'WLM_ACTIVITY_LOG'
  | 'PARTITION_REPORT'
  | 'REPORT_CLASS_ADVISOR'
  | 'CF_REPORT'
  | 'DASD_REPORT'
  | 'SMF113'
  | 'DB2_ACCOUNTING'
  | 'CICS_MONITORING'
  | 'BATCH_GANTT'
  | 'CAPACITY_PLANNER'
  | 'WHAT_IF'
  | 'ALERTS'
  | 'AUTOMATION'
  | 'CPM'
  | 'AIOPS';

export interface ToolOverhead {
  /** Extra CPU per transaction for workloads of these subsystem types (fraction, e.g. 0.03 = +3%). */
  subsystems?: { types: SubsystemType[]; cpuFrac: number };
  /** Extra CPU for named address spaces (data gatherers), as a multiplier on their base CPU. */
  addressSpaces?: { jobnames: string[]; cpuFrac: number };
}

export interface ToolDef {
  id: string;
  name: string;
  tier: 1 | 2 | 3 | 4;
  insightCost: number;
  /** All must be owned first. */
  prereqs: string[];
  unlocks: ToolFeature[];
  overhead: ToolOverhead | null;
  /** What the player gets, in one line. */
  reveals: string;
  /** Not built yet: shown greyed in the tree so players can plan. */
  comingSoon?: boolean;
}

// FICTIONAL: Insight costs are tuned so a curious player affords tier 1 by ~day 4, tier 2 by ~day 12
// and one tier-3 tool by ~day 20 (RCA ≈ 5–10 per incident, reports ≤ 5/day, vendor trial 15).
// Overheads: SMF 101 class 2/3 accounting adds a few % to Db2 transaction CPU and SMF 110
// performance-class monitoring a few % to CICS (IBM: "monitoring overhead depends on classes
// active"; practitioners quote low single digits). SMF 113 counters are essentially free.
export const TOOLS: ToolDef[] = [
  {
    id: 'RMF_MON3',
    name: 'RMF Monitor III',
    tier: 1,
    insightCost: 10,
    prereqs: [],
    unlocks: ['MON3', 'WLM_ACTIVITY_LOG'],
    overhead: { addressSpaces: { jobnames: ['RMFGAT'], cpuFrac: 1 } },
    reveals: 'Live SYSINFO, DELAY, PROCU, ENCLAVE, CPC and WFEX views (last ~100 s), today’s reports as each interval closes, and the live WLM activity log.',
  },
  {
    id: 'PARTITION_DATA',
    name: 'Partition Data report',
    tier: 1,
    insightCost: 6,
    prereqs: [],
    unlocks: ['PARTITION_REPORT'],
    overhead: null,
    reveals: 'PR/SM view per LPAR: weights, entitlement, polarity, logical:physical, PR/SM overhead.',
  },
  {
    id: 'RC_ADVISOR',
    name: 'Report class advisor',
    tier: 1,
    insightCost: 6,
    prereqs: [],
    unlocks: ['REPORT_CLASS_ADVISOR'],
    overhead: null,
    reveals: 'Suggests report classes so WLMGL shows one row per business workload.',
    comingSoon: true,
  },
  {
    id: 'CF_DASD',
    name: 'CF Activity and DASD reports',
    tier: 2,
    insightCost: 12,
    prereqs: ['PARTITION_DATA'],
    unlocks: ['CF_REPORT', 'DASD_REPORT'],
    overhead: null,
    reveals: 'CF sync/async service times and conversion; DASD IOSQ/PEND/DISC/CONN per LCU.',
  },
  {
    id: 'SMF113',
    name: 'SMF 113 hardware counters',
    tier: 2,
    insightCost: 10,
    prereqs: ['PARTITION_DATA'],
    unlocks: ['SMF113'],
    overhead: null,
    reveals: 'RNI, CPI and L1 miss rates per LPAR: why the same work costs more MSU on a busy box.',
  },
  {
    id: 'DB2_ACCT',
    name: 'Db2 accounting (SMF 101)',
    tier: 2,
    insightCost: 14,
    prereqs: ['RMF_MON3'],
    unlocks: ['DB2_ACCOUNTING'],
    overhead: { subsystems: { types: ['DDF', 'CICS'], cpuFrac: 0.03 } },
    reveals: 'Per-package CPU and class 3 suspensions (lock, sync I/O): finds access-path regressions.',
  },
  {
    id: 'CICS_MON',
    name: 'CICS monitoring (SMF 110)',
    tier: 2,
    insightCost: 14,
    prereqs: ['RMF_MON3'],
    unlocks: ['CICS_MONITORING'],
    overhead: { subsystems: { types: ['CICS'], cpuFrac: 0.04 } },
    reveals: 'Per-region dispatch, QR TCB busy and MXT waits.',
  },
  {
    id: 'SMF30_BATCH',
    name: 'Batch analytics (SMF 30)',
    tier: 2,
    insightCost: 10,
    prereqs: ['RMF_MON3'],
    unlocks: ['BATCH_GANTT'],
    overhead: null,
    reveals: 'Critical-path Gantt with per-job CPU, I/O and initiator wait.',
  },
  {
    id: 'CAP_PLANNER',
    name: 'Capacity planner',
    tier: 3,
    insightCost: 25,
    prereqs: ['PARTITION_DATA', 'SMF30_BATCH'],
    unlocks: ['CAPACITY_PLANNER'],
    overhead: null,
    reveals: 'Forecast R4HA, utilisation and SLA risk days ahead, with widening confidence bands.',
    comingSoon: true,
  },
  {
    id: 'WHAT_IF',
    name: 'What-if simulator',
    tier: 3,
    insightCost: 30,
    prereqs: ['CAP_PLANNER'],
    unlocks: ['WHAT_IF'],
    overhead: null,
    reveals: 'Run tomorrow with a proposed configuration against forecast arrivals. Costs hours.',
    comingSoon: true,
  },
  {
    id: 'ALERTS',
    name: 'Alerting rules',
    tier: 3,
    insightCost: 15,
    prereqs: ['RMF_MON3'],
    unlocks: ['ALERTS'],
    overhead: null,
    reveals: 'Custom thresholds page you (PI, capping, batch at risk).',
    comingSoon: true,
  },
  {
    id: 'AUTOMATION',
    name: 'Automation rules',
    tier: 3,
    insightCost: 25,
    prereqs: ['ALERTS'],
    unlocks: ['AUTOMATION', 'CPM'],
    overhead: null,
    reveals: 'IF/THEN rules (switch policy, restart a job, activate CoD). Saves hours; can misfire.',
    comingSoon: true,
  },
  {
    id: 'AIOPS',
    name: 'AIOps anomaly detection',
    tier: 4,
    insightCost: 50,
    prereqs: ['DB2_ACCT', 'CICS_MON', 'ALERTS'],
    unlocks: ['AIOPS'],
    overhead: null,
    reveals: 'Flags anomalies and ranks RCA hypotheses with a confidence. Sometimes wrong.',
    comingSoon: true,
  },
];

// FICTIONAL: Insight income.
export const INSIGHT = {
  /** Per distinct report opened in a played day. */
  perReport: 1,
  /** Cap on report Insight per played day. */
  reportCapPerDay: 5,
  /** Per what-if run (M7.4). */
  perWhatIf: 2,
};

export const toolDef = (id: string): ToolDef | undefined => TOOLS.find((t) => t.id === id);
