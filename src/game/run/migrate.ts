import { packOf } from '../../content/packs';
import type { Scenario } from '../../sim/core/scenario';
import { TICKS_PER_DAY } from '../../sim/core/units';
import { requestOperation } from '../operations';
import type { DayTrace } from '../dayTrace';
import type { PlannedChange, RunState } from '../types';
import { otherTeamChangeId, operationsForEvent } from './eventEffects';
import { resolveEvent } from './events';
import { applyBackout } from './otherTeamChanges';
import { logLine, loseTrust, type GameContent } from './shared';

/** Translation for v2 saves written before PT-54. Only the loader reads the old fix IDs. */
const LEGACY_EVENT: Readonly<Record<string, string>> = {
  CANCEL_RUNAWAY: 'RUNAWAY',
  REBIND_REVERT: 'REGRESSION',
  EFILE_REBIND_REVERT: 'EFILE_REGRESSION',
  BLOCK_BOTS: 'BOT_ATTACK',
  BLOCK_FILING_BOTS: 'FILING_BOTS',
  MOBILE_BACKOFF: 'RETRY_STORM',
  REFSTAT_BACKOFF: 'REFUND_RETRY_STORM',
  TERM_UTILITY: 'REORG_OVERRUN',
  CANCEL_XLOG: 'XLOG_LOOP',
  SCOPE_ENCRYPTION: 'ENCRYPTION_MANDATE',
  NEGOTIATE_MLC_PRICE: 'VENDOR_PRICE',
  ROLLBACK_MONITOR: 'MONITOR_CREEP',
  COMMIT_SETTLEMENT_OFTEN: 'LOCK_ESCALATION',
  STOP_SHADOW_IT: 'SHADOW_IT',
  ROLLBACK_TELLER_RELEASE: 'QR_RELEASE',
  NATIVE_SQL_PROCS: 'ZIIP_LOSS',
  NATIVE_SQL_PROCS_REV: 'ZIIP_LOSS',
  RECYCLE_PROD2_AORS: 'CICS_SOS',
  RECYCLE_PROD2_AORS_REV: 'CICS_SOS',
  RECYCLE_SICK_AOR: 'SICK_AOR',
  SCOPE_SMF_AUDIT: 'SMF_AUDIT',
  HOLD_HSM_RECALLS: 'HSM_RECALL_STORM',
  HOLD_HSM_RECALLS_REV: 'HSM_RECALL_STORM',
};

function migratedEventId(run: RunState, oldId: string | null | undefined): string | undefined {
  const id = oldId ? LEGACY_EVENT[oldId] : undefined;
  if (run.scenarioId !== 'revenue') return id;
  if (id === 'RUNAWAY') return 'RUNAWAY_COMPLIANCE';
  if (id === 'ENCRYPTION_MANDATE') return 'TAXDATA_ENCRYPTION';
  return id;
}

type LegacyChange = PlannedChange & { endsEvent?: string | null; fixId?: string; armedEvents?: string[] };

export function migrateRunState(run: RunState): RunState {
  const { game: content } = packOf(run.scenarioId);
  const oldChanges: LegacyChange[] = run.changes;
  const extraAddressSpaces = run.sim.extraAddressSpaces.filter((a) => a.jobname !== 'CICSXLOG');
  let next = extraAddressSpaces.length === run.sim.extraAddressSpaces.length
    ? run : { ...run, sim: { ...run.sim, extraAddressSpaces } };
  const replies = new Map<string, string>();
  for (const event of run.events) {
    const def = content.events.find((d) => d.id === event.defId);
    const drawDay = Number(event.uid.split('@').at(-1));
    if (def?.reply && def.forewarning) replies.set(`${drawDay}:${def.forewarning}`, event.uid);
  }
  const inbox = run.inbox.map((m) => {
    const uid = !m.replyToEventUid && m.from === 'Inbox' ? replies.get(`${m.day}:${m.body}`) : undefined;
    return uid ? { ...m, replyToEventUid: uid } : m;
  });
  if (inbox.some((m, i) => m !== run.inbox[i])) next = { ...next, inbox };
  if (!oldChanges.some((c) => 'endsEvent' in c || 'fixId' in c || 'armedEvents' in c)) return next;
  const changes = oldChanges.map(({ endsEvent, fixId, armedEvents: _armed, ...c }): PlannedChange => {
    const eventId = migratedEventId(run, endsEvent ?? fixId);
    return eventId && c.status === 'PLANNED' ? { ...c, migratedEventId: eventId } : c;
  });
  next = { ...next, changes };
  const armed = new Set(oldChanges.flatMap((c) => c.status === 'APPLIED' ? c.armedEvents ?? [] : []));
  for (const event of next.events) {
    if (!armed.has(event.uid) || event.started || event.ended) continue;
    const def = content.events.find((d) => d.id === event.defId);
    next = def?.endedBy?.kind === 'BACKOUT_CHANGE'
      ? applyBackout(next, content, otherTeamChangeId(next, event), true, false)
      : resolveEvent(next, event);
  }
  return next;
}

export function applyMigratedRequest(run: RunState, scenario: Scenario, content: GameContent, eventId: string): RunState {
  const def = content.events.find((d) => d.id === eventId);
  const event = run.events.find((e) => e.defId === eventId && !e.ended &&
    (e.endTick === null || e.endTick > run.sim.tick) && (e.started || e.startTick < (run.day + 1) * TICKS_PER_DAY));
  if (!def || !event) return run;
  if (def.endedBy?.kind === 'BACKOUT_CHANGE') return applyBackout(run, content, otherTeamChangeId(run, event));
  if (def.reply) {
    const next = resolveEvent(loseTrust(run, [def.reply.facet], def.reply.trust), event);
    return logLine(next, `Reply sent: ${def.reply.label}`);
  }
  if (event.started) {
    for (const op of operationsForEvent(run, scenario, def, event)) {
      if (op.kind !== 'BACKOUT_CHANGE') run = requestOperation(run, scenario, content, op, true).run;
    }
  }
  return run;
}

/** Older traces may still contain legacy player actions. Their snapshots use the same migration as the live save. */
export function migrateDayTrace(trace: DayTrace | null | undefined): DayTrace | null {
  return trace ? { ...trace, start: migrateRunState(trace.start) } : null;
}

export function replayLegacyRequest(run: RunState, scenario: Scenario, content: GameContent, request: { label: string }): RunState | undefined {
  const fixId = (request as { fixId?: string }).fixId;
  const eventId = migratedEventId(run, fixId);
  return eventId ? applyMigratedRequest(run, scenario, content, eventId) : undefined;
}
