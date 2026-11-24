import { cardMechanisms } from '../../src/content/footprint';
import { CO_DOMINANT_SHARE } from '../../src/content/sla';
import { describe, expect, it } from 'vitest';
import { MIDWEST_GAME } from '../../src/content/game-midwest';
import { MIDWEST } from '../../src/content/scenarios';
import { acceptedAnswers, truthCause, type TruthContext } from '../../src/game/rcaTruth';
import { advance, newRun, startDay, submitRca } from '../../src/game/run';
import { closeHour, newHour } from '../../src/game/run/hourly';
import { importanceRank, scoreAccepted } from '../../src/game/sla';
import type { ActiveEvent } from '../../src/game/types';
import { EMPTY_SUBJECTS, truthOf } from '../helpers/truth';
import { applyPlayCommand, newPlayFile } from '../../tools/playCore';
import { classify } from '../../src/sim/wlm/classify';
import { TICKS_PER_HOUR } from '../../src/sim/core/units';

const MOBILE = MIDWEST.workloads.find((w) => w.id === 'MOBILE')!;

/** A running card from the real deck, so its declared alternates are the content's. */
function card(defId: string, startTick = 0, endTick: number | null = null): ActiveEvent {
  const def = MIDWEST_GAME.events.find((d) => d.id === defId)!;
  return {
    uid: `${defId}@1`, defId, name: def.name, startTick, endTick, trigger: def.trigger,
    affects: def.affects, mechanisms: cardMechanisms(def) ?? [], endCommands: def.end, started: true, ended: false,
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
    // row 20). The bands cannot separate capacity from priority there, so the D12 answer is a full answer. The hour
    // is built from those published numbers rather than replayed: a 12-day replay is far too slow for the suite.
    const { accepted } = acceptedAnswers(ctx({
      mechanism: 'CPU_PRIORITY', trigger: 'HARDWARE_FAULT', basis: basis(), events: [card('POWER_CAP')],
    }));
    expect(accepted.mechanisms).toEqual(['CPU_PRIORITY', 'CPU_CAPACITY']);
    expect(accepted.triggers).toEqual(['HARDWARE_FAULT']);
    expect(scoreAccepted(accepted, truthOf('CPU_CAPACITY', 'HARDWARE_FAULT'))).toBe(5);
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
    // The mixed row (§4.3): a host short of full leaves capacity open even with donors to move.
    expect(acceptedAnswers(ctx({ mechanism: 'CPU_PRIORITY', basis: basis({ cpcBusyPct: 88, lparBusyPct: 70, donorPct: 22 }) })).accepted.mechanisms)
      .toEqual(['CPU_PRIORITY', 'CPU_CAPACITY']);
    // Edges: below 85 % the host had room (strict), at 85 % it is already the band; 95 % and 5 % are the
    // clear-capacity lines.
    expect(acceptedAnswers(ctx({ mechanism: 'CPU_PRIORITY', basis: basis({ cpcBusyPct: 84.9, lparBusyPct: 60, donorPct: 30 }) })).accepted.mechanisms)
      .toEqual(['CPU_PRIORITY']);
    expect(acceptedAnswers(ctx({ mechanism: 'CPU_PRIORITY', basis: basis({ cpcBusyPct: 85, lparBusyPct: 60, donorPct: 0 }) })).accepted.mechanisms)
      .toEqual(['CPU_PRIORITY', 'CPU_CAPACITY']);
    expect(acceptedAnswers(ctx({ mechanism: 'CPU_CAPACITY', basis: basis({ cpcBusyPct: 95, lparBusyPct: 80, donorPct: 4.9 }) })).accepted.mechanisms)
      .toEqual(['CPU_CAPACITY']);
    expect(acceptedAnswers(ctx({ mechanism: 'CPU_CAPACITY', basis: basis({ cpcBusyPct: 95, lparBusyPct: 80, donorPct: 5 }) })).accepted.mechanisms)
      .toEqual(['CPU_CAPACITY', 'CPU_PRIORITY']);
  });

  it('a machine that lost capacity explains CPU work only, not an I/O or storage miss', () => {
    // POWER_CAP overlaps an I/O hour: accepting CPU_CAPACITY there would teach a cause the data cannot support.
    const out = acceptedAnswers(ctx({ mechanism: 'IO', trigger: 'POLICY', events: [card('POWER_CAP')] }));
    expect(out.accepted.mechanisms).toEqual(['IO']);
  });

  it('a batch night sees a card that starts after 18:00', () => {
    const night = newHour(12 * TICKS_PER_HOUR); // 18:00
    const late = card('POWER_CAP', 14 * TICKS_PER_HOUR); // 20:00
    // The 18:00 hour alone does not overlap it; the night window (18:00 to the day end) does.
    expect(acceptedAnswers(ctx({ mechanism: 'CPU_PRIORITY', hour: night, events: [late] })).accepted.mechanisms)
      .toEqual(['CPU_PRIORITY']);
    expect(acceptedAnswers(ctx({
      mechanism: 'CPU_PRIORITY', hour: night, events: [late],
      window: { startTick: 12 * TICKS_PER_HOUR, endTick: 24 * TICKS_PER_HOUR },
    })).accepted.mechanisms).toEqual(['CPU_PRIORITY', 'CPU_CAPACITY']);
  });

  it('DEPENDENCY on a server short of its own CPU adds CPU_PRIORITY', () => {
    const hour = { ...newHour(0), ticks: TICKS_PER_HOUR, lparBusyById: { PROD2: 0.97 * TICKS_PER_HOUR } };
    const out = acceptedAnswers(ctx({
      mechanism: 'DEPENDENCY', trigger: 'POLICY', hour,
      servers: [{ jobname: 'DB2MSTR', lparId: 'PROD2' }],
    }));
    expect(out.accepted.mechanisms).toEqual(['DEPENDENCY', 'CPU_PRIORITY']);
    expect(out.notes.CPU_PRIORITY).toMatch(/DB2MSTR on PROD2/);
    // A server with room on its own image is no evidence of a policy miss, even on a busy machine.
    const busyCpc = { ...newHour(0), ticks: TICKS_PER_HOUR, cpcBusyById: { CPCA: 0.85 * TICKS_PER_HOUR }, lparBusyById: { PROD2: 0.4 * TICKS_PER_HOUR } };
    const quiet = acceptedAnswers(ctx({ mechanism: 'DEPENDENCY', trigger: 'POLICY', hour: busyCpc, servers: [{ jobname: 'DB2MSTR', lparId: 'PROD2' }] }));
    expect(quiet.accepted.mechanisms).toEqual(['DEPENDENCY']);
  });

  it('accepts a peer-slow CF or LCU at a third of the response, and names the near miss below it (RT-35)', () => {
    // oneHour: the work's summed parts; the response time is rtSumSec / completions.
    const oneHour = (id: string, parts: Record<string, number>, rtSumSec = 200, completions = 1000) => ({
      ...newHour(0), ticks: TICKS_PER_HOUR,
      workloads: { [id]: { completions, withinSla: completions, failed: 0, rtSumSec, parts } },
    });
    const cfPeers = {
      cf: [
        { lparId: 'CF01', reqPerSec: 5000, syncUs: 18, asyncPct: 0 },
        { lparId: 'CF02', reqPerSec: 2000, syncUs: 1368, asyncPct: 98 },
      ],
      connectedCf: ['CF01', 'CF02'],
    };
    // INC22's measured hour: CF02 is 76× CF01, but CF time is 3.51 ms of CARDAUTH's 18 ms response (19.5 %).
    // The claim can be proven from the peer rule, but it is not accepted; the near miss says why.
    const inc22 = acceptedAnswers(ctx({ workloadId: 'CARDAUTH', mechanism: 'CPU_PRIORITY', trigger: 'POLICY', hour: oneHour('CARDAUTH', { cf: 3.51 }, 18), peers: cfPeers }));
    expect(inc22.accepted.mechanisms).toEqual(['CPU_PRIORITY']);
    expect(inc22.nearMiss?.CF_SERVICE).toMatch(/CF02 at 76× CF01's sync service time, but CF time was 19\.5 % of CARDAUTH's response time \(accepted from 33 %\)/);
    // The FAIL_CF structure-move state (CF 11.38 ms of a 30 ms response, 37.9 %) is accepted.
    const moved = acceptedAnswers(ctx({ mechanism: 'CPU_PRIORITY', trigger: 'POLICY', hour: oneHour('MOBILE', { cf: 11.38 }, 30), peers: cfPeers }));
    expect(moved.accepted.mechanisms).toEqual(['CPU_PRIORITY', 'CF_SERVICE']);
    expect(moved.notes.CF_SERVICE).toMatch(/CF02 at 76× CF01's sync service time/);
    // Exactly a third counts, by the same arithmetic the source uses.
    const total = 30 / 1000;
    const atLine = acceptedAnswers(ctx({ mechanism: 'CPU_PRIORITY', trigger: 'POLICY', hour: oneHour('MOBILE', { cf: CO_DOMINANT_SHARE * total * 1000 }, 30), peers: cfPeers }));
    expect(atLine.accepted.mechanisms).toEqual(['CPU_PRIORITY', 'CF_SERVICE']);
    // A slow CF the work does not connect to is not its resource.
    const unconnected = acceptedAnswers(ctx({ mechanism: 'CPU_PRIORITY', trigger: 'POLICY', hour: oneHour('MOBILE', { cf: 80 }), peers: { ...cfPeers, connectedCf: ['CF01'] } }));
    expect(unconnected.accepted.mechanisms).toEqual(['CPU_PRIORITY']);
    expect(unconnected.nearMiss).toBeUndefined();
    // The DASD equivalent: LCU 30's DISC against the 0.07 ms median of three LCUs; below a third is a near miss.
    const lcuPeers = { lcus: [
      { id: '10', iops: 300, discMs: 0.07, rtMs: 0.22 },
      { id: '21', iops: 500, discMs: 0.07, rtMs: 0.22 },
      { id: '30', iops: 400, discMs: 0.4, rtMs: 0.22 },
    ] };
    const io = acceptedAnswers(ctx({ mechanism: 'CPU_PRIORITY', trigger: 'POLICY', hour: oneHour('MOBILE', { io: 80 }), peers: lcuPeers }));
    expect(io.accepted.mechanisms).toEqual(['CPU_PRIORITY', 'IO']);
    expect(io.notes.IO).toMatch(/LCU 30 at 6× the LCU median DISC time/);
    const ioShort = acceptedAnswers(ctx({ mechanism: 'CPU_PRIORITY', trigger: 'POLICY', hour: oneHour('MOBILE', { io: 3 }, 30), peers: lcuPeers }));
    expect(ioShort.accepted.mechanisms).toEqual(['CPU_PRIORITY']);
    expect(ioShort.nearMiss?.IO).toMatch(/I\/O time was 10\.0 % of MOBILE's response time \(accepted from 33 %\)/);
  });

  it('with no card to blame accepts GROWTH and POLICY together, and new work keeps one answer', () => {
    const none = acceptedAnswers(ctx({ mechanism: 'CPU_PRIORITY', trigger: 'POLICY', isNew: false }));
    expect(none.accepted.triggers).toEqual(['POLICY', 'GROWTH']);
    expect(none.notes.GROWTH).toMatch(/same state/);
    const fresh = acceptedAnswers(ctx({ mechanism: 'CPU_PRIORITY', trigger: 'NEW_WORKLOAD', isNew: true }));
    expect(fresh.accepted.triggers).toEqual(['NEW_WORKLOAD']);
  });

  it('accepts a co-dominant delay group beside the primary (RT-17)', () => {
    const out = acceptedAnswers(ctx({ mechanism: 'CPU_PRIORITY', coDominant: [{ mechanism: 'IO', why: '40.0 % of the delay excess grew beside the primary' }] }));
    expect(out.accepted.mechanisms).toContain('IO');
    expect(out.notes.IO).toBe('40.0 % of the delay excess grew beside the primary');
    // An answer the truth already carries is not offered twice.
    const same = acceptedAnswers(ctx({ mechanism: 'CPU_PRIORITY', coDominant: [{ mechanism: 'CPU_PRIORITY', why: 'never shown' }] }));
    expect(same.notes.CPU_PRIORITY).toBeUndefined();
  });

  it('names the cause: the blamed card, new work, or what was short', () => {
    expect(truthCause(ctx({ events: [card('POWER_CAP')], trigger: 'HARDWARE_FAULT' }))).toBe('POWER_CAP@1');
    expect(truthCause(ctx({ isNew: true, trigger: 'NEW_WORKLOAD' }))).toBe('new:MOBILE');
    expect(truthCause(ctx({ mechanism: 'DEPENDENCY', basis: null }))).toBe('none:DEPENDENCY:PROD1');
    expect(truthCause(ctx({ mechanism: 'CAPPING', basis: null }))).toBe('none:CPU:PROD1');
  });

  it('the headless reply calls an accepted alternate right and gives its reason', () => {
    const file = newPlayFile(3);
    const incident = {
      id: 7, workloadId: 'MOBILE', day: 0, startTick: 0, endTick: null, hours: 1, worstAttainmentPct: 80,
      truth: truthOf('CPU_PRIORITY', 'HARDWARE_FAULT', {
        accepted: { mechanisms: ['CPU_PRIORITY' as const, 'CPU_CAPACITY' as const], triggers: ['HARDWARE_FAULT' as const] },
        notes: { CPU_CAPACITY: 'the machine may have been the constraint' },
      }),
      subjects: EMPTY_SUBJECTS,
      rca: null, trustLost: 1,
    };
    const out = applyPlayCommand({ ...file, run: { ...file.run, incidents: [incident], nextId: 8 } }, {
      cmd: 'rca', incidentId: 7, mechanism: 'CPU_CAPACITY', trigger: 'HARDWARE_FAULT',
    });
    expect(out.ok).toBe(true);
    expect(out.text).toContain('Mechanism CPU_CAPACITY accepted, trigger Hardware fault accepted (primary CPU_PRIORITY/Hardware fault)');
    expect(out.text).toContain('5 points');
    expect(out.text).toContain('also accepted: CPU_CAPACITY (the machine may have been the constraint)');
    // A single incident has one primary, so its header carries no workload.
    expect(out.text).toContain('(primary CPU_PRIORITY/Hardware fault)');
  });

  it('a two-victim group names each primary with its workload and each reason with its victim (RT-28)', () => {
    const file = newPlayFile(3);
    const incident = (id: number, workloadId: string, truth: ReturnType<typeof truthOf>, rcaGroup?: number) => ({
      id, workloadId, day: 0, startTick: 0, endTick: null, hours: 1, worstAttainmentPct: 80,
      truth, subjects: EMPTY_SUBJECTS, rca: null, trustLost: 0, ...(rcaGroup === undefined ? {} : { rcaGroup }),
    });
    const run = {
      ...file.run,
      incidents: [
        incident(7, 'RBANK', truthOf('CPU_PRIORITY', 'POLICY')),
        incident(8, 'CARDAUTH', truthOf('CPU_CAPACITY', 'POLICY', {
          accepted: { mechanisms: ['CPU_CAPACITY', 'DEPENDENCY'], triggers: ['POLICY'] },
          notes: { DEPENDENCY: 'its Db2 connection was short' },
        }), 7),
      ],
      nextId: 9,
    };
    const out = applyPlayCommand({ ...file, run }, { cmd: 'rca', incidentId: 7, mechanism: 'CPU_PRIORITY', trigger: 'POLICY' });
    expect(out.ok, out.text).toBe(true);
    expect(out.text).toContain('(primary CPU_PRIORITY/Policy or configuration: RBANK; CPU_CAPACITY/Policy or configuration: CARDAUTH)');
    expect(out.text).toContain('also accepted: CPU_CAPACITY; DEPENDENCY (CARDAUTH: its Db2 connection was short)');
    // The reply is the group's: the member's incident carries it too.
    expect(out.file.run.incidents[1]!.rca!.points).toBe(5);
    // A group whose members agree keeps the one-primary header, but a reason still names the member whose hour gave it.
    const agreed = {
      ...run,
      incidents: [
        incident(7, 'RBANK', truthOf('CPU_PRIORITY', 'POLICY', {
          accepted: { mechanisms: ['CPU_PRIORITY', 'CPU_CAPACITY'], triggers: ['POLICY'] },
          notes: { CPU_CAPACITY: 'the machine may have been the constraint' },
        })),
        incident(8, 'CARDAUTH', truthOf('CPU_PRIORITY', 'POLICY'), 7),
      ],
    };
    const agreedOut = applyPlayCommand({ ...file, run: agreed }, { cmd: 'rca', incidentId: 7, mechanism: 'CPU_PRIORITY', trigger: 'POLICY' });
    expect(agreedOut.text).toContain('Mechanism CPU_PRIORITY accepted, trigger Policy or configuration accepted; also accepted:');
    expect(agreedOut.text).toContain('also accepted: CPU_CAPACITY (RBANK: the machine may have been the constraint)');
  });

  it('a closed hour records the accepted set and scores a defensible alternate in full', () => {
    // A real POWER_CAP on a full CPC with 12 % of the CP at a lower importance: R-7's shape through `closeHour`.
    const def = MIDWEST_GAME.events.find((e) => e.id === 'POWER_CAP')!;
    const started = startDay(newRun(MIDWEST, MIDWEST_GAME, 3), MIDWEST_GAME);
    const run = advance({
      ...started,
      events: [{
        uid: 'POWER_CAP@0', defId: def.id, name: def.name, startTick: 0, endTick: 6 * TICKS_PER_HOUR,
        trigger: def.trigger, affects: def.affects, mechanisms: cardMechanisms(def) ?? [],
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
    expect(scoreAccepted(inc.truth.accepted, truthOf('CPU_CAPACITY', 'HARDWARE_FAULT'))).toBe(5);
    const filed = submitRca(closed, inc.id, 'CPU_CAPACITY', 'HARDWARE_FAULT');
    expect(filed.incidents.find((i) => i.id === inc.id)!.rca!.points).toBe(5);
  });
});
