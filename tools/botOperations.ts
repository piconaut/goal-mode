// Report-driven operator choices for the strategy bots (PT-55). These helpers never read incident truth or a
// card's resolved culprits: the target must be identifiable from the same Operations/report rows a player sees.

import type { EventDef } from '../src/content/events/midwest-events';
import { clockAt } from '../src/sim/core/clock';
import type { GatewayMode, Operation, RosterTarget } from '../src/sim/core/operations';
import type { Scenario } from '../src/sim/core/scenario';
import { cicsStorageReach, regionKey } from '../src/game/footprint';
import { buildMon3 } from '../src/game/mon3';
import { operationsView } from '../src/game/operations';
import type { GameContent } from '../src/game/run';
import type { CardOperation } from '../src/game/run/eventEffects';
import { isOpenStatus, otherTeamChangesView, profileOf } from '../src/game/run/otherTeamChanges';
import { db2LockHolder } from '../src/game/smf';
import type { ActiveEvent, RunState } from '../src/game/types';

// Bot heuristics, not simulation coefficients: a culprit group stands clearly above the roster's heavy tail,
// and a gateway surge must be well above its recent same-hour report baseline before protection is chosen.
const ROSTER_TOP_SHARE = 0.25;
const PROCU_TOP_RATIO = 1.5;
const GATEWAY_SURGE_RATIO = 1.5;
const GATEWAY_CLEAR_RATIO = 1.25;
const BASELINE_HOURS = 3;

const textOrder = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;

const median = (xs: readonly number[]): number | undefined => {
  if (xs.length === 0) return undefined;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

function rosterTargets(run: RunState, scenario: Scenario, def: EventDef): CardOperation[] {
  const spec = def.culprits;
  if (!spec) return [];
  const view = operationsView(run, scenario);
  const rows = (spec.entity === 'DDF_THREAD' ? view.threads : view.tso)
    .filter((row) => row.workloadId === spec.workloadId && (!spec.lparIds || spec.lparIds.includes(row.lparId)))
    .sort((a, b) => b.cpuSec - a.cpuSec || textOrder(a.id, b.id));
  if (rows.length === 0 || rows[0]!.cpuSec <= 0) return [];
  const min = typeof spec.count === 'number' ? spec.count : spec.count[0];
  const max = typeof spec.count === 'number' ? spec.count : spec.count[1];
  const floor = rows[0]!.cpuSec * ROSTER_TOP_SHARE;
  const picked = rows.filter((row) => row.cpuSec >= floor).slice(0, max);
  // Too few stand-out entries, or more than the card could explain, means the report does not single out a target.
  if (picked.length < min || (rows[max] && rows[max]!.cpuSec >= floor)) return [];
  return picked.map((row): CardOperation => ({
    kind: 'CANCEL_SESSION',
    target: { kind: row.kind, id: row.id, workloadId: row.workloadId, lparId: row.lparId, day: row.day } satisfies RosterTarget,
  }));
}

function topAddressSpace(run: RunState, scenario: Scenario): CardOperation[] {
  const offered = new Set(operationsView(run, scenario).addressSpaces.map((row) => `${row.jobname}@${row.lparId}`));
  const jobs = (buildMon3(run, scenario).procJobs ?? [])
    .filter((row) => row.cx === 'S' && offered.has(`${row.jobname}@${row.system}`))
    .sort((a, b) => (b.eapplCpEngines + b.eapplZiipEngines) - (a.eapplCpEngines + a.eapplZiipEngines) ||
      textOrder(`${a.system}:${a.jobname}`, `${b.system}:${b.jobname}`));
  const top = jobs[0];
  if (!top || top.eapplCpEngines + top.eapplZiipEngines <= 0) return [];
  const second = jobs[1];
  if (second && (top.eapplCpEngines + top.eapplZiipEngines) <
    (second.eapplCpEngines + second.eapplZiipEngines) * PROCU_TOP_RATIO) return [];
  return [{ kind: 'CANCEL_ADDRESS_SPACE', jobname: top.jobname, lparId: top.system }];
}

function changeTarget(run: RunState, content: GameContent, def: EventDef, event: ActiveEvent): CardOperation[] {
  const profile = profileOf(content.otherTeamChanges, def.id);
  if (!profile) return [];
  const rows = otherTeamChangesView(run, content).filter((row) => isOpenStatus(row.status) && !row.planned &&
    row.owner === profile.owner && row.kind === profile.kind && row.label === `${profile.label} · ${row.id}`);
  const timed = rows.filter((row) => row.startTick === event.startTick);
  // The board's visible label/time must single out one rollout; never fall back to its hidden event link.
  return timed.length === 1 ? [{ kind: 'BACKOUT_CHANGE', changeId: timed[0]!.id }] : [];
}

function utilityTarget(run: RunState, scenario: Scenario): CardOperation[] {
  const rows = operationsView(run, scenario).utilities.filter((row) => row.overrun);
  return rows.length === 1 ? [{ kind: 'TERM_UTILITY', id: rows[0]!.id, member: rows[0]!.member, day: rows[0]!.day }] : [];
}

function lockTarget(run: RunState, scenario: Scenario): CardOperation[] {
  const holder = db2LockHolder(run);
  if (!holder || holder.backoutUntilTick !== undefined) return [];
  const job = operationsView(run, scenario).jobs.find((row) =>
    row.jobname === holder.job && row.lparId === holder.lparId);
  return job ? [{ kind: 'CANCEL_JOB', ...job }] : [];
}

function storageTargets(run: RunState, scenario: Scenario, def: EventDef): CardOperation[] {
  const view = operationsView(run, scenario);
  const regions = typeof def.reach === 'object' && 'regions' in def.reach ? def.reach.regions : view.regions.map((row) => row.name);
  const pressure = new Set(cicsStorageReach(regions, run.sim.last.lpars));
  const targets = view.regions.filter((row) => regions.includes(row.name) && !row.recycle && pressure.has(regionKey(row.name, row.lparId)));
  return targets.length ? [{ kind: 'RECYCLE_CICS', targets: targets.map(({ name, lparId }) => ({ name, lparId })) }] : [];
}

function abendTarget(run: RunState, scenario: Scenario): CardOperation[] {
  const counts = run.sim.last.lpars.flatMap((lpar) => Object.entries(lpar.cicsAbends ?? {}).map(([name, count]) => ({ name, lparId: lpar.lparId, count })));
  const top = counts.sort((a, b) => b.count - a.count || textOrder(`${a.lparId}:${a.name}`, `${b.lparId}:${b.name}`))[0];
  if (!top || top.count <= 0 || (counts[1] && counts[1]!.count === top.count)) return [];
  const region = operationsView(run, scenario).regions.find((row) => row.name === top.name && row.lparId === top.lparId && !row.recycle);
  return region ? [{ kind: 'RECYCLE_CICS', targets: [{ name: region.name, lparId: region.lparId }] }] : [];
}

function arrivalBaseline(run: RunState, workloadId: string): number | undefined {
  const hour = clockAt(run.sim.tick).hourOfDay;
  const recent = run.smfHours.filter((row) => row.day < run.day && row.hourOfDay === hour &&
    (row.workloads[workloadId]?.completions ?? 0) > 0).slice(-BASELINE_HOURS);
  const reported = median(recent.map((row) => row.workloads[workloadId]!.completions / 3600));
  return reported !== undefined && reported > 0 ? reported : undefined;
}

function gatewaySurges(run: RunState, scenario: Scenario) {
  return operationsView(run, scenario).gateway.map((row) => {
    const baseline = arrivalBaseline(run, row.id);
    return { ...row, ratio: baseline !== undefined ? row.offeredRatePerSec / baseline : undefined };
  }).sort((a, b) => (b.ratio ?? -1) - (a.ratio ?? -1) || textOrder(a.id, b.id));
}

function gatewayTarget(run: RunState, scenario: Scenario, mode: GatewayMode): CardOperation[] {
  const [top, second] = gatewaySurges(run, scenario);
  if (!top || top.ratio === undefined || top.ratio < GATEWAY_SURGE_RATIO ||
    (second?.ratio !== undefined && Math.abs(top.ratio - second.ratio) < 1e-9)) return [];
  if (top.mode === mode) return [];
  return [{ kind: 'SET_GATEWAY', workloadId: top.id, mode }];
}

/** Operations whose targets are singled out by current player-visible reports. */
export function operationsForEventReports(run: RunState, scenario: Scenario, content: GameContent, event: ActiveEvent): CardOperation[] {
  const def = content.events.find((row) => row.id === event.defId);
  if (!def || !event.started || event.ended || (event.endTick !== null && event.endTick <= run.sim.tick)) return [];
  switch (def.endedBy?.kind) {
    case 'CANCEL_ADDRESS_SPACE': return topAddressSpace(run, scenario);
    case 'CANCEL_SESSION': return rosterTargets(run, scenario, def);
    case 'CANCEL_JOB': return lockTarget(run, scenario);
    case 'TERM_UTILITY': return utilityTarget(run, scenario);
    case 'RECYCLE_CICS': return abendTarget(run, scenario);
    case 'SET_GATEWAY': return gatewayTarget(run, scenario, def.endedBy.mode);
    case 'BACKOUT_CHANGE': return changeTarget(run, content, def, event);
    default:
      if (def.relief === 'HSM_RECALL') {
        const recalls = operationsView(run, scenario).recalls;
        return !recalls.held && recalls.incomingIops > 0 ? [{ kind: 'HOLD_HSM_RECALL', held: true }] : [];
      }
      if (def.relief === 'CICS_STORAGE') return storageTargets(run, scenario, def);
      return [];
  }
}

/** Protection to clear after its underlying report pressure is gone, not merely because a card ended. */
export function protectionReleases(run: RunState, scenario: Scenario): Operation[] {
  const view = operationsView(run, scenario);
  const out: Operation[] = [];
  if (view.recalls.held && view.recalls.incomingIops === 0) out.push({ kind: 'HOLD_HSM_RECALL', held: false });
  const surges = gatewaySurges(run, scenario);
  for (const row of view.gateway) {
    if (row.mode === null) continue;
    const surge = surges.find((candidate) => candidate.id === row.id);
    if (surge && surge.ratio !== undefined && surge.ratio <= GATEWAY_CLEAR_RATIO) out.push({ kind: 'SET_GATEWAY', workloadId: row.id, mode: null });
  }
  return out;
}
