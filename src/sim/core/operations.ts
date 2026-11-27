import type { UtilityKind } from '../../content/entities';
import { CICS_RECYCLE, HSM_RECALL, SETTLEMENT_BACKOUT_ELAPSED_MULT } from '../../content/operations';
import { lockHolderJob } from '../subsys/batch';
import { activeUtilities } from '../subsys/utilities';
import { dailyRoster, type RosterEntry, type RosterKind } from '../workload/rosters';
import { applyCommand, type CommandResult } from './commands';
import type { Scenario } from './scenario';
import { effectiveWorkloads } from './tick/helpers';
import type { SimState } from './types';
import { TICK_SEC, TICKS_PER_DAY } from './units';

export type RosterTarget = Pick<RosterEntry, 'kind' | 'id' | 'workloadId' | 'lparId'> & { day: number };

export interface CancelledSession extends RosterTarget {
  shareFrac: number;
  atTick: number;
  /** The fluid Db2 reader already accounts for this share of the failed request. */
  cohortAborted: number;
}

export interface TerminatedUtility {
  id: string;
  day: number;
  kind: UtilityKind;
  member: string;
  object: string;
}

export interface CicsTarget {
  name: string;
  lparId: string;
}

export interface CicsRecycle extends CicsTarget {
  startTick: number;
  restartTick: number;
}

export type GatewayMode = 'LIMIT' | 'BACKOFF' | 'BLOCK';

export interface HsmRecalls {
  heldSinceTick: number | null;
  backlogIo: number;
}

export const recallHeld = (recalls: HsmRecalls | undefined): boolean => recalls?.heldSinceTick != null;

export type Operation =
  | { kind: 'CANCEL_JOB'; day: number; jobname: string; lparId: string }
  | { kind: 'CANCEL_ADDRESS_SPACE'; jobname: string; lparId: string }
  | { kind: 'CANCEL_SESSION'; target: RosterTarget }
  | { kind: 'TERM_UTILITY'; id: string; member: string; day: number }
  | { kind: 'RECYCLE_CICS'; targets: CicsTarget[] }
  | { kind: 'SET_GATEWAY'; workloadId: string; mode: GatewayMode | null }
  | { kind: 'HOLD_HSM_RECALL'; held: boolean };

const dayAt = (tick: number) => Math.floor(tick / TICKS_PER_DAY);

function sameSession(a: RosterTarget, b: RosterTarget): boolean {
  return a.kind === b.kind && a.day === b.day && a.id === b.id && a.workloadId === b.workloadId && a.lparId === b.lparId;
}

export function operatorRoster(s: SimState, scenario: Scenario, kind: RosterKind, workloadId?: string): (RosterEntry & { day: number })[] {
  const day = dayAt(s.tick);
  const subsystem = kind === 'DDF_THREAD' ? 'DDF' : 'TSO';
  const effective = effectiveWorkloads(scenario, s);
  const listed: (RosterEntry & { day: number })[] = effective
    .filter((w) => w.subsystem === subsystem && (workloadId === undefined || workloadId === w.id))
    .flatMap((w) => dailyRoster(s.seed, day, w, w.routing, kind).map((entry) => ({ ...entry, day })));
  // A loaded entity keeps running on its image after routing moves its workload away (RF-11), so it stays listed there
  // with no share of the workload's own CPU, until it is cancelled or its card ends.
  for (const l of s.entityLoads ?? []) {
    if (l.kind !== kind || (workloadId !== undefined && l.workloadId !== workloadId)) continue;
    const same = (e: RosterEntry) => e.kind === l.kind && e.id === l.id && e.workloadId === l.workloadId && e.lparId === l.lparId;
    if (listed.some(same)) continue;
    const w = effective.find((x) => x.id === l.workloadId);
    if (!w) continue;
    listed.push({
      kind: l.kind, id: l.id, workloadId: l.workloadId, lparId: l.lparId, shareFrac: 0, day,
      ...(kind === 'DDF_THREAD' ? { authid: w.work.UI ?? w.id, corrid: w.work.CI ?? w.id } : {}),
    });
  }
  return listed.filter((entry) => !s.cancelledSessions?.some((old) => sameSession(old, entry)));
}

export function gatewayChannels(s: SimState, scenario: Scenario) {
  return [...scenario.workloads, ...s.extraWorkloads].filter((w) =>
    w.stakeholder !== 'Internal' && w.sla.kind !== 'NONE' && (w.subsystem === 'CICS' || w.subsystem === 'DDF' || w.subsystem === 'OMVS'));
}

function releaseReader(s: SimState, scenario: Scenario, target: RosterTarget): { env: SimState['env']; aborted: number } {
  const state = s.env.db2Contention;
  const member = s.config.db2.find((m) => m.lparId === target.lparId)?.ssid;
  const old = member === undefined ? undefined : state?.readers[member];
  if (!state || !member || !old?.count || scenario.db2Contention?.reader !== target.workloadId) return { env: s.env, aborted: 0 };
  const aborted = Math.min(1, old.count);
  const count = old.count - aborted;
  const leftFrac = count / old.count;
  const reader = {
    ...old,
    count,
    ageSec: count > 0 ? old.ageSec : 0,
    cpRefSec: old.cpRefSec * leftFrac,
    ziipRefSec: old.ziipRefSec * leftFrac,
    workByPeriod: count > 0 ? old.workByPeriod.map((w) => ({ cpRefSec: w.cpRefSec * leftFrac, ziipRefSec: w.ziipRefSec * leftFrac })) : [],
    cancelled: (old.cancelled ?? 0) + aborted,
  };
  return { env: { ...s.env, db2Contention: { ...state, readers: { ...state.readers, [member]: reader } } }, aborted };
}

export function applyOperation(s: SimState, scenario: Scenario, op: Operation): CommandResult {
  const ok = (state: SimState, message: string): CommandResult => ({ state, ok: true, message });
  const fail = (message: string): CommandResult => ({ state: s, ok: false, message });

  switch (op.kind) {
    case 'CANCEL_ADDRESS_SPACE':
      return applyCommand(s, op, scenario.addressSpaces);
    case 'CANCEL_JOB': {
      const job = s.batch.jobs.find((j) => j.day === op.day && j.def.name === op.jobname && j.lparId === op.lparId && j.status === 'RUNNING');
      if (!job) return fail(`IEE341I ${op.jobname} NOT ACTIVE on ${op.lparId}`);
      // CANCEL without DUMP ends the job with system completion code 222; 122 is CANCEL with DUMP
      // (z/OS 3.1 MVS System Codes SA38-0665-60 PDF p.336 (printed 324) and PDF p.253 (printed 241)).
      const holder = s.mods.lockHolder;
      // APPROX: back out the active batch attempt and retain its modeled locks through completion.
      // Db2 13 Managing Performance PDF p.116 (printed 96), PDF p.355 (printed 335).
      const lockBackout = holder && lockHolderJob(s.mods, s.batch.jobs) === job ? {
        untilTick: s.tick + Math.max(1, Math.ceil((s.tick - (job.startTick ?? s.tick)) * SETTLEMENT_BACKOUT_ELAPSED_MULT)),
        lockIndex: s.mods.lockBoost + job.def.lockIntensity,
        object: holder.object,
      } : undefined;
      const jobs = s.batch.jobs.map((j) => j === job
        ? { ...j, status: 'ABENDED' as const, abended: true, failCode: 'S222', failTick: s.tick, endTick: s.tick + 1,
          ...(lockBackout ? { lockBackout } : {}) }
        : j);
      return ok({ ...s, batch: { ...s.batch, jobs } }, `CANCEL ${op.jobname}: ABEND S222 on ${op.lparId}`);
    }
    case 'CANCEL_SESSION': {
      const target = op.target;
      const entry = operatorRoster(s, scenario, target.kind, target.workloadId).find((e) => sameSession(e, target));
      if (!entry) return fail(`${target.id} is no longer active on ${target.lparId}`);
      const { env, aborted } = target.kind === 'DDF_THREAD' ? releaseReader(s, scenario, target) : { env: s.env, aborted: 0 };
      const loads = s.entityLoads?.filter((load) =>
        load.kind !== target.kind || load.id !== target.id || load.workloadId !== target.workloadId || load.lparId !== target.lparId);
      const { entityLoads: _oldLoads, ...rest } = s;
      const cancelledSessions = [...(s.cancelledSessions ?? []), { ...target, shareFrac: entry.shareFrac, atTick: s.tick, cohortAborted: aborted }];
      const state = { ...rest, ...(loads?.length ? { entityLoads: loads } : {}), env, cancelledSessions };
      const name = target.kind === 'DDF_THREAD' ? `-CANCEL THREAD(${target.id})` : `CANCEL U=${target.id}`;
      return ok(state, `${name} on ${target.lparId}`);
    }
    case 'TERM_UTILITY': {
      const day = dayAt(s.tick);
      const active = activeUtilities(scenario.utilities, s.seed, s.tick, s.utilityOverruns, s.terminatedUtilities);
      const target = op.day === day && active.find(({ def }) => def.id === op.id && def.member === op.member);
      if (!target) return fail(`${op.id} is no longer active on ${op.member}`);
      const { utilityOverruns, ...rest } = s;
      const left = utilityOverruns?.filter((overrun) => overrun.kind !== target.def.kind);
      const terminatedUtilities = [
        ...(s.terminatedUtilities ?? []).filter((u) => u.id !== op.id),
        { id: op.id, day, kind: target.def.kind, member: op.member, object: target.def.object },
      ];
      return ok({ ...rest, ...(left?.length ? { utilityOverruns: left } : {}), terminatedUtilities }, `-TERM UTILITY(${op.id}) on ${op.member}`);
    }
    case 'RECYCLE_CICS': {
      if (!op.targets.length) return fail('Select at least one CICS region.');
      const sameRegion = (a: CicsTarget, b: CicsTarget) => a.name === b.name && a.lparId === b.lparId;
      const scheduled = s.cicsRecycles?.filter((r) => r.restartTick > s.tick) ?? [];
      let startTick = scheduled[scheduled.length - 1]?.restartTick ?? s.tick;
      const durationTicks = Math.ceil(CICS_RECYCLE.restartMin * 60 / TICK_SEC);
      for (const target of op.targets) {
        const { name, lparId } = target;
        if (!s.config.cics.some((r) => sameRegion(r, target))) return fail(`CICS region ${name} is not defined on ${lparId}.`);
        if (scheduled.some((r) => sameRegion(r, target))) return fail(`CICS region ${name} on ${lparId} already has a restart scheduled.`);
        const restartTick = startTick + durationTicks;
        scheduled.push({ name, lparId, startTick, restartTick });
        startTick = restartTick;
      }
      return ok({ ...s, cicsRecycles: scheduled }, `Recycle CICS: ${op.targets.map((r) => `${r.name}@${r.lparId}`).join(', ')}`);
    }
    case 'SET_GATEWAY': {
      const target = gatewayChannels(s, scenario).find((w) => w.id === op.workloadId);
      if (!target) return fail(`${op.workloadId} is not an external gateway channel.`);
      const { gatewayModes, ...rest } = s;
      const { [target.id]: old, ...modes } = gatewayModes ?? {};
      if ((old ?? null) === op.mode) return fail(`Gateway protection for ${target.name} is already set to ${op.mode ?? 'off'}.`);
      if (op.mode !== null) modes[target.id] = op.mode;
      return ok({ ...rest, ...(Object.keys(modes).length ? { gatewayModes: modes } : {}) }, `Gateway ${target.name}: ${op.mode ?? 'OFF'}`);
    }
    case 'HOLD_HSM_RECALL': {
      if (!s.config.dasd.lcus.some((l) => l.id === HSM_RECALL.lcuId)) return fail('No DFSMShsm recall volume is defined.');
      const { hsmRecalls, ...rest } = s;
      const held = recallHeld(hsmRecalls);
      if (op.held === held) return fail(held ? 'DFSMShsm recalls are already held.' : 'DFSMShsm recalls are already released.');
      const backlogIo = hsmRecalls?.backlogIo ?? 0;
      const recalls = { heldSinceTick: op.held ? s.tick : null, backlogIo };
      return ok(op.held || backlogIo > 0 ? { ...rest, hsmRecalls: recalls } : rest, op.held ? 'HSM recalls HELD' : 'HSM recalls RELEASED');
    }
  }
}

/** A fresh roster replaces yesterday's sessions. A later completed utility replaces a missed run. */
export function rolloverOperations(s: SimState, scenario: Scenario): SimState {
  const day = dayAt(s.tick);
  const { cancelledSessions, terminatedUtilities } = s;
  const sessions = cancelledSessions?.filter((e) => e.day >= day);
  let utilities = terminatedUtilities;
  if (terminatedUtilities?.some((u) => u.day < day)) {
    const before = activeUtilities(scenario.utilities, s.seed, s.tick - 1, s.utilityOverruns, terminatedUtilities);
    const now = activeUtilities(scenario.utilities, s.seed, s.tick, s.utilityOverruns, terminatedUtilities);
    utilities = terminatedUtilities.filter((u) => !before.some((a) => a.def.id === u.id) || now.some((a) => a.def.id === u.id));
  }
  if (sessions?.length === cancelledSessions?.length && utilities?.length === terminatedUtilities?.length) return s;
  const { cancelledSessions: _sessions, terminatedUtilities: _utilities, ...rest } = s;
  return { ...rest, ...(sessions?.length ? { cancelledSessions: sessions } : {}), ...(utilities?.length ? { terminatedUtilities: utilities } : {}) };
}
