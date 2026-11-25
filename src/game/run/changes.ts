import { packOf } from '../../content/packs';
import { applyCommand, type Command } from '../../sim/core/commands';
import { streamRng } from '../../sim/core/rng';
import type { Scenario } from '../../sim/core/scenario';
import { effectiveAddressSpaces } from '../../sim/core/tick/helpers';
import type { SimState } from '../../sim/core/types';
import type { ServiceDefinition } from '../../sim/wlm/types';
import { COD_DEACTIVATE_HOURS, DASD_REBALANCE } from '../../content/hardware-catalog';
import { CHANGE_DESK_KINDS, failRiskFor, FIXES, hardwareItem, previewChange } from '../catalog';
import { engineerHoursMult, slowInternalOf } from '../staff';
import { placementRefusal } from '../workloads';
import { idText } from '../ids';
import {
  type Phase,
  type PlannedChange,
  type RunState
} from '../types';
import { armableEvents, endEventByFix, fixIdsOf, hasEventForFix } from './events';
import type { GameContent } from './shared';
import { clampTrust, FATIGUE_PER_OVERTIME_HOUR, logLine, mapTrust } from './shared';

export interface ChangeRequest {
  label: string;
  commands?: Command[];
  hardwareId?: string;
  /** Target CPC of a per-CPC hardware item (default the first). */
  cpcId?: string;
  fixId?: string;
  /** Pre-approved automation: no engineer-hours, no emergency trust cost, a misfire chance instead. */
  automated?: { misfireFrac: number };
}

export interface ChangeOutcome {
  run: RunState;
  ok: boolean;
  message: string;
  /** The policy a cancelled activation would have installed, so the caller can keep it as pending edits. */
  restoredPolicy?: ServiceDefinition;
}

export const NO_TARGET = 'no active event matched this fix';
/** A fix whose forewarned card has not started yet: it ends when the card starts. */
export const ARMED = 'armed against the forewarned change; it ends when it lands';

export function failRisk(run: RunState): number {
  return failRiskFor(run.fatigue, run.perks);
}

export function previewContext(run: RunState, content?: GameContent) {
  // The team's own work can make hands-on hours dearer (PT-50): the surcharge is derived from the closed hours,
  // so it disappears as soon as the work meets its goal again.
  const slow = slowInternalOf(run, content?.internalGoal ?? packOf(run.scenarioId).game.internalGoal);
  return {
    phase: run.phase,
    perks: run.perks,
    fatigue: run.fatigue,
    hoursLeft: run.hoursLeft,
    capexRemaining: run.capexRemaining,
    incidentOpen: run.incidents.some((i) => i.endTick === null),
    constraints: run.constraints,
    blockedHardware: run.events.flatMap((e) => (e.started && !e.ended ? (e.blocksHardware ?? []) : [])),
    cpcs: run.sim.config.cpcs.map((c) => ({ id: c.id, capacitySetting: c.capacitySetting, generation: c.generation })),
    ...(content ? { fixIds: fixIdsOf(content) } : {}),
    ...(slow ? { staffSurcharge: { mult: slow.hoursMult, rtSec: slow.rtSec, goalSec: slow.goalSec, missedHours: slow.missedHours } } : {}),
  };
}

/** Plan (BRIEFING) or make an emergency change (LIVE). */
export function requestChange(run: RunState, content: GameContent, req: ChangeRequest): ChangeOutcome {
  const live = run.phase === 'LIVE';
  const preview = previewChange(previewContext(run, content), req);
  if (!preview.ok) return { run, ok: false, message: preview.reason ?? 'Change not allowed' };
  // Only the player's own plan is checked here: refusing a fix because no event matches would let the Change Desk
  // be probed for hidden events at no cost. A fix with no target is charged and reports "no effect" once it runs.
  const plannedFix = req.fixId ? run.changes.find((c) => c.status === 'PLANNED' && c.endsEvent === req.fixId) : undefined;
  if (plannedFix) {
    const hint = live ? ` for day ${plannedFix.activateDay + 1}; cancel ${idText('change', plannedFix.id)} to apply it now` : '';
    return { run, ok: false, message: `This fix is already planned${hint}; no hours or trust spent.` };
  }
  const refused = !req.hardwareId && !req.fixId ? dryRunRefusal(run, req.commands ?? []) : null;
  if (refused) return { run, ok: false, message: refused };
  const hw = req.hardwareId ? hardwareItem(req.hardwareId) : undefined;
  const fix = req.fixId ? FIXES.find((f) => f.id === req.fixId) : undefined;
  const commands = hw ? hw.commands(run.sim, req.cpcId) : (req.commands ?? []);
  const hours = req.automated ? 0 : preview.hours;
  const { capex } = preview;

  let r = spendHours(run, hours);
  r = { ...r, capexRemaining: r.capexRemaining - capex };
  const change: PlannedChange = {
    id: r.nextId,
    label: req.label,
    commands,
    hours,
    capex,
    opexPerDay: hw?.opexPerDay ?? 0,
    activateDay: run.day + preview.leadDays,
    plannedDay: run.day,
    emergency: preview.emergency,
    status: 'PLANNED',
    revertDay: hw?.durationDays ? run.day + preview.leadDays + hw.durationDays : null,
    revertCommands: hw?.durationDays ? hw.revert(run.sim, req.cpcId) : [],
    endsEvent: fix?.id ?? null,
  };
  r = { ...r, nextId: r.nextId + 1 };

  if (preview.emergency) {
    // Emergency change board: costs trust, more when no incident justifies it.
    const trustCost = req.automated ? 0 : preview.trustCostEach;
    r = { ...r, trust: mapTrust(r, (t) => t - trustCost) };
    if (fix?.trustCost && fix.trustCost.facet in r.trust) r = { ...r, trust: { ...r.trust, [fix.trustCost.facet]: clampTrust(r.trust[fix.trustCost.facet]! - fix.trustCost.amount) } };
    const risk = req.automated ? req.automated.misfireFrac : failRisk(r);
    const attempt = r.changes.filter((x) => x.plannedDay === r.day && x.label === req.label).length;
    const failed = streamRng(r.seed, 'live-change', r.day, req.label, attempt).chance(risk);
    if (failed && !fix) {
      r = { ...r, changes: [...r.changes, { ...change, status: 'FAILED' }] };
      return {
        run: logLine(r, `${req.automated ? 'Automation MISFIRED' : 'Emergency change FAILED'}: ${req.label}`),
        ok: false,
        message: `${req.automated ? 'Automation misfired' : 'Change failed during implementation'} (risk ${(100 * risk).toFixed(0)}%): ${req.label}`,
      };
    }
    const noTarget = fix !== undefined && !hasEventForFix(r, content, fix.id);
    // The forewarned card has not started yet: the fix is ready and ends it when it lands that day.
    const arms = fix !== undefined && noTarget ? armableEvents(r, content, fix.id, r.day) : [];
    if (change.activateDay === r.day) {
      r = { ...r, pendingCommands: [...r.pendingCommands, ...commands], changes: [...r.changes, { ...change, status: 'APPLIED', ...(arms.length > 0 ? { armedEvents: arms } : {}) }] };
    } else r = { ...r, changes: [...r.changes, change] };
    if (fix) r = endEventByFix(r, content, fix.id);
    const what = `${req.automated ? 'Automation' : 'Emergency change'}: ${req.label}`;
    if (arms.length > 0) return { run: logLine(r, `${what} (${ARMED})`), ok: true, message: `Applied: ${req.label}; ${ARMED}` };
    if (noTarget) return { run: logLine(r, `${what} (${NO_TARGET})`), ok: true, message: `Applied with no effect: ${req.label}; ${NO_TARGET}` };
    return { run: logLine(r, what), ok: true, message: `Applied: ${req.label}` };
  }
  return { run: { ...r, changes: [...r.changes, change] }, ok: true, message: `Planned ${idText('change', change.id)} for day ${change.activateDay + 1}: ${req.label}` };
}

/** Why the config would reject these commands (unknown region, LPAR, pool...), tried on today's config with
 * the changes already planned; null when they apply. Catches a mistyped target before it costs hours. */
export function dryRunRefusal(run: RunState, commands: readonly Command[]): string | null {
  const scenario = packOf(run.scenarioId).scenario;
  let s = run.sim;
  for (const c of run.changes) if (c.status === 'PLANNED') for (const cmd of c.commands) s = applyCommand(s, cmd).state;
  for (const cmd of commands) {
    // Only player commands: the JSON change path accepts any Command shape, including event-only ones.
    if (!CHANGE_DESK_KINDS.has(cmd.kind)) return `${cmd.kind} is not a change-desk command; hardware, fixes and events keep their own paths`;
    const field = eventOnlyField(cmd) ?? hotSkewRefusal(s, cmd);
    if (field) return field;
    const placement = placementOf(scenario, s, cmd);
    if (placement) return `${placement}${targetHint(s, cmd)}`;
    const res = applyCommand(s, cmd);
    if (!res.ok) return `${res.message}${targetHint(s, cmd)}`;
    s = res.state;
  }
  return null;
}

/** Fields an event card sets to start or end a failure the player must diagnose; a change may not. */
function eventOnlyField(cmd: Command): string | null {
  if (cmd.kind === 'SET_CF' && cmd.degrade !== undefined) return 'A CF degradation is raised by an event, not by a change';
  if (cmd.kind === 'SET_LCU' && cmd.extraIops !== undefined) return 'Extra LCU I/O is raised by an event, not by a change';
  if (cmd.kind === 'SET_CICS' && cmd.leak !== undefined) return 'A storage leak is raised by an event, not by a change';
  return null;
}

/** A rebalance moves the hottest data sets one step, as the Change Desk offers: it must reduce the LCU's skew and
 * no further than `DASD_REBALANCE`. The raw command clamps to 0.05–1, which would balance a whole LCU at once. */
function hotSkewRefusal(s: SimState, cmd: Command): string | null {
  if (cmd.kind !== 'SET_LCU' || cmd.hotSkew === undefined) return null;
  const lcu = s.config.dasd.lcus.find((x) => x.id === cmd.lcuId);
  if (!lcu) return `No LCU ${cmd.lcuId}`;
  const floor = Math.max(DASD_REBALANCE.minSkew, lcu.hotSkew * DASD_REBALANCE.skewFactor);
  if (cmd.hotSkew >= lcu.hotSkew) return `LCU ${lcu.id} hot skew is ${lcu.hotSkew}; a rebalance must reduce it`;
  if (cmd.hotSkew < floor - 1e-9) return `One rebalance moves ${Math.round((1 - DASD_REBALANCE.skewFactor) * 100)} % of the hot skew at most: LCU ${lcu.id} needs ${floor.toFixed(2)} or more`;
  return null;
}

/** Placement checks the sim command cannot make: the sim state has no scenario, so it cannot look up a
 * scenario workload's server roles nor the scenario's address spaces. */
function placementOf(scenario: Scenario, s: SimState, cmd: Command): string | null {
  const addressSpaces = effectiveAddressSpaces(scenario, s);
  if (cmd.kind !== 'SET_ROUTING') return null;
  const workload = [...scenario.workloads, ...s.extraWorkloads].find((w) => w.id === cmd.workloadId);
  return workload ? placementRefusal(scenario, addressSpaces, workload, cmd.routing) : `Unknown workload ${cmd.workloadId}`;
}

function targetHint(s: RunState['sim'], cmd: Command): string {
  const list = (what: string, names: readonly string[]) => `; ${what}: ${names.join(' ')}`;
  switch (cmd.kind) {
    case 'SET_CICS': return list('CICS regions', s.config.cics.map((r) => r.name));
    case 'SET_DB2': return list('Db2 subsystems', s.config.db2.map((d) => d.ssid));
    case 'SET_WEIGHT': case 'SET_LOGICAL': case 'SET_DEFINED_CAPACITY': case 'SET_ABSOLUTE_CAP': case 'SET_IEAOPT': case 'SET_LPAR_MEMORY':
      return list('LPARs', s.config.lpars.map((l) => l.id));
    default: return '';
  }
}

/** Whether the change row offers "Deactivate tomorrow": the same conditions as deactivateCod. */
export const codDeactivatable = (c: Pick<PlannedChange, 'status' | 'opexPerDay' | 'revertDay'>, phase: Phase, day: number): boolean =>
  (phase === 'BRIEFING' || phase === 'LIVE') && c.status === 'APPLIED' && c.opexPerDay > 0 && c.revertDay !== null && c.revertDay > day + 1;

/**
 * Deactivate an active On/Off CoD order from the next day: its lease's revert day becomes tomorrow, so the
 * existing 06:00 revert applies then and the daily fee stops. SG24-8579-00 (July 2025), PDF pp.370/372,
 * documents 24-hour billing and manual deactivation. APPROX: the game defers removal to the next 06:00.
 */
export function deactivateCod(run: RunState, changeId: number): ChangeOutcome {
  if (run.phase !== 'BRIEFING' && run.phase !== 'LIVE') return { run, ok: false, message: 'On/Off CoD can be changed during the briefing or the live day' };
  const c = run.changes.find((x) => x.id === changeId);
  if (!c || c.status !== 'APPLIED' || c.opexPerDay <= 0 || c.revertDay === null) return { run, ok: false, message: 'No active On/Off CoD order with that id' };
  if (c.revertDay <= run.day + 1) return { run, ok: true, message: 'On/Off CoD already deactivates by tomorrow' };
  const cost = COD_DEACTIVATE_HOURS * engineerHoursMult(run);
  if (run.hoursLeft < cost) return { run, ok: false, message: `Needs ${cost}h` };
  return {
    run: spendHours(logLine({ ...run, changes: run.changes.map((x) => (x.id === changeId ? { ...x, revertDay: run.day + 1 } : x)) }, `On/Off CoD: deactivation scheduled for 06:00 tomorrow (APPROX)`), cost),
    ok: true,
    message: `On/Off CoD deactivates at 06:00 tomorrow (${cost}h)`,
  };
}

/** Cancel a change that has not taken effect yet. Capex is refunded; hours only on the day they were spent. */
export function cancelChange(run: RunState, changeId: number): ChangeOutcome {
  const index = run.changes.findIndex((x) => x.id === changeId);
  const c = run.changes[index];
  if (!c) return { run, ok: false, message: `No planned change ${idText('change', changeId)} (already cancelled or applied?)` };
  if (c.status !== 'PLANNED') return { run, ok: false, message: `Already ${c.status.toLowerCase()}` };
  if (c.activateDay === run.day && run.phase !== 'BRIEFING') return { run, ok: false, message: 'It activates today and the day has started' };
  const refundHours = c.plannedDay === run.day ? c.hours : 0;
  const activation = policyOf(c);
  let laterPolicy: ServiceDefinition | null = null;
  if (activation) for (const later of run.changes.slice(index + 1)) {
    if (later.activateDay === c.activateDay && (later.status === 'PLANNED' || later.status === 'APPLIED'))
      laterPolicy = policyOf(later) ?? laterPolicy;
  }
  const restored = activation && !laterPolicy ? activation : null;
  return {
    ...(restored ? { restoredPolicy: restored } : {}),
    run: logLine(
      { ...run, changes: run.changes.filter((x) => x.id !== changeId), capexRemaining: run.capexRemaining + c.capex, hoursLeft: run.hoursLeft + refundHours },
      `Change cancelled: ${c.label}`,
    ),
    ok: true,
    message: `Cancelled: ${c.label}${refundHours ? ` (${refundHours}h back)` : ''}${c.capex ? ` ($${Math.round(c.capex / 1000)}k capex back)` : ''}${laterPolicy ? `. Later policy ${laterPolicy.policyName} keeps its current edits, including any copied from this request.` : restored ? '. Its edits go back to the pending policy (unless newer edits are pending).' : ''}`,
  };
}

function spendHours(run: RunState, hours: number): RunState {
  const left = run.hoursLeft - hours;
  const overtime = Math.max(0, -left) - Math.max(0, -run.hoursLeft);
  return { ...run, hoursLeft: left, fatigue: Math.min(100, run.fatigue + overtime * FATIGUE_PER_OVERTIME_HOUR) };
}

function policyOf(change: PlannedChange): ServiceDefinition | null {
  for (const command of [...change.commands].reverse()) if (command.kind === 'ACTIVATE_POLICY') return command.definition;
  return null;
}

/** Plain-data leaf paths where `after` differs from `before`; array positions are compared by index. */
function changedLeaves(after: unknown, before: unknown, path = ''): [string, unknown][] {
  if (sameValue(after, before)) return [];
  const bothObjects = after !== null && before !== null && typeof after === 'object' && typeof before === 'object';
  if (!bothObjects || Array.isArray(after) !== Array.isArray(before)) return [[path, after]];
  if (Array.isArray(after) && Array.isArray(before)) {
    const out: [string, unknown][] = [];
    for (let i = 0; i < Math.max(after.length, before.length); i++) out.push(...changedLeaves(after[i], before[i], `${path}.${i}`));
    return out;
  }
  const a = after as Record<string, unknown>, b = before as Record<string, unknown>;
  const out: [string, unknown][] = [];
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) out.push(...changedLeaves(a[k], b[k], `${path}.${k}`));
  return out;
}

function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === (b as unknown[]).length && a.every((x, i) => sameValue(x, (b as unknown[])[i]));
  const ao = a as Record<string, unknown>, bo = b as Record<string, unknown>;
  const keys = Object.keys(ao);
  return keys.length === Object.keys(bo).length && keys.every((k) => sameValue(ao[k], bo[k]));
}

function valueAt(root: unknown, path: string): unknown {
  let cur = root;
  for (const part of path.split('.').slice(1)) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

/** Whether `later` holds every value `failed` changes relative to the briefing's active policy: its edits are live. */
function carriesEdits(base: ServiceDefinition, failed: ServiceDefinition, later: ServiceDefinition): boolean {
  // The policy name is the activation's own name, not an edit; every activation has a new one.
  return changedLeaves(failed, base)
    .filter(([path]) => path !== '.policyName')
    .every(([path, value]) => sameValue(valueAt(later, path), value));
}

export interface LaterPolicyToday {
  failed: PlannedChange;
  /** Name of the later activation that applied today. */
  laterName: string;
  /** Whether that policy carries every edit the failed request made (it was drafted on the failed request's policy). */
  editsLive: boolean;
}

/** Every policy activation that failed at today's start while a later same-day activation applied. */
export function policyFailuresWithLaterToday(run: RunState, base: ServiceDefinition = run.sim.wlm.definition): LaterPolicyToday[] {
  const out: LaterPolicyToday[] = [];
  for (let i = 0; i < run.changes.length; i++) {
    const c = run.changes[i]!;
    if (c.status !== 'FAILED' || c.activateDay !== run.day) continue;
    const failedPolicy = policyOf(c);
    if (!failedPolicy) continue;
    // Several installs can apply; the last one is the policy in effect after the queued commands run.
    let last: LaterPolicyToday | null = null;
    for (let j = i + 1; j < run.changes.length; j++) {
      const later = run.changes[j]!;
      if (later.activateDay !== run.day || later.status !== 'APPLIED') continue;
      const laterPolicy = policyOf(later);
      if (!laterPolicy) continue;
      last = { failed: c, laterName: laterPolicy.policyName, editsLive: carriesEdits(base, failedPolicy, laterPolicy) };
    }
    if (last) out.push(last);
  }
  return out;
}

/** Restore only the latest policy attempt today; an older failure must not replace a later success. */
export function failedPolicyToday(run: RunState): ServiceDefinition | null {
  for (const c of [...run.changes].reverse()) {
    if ((c.status !== 'FAILED' && c.status !== 'APPLIED') || c.activateDay !== run.day) continue;
    const policy = policyOf(c);
    if (policy) return c.status === 'FAILED' ? policy : null;
  }
  return null;
}
