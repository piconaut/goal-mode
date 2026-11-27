import { OPERATION_TRUST, OPERATIONS } from '../content/operations';
import { STC_AUTOMATION } from '../content/entities';
import { applyOperation, gatewayChannels, operatorRoster, type GatewayMode, type Operation } from '../sim/core/operations';
import type { Scenario } from '../sim/core/scenario';
import { effectiveAddressSpaces } from '../sim/core/tick/helpers';
import { TICK_SEC, TICKS_PER_DAY, TICKS_PER_HOUR } from '../sim/core/units';
import { recallIncomingIops } from '../sim/core/tick/operatorEffects';
import { activeUtilities } from '../sim/subsys/utilities';
import { rosterCpuSec, type RosterEntry, type RosterKind } from '../sim/workload/rosters';
import { endEventsByOperation } from './run/events';
import { previewContext, spendHours, type ChangeOutcome } from './run/changes';
import { poolUse } from './displaceable';
import { hostImages } from './footprint';
import { allWorkloads } from './workloads';
import { facetOf, logLine, loseTrust, type GameContent } from './run/shared';
import type { RunState } from './types';

/** Which offered-traffic reading a gateway row shows: a closed hour, the current tick, or admitted traffic. */
export type OfferedBasis = 'CLOSED' | 'TICK' | 'ADMITTED';

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

/** The first of `facets` the run tracks (none when it has none of them). */
const firstFacet = (run: RunState, facets: readonly string[]): string[] => {
  const facet = facets.find((f) => run.trust[f] !== undefined);
  return facet === undefined ? [] : [facet];
};

/** External channels under a gateway protection mode, for the day's report card (PT-20 rule 6: toggled state is
 * visible). The mode in force when the report is taken; a channel switched off before the day closed is not listed. */
export function gatewayStatus(run: RunState, scenario: Scenario): { id: string; name: string; mode: GatewayMode }[] {
  const modes = run.sim.gatewayModes;
  if (!modes) return [];
  return gatewayChannels(run.sim, scenario).flatMap(({ id, name }) => {
    const mode = modes[id];
    return mode === undefined ? [] : [{ id, name, mode }];
  });
}

/** The DFSMShsm recall state for a report: held (and since when) and the I/O queued. Null when recalls are neither
 * held nor backlogged, so a released-and-drained queue prints no line. */
export function recallStatus(run: RunState): { held: boolean; heldSinceTick: number | null; backlogIo: number } | null {
  const recalls = run.sim.hsmRecalls;
  if (!recalls) return null;
  const held = recalls.heldSinceTick != null;
  return held || recalls.backlogIo > 0 ? { held, heldSinceTick: recalls.heldSinceTick, backlogIo: recalls.backlogIo } : null;
}

export function chargeHeldRecalls(run: RunState, tick: number): RunState {
  const since = run.sim.hsmRecalls?.heldSinceTick;
  if (since == null || (tick - since + 1) % TICKS_PER_HOUR !== 0) return run;
  return loseTrust(run, firstFacet(run, OPERATION_TRUST.hsmFacets), OPERATIONS.hsmTrustPerHour);
}

export function requestOperation(run: RunState, scenario: Scenario, content: GameContent, op: Operation, prepaid = false): ChangeOutcome {
  if (run.phase !== 'LIVE') return { run, ok: false, message: 'Operator commands run during the live day.' };
  const result = applyOperation(run.sim, scenario, op);
  if (!result.ok) return { run, ok: false, message: result.message };
  const tso = op.kind === 'CANCEL_SESSION' && op.target.kind === 'TSO_USER';
  const surcharge = previewContext(run, content).staffSurcharge?.mult ?? 1;
  let next = { ...run, sim: result.state };
  if (!prepaid) next = spendHours(next, operationHours(op, surcharge));
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
    if (op.mode === 'BLOCK' && run.sim.mods.gatewaySources?.[op.workloadId]?.attackRateMult === undefined) message += '. Edge team: no unusual source addresses.';
  }
  return { run: logLine(endEventsByOperation(run, next, scenario, content, op), message), ok: true, message };
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
    gateway: gatewayChannels(sim, scenario).map(({ id, name }) => {
      const last = sim.last.workloads.find((w) => w.id === id);
      const closedOffered = run.smfHours.at(-1)?.workloads[id]?.offeredArrivals;
      const tickOffered = last?.offeredRate;
      // Say which figure is shown: the closed-hour offered average, the current offered tick, or (on a pre-PT-55
      // save) admitted traffic, which is all the run has. Protection hides offered pressure, not these readings.
      const offeredBasis: OfferedBasis = closedOffered !== undefined ? 'CLOSED'
        : tickOffered !== undefined ? 'TICK' : 'ADMITTED';
      return {
        id, name, mode: sim.gatewayModes?.[id] ?? null, offeredBasis,
        offeredAvgPerSec: closedOffered !== undefined ? closedOffered / 3600
          : tickOffered ?? last?.arrivalRate ?? 0,
      };
    }),
    recalls: {
      held: sim.hsmRecalls?.heldSinceTick != null,
      backlogIo: sim.hsmRecalls?.backlogIo ?? 0,
      incomingIops: recallIncomingIops(sim),
    },
  };
}
