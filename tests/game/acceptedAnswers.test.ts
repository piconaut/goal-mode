import { describe, expect, it } from 'vitest';
import { MIDWEST_GAME } from '../../src/content/game-midwest';
import { MIDWEST } from '../../src/content/scenarios';
import { acceptedAnswers, truthCause, type TruthContext } from '../../src/game/rcaTruth';
import { advance, newRun, startDay, submitRca } from '../../src/game/run';
import { closeHour, newHour } from '../../src/game/run/hourly';
import { acceptedOf, importanceRank, scoreRca } from '../../src/game/sla';
import type { ActiveEvent } from '../../src/game/types';
import { classify } from '../../src/sim/wlm/classify';
import { TICKS_PER_HOUR } from '../../src/sim/core/units';

const MOBILE = MIDWEST.workloads.find((w) => w.id === 'MOBILE')!;

/** A running card from the real deck, so its declared alternates are the content's. */
function card(defId: string, startTick = 0, endTick: number | null = null): ActiveEvent {
  const def = MIDWEST_GAME.events.find((d) => d.id === defId)!;
  return {
    uid: `${defId}@1`, defId, name: def.name, startTick, endTick, trigger: def.trigger,
    affects: def.affects, mechanisms: def.mechanisms, endCommands: def.end, started: true, ended: false,
  };
}

const lpars = newRun(MIDWEST, MIDWEST_GAME, 3).sim.config.lpars.map((l) => ({ id: l.id, cpcId: l.cpcId }));
const hosts = [{ lparId: 'PROD1', cpcId: 'CPCA' }];

const ctx = (over: Partial<TruthContext> = {}): TruthContext => ({
  workloadId: 'MOBILE', mechanism: 'CPU_PRIORITY', trigger: 'POLICY',
  hour: newHour(0), events: [], hosts, lpars, content: MIDWEST_GAME, isNew: false,
  ...over,
});

const basis = (over: Partial<{ cpcBusyPct: number; lparBusyPct: number; donorPct: number }> = {}) => ({
  lparId: 'PROD1', cpcId: 'CPCA', cpcBusyPct: 98, lparBusyPct: 78, donorPct: 12, full: false, ...over,
});

describe('accepted answer sets (RT-07)', () => {
  it('always names the primary, and a card declares what else it can be read as', () => {
    // XLOG_LOOP is a runaway in a high class; the policy that ran it there is also a defensible reading (§4.1).
    const out = acceptedAnswers(ctx({ workloadId: 'TELLER', mechanism: 'CPU_PRIORITY', trigger: 'RUNAWAY_WORK', events: [card('XLOG_LOOP')] }));
    expect(out.accepted.triggers[0]).toBe('RUNAWAY_WORK');
    expect(out.accepted.triggers).toEqual(['RUNAWAY_WORK', 'POLICY']);
    expect(out.notes.POLICY).toMatch(/looping log archiver/i);
    // A card with nothing declared adds nothing.
    expect(acceptedAnswers(ctx({ events: [{ ...card('REGRESSION'), affects: ['MOBILE'] }] })).accepted.triggers).toEqual(['POLICY']);
  });

  it('a capacity-reducing card adds CPU_CAPACITY whatever the bands say', () => {
    // A clear priority hour: room on the machine, all CP at the hurt work's importance or below.
    const out = acceptedAnswers(ctx({
      mechanism: 'CPU_PRIORITY', basis: basis({ cpcBusyPct: 70, lparBusyPct: 60, donorPct: 30 }),
      events: [card('POWER_CAP')],
    }));
    expect(out.accepted.mechanisms).toEqual(['CPU_PRIORITY', 'CPU_CAPACITY']);
    expect(out.notes.CPU_CAPACITY).toMatch(/lowered the processor's capacity/i);
  });

  it("scores the playtest D12 answer 5 on R-7's numbers (CPC 98 % busy, 12 % displaceable)", () => {
    // R-7: POWER_CAP, MOBILE `CPU_PRIORITY/HARDWARE_FAULT` at CPC 98 % with 12 % donors (docs/rca-design.md §3,
    // row 20). The bands cannot separate capacity from priority there, so the D12 answer is a full answer.
    const { accepted } = acceptedAnswers(ctx({
      mechanism: 'CPU_PRIORITY', trigger: 'HARDWARE_FAULT', basis: basis(), events: [card('POWER_CAP')],
    }));
    const truth = { mechanism: 'CPU_PRIORITY' as const, trigger: 'HARDWARE_FAULT' as const, accepted };
    expect(accepted.mechanisms).toEqual(['CPU_PRIORITY', 'CPU_CAPACITY']);
    expect(accepted.triggers).toEqual(['HARDWARE_FAULT']);
    expect(scoreRca(truth, { mechanism: 'CPU_CAPACITY', trigger: 'HARDWARE_FAULT' })).toBe(5);
    // A capacity verdict also accepts priority inside the same band, and only the band widens it.
    const cap = acceptedAnswers(ctx({ mechanism: 'CPU_CAPACITY', basis: basis() }));
    expect(cap.accepted.mechanisms).toEqual(['CPU_CAPACITY', 'CPU_PRIORITY']);
    const full = acceptedAnswers(ctx({ mechanism: 'CPU_CAPACITY', basis: basis({ cpcBusyPct: 97, donorPct: 2 }) }));
    expect(full.accepted.mechanisms).toEqual(['CPU_CAPACITY']);
    const room = acceptedAnswers(ctx({ mechanism: 'CPU_PRIORITY', basis: basis({ cpcBusyPct: 70, lparBusyPct: 60, donorPct: 30 }) }));
    expect(room.accepted.mechanisms).toEqual(['CPU_PRIORITY']);
    // Room on the machine is enough on its own: an unmeasured donor share must not widen the answer.
    const noDonors = acceptedAnswers(ctx({ mechanism: 'CPU_PRIORITY', basis: basis({ cpcBusyPct: 70, lparBusyPct: 60, donorPct: 0 }) }));
    expect(noDonors.accepted.mechanisms).toEqual(['CPU_PRIORITY']);
  });

  it('DEPENDENCY on a server short of its own CPU adds CPU_PRIORITY', () => {
    const hour = { ...newHour(0), ticks: TICKS_PER_HOUR, lparBusyById: { PROD2: 0.97 * TICKS_PER_HOUR } };
    const out = acceptedAnswers(ctx({
      mechanism: 'DEPENDENCY', trigger: 'POLICY', hour,
      servers: [{ jobname: 'DB2MSTR', lparId: 'PROD2' }],
    }));
    expect(out.accepted.mechanisms).toEqual(['DEPENDENCY', 'CPU_PRIORITY']);
    expect(out.notes.CPU_PRIORITY).toMatch(/DB2MSTR on PROD2/);
    // A server with room on its image is no evidence of a policy miss.
    const quiet = acceptedAnswers(ctx({ mechanism: 'DEPENDENCY', trigger: 'POLICY', hour: { ...newHour(0), ticks: TICKS_PER_HOUR }, servers: [{ jobname: 'DB2MSTR', lparId: 'PROD2' }] }));
    expect(quiet.accepted.mechanisms).toEqual(['DEPENDENCY']);
  });

  it('with no card to blame accepts GROWTH and POLICY together, and new work keeps one answer', () => {
    const none = acceptedAnswers(ctx({ mechanism: 'CPU_PRIORITY', trigger: 'POLICY', isNew: false }));
    expect(none.accepted.triggers).toEqual(['POLICY', 'GROWTH']);
    expect(none.notes.GROWTH).toMatch(/same state/);
    const fresh = acceptedAnswers(ctx({ mechanism: 'CPU_PRIORITY', trigger: 'NEW_WORKLOAD', isNew: true }));
    expect(fresh.accepted.triggers).toEqual(['NEW_WORKLOAD']);
  });

  it('a save written before RT-07 scores the primary alone', () => {
    const old = { mechanism: 'CPU_CAPACITY' as const, trigger: 'HARDWARE_FAULT' as const };
    expect(acceptedOf(old)).toEqual({ mechanisms: ['CPU_CAPACITY'], triggers: ['HARDWARE_FAULT'] });
    expect(scoreRca(old, { mechanism: 'CPU_PRIORITY', trigger: 'HARDWARE_FAULT' })).toBe(2);
    expect(scoreRca(old, { mechanism: 'CPU_CAPACITY', trigger: 'HARDWARE_FAULT' })).toBe(5);
  });

  it('names the cause: the blamed card, new work, or what was short', () => {
    expect(truthCause(ctx({ events: [card('POWER_CAP')], trigger: 'HARDWARE_FAULT' }))).toBe('POWER_CAP@1');
    expect(truthCause(ctx({ isNew: true, trigger: 'NEW_WORKLOAD' }))).toBe('new:MOBILE');
    expect(truthCause(ctx({ mechanism: 'DEPENDENCY', basis: null }))).toBe('none:DEPENDENCY:PROD1');
    expect(truthCause(ctx({ mechanism: 'CAPPING', basis: null }))).toBe('none:CPU:PROD1');
  });

  it('a closed hour records the accepted set and scores a defensible alternate in full', () => {
    // A real POWER_CAP on a full CPC with 12 % of the CP at a lower importance: R-7's shape through `closeHour`.
    const def = MIDWEST_GAME.events.find((e) => e.id === 'POWER_CAP')!;
    const started = startDay(newRun(MIDWEST, MIDWEST_GAME, 3), MIDWEST_GAME);
    const run = advance({
      ...started,
      events: [{
        uid: 'POWER_CAP@0', defId: def.id, name: def.name, startTick: 0, endTick: 6 * TICKS_PER_HOUR,
        trigger: def.trigger, affects: def.affects, mechanisms: def.mechanisms,
        endCommands: def.end, started: false, ended: false,
      }],
    }, MIDWEST, MIDWEST_GAME, 1);
    // Both images MOBILE is routed to were full, and 12 % of each one's CP was at a lower importance. The donor
    // share is built from the importance the hour itself would have recorded, so the test does not guess it.
    const routing = Object.entries(run.sim.routing.MOBILE ?? MOBILE.routing).filter(([, f]) => f > 0).map(([id]) => id);
    const cpByImportance: Record<string, number[]> = {};
    for (const lparId of routing) {
      const sc = classify(run.sim.wlm.definition, { ...MOBILE.work, SY: lparId }).serviceClass;
      const imp = importanceRank(run.sim.wlm.definition, `${sc}#1`);
      const byImportance = [0, 0, 0, 0, 0, 0, 0];
      byImportance[imp] = 88;
      byImportance[6] = (byImportance[6] ?? 0) + 12;
      cpByImportance[lparId] = byImportance;
    }
    const closed = closeHour({
      ...run,
      sim: { ...run.sim, tick: TICKS_PER_HOUR },
      hour: {
        ...newHour(0), ticks: TICKS_PER_HOUR,
        workloads: { MOBILE: { completions: 1000, failed: 0, withinSla: 500, rtSumSec: 5000, parts: { cpuQueue: 5000 } } },
        cpcBusyById: { CPCA: 0.98 * TICKS_PER_HOUR },
        lparBusyById: Object.fromEntries(routing.map((id) => [id, 0.98 * TICKS_PER_HOUR])),
        cpByImportance,
      },
    }, MIDWEST, MIDWEST_GAME);
    const inc = closed.incidents.find((i) => i.workloadId === 'MOBILE')!;
    expect(inc.truth).toMatchObject({
      mechanism: 'CPU_PRIORITY', trigger: 'HARDWARE_FAULT', cause: 'POWER_CAP@0',
      accepted: { mechanisms: ['CPU_PRIORITY', 'CPU_CAPACITY'], triggers: ['HARDWARE_FAULT'] },
    });
    // 12 % at a rank below the hurt work's (or all of it, if that rank is already the lowest): either way the donor
    // line is crossed, so the hour is not a capacity verdict.
    expect(inc.basis!.donorPct).toBeGreaterThanOrEqual(10);
    expect(scoreRca(inc.truth, { mechanism: 'CPU_CAPACITY', trigger: 'HARDWARE_FAULT' })).toBe(5);
    const filed = submitRca(closed, inc.id, 'CPU_CAPACITY', 'HARDWARE_FAULT');
    expect(filed.incidents.find((i) => i.id === inc.id)!.rca!.points).toBe(5);
  });
});
