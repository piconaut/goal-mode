import { EVIDENCE } from '../../src/content/evidence';
import { MIDWEST_GAME } from '../../src/content/game-midwest';
import { MIDWEST } from '../../src/content/scenarios';
import type { EvidencePin } from '../../src/game/evidence';
import { judgeEvidence } from '../../src/game/evidence';
import { newRun, submitRca } from '../../src/game/run';
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

  it('keeps the first incident when score and evidence checks tie', () => {
    const r = grouped();
    r.pins = [pin(r, { subject: 'UNRELATED' })];
    expect(file(r).incidents[0]!.rca!.evidence![0]!.why).toBe('not about RBANK');
    const reversed = file({ ...r, incidents: [...r.incidents].reverse() });
    expect(reversed.incidents[0]!.rca!.evidence![0]!.why).toBe('not about CARDAUTH');
  });

  it('selects evidence independently per pin and awards group points and bonuses once', () => {
    const r = grouped();
    r.incidents = r.incidents.map((inc) => ({ ...inc, truth: { mechanism: 'CPU_CAPACITY', trigger: 'POLICY' } }));
    r.pins = [pin(r, { id: 10, subject: 'RBANK' }), pin(r, { id: 11, subject: 'CARDAUTH' })];
    const noEvidence = file({ ...r, pins: [] });
    const scored = file(r);
    const rca = scored.incidents[0]!.rca!;
    expect(rca.evidence!.map((v) => [v.pinId, v.relevance, v.why])).toEqual([
      [10, 1, 'points at the cause'], [11, 1, 'points at the cause'],
    ]);
    expect(rca.evidencePoints).toBe(2);
    expect(rca.points).toBe(7);
    expect(scored.score - r.score).toBe(7);
    expect(scored.insight - r.insight).toBe(7 + EVIDENCE.strongInsight);
    expect(scored.trust).toEqual(noEvidence.trust);
    expect(scored.incidents[1]!.rca).toBe(rca);
    expect(file(scored, 2)).toBe(scored);
  });
});
