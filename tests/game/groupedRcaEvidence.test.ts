import { EVIDENCE, PROOF } from '../../src/content/evidence';
import { MIDWEST_GAME } from '../../src/content/game-midwest';
import { MIDWEST } from '../../src/content/scenarios';
import type { EvidencePin } from '../../src/game/evidence';
import { judgeEvidence } from '../../src/game/evidence';
import { newRun, submitRca } from '../../src/game/run';
import { alsoAcceptedOf } from '../../src/game/run/rca';
import type { Incident, RunState } from '../../src/game/types';

function grouped(): RunState {
  const r = newRun(MIDWEST, MIDWEST_GAME, 7);
  const base: Incident = {
    id: 1, workloadId: 'RBANK', day: r.day, startTick: r.sim.tick, endTick: r.sim.tick,
    hours: 1, worstAttainmentPct: 80, truth: { mechanism: 'CPU_PRIORITY', trigger: 'POLICY' },
    rca: null, trustLost: 0,
  };
  return { ...r, incidents: [base, { ...base, id: 2, workloadId: 'CARDAUTH', rcaGroup: 1 }] };
}

function pin(r: RunState, over: Partial<EvidencePin> = {}): EvidencePin {
  return {
    id: 10, source: 'CICS 110', metric: 'CPU_VS_BASE', subject: 'CARDAUTH', system: '*PLEX',
    tick: r.sim.tick, value: 2, text: 'CARDAUTH CPU/txn vs baseline', ...over,
  };
}

function file(r: RunState, incidentId = 1): RunState {
  const truth = r.incidents[0]!.truth;
  return submitRca(r, incidentId, truth.mechanism, truth.trigger, MIDWEST, r.pins.map((p) => p.id));
}

describe('grouped RCA evidence verdicts', () => {
  it.each([
    { metric: 'CPU_VS_BASE', value: 2, why: 'points elsewhere' },
    { metric: 'PI', value: 4, why: 'a symptom, not a cause' },
    { metric: 'SYNC_IO', value: 1, why: 'value is unremarkable' },
  ] as const)('shows the CARDAUTH rejection when all scores are zero: $why', ({ metric, value, why }) => {
    const r = grouped();
    r.pins = [pin(r, { metric, value })];
    expect(r.incidents.map((inc) => judgeEvidence(r, MIDWEST, inc, r.pins)[0]!.relevance)).toEqual([0, 0]);
    expect(judgeEvidence(r, MIDWEST, r.incidents[0]!, r.pins)[0]!.why).toBe('not about RBANK');
    const noEvidence = file({ ...r, pins: [] });
    for (const incidentId of [1, 2]) {
      const scored = file(r, incidentId);
      expect(scored.incidents[0]!.rca!.evidence).toEqual([{ pinId: 10, text: r.pins[0]!.text, relevance: 0, why }]);
      expect(scored.incidents[1]!.rca).toBe(scored.incidents[0]!.rca);
      expect(scored.incidents[0]!.rca!.evidencePoints).toBe(0);
      expect([scored.score, scored.insight, scored.trust]).toEqual([noEvidence.score, noEvidence.insight, noEvidence.trust]);
      const reversed = file({ ...r, incidents: [...r.incidents].reverse() }, incidentId);
      expect(reversed.incidents[0]!.rca).toEqual(scored.incidents[0]!.rca);
    }
  });

  it('prefers an in-window subject rejection over an out-of-window rejection', () => {
    const r = grouped();
    r.incidents = r.incidents.map((inc) => inc.id === 1 ? { ...inc, startTick: r.sim.tick + 3 * 360, endTick: r.sim.tick + 4 * 360 } : inc);
    r.pins = [pin(r, { subject: 'UNRELATED' })];
    expect(file(r).incidents[0]!.rca!.evidence![0]!.why).toBe('not about CARDAUTH');
  });

  it("names the victim whose hour backs a group answer, not the lead's contradictory line (N1)", () => {
    const basis = (over: Partial<NonNullable<Incident['basis']>>) => ({
      lparId: 'PROD1', cpcId: 'CPCA', lparBusyPct: 50, cpcBusyPct: 50, donorPct: 30, full: false, ...over,
    });
    const r = grouped();
    r.incidents = [
      // The lead's hour has room, so its line rules capacity out; the member's hour is full, which is what makes the
      // union accept it.
      { ...r.incidents[0]!, basis: basis({}), truth: { mechanism: 'CPU_PRIORITY', trigger: 'POLICY', accepted: { mechanisms: ['CPU_PRIORITY'], triggers: ['POLICY'] } } },
      { ...r.incidents[1]!, basis: basis({ cpcBusyPct: 99, donorPct: 0, full: true }), truth: { mechanism: 'CPU_CAPACITY', trigger: 'POLICY', accepted: { mechanisms: ['CPU_CAPACITY'], triggers: ['POLICY'] } } },
    ];
    const rca = submitRca(r, 1, 'CPU_CAPACITY', 'POLICY').incidents[0]!.rca!;
    expect(rca.points).toBe(5);
    expect(rca.explain).toMatch(/^CARDAUTH: /);
    expect(rca.explain).toMatch(/machine, not the policy/);
  });

  it('keeps the group lead when score and evidence checks tie', () => {
    const r = grouped();
    r.pins = [pin(r, { subject: 'UNRELATED' })];
    expect(file(r).incidents[0]!.rca!.evidence![0]!.why).toBe('not about RBANK');
    // The group is read lead-first (RT-15), so a save whose array order differs still ties on the lead's rejection.
    const reversed = file({ ...r, incidents: [...r.incidents].reverse() });
    expect(reversed.incidents[0]!.rca!.evidence![0]!.why).toBe('not about RBANK');
  });

  it('scores an answer accepted by another incident of the group (the union, §4.5)', () => {
    const r = grouped();
    const [a, b] = r.incidents;
    // One cause, two victims: each truth accepts a different answer, so either is a full answer for the group.
    r.incidents = [
      { ...a!, truth: { ...a!.truth, accepted: { mechanisms: ['CPU_PRIORITY', 'CPU_CAPACITY'], triggers: ['POLICY'] }, notes: { CPU_CAPACITY: 'the machine may have been the constraint' } } },
      { ...b!, truth: { ...b!.truth, accepted: { mechanisms: ['DEPENDENCY'], triggers: ['BATCH_OVERLAP'] } } },
    ];
    // The reply and the review show the union too, led by the lead's own alternates and their reasons.
    expect(alsoAcceptedOf(r.incidents)).toEqual([
      { answer: 'CPU_CAPACITY', why: 'the machine may have been the constraint' },
      { answer: 'DEPENDENCY', why: undefined },
      { answer: 'BATCH_OVERLAP', why: undefined },
    ]);
    const alone = submitRca({ ...r, incidents: [r.incidents[0]!] }, 1, 'DEPENDENCY', 'BATCH_OVERLAP');
    expect(alone.incidents[0]!.rca!.points).toBe(0);
    const scored = submitRca(r, 1, 'DEPENDENCY', 'BATCH_OVERLAP');
    expect(scored.incidents[0]!.rca!.points).toBe(5);
    expect(scored.incidents[1]!.rca).toBe(scored.incidents[0]!.rca);
    // The union is a product: a mechanism accepted by one victim with a trigger accepted by the other still scores 5.
    expect(submitRca(r, 1, 'DEPENDENCY', 'POLICY').incidents[0]!.rca!.points).toBe(5);
  });

  it('selects evidence independently per pin and awards group points and bonuses once', () => {
    const r = grouped();
    r.incidents = r.incidents.map((inc) => ({ ...inc, truth: { mechanism: 'CPU_CAPACITY', trigger: 'POLICY' } }));
    // RBANK's region class waiting for CPU on PROD1 (also the POLICY symptom), CPCA full, and CARDAUTH's own rate at
    // its normal: the CPU_CAPACITY and POLICY recipes over the group's two incidents (RT-13).
    r.pins = [
      pin(r, { id: 10, source: 'WLMGL', metric: 'DELAY_CPU', subject: 'STCHI#1', system: 'PROD1', value: 25 }),
      pin(r, { id: 11, source: 'CPC', metric: 'CPC_BUSY', subject: 'CPCA', system: 'CPCA', value: 95 }),
      pin(r, { id: 12, metric: 'ENDED_RATE', value: 100, baseline: 100 }),
    ];
    const noEvidence = file({ ...r, pins: [] });
    const scored = file(r);
    const rca = scored.incidents[0]!.rca!;
    expect(rca.evidence!.map((v) => [v.pinId, v.relevance])).toEqual([[10, 1], [11, 1], [12, 0]]);
    expect(rca.proof!.mechanism.complete).toBe(true);
    expect(rca.proof!.trigger.complete).toBe(true);
    expect(rca.evidencePoints).toBe(PROOF.recipePoints);
    expect(rca.points).toBe(5 + PROOF.recipePoints);
    expect(scored.score - r.score).toBe(5 + PROOF.recipePoints);
    expect(scored.insight - r.insight).toBe(5 + PROOF.recipePoints + EVIDENCE.strongInsight);
    expect(scored.trust).toEqual(noEvidence.trust);
    expect(scored.incidents[1]!.rca).toBe(rca);
    expect(file(scored, 2)).toBe(scored);
  });
});
