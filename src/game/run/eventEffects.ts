import type { CicsTarget, Operation, RosterTarget } from '../../sim/core/operations';

import type { EventEffect } from '../../content/events/effects';
import type { EventDef } from '../../content/events/midwest-events';
import { operatorRoster } from '../../sim/core/operations';
import type { Scenario } from '../../sim/core/scenario';
import { TICKS_PER_DAY } from '../../sim/core/units';
import { lockHolderJob } from '../../sim/subsys/batch';
import { activeUtilities } from '../../sim/subsys/utilities';
import type { ActiveEvent, RunState } from '../types';

export type CardOperation = Operation | { kind: 'BACKOUT_CHANGE'; changeId: string };

interface EventTargets {
  sessions?: readonly RosterTarget[];
  job?: Extract<Operation, { kind: 'CANCEL_JOB' }>;
  utility?: Extract<Operation, { kind: 'TERM_UTILITY' }>;
  changeId?: string;
}

const sameRegion = (a: CicsTarget, b: CicsTarget) => a.name === b.name && a.lparId === b.lparId;

export function matchesEventEffect(effect: EventEffect, operation: CardOperation, targets: EventTargets = {}): boolean {
  switch (effect.kind) {
    case 'CANCEL_ADDRESS_SPACE':
      return operation.kind === effect.kind && operation.jobname === effect.jobname && operation.lparId === effect.lparId;
    case 'CANCEL_SESSION': {
      const target = targets.sessions?.[0];
      return operation.kind === effect.kind && targets.sessions?.length === 1 && target !== undefined &&
        operation.target.kind === target.kind && operation.target.id === target.id && operation.target.day === target.day &&
        operation.target.workloadId === target.workloadId && operation.target.lparId === target.lparId;
    }
    case 'CANCEL_JOB':
      return operation.kind === effect.kind && operation.jobname === targets.job?.jobname &&
        operation.day === targets.job.day && operation.lparId === targets.job.lparId;
    case 'TERM_UTILITY':
      return operation.kind === effect.kind && operation.id === targets.utility?.id &&
        operation.member === targets.utility.member && operation.day === targets.utility.day;
    case 'RECYCLE_CICS':
      return operation.kind === effect.kind && effect.targets.every((target) => operation.targets.some((r) => sameRegion(r, target)));
    case 'SET_GATEWAY':
      return operation.kind === effect.kind && operation.workloadId === effect.workloadId && operation.mode === effect.mode;
    case 'BACKOUT_CHANGE':
      return operation.kind === effect.kind && operation.changeId === targets.changeId;
  }
}

/** Bind a declaration to this card instance and the live entities the reports name. */
export function eventTargets(run: RunState, scenario: Scenario, def: EventDef, event: ActiveEvent): EventTargets {
  switch (def.endedBy?.kind) {
    case 'CANCEL_SESSION': {
      const spec = def.culprits;
      const sessions = spec ? operatorRoster(run.sim, scenario, spec.entity, spec.workloadId)
        .filter((target) => run.sim.entityLoads?.some((load) => load.tag === event.uid && load.kind === target.kind &&
          load.id === target.id && load.workloadId === target.workloadId && load.lparId === target.lparId)) : [];
      return { sessions };
    }
    case 'CANCEL_JOB': {
      const job = lockHolderJob(run.sim.mods, run.sim.batch.jobs);
      return job?.lparId ? { job: { kind: 'CANCEL_JOB', day: job.day, jobname: job.def.name, lparId: job.lparId } } : {};
    }
    case 'TERM_UTILITY': {
      const sim = run.sim;
      const target = activeUtilities(scenario.utilities, sim.seed, sim.tick, sim.utilityOverruns, sim.terminatedUtilities)
        .find(({ overrun }) => overrun);
      return target ? { utility: { kind: 'TERM_UTILITY', day: Math.floor(sim.tick / TICKS_PER_DAY), id: target.def.id, member: target.def.member } } : {};
    }
    case 'BACKOUT_CHANGE':
      return { changeId: otherTeamChangeId(run, event) };
    default:
      return {};
  }
}

/** Commands for tools that already know which card and entities caused the incident. */
export function operationsForEvent(run: RunState, scenario: Scenario, def: EventDef, event: ActiveEvent): CardOperation[] {
  const targets = eventTargets(run, scenario, def, event);
  const effect = def.endedBy;
  switch (effect?.kind) {
    case 'CANCEL_ADDRESS_SPACE': case 'SET_GATEWAY': case 'RECYCLE_CICS':
      return [effect];
    case 'CANCEL_SESSION':
      return (targets.sessions ?? []).map((target) => ({ kind: 'CANCEL_SESSION', target }));
    case 'CANCEL_JOB':
      return targets.job ? [targets.job] : [];
    case 'TERM_UTILITY':
      return targets.utility ? [targets.utility] : [];
    case 'BACKOUT_CHANGE':
      return targets.changeId ? [{ kind: 'BACKOUT_CHANGE', changeId: targets.changeId }] : [];
    default:
      if (def.relief === 'HSM_RECALL') return [{ kind: 'HOLD_HSM_RECALL', held: true }];
      if (def.relief === 'CICS_STORAGE' && typeof def.reach === 'object' && 'regions' in def.reach) {
        const { regions } = def.reach;
        const targets = run.sim.config.cics.filter((c) => regions.includes(c.name));
        return [{ kind: 'RECYCLE_CICS', targets: targets.map(({ name, lparId }) => ({ name, lparId })) }];
      }
      return [];
  }
}

export function otherTeamChangeId(run: RunState, event: ActiveEvent): string {
  return run.otherTeamChanges?.find((entry) => entry.eventUid === event.uid)?.id ?? `OT-legacy-${run.events.indexOf(event) + 1}`;
}
