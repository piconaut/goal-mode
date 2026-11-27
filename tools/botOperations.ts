// Report-driven operator choices for the strategy bots (PT-55). These helpers never read incident truth or a
// card's resolved culprits: the target must be identifiable from the same Operations/report rows a player sees.

import type { EventDef } from '../src/content/events/midwest-events';
import { minuteKey } from '../src/sim/core/clock';
import { median } from '../src/sim/core/math';
import type { GatewayMode, Operation, RosterTarget } from '../src/sim/core/operations';
import type { Scenario } from '../src/sim/core/scenario';
import { effectiveAddressSpaces } from '../src/sim/core/tick/helpers';
import { classify } from '../src/sim/wlm/classify';
import { cicsStorageReach, regionKey } from '../src/game/footprint';
import { buildMon3 } from '../src/game/mon3';
import { operationsView } from '../src/game/operations';
import type { GameContent } from '../src/game/run';
import type { CardOperation } from '../src/game/run/eventEffects';
import { cardLive } from '../src/game/run/shared';
import { isOpenStatus, labelFor, otherTeamChangesView, profileOf } from '../src/game/run/otherTeamChanges';
import { db2LockHolder } from '../src/game/smf';
import type { ActiveEvent, RunState } from '../src/game/types';

// Bot heuristics, not simulation coefficients: a culprit group stands clearly above the roster's heavy tail,
// and a gateway surge must be well above its recent same-hour report baseline before protection is chosen.
const ROSTER_TOP_SHARE = 0.25;
const PROCU_TOP_RATIO = 1.5;
const PROCU_MIN_ENGINES = 0.25;
const PROCU_MIN_ELEVATION = 4;
const GATEWAY_SURGE_RATIO = 1.5;
const GATEWAY_CLEAR_RATIO = 1.25;
const GATEWAY_AMBIGUITY_MARGIN = 0.1;
// SMF keeps 48 hours, so a prior-day same-hour median has at most two rows; asking for three would read as if a
// third day existed.
const BASELINE_HOURS = 2;

const textOrder = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;

function rosterTargets(run: RunState, scenario: Scenario, def: EventDef): CardOperation[] {
  const spec = def.culprits;
  if (!spec) return [];
  const view = operationsView(run, scenario);
  const rows = (spec.entity === 'DDF_THREAD' ? view.threads : view.tso)
    .filter((row) => row.workloadId === spec.workloadId && (!spec.lparIds || spec.lparIds.includes(row.lparId)))
    .sort((a, b) => b.cpuSec - a.cpuSec || textOrder(a.id, b.id));
  if (rows.length === 0 || rows[0]!.cpuSec <= 0) return [];
  const [min, max] = typeof spec.count === 'number' ? [spec.count, spec.count] : spec.count;
  const floor = rows[0]!.cpuSec * ROSTER_TOP_SHARE;
  const picked = rows.filter((row) => row.cpuSec >= floor);
  // Too few stand-out entries, or more than the card could explain, means the report does not single out a target.
  if (picked.length < min || picked.length > max) return [];
  return picked.map((row): CardOperation => ({
    kind: 'CANCEL_SESSION',
    target: { kind: row.kind, id: row.id, workloadId: row.workloadId, lparId: row.lparId, day: row.day } satisfies RosterTarget,
  }));
}

function topAddressSpace(run: RunState, scenario: Scenario, def: EventDef): CardOperation[] {
  const effect = def.endedBy;
  if (effect?.kind !== 'CANCEL_ADDRESS_SPACE') return [];
  const spaces = effectiveAddressSpaces(scenario, run.sim);
  // The card's clue names the looping job and its service class ("CICSXLOG ... the top consumer in STCHI"), so
  // that class is the card's visible scope, not the hidden answer: the target itself must still be the class's
  // clear top consumer in the current PROCU report.
  const expected = spaces.find((row) => row.jobname === effect.jobname && row.lparId === effect.lparId);
  if (!expected) return [];
  const serviceClass = classify(run.sim.wlm.definition, {
    subsystem: expected.subsystem, TN: expected.jobname, SY: expected.lparId,
  }).serviceClass;
  const offered = new Set(operationsView(run, scenario).addressSpaces.map((row) => regionKey(row.jobname, row.lparId)));
  const jobs = (buildMon3(run, scenario).procJobs ?? [])
    .filter((row) => row.cx === 'S' && row.serviceClass === serviceClass && offered.has(regionKey(row.jobname, row.system)))
    .sort((a, b) => (b.eapplCpEngines + b.eapplZiipEngines) - (a.eapplCpEngines + a.eapplZiipEngines) ||
      textOrder(`${a.system}:${a.jobname}`, `${b.system}:${b.jobname}`));
  const top = jobs[0];
  if (!top) return [];
  const engines = top.eapplCpEngines + top.eapplZiipEngines;
  const base = spaces.find((row) => row.jobname === top.jobname && row.lparId === top.system)?.baseEnginesRef ?? 0;
  if (engines < Math.max(PROCU_MIN_ENGINES, base * PROCU_MIN_ELEVATION)) return [];
  const second = jobs[1];
  if (second && engines < (second.eapplCpEngines + second.eapplZiipEngines) * PROCU_TOP_RATIO) return [];
  return [{ kind: 'CANCEL_ADDRESS_SPACE', jobname: top.jobname, lparId: top.system }];
}

function changeTarget(run: RunState, content: GameContent, def: EventDef, event: ActiveEvent): CardOperation[] {
  const profile = profileOf(content.otherTeamChanges, def.id);
  if (!profile) return [];
  const rows = otherTeamChangesView(run, content).filter((row) => isOpenStatus(row.status) && !row.planned &&
    row.owner === profile.owner && row.kind === profile.kind && row.label === labelFor(profile, row.id));
  const timed = rows.filter((row) => minuteKey(row.startTick) === minuteKey(event.startTick));
  // The board's visible label and minute must single out one rollout; never fall back to its hidden event link.
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
  const stats = run.smfHours.at(-1)?.cicsStorage ?? {};
  const rows = Object.entries(stats).filter(([, row]) => (row.abends ?? 0) > 0)
    .map(([name, row]) => ({ name, count: row.abends ?? 0 }))
    .sort((a, b) => b.count - a.count || textOrder(a.name, b.name));
  const top = rows[0];
  if (!top || (rows[1] && rows[1]!.count === top.count)) return [];
  const regions = operationsView(run, scenario).regions.filter((row) => row.name === top.name && !row.recycle);
  return regions.length === 1 ? [{ kind: 'RECYCLE_CICS', targets: [{ name: regions[0]!.name, lparId: regions[0]!.lparId }] }] : [];
}

function arrivalBaseline(run: RunState, workloadId: string): number | undefined {
  const current = run.smfHours.at(-1);
  if (!current) return undefined;
  const recent = run.smfHours.slice(0, -1)
    .filter((row) => row.day < current.day && row.hourOfDay === current.hourOfDay)
    .flatMap((row) => {
      const offered = row.workloads[workloadId]?.offeredArrivals ?? 0;
      return offered > 0 ? [offered / 3600] : [];
    })
    .slice(-BASELINE_HOURS);
  return median(recent);
}

/** Gateway rows with each channel's offered traffic against its prior-day same-hour baseline. */
function gatewaySurges(run: RunState, scenario: Scenario, view = operationsView(run, scenario)) {
  return view.gateway.map((row) => {
    const baseline = arrivalBaseline(run, row.id);
    return {
      ...row,
      ratio: row.offeredBasis === 'CLOSED' && baseline !== undefined ? row.offeredAvgPerSec / baseline : undefined,
    };
  });
}

function gatewayTarget(run: RunState, scenario: Scenario, def: EventDef, mode: GatewayMode): CardOperation[] {
  // The card's symptom names the affected workload(s), so only those channels are candidates: an unrelated
  // channel that happens to surge harder is not what the card's report points at, and protecting it would shed
  // real traffic and leave the card unresolved. A stronger surge elsewhere must not veto the card's own channel.
  const affected = new Set(def.affects);
  const [top, second] = gatewaySurges(run, scenario)
    .filter((row) => affected.has(row.id))
    .sort((a, b) => (b.ratio ?? -1) - (a.ratio ?? -1) || textOrder(a.id, b.id));
  if (!top || top.ratio === undefined || top.ratio < GATEWAY_SURGE_RATIO ||
    (second?.ratio !== undefined && second.ratio >= top.ratio * (1 - GATEWAY_AMBIGUITY_MARGIN))) return [];
  if (top.mode === mode) return [];
  return [{ kind: 'SET_GATEWAY', workloadId: top.id, mode }];
}

/** Operations whose targets are singled out by current player-visible reports. */
export function operationsForEventReports(run: RunState, scenario: Scenario, content: GameContent, event: ActiveEvent): CardOperation[] {
  const def = content.events.find((row) => row.id === event.defId);
  if (!def || !cardLive(event, run.sim.tick)) return [];
  switch (def.endedBy?.kind) {
    case 'CANCEL_ADDRESS_SPACE': return topAddressSpace(run, scenario, def);
    case 'CANCEL_SESSION': return rosterTargets(run, scenario, def);
    case 'CANCEL_JOB': return lockTarget(run, scenario);
    case 'TERM_UTILITY': return utilityTarget(run, scenario);
    case 'RECYCLE_CICS': return abendTarget(run, scenario);
    case 'SET_GATEWAY': return gatewayTarget(run, scenario, def, def.endedBy.mode);
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
  for (const row of gatewaySurges(run, scenario, view)) {
    if (row.mode !== null && row.ratio !== undefined && row.ratio <= GATEWAY_CLEAR_RATIO) {
      out.push({ kind: 'SET_GATEWAY', workloadId: row.id, mode: null });
    }
  }
  return out;
}
