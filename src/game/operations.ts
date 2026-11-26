import { GATEWAY_TRAFFIC_CARDS, OPERATION_TRUST, OPERATIONS } from '../content/operations';
import { STC_AUTOMATION } from '../content/entities';
import { applyOperation, gatewayChannels, operatorRoster, type Operation } from '../sim/core/operations';
import type { Scenario } from '../sim/core/scenario';
import { effectiveAddressSpaces } from '../sim/core/tick/helpers';
import { TICK_SEC, TICKS_PER_DAY, TICKS_PER_HOUR } from '../sim/core/units';
import type { GatewayTraffic } from '../sim/core/tick/operatorEffects';
import { activeUtilities } from '../sim/subsys/utilities';
import { rosterCpuSec, type RosterEntry, type RosterKind } from '../sim/workload/rosters';
import { previewContext, spendHours, type ChangeOutcome } from './run/changes';
import { poolUse } from './displaceable';
import { difficultyOf, scaleExcess } from './difficulty';
import { hostImages } from './footprint';
import { allWorkloads } from './workloads';
import { clampTrust, facetOf, logLine, type GameContent } from './run/shared';
import type { RunState } from './types';

export function operationHours(op: Operation, staffMult = 1): number {
  switch (op.kind) {
    case 'TERM_UTILITY': return OPERATIONS.terminateUtilityHours * staffMult;
    case 'RECYCLE_CICS': return OPERATIONS.cicsHours * staffMult;
    case 'SET_GATEWAY': return OPERATIONS.gatewayHours * staffMult;
    case 'HOLD_HSM_RECALL': return OPERATIONS.hsmHours * staffMult;
    case 'CANCEL_SESSION': return OPERATIONS.cancelHours * staffMult + (op.target.kind === 'TSO_USER' ? OPERATIONS.tsoHoursLost : 0);
    default: return OPERATIONS.cancelHours * staffMult;
  }
}

/** Legacy cards already describe the additional traffic as an arrival multiplier. The edge reads the cards, not the
 * live `mods.rate`, so overlapping rate cards keep the pre-existing last-begin-wins approximation. */
export function gatewaySources(run: RunState, content: GameContent, excluded?: ReadonlySet<string>): Record<string, GatewayTraffic> {
  const result: Record<string, GatewayTraffic> = {};
  for (const e of run.events) {
    const source = GATEWAY_TRAFFIC_CARDS[e.defId];
    if (!source || e.ended || excluded?.has(e.uid) || e.startTick > run.sim.tick || (e.endTick !== null && e.endTick <= run.sim.tick)) continue;
    const def = content.events.find((d) => d.id === e.defId);
    const severity = def?.fixedSeverity ? 1 : difficultyOf(run.difficulty).eventSeverityMult;
    for (const cmd of def?.begin ?? []) {
      if (cmd.kind !== 'SET_MODIFIER' || cmd.mod !== 'rate') continue;
      (result[cmd.key] ??= {})[source] = scaleExcess(cmd.value, severity);
    }
  }
  return result;
}

/** The first of `facets` the run tracks (none when it has none of them). */
const firstFacet = (run: RunState, facets: readonly string[]): string[] => {
  const facet = facets.find((f) => run.trust[f] !== undefined);
  return facet === undefined ? [] : [facet];
};

function loseTrust(run: RunState, facets: Iterable<string>, amount: number): RunState {
  const trust = { ...run.trust };
  for (const facet of facets) if (trust[facet] !== undefined) trust[facet] = clampTrust(trust[facet]! - amount);
  return { ...run, trust };
}

export function chargeHeldRecalls(run: RunState, tick: number): RunState {
  const since = run.sim.hsmRecalls?.heldSinceTick;
  if (since == null || (tick - since + 1) % TICKS_PER_HOUR !== 0) return run;
  return loseTrust(run, firstFacet(run, OPERATION_TRUST.hsmFacets), OPERATIONS.hsmTrustPerHour);
}

export function requestOperation(run: RunState, scenario: Scenario, content: GameContent, op: Operation): ChangeOutcome {
  if (run.phase !== 'LIVE') return { run, ok: false, message: 'Operator commands run during the live day.' };
  const result = applyOperation(run.sim, scenario, op);
  if (!result.ok) return { run, ok: false, message: result.message };
  const tso = op.kind === 'CANCEL_SESSION' && op.target.kind === 'TSO_USER';
  const surcharge = previewContext(run, content).staffSurcharge?.mult ?? 1;
  let next = spendHours({ ...run, sim: result.state }, operationHours(op, surcharge));
  let message = result.message;
  if (tso) {
    next = loseTrust(next, firstFacet(next, OPERATION_TRUST.tsoFacets), OPERATIONS.tsoTrust);
  } else if (op.kind === 'CANCEL_ADDRESS_SPACE' && op.jobname === OPERATION_TRUST.journalJobname) {
    next = loseTrust(next, OPERATION_TRUST.journalFacets, OPERATIONS.journalTrust);
  } else if (op.kind === 'TERM_UTILITY') {
    next = loseTrust(next, OPERATION_TRUST.utilityFacets, OPERATIONS.utilityTrust);
  } else if (op.kind === 'RECYCLE_CICS') {
    const owners = new Set(allWorkloads(scenario, run).flatMap((w) => {
      const facet = w.subsystem === 'CICS' &&
        op.targets.some((r) => hostImages(run.sim.routing[w.id] ?? w.routing).includes(r.lparId)) ? facetOf(w) : null;
      return facet === null ? [] : [facet];
    }));
    next = loseTrust(next, owners, OPERATIONS.cicsTrust);
  } else if (op.kind === 'SET_GATEWAY' && op.mode !== null) {
    const owner = gatewayChannels(run.sim, scenario).find((w) => w.id === op.workloadId)!.stakeholder;
    next = loseTrust(next, [owner], OPERATIONS.gatewayTrust);
    if (op.mode === 'BLOCK' && gatewaySources(run, content)[op.workloadId]?.attackRateMult === undefined) message += '. Edge team: no unusual source addresses.';
  }
  return { run: logLine(next, message), ok: true, message };
}

interface RosterGroup {
  workloadId: string;
  lparId: string;
  shareSum: number;
  entries: (RosterEntry & { day: number })[];
}

function rosterView(run: RunState, scenario: Scenario, kind: RosterKind) {
  const { sim } = run;
  const groups = new Map<string, RosterGroup>();
  for (const e of operatorRoster(sim, scenario, kind)) {
    const key = `${e.workloadId}@${e.lparId}`;
    let group = groups.get(key);
    if (!group) groups.set(key, group = { workloadId: e.workloadId, lparId: e.lparId, shareSum: 0, entries: [] });
    group.entries.push(e);
    group.shareSum += e.shareFrac;
  }
  return [...groups.values()].flatMap(({ workloadId, lparId, shareSum, entries }) => {
    const grant = sim.last.lpars.find((l) => l.lparId === lparId)?.cpByWorkload?.[workloadId];
    const measuredCpuSec = grant ? (poolUse(grant, 'CP') + poolUse(grant, 'ZIIP')) * TICK_SEC : 0;
    const cpuSec = rosterCpuSec(entries.map((e) => ({ ...e, shareFrac: e.shareFrac / shareSum })), measuredCpuSec, sim.entityLoads);
    const member = sim.config.db2.find((m) => m.lparId === lparId)?.ssid;
    return entries.map((e) => ({ ...e, cpuSec: cpuSec[e.id] ?? 0, member }));
  }).sort((a, b) => b.cpuSec - a.cpuSec);
}

type OperationsView = ReturnType<typeof buildOperationsView>;
const viewCache = new WeakMap<RunState, { scenario: Scenario; view: OperationsView }>();

/** The view is read on every frame; rebuild it only when the run or its scenario changes. */
export function operationsView(run: RunState, scenario: Scenario): OperationsView {
  const hit = viewCache.get(run);
  if (hit?.scenario === scenario) return hit.view;
  const view = buildOperationsView(run, scenario);
  viewCache.set(run, { scenario, view });
  return view;
}

function buildOperationsView(run: RunState, scenario: Scenario) {
  const { sim } = run;
  const day = Math.floor(sim.tick / TICKS_PER_DAY);
  return {
    jobs: sim.batch.jobs.flatMap((j) => j.status === 'RUNNING' && j.lparId
      ? [{ day: j.day, jobname: j.def.name, lparId: j.lparId }]
      : []),
    addressSpaces: effectiveAddressSpaces(scenario, sim)
      .filter((a) => !a.role && !STC_AUTOMATION.noCancel.includes(a.jobname))
      .map(({ jobname, lparId }) => ({ jobname, lparId })),
    tso: rosterView(run, scenario, 'TSO_USER'),
    threads: rosterView(run, scenario, 'DDF_THREAD'),
    utilities: activeUtilities(scenario.utilities, sim.seed, sim.tick, sim.utilityOverruns, sim.terminatedUtilities)
      .map(({ def: { id, kind, member, object }, overrun }) => ({ id, kind, member, object, overrun, day })),
    missedUtilities: sim.terminatedUtilities ?? [],
    regions: sim.config.cics.map(({ name, lparId }) => ({
      name, lparId, recycle: sim.cicsRecycles?.find((r) => r.name === name && r.lparId === lparId && r.restartTick > sim.tick) ?? null,
    })),
    gateway: gatewayChannels(sim, scenario).map(({ id, name }) => ({ id, name, mode: sim.gatewayModes?.[id] ?? null })),
    recalls: { held: sim.hsmRecalls?.heldSinceTick != null, backlogIo: sim.hsmRecalls?.backlogIo ?? 0 },
  };
}
