// WLM service definition model (SPEC §5.5.1). Plain data.

export type Importance = 1 | 2 | 3 | 4 | 5;

export type Goal =
  | { kind: 'AVG'; rtSec: number }
  | { kind: 'PCT'; rtSec: number; pct: number }
  | { kind: 'VEL'; velocity: number }
  | { kind: 'DISC' };

export interface PeriodDef {
  goal: Goal;
  /** Ignored for discretionary periods. */
  importance: Importance;
  /** Service units this period lasts; null for the last period. */
  durationSu: number | null;
}

export interface ServiceClassDef {
  id: string;
  description: string;
  periods: PeriodDef[];
  cpuCritical: boolean;
  storageCritical: boolean;
  resourceGroup: string | null;
  /** zIIP "honor priority": may zIIP-eligible work overflow onto CPs. */
  honorPriority: boolean;
}

export type SubsystemType = 'STC' | 'JES' | 'CICS' | 'DDF' | 'TSO' | 'MQ' | 'OMVS';

/** TN = transaction/job name, UI = userid, TC = transaction/job class, PK = Db2 package,
 * CI = correlation id, SY = system name. */
export type Qualifier = 'TN' | 'UI' | 'TC' | 'PK' | 'CI' | 'SY';

export interface ClassificationRule {
  qualifier: Qualifier;
  /** Wildcards: `*` any run of characters, `?` one character. */
  pattern: string;
  serviceClass: string | null;
  reportClass: string | null;
  children: ClassificationRule[];
  /** STC/JES rules only: "Manage Region Using Goals Of" for the CICS/IMS regions this rule catches (absent =
   * inherited from the enclosing rule, else the policy-wide legacy `cicsRegionMode`, else TRANSACTION). */
  regionMode?: RegionMode;
}

/** TRANSACTION: managed as a transaction server, to the goals of the transaction classes it serves. REGION: to the
 * region's own service class goal. BOTH: like REGION, but transaction completions are still tracked so the
 * transaction classes keep their response-time management (WLM Planning 3.1 p.122, p.211). */
export type RegionMode = 'TRANSACTION' | 'REGION' | 'BOTH';

export interface SubsystemRules {
  subsystem: SubsystemType;
  defaultServiceClass: string | null;
  defaultReportClass: string | null;
  rules: ClassificationRule[];
}

export type ResourceGroupType = 1 | 2 | 3;

export interface ResourceGroupDef {
  id: string;
  type: ResourceGroupType;
  /** Type 1: SU/s sysplex; type 2: % of LPAR share; type 3: CPs × 100. */
  min: number | null;
  max: number | null;
}

export interface ServiceDefinition {
  policyName: string;
  classes: ServiceClassDef[];
  reportClasses: string[];
  resourceGroups: ResourceGroupDef[];
  /** Legacy policy-wide "Manage regions using goals of" (saved games before it moved to the STC/JES rules):
   * the fallback for rules without their own `regionMode`. Absent = TRANSACTION. */
  cicsRegionMode?: 'TRANSACTION' | 'REGION';
  /** Service coefficient option "I/O priority management" (absent = YES). */
  ioPriorityManagement?: boolean;
  subsystems: SubsystemRules[];
}

/** Built-in classes. SYSTEM and SYSSTC have fixed DPs and no goals. */
export const SYSTEM = 'SYSTEM';
export const SYSSTC = 'SYSSTC';
export const SYSOTHER = 'SYSOTHER';
export const BUILTIN_CLASSES = [SYSTEM, SYSSTC, SYSOTHER] as const;

/** Address spaces z/OS keeps in SYSTEM regardless of classification (SG24-7621 §3.13). */
export const FORCED_SYSTEM_JOBNAMES = [
  '*MASTER*', 'WLM', 'XCFAS', 'GRS', 'SMSPDSE', 'SMSPDSE1', 'CONSOLE', 'IEFSCHAS', 'IXGLOGR',
  'SMF', 'CATALOG', 'DUMPSRV', 'RASP', 'IOSAS', 'SMXC', 'ANTMAIN', 'JESXCF', 'ALLOCAS',
];

export interface WorkAttributes {
  subsystem: SubsystemType;
  /** Values for each qualifier type that applies to this work. */
  TN?: string;
  UI?: string;
  TC?: string;
  PK?: string;
  CI?: string;
  SY?: string;
}
