// RMF Monitor III view shapes (SPEC §8 tier 1). Split from `mon3.ts` (CL-33): types only.
import type { WorkManagerSamples } from '../../sim/wlm/reporting';

export interface Mon3Row {
  workManager?: WorkManagerSamples;
  resourceSamples?: boolean;
  system: string;
  scKey: string;
  serviceClass: string;
  /** 1-based period number, as RMF shows it in the T column. */
  period: number;
  goal: string;
  importance: number | null;
  /** SYSSUM goal columns: velocity goal, or response-time goal (ms) with percentile (null = AVG). */
  goalVelocity: number | null;
  goalRtMs: number | null;
  goalPct: number | null;
  /** Execution velocity, 0..100: Using ÷ (Using + Delay) (null when nothing was sampled). */
  velocity: number | null;
  /** SYSSUM Exec Vel Act: N/A (null) for transaction classes served by CICS regions. */
  velocityAct: number | null;
  /** Percentile goals: % of ended transactions within the goal time (SYSSUM Response Time Actual). */
  withinGoalPct: number | null;
  pi: number | null;
  endedPerSec: number;
  avgRtMs: number | null;
  /** CPU on general CPs (incl. zIIP-eligible work run on CPs) in engines: PROCU EAppl% CP ÷ 100. */
  cpuEngines: number;
  /** zIIP time (PROCU EAppl% IIP ÷ 100) and the zIIP-eligible part of cpuEngines (Time on CP % IIP). */
  ziipEngines: number;
  iipcpEngines: number;
  /** SYSINFO "Users ACT", "AVG USG" and "Average Number Delayed For" (average number of users). */
  avgUsers: { active: number; proc: number; dev: number; delayProc: number; delayDev: number; delayStor: number };
  /** DELAY report USG %, DLY % and UKN % as 0..1 of active samples.
   * APPROX: IDL %, SUB, OPR and ENQ are not modelled (the UI shows them blank or 0). */
  usingFrac: number;
  delayFrac: number;
  unknownFrac: number;
  /** % Delayed for, 0..1. The DELAY report shows PRC (cpu + ziip), DEV (io) and STR (stor); `cap` (WLM capping)
   * has no column and counts only in DLY %, so DLY % may exceed the column sum (p.109); `other` is the UKN state. */
  delay: { cpu: number; ziip: number; io: number; stor: number; cap: number; other: number };
  /** Resource with the largest delay above 2% (CAP = WLM capping), or null. */
  primaryDelay: Mon3DelayResource | null;
  /** DELAY "Primary Reason" in RMF's forms (p.110): the heaviest other processor user's jobname (or *ENCLAVE)
   * for PRC, the LCU for DEV, LOCL for STR, RG-Cap for capping. */
  primaryReason: string | null;
}

export type Mon3DelayResource = 'PRC' | 'DEV' | 'STR' | 'CAP';

export interface Mon3System {
  system: string;
  /** SYSINFO header. */
  cpsOnline: number;
  iipsOnline: number;
  /** Avg CPU Util%: LPAR view (dispatch time ÷ online time); Avg MVS Util%: z/OS view (not in wait). */
  cpBusyPct: number;
  mvsBusyPct: number;
  ziipBusyPct: number | null;
  /** Appl% (address spaces), EAppl% (plus enclaves), Appl% IIP; each ÷ logical processors. */
  applPct: number;
  eapplPct: number;
  applIipPct: number | null;
  msu: number;
  capped: boolean;
  /** Worst PI of goal-bearing periods on this system. */
  worstPi: number | null;
}

/** The partition's zIIP figures for the CPC report's *IIP group (RMF Report Analysis p.97–99): the same column
 * formulas as the CP group, against the image's zIIPs and the CPC's IIP engines. MSU columns stay blank (the
 * report gives them for general purpose processors only). */
export interface Mon3CpcIip {
  /** Logical zIIPs online during the range (Proc Num). */
  procNum: number;
  logicalEffectPct: number;
  logicalTotalPct: number;
  physLparPct: number;
  physEffectPct: number;
  physTotalPct: number;
  /** The zIIP pool's short-engine wait and capping share (the report has no such columns; the CP ones are ours). */
  prsmDelayPct: number;
  cappedPct: number;
}

export interface Mon3Cpc {
  lparId: string;
  cpcId: string;
  kind: 'ZOS' | 'CF';
  /** Present when the image has zIIPs online: its row in the *IIP group. */
  iip?: Mon3CpcIip;
  /** CPC Capacity report columns. */
  msuDef: number | null;
  msuAct: number | null;
  procNum: number;
  logicalEffectPct: number;
  logicalTotalPct: number;
  physLparPct: number;
  physEffectPct: number;
  physTotalPct: number;
  /** Not CPC report fields: Partition Data (weight, polarity) and game-derived PR/SM figures. */
  weight: number;
  logical: number;
  polarity: string;
  busyPct: number;
  prsmDelayPct: number;
  overheadPct: number;
  cappedPct: number;
  /** 100 − SMF70CAI: capacity lost against the processor's normal setting (0 when not adjusted). */
  capacityAdjPct?: number;
}

/** CPC report header, for one partition (RMF shows it for the partition the reporter runs on). */
export interface Mon3CpcHeader {
  lparId: string;
  cpcId: string;
  cpcCapacityMsu: number;
  imageCapacityMsu: number;
  wlmCappingPct: number;
  r4haMsu: number;
  max4hMsu: number;
  group: string | null;
  groupLimitMsu: number | null;
  /** The group's unused four-hour average as this member sees it (RF-08); negative while the group caps it. */
  groupAvailableMsu?: number;
  /** RMF flags the member's LIMIT with `*` for four hours after it joined (its view is not full). */
  groupLimitNew?: boolean;
}

export interface Mon3Enclave {
  workloadIds: string[];
  scKey: string;
  serviceClass: string;
  period: number;
  goal: string;
  endedPerSec: number;
  avgRtMs: number | null;
  pi: number | null;
  /** EAppl% ÷ 100 on CPs (incl. zIIP-eligible work run on CPs), and zIIP time. */
  cpEngines: number;
  ziipEngines: number;
  iipcpEngines: number;
  usingFrac: number;
  delayFrac: number;
  unknownFrac: number;
}

export interface Mon3Speed {
  system: string;
  name: string;
  activeUsers: number;
  /** Workflow %, 0..100 (null = No work). */
  speed: number | null;
  /** CICS/IMS transaction classes: the region classes whose samples gave the speed. */
  servedBy?: string[];
}

export interface Mon3Exception {
  severity: 'warn' | 'crit';
  /** WFEX Name / Reason / Critical val.; `text` is the "Possible cause or action". */
  where: string;
  reason: string;
  value: string;
  text: string;
}

/** SYSWKM "Address Spaces Serving this Service Class" row (RMF Report Analysis p.206–207). */
export interface Mon3Server {
  jobname: string;
  system: string;
  /** How WLM manages the region (Manage Region Using Goals Of). */
  mgmt: 'TRANSACTION' | 'REGION' | 'BOTH';
  /** The region's own service class, and the matching Monitor III row on its system (pin target). */
  serviceClass: string;
  rowKey: string | null;
  /** Share of the region's service given to the reported class, 0..100. */
  servicePct: number;
  velocity: number | null;
  procUsgPct: number;
  ioUsgPct: number;
  cappPct: number;
  /** Operator quiesce (RESET QUIESCE) is not modelled: always 0. */
  quiescePct: number;
}

/** SYSWKM Work Manager Delays report, sysplex-wide, for one CICS transaction class period (p.204–207). */
export interface Mon3Wkm {
  scKey: string;
  serviceClass: string;
  period: number;
  goal: string;
  avgRtMs: number | null;
  endedPerSec: number;
  pi: number | null;
  /** Response time breakdown, % of the EXE phase states. */
  states: { active: number; ready: number; idle: number | null; lock: number; io: number; conv: number | null; prod: number; misc: number };
  servers: Mon3Server[];
  /** Why this PI is report-only: the AORs run at the served class's DP in TRANSACTION mode. */
  note?: string;
}

/** A processor group's PHYSICAL line (p.97–99): physical CPU busy time that could not be attributed to any
 * partition. Empty logical columns; Physical Util % LPAR and Total are both this figure, and Effect is 0.
 * APPROX: every busy engine-second in the sim comes from a partition's dispatch (PR/SM overhead is charged inside
 * it, as each partition's Physical Util % LPAR shows), so the sim has no unattributed busy time and this is 0. */
export interface Mon3CpcPhysical {
  cpcId: string;
  kind: 'CP' | 'IIP' | 'ICF';
  physPct: number;
}

export interface Mon3View {
  rangeSec: number;
  policy: string;
  systems: Mon3System[];
  rows: Mon3Row[];
  cpc: Mon3Cpc[];
  /** One PHYSICAL line per processor group that has partitions (CP always; IIP and ICF when they have any). */
  cpcPhysical: Mon3CpcPhysical[];
  cpcHeaders: Mon3CpcHeader[];
  /** Shared z/OS logical CPs per physical CP, per CPC (the aggregate is logicalToPhysical). */
  logicalToPhysicalByCpc: Record<string, number>;
  logicalToPhysical: number;
  enclaves: Mon3Enclave[];
  speed: Mon3Speed[];
  exceptions: Mon3Exception[];
  /** SYSWKM: CICS transaction classes with work manager data (absent from the CLI's trimmed history, which keeps
   * only what a pin reads; a past SYSWKM pin needs the browser). */
  wkm?: Mon3Wkm[];
  /** PROCU: jobs using a processor, by descending EAppl % CP (absent from the CLI's trimmed history, like SYSWKM). */
  procJobs?: Mon3ProcJob[];
}

/** One PROCU line (RMF Report Analysis p.188–189). Engines: the report's percentages ÷ 100. */
export interface Mon3ProcJob {
  system: string;
  jobname: string;
  /** Job class: S started task, B batch, T TSO. */
  cx: 'S' | 'B' | 'T';
  serviceClass: string;
  /** Time on CP % Total: TCB and SRB time of the address space, enclaves excluded. */
  cpEngines: number;
  /** Time on CP % IIP: zIIP-eligible work that ran on CPs (a subset of cpEngines). */
  iipcpEngines: number;
  /** EAppl % CP and IIP: enclave CPU included. */
  eapplCpEngines: number;
  eapplZiipEngines: number;
}
