// What player actions cost (SPEC §6): engineer-hours per command, fixes for events,
// hardware orders.

import { DASD_REBALANCE, HARDWARE, type HardwareItem } from '../content/hardware-catalog';
import { DRAFT_TUNING } from '../content/draft';
import type { Command } from '../sim/core/commands';
import type { Facet } from './types';

const HOURS: Partial<Record<Command['kind'], number>> = {
  ACTIVATE_POLICY: 1.5,
  SET_WEIGHT: 0.5,
  SET_LOGICAL: 1,
  SET_DEFINED_CAPACITY: 0.5,
  SET_CAPACITY_GROUP: 1,
  SET_ABSOLUTE_CAP: 0.5,
  SET_IEAOPT: 0.5,
  SET_RMF_INTERVAL: 0.25,
  SET_LPAR_MEMORY: 1,
  SET_DB2: 1,
  SET_CICS: 0.5,
  ADD_AOR: 3,
  SET_JOB_CLASS: 1,
  SET_CF: 1,
  MOVE_STRUCTURE: 1,
  // CFRM policy change + SETXCF START,REBUILD,DUPLEX.
  SET_DUPLEX: 1,
  // HCD change + dynamic activate to move HyperPAV aliases between LCUs.
  SET_LCU: 1,
  SET_ROUTING: 0.5,
  // Sysplex distributor VIPADISTRIBUTE change or a CPSM workload definition (WLMSPEC) update.
  SET_ROUTING_POLICY: 1,
  SET_MQ: 0.25,
  RESTART_JOB: 0.5,
};

const PRSM_KINDS: ReadonlySet<Command['kind']> = new Set(['SET_WEIGHT', 'SET_LOGICAL', 'SET_DEFINED_CAPACITY', 'SET_CAPACITY_GROUP', 'SET_ABSOLUTE_CAP']);

export function hoursFor(commands: readonly Command[], perks: readonly string[]): number {
  let h = 0;
  for (const c of commands) {
    if (perks.includes('HMC_NINJA') && PRSM_KINDS.has(c.kind)) continue;
    const base = c.kind === 'SET_LCU' && c.hotSkew !== undefined ? DASD_REBALANCE.hours : (HOURS[c.kind] ?? 0.5);
    h += perks.includes('WLM_COURSE') && c.kind === 'ACTIVATE_POLICY' ? base * DRAFT_TUNING.wlmCourseHoursMult : base;
  }
  return h;
}

export interface FixDef {
  id: string;
  name: string;
  hours: number;
  /** Trust cost to the facet that owns the affected work (e.g. cancelling a user's query). */
  trustCost: { facet: Facet; amount: number } | null;
  description: string;
}

export const FIXES: FixDef[] = [
  { id: 'CANCEL_RUNAWAY', name: 'Cancel the runaway DDF thread', hours: 0.5, trustCost: null, description: '-CANCEL THREAD on the looping BI query.' },
  { id: 'REBIND_REVERT', name: 'REBIND with APREUSE / switch back', hours: 1.5, trustCost: null, description: 'Restore the previous access path for the retail package.' },
  { id: 'EFILE_REBIND_REVERT', name: 'REBIND with APREUSE / switch back', hours: 1.5, trustCost: null, description: 'Restore the previous access path for the e-filing package.' },
  { id: 'BLOCK_BOTS', name: 'Block bot traffic at the edge', hours: 1, trustCost: { facet: 'Digital', amount: 1 }, description: 'Rate-limit the credential-stuffing source addresses.' },
  { id: 'BLOCK_FILING_BOTS', name: 'Block bot traffic at the edge', hours: 1, trustCost: { facet: 'Taxpayers', amount: 1 }, description: 'Rate-limit the credential-stuffing source addresses on the taxpayer login.' },
  { id: 'MOBILE_BACKOFF', name: 'Turn on retry backoff in the API gateway', hours: 1, trustCost: { facet: 'Digital', amount: 1 }, description: 'Exponential backoff and a circuit breaker for the mobile app; customers see "try again later" instead of retrying.' },
  { id: 'REFSTAT_BACKOFF', name: 'Back off refund-status retries', hours: 1, trustCost: { facet: 'Refunds', amount: 1 }, description: 'The status page says "check back tomorrow" and the client backs off; taxpayers see a delay message instead of retrying.' },
  { id: 'TERM_UTILITY', name: 'Terminate the overrunning REORG', hours: 0.5, trustCost: { facet: 'Finance', amount: 1 }, description: '-TERM UTILITY: stops the I/O storm; the REORG has to be rescheduled.' },
  { id: 'CANCEL_XLOG', name: 'Cancel the looping CICSXLOG job', hours: 0.5, trustCost: { facet: 'Regulator', amount: 1 }, description: 'C CICSXLOG: the loop stops; the CICS journals are archived late and audit asks why.' },
  { id: 'SCOPE_ENCRYPTION', name: 'Agree a narrower encryption scope', hours: 2, trustCost: { facet: 'Regulator', amount: 2 }, description: 'Encrypt only the regulated customer data sets; the online CPU overhead goes away, the regulator notes the exception.' },
  { id: 'ROLLBACK_MONITOR', name: 'Roll back the monitoring agent', hours: 1, trustCost: null, description: 'Revert to the previous agent release.' },
  { id: 'STOP_SHADOW_IT', name: 'Stop the unapproved TSO workload', hours: 1, trustCost: { facet: 'Digital', amount: 1 }, description: 'Find the users behind the TSO CPU and have the model training moved off the mainframe.' },
  { id: 'ROLLBACK_TELLER_RELEASE', name: 'Roll back the teller release', hours: 1.5, trustCost: { facet: 'Retail', amount: 1 }, description: 'Back out release 4.2 from the PROD1 CICS regions until it is made threadsafe.' },
  { id: 'NATIVE_SQL_PROCS', name: 'Redeploy as native SQL procedures', hours: 2, trustCost: { facet: 'Digital', amount: 1 }, description: 'Back out the external stored procedures; native SQL procedures under DDF are zIIP-eligible again.' },
  { id: 'NATIVE_SQL_PROCS_REV', name: 'Redeploy as native SQL procedures', hours: 2, trustCost: { facet: 'Taxpayers', amount: 1 }, description: 'Back out the external stored procedures; native SQL procedures under DDF are zIIP-eligible again.' },
  { id: 'RECYCLE_PROD2_AORS', name: 'Recycle the PROD2 CICS AORs', hours: 1, trustCost: { facet: 'Retail', amount: 1 }, description: 'Restart CICSAOR2 and CICSAOR4 one at a time to clear the storage leak; in-flight teller work on them fails over.' },
  { id: 'RECYCLE_PROD2_AORS_REV', name: 'Recycle the PROD2 CICS AORs', hours: 1, trustCost: { facet: 'Agents', amount: 1 }, description: 'Restart CICSAOR2 and CICSAOR4 one at a time to clear the storage leak; in-flight call-centre work on them fails over.' },
  { id: 'RECYCLE_SICK_AOR', name: 'Recycle CICSAOR3 on PRDC', hours: 1, trustCost: { facet: 'Markets', amount: 1 }, description: 'Restart the abending CICS region (CICSAOR3) on PRDC; in-flight orders on it fail and the traders notice.' },
  { id: 'SCOPE_SMF_AUDIT', name: 'Negotiate the SMF audit scope', hours: 1, trustCost: { facet: 'Regulator', amount: 2 }, description: 'Agree with the regulator to keep sampled SMF 101/110 records only; the SMF address space drops back to normal.' },
  { id: 'HOLD_HSM_RECALLS', name: 'Hold DFSMShsm recalls', hours: 0.5, trustCost: { facet: 'Retail', amount: 1 }, description: 'HOLD RECALL until the storm drains; users wait for their data sets.' },
  { id: 'HOLD_HSM_RECALLS_REV', name: 'Hold DFSMShsm recalls', hours: 0.5, trustCost: { facet: 'Agents', amount: 1 }, description: 'HOLD RECALL until the storm drains; case workers wait for their data sets.' },
];

export const hardwareItem = (id: string): HardwareItem | undefined => HARDWARE.find((h) => h.id === id);

export const MAX_OVERTIME = 4;
export const CHANGE_FAIL_BASE = 0.03;

export interface PreviewContext {
  phase: string;
  perks: readonly string[];
  fatigue: number;
  hoursLeft: number;
  capexRemaining: number;
  incidentOpen: boolean;
  constraints: readonly string[];
  /** Hardware items refused by a running event card. */
  blockedHardware?: readonly string[];
}

export interface ChangePreview {
  hours: number;
  capex: number;
  opexPerDay: number;
  leadDays: number;
  emergency: boolean;
  /** Trust lost by every stakeholder if this is an emergency change. */
  trustCostEach: number;
  failRisk: number;
  ok: boolean;
  reason: string | null;
}

/** Hardware capex after perks (the zIIP promotion discounts specialty engines). */
export function capexFor(hardwareId: string, capex: number, perks: readonly string[]): number {
  return perks.includes('ZIIP_PROMO') && hardwareId === 'ADD_ZIIP' ? Math.round(capex * DRAFT_TUNING.ziipPromoCapexMult) : capex;
}

export function leadDaysFor(leadDays: number, perks: readonly string[]): number {
  return perks.includes('VENDOR_FRIEND') && leadDays >= 2 ? leadDays - DRAFT_TUNING.vendorFriendDays : leadDays;
}

/** Monthly opex budget after perks (Friends in Finance, the capex-for-opex pact). */
export function opexBudgetFor(baseMonthly: number, perks: readonly string[]): number {
  return baseMonthly * (perks.includes('FRIENDS_IN_FINANCE') ? 1.1 : 1) * (perks.includes('BUDGET_SWAP') ? DRAFT_TUNING.budgetSwapOpexMult : 1);
}

export function failRiskFor(fatigue: number, perks: readonly string[]): number {
  return CHANGE_FAIL_BASE * (1 + fatigue / 50) * (perks.includes('BELT_AND_BRACES') ? 0.5 : 1) * (perks.includes('NIGHT_DESK') ? DRAFT_TUNING.nightDeskFailMult : 1);
}

/** What a change would cost and whether it is allowed, without making it (UI and requestChange share this). */
export function previewChange(ctx: PreviewContext, req: { commands?: Command[]; hardwareId?: string; fixId?: string }): ChangePreview {
  const hw = req.hardwareId ? hardwareItem(req.hardwareId) : undefined;
  const fix = req.fixId ? FIXES.find((f) => f.id === req.fixId) : undefined;
  const live = ctx.phase === 'LIVE';
  const hours = fix ? fix.hours : hw ? 2 : hoursFor(req.commands ?? [], ctx.perks);
  const capex = hw ? capexFor(hw.id, hw.capex, ctx.perks) : 0;
  const base: ChangePreview = {
    hours,
    capex,
    opexPerDay: hw?.opexPerDay ?? 0,
    leadDays: leadDaysFor(hw?.leadDays ?? 0, ctx.perks),
    emergency: live,
    trustCostEach: live ? (ctx.incidentOpen ? 0.5 : 1.5) * (ctx.perks.includes('NIGHT_OWL') ? 0.5 : 1) : 0,
    failRisk: fix ? 0 : failRiskFor(ctx.fatigue, ctx.perks),
    ok: true,
    reason: null,
  };
  const no = (reason: string): ChangePreview => ({ ...base, ok: false, reason });
  if (ctx.phase !== 'BRIEFING' && ctx.phase !== 'LIVE') return no('Changes are made during the briefing or the live day');
  if (!live && ctx.constraints.includes('FREEZE') && !req.fixId) return no('Change freeze: only emergency changes during the live day');
  if (req.hardwareId && !hw) return no(`Unknown hardware item ${req.hardwareId}`);
  if (req.fixId && !fix) return no(`Unknown fix ${req.fixId}`);
  if (hw && ctx.blockedHardware?.includes(hw.id)) return no(`${hw.name} is refused: the data centre power budget forbids it for now`);
  if (!hw && !fix && (req.commands ?? []).length === 0) return no('Nothing to change');
  if (hours > ctx.hoursLeft + MAX_OVERTIME) return no(`Needs ${hours}h; only ${ctx.hoursLeft.toFixed(1)}h left (+${MAX_OVERTIME}h overtime)`);
  if (capex > ctx.capexRemaining) return no(`Capex $${capex.toLocaleString()} exceeds the $${ctx.capexRemaining.toLocaleString()} left`);
  return base;
}
