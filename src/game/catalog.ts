// What player actions cost (SPEC §6): engineer-hours per command, fixes for events,
// hardware orders.

import { DASD_REBALANCE, HARDWARE, type HardwareItem } from '../content/hardware-catalog';
import { DRAFT_TUNING } from '../content/draft';
import type { OtherTeamChangeDef } from '../content/otherTeamChanges';
import type { Command } from '../sim/core/commands';

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

/** The commands a player change may carry: the ones with an engineer-hours cost. Everything else (engines,
 * prices, modifiers, address spaces, workloads, CF failures) is for events, hardware orders and the game itself. */
export const CHANGE_DESK_KINDS: ReadonlySet<Command['kind']> = new Set(Object.keys(HOURS) as Command['kind'][]);

export function hoursFor(commands: readonly Command[], perks: readonly string[]): number {
  let h = 0;
  for (const c of commands) {
    if (perks.includes('HMC_NINJA') && PRSM_KINDS.has(c.kind)) continue;
    const base = c.kind === 'SET_LCU' && c.hotSkew !== undefined ? DASD_REBALANCE.hours : (HOURS[c.kind] ?? 0.5);
    h += perks.includes('WLM_COURSE') && c.kind === 'ACTIVATE_POLICY' ? base * DRAFT_TUNING.wlmCourseHoursMult : base;
  }
  return h;
}

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
  /** The CPCs, for per-CPC hardware (target exists, item not pointless on it). */
  cpcs?: readonly { id: string; capacitySetting: 4 | 5 | 6 | 7; generation: string }[];
  /** The slow-internal-work surcharge in force (PT-50), absent or null when hands-on work costs its base hours. */
  staffSurcharge?: { mult: number; rtSec: number; goalSec: number; missedHours: number } | null;
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
  /** The slow-internal-work multiplier applied to `hours` (1 when none), so the UI can name the surcharge. */
  staffMult: number;
  ok: boolean;
  reason: string | null;
}

/** What a backout costs, taken from the change's content definition. */
export type BackoutCost = Pick<OtherTeamChangeDef, 'hours' | 'kind'>;

/** Hardware capex after perks (the zIIP promotion discounts specialty engines). */
function capexFor(hardwareId: string, capex: number, perks: readonly string[]): number {
  return perks.includes('ZIIP_PROMO') && hardwareId === 'ADD_ZIIP' ? Math.round(capex * DRAFT_TUNING.ziipPromoCapexMult) : capex;
}

function leadDaysFor(leadDays: number, perks: readonly string[]): number {
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
export function previewChange(ctx: PreviewContext, req: { commands?: Command[]; hardwareId?: string; cpcId?: string }, backout?: BackoutCost): ChangePreview {
  const hw = req.hardwareId ? hardwareItem(req.hardwareId) : undefined;
  const live = ctx.phase === 'LIVE';
  const staffMult = ctx.staffSurcharge?.mult ?? 1;
  const dbaCommand = backout?.kind === 'REBIND';
  const hours = (backout?.hours ?? (hw ? 2 : hoursFor(req.commands ?? [], ctx.perks))) * staffMult;
  const capex = hw ? capexFor(hw.id, hw.capex, ctx.perks) : 0;
  const leadDays = leadDaysFor(hw?.leadDays ?? 0, ctx.perks);
  // A lead-time order placed during the live day arrives later, so it is a plan for a future day, not an emergency
  // change made now (PT-11). Only changes that take effect this day pay the trust and failure cost.
  const emergency = live && leadDays === 0 && !dbaCommand;
  const base: ChangePreview = {
    hours,
    capex,
    opexPerDay: hw?.opexPerDay ?? 0,
    leadDays,
    emergency,
    trustCostEach: emergency ? (ctx.incidentOpen ? 0.5 : 1.5) * (ctx.perks.includes('NIGHT_OWL') ? 0.5 : 1) : 0,
    failRisk: dbaCommand ? 0 : failRiskFor(ctx.fatigue, ctx.perks),
    staffMult,
    ok: true,
    reason: null,
  };
  const no = (reason: string): ChangePreview => ({ ...base, ok: false, reason });
  if (ctx.phase !== 'BRIEFING' && ctx.phase !== 'LIVE') return no('Changes are made during the briefing or the live day');
  if (!emergency && ctx.constraints.includes('FREEZE') && !dbaCommand) return no('Change freeze: only emergency changes during the live day');
  if (req.hardwareId && !hw) return no(`Unknown hardware item ${req.hardwareId}`);
  if (req.hardwareId && (req.commands ?? []).length > 0) return no('A hardware order cannot also carry change commands');
  const target = hw?.perCpc && ctx.cpcs ? (req.cpcId ? ctx.cpcs.find((c) => c.id === req.cpcId) : ctx.cpcs[0]) : undefined;
  if (hw?.perCpc && ctx.cpcs && !target) return no(`Unknown CPC ${req.cpcId}`);
  const pointless = target && hw?.unavailable?.(target);
  if (pointless) return no(`${target.id}: ${pointless}`);
  if (hw && ctx.blockedHardware?.includes(hw.id)) return no(`${hw.name} is refused: the data centre power budget forbids it for now`);
  if (!hw && !backout && (req.commands ?? []).length === 0) return no('Nothing to change');
  if (hours > ctx.hoursLeft + MAX_OVERTIME) return no(`Needs ${hours}h; only ${ctx.hoursLeft.toFixed(1)}h left (+${MAX_OVERTIME}h overtime)`);
  if (capex > ctx.capexRemaining) return no(`Capex $${capex.toLocaleString()} exceeds the $${ctx.capexRemaining.toLocaleString()} left`);
  return base;
}
