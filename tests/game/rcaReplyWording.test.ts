import { describe, expect, it } from 'vitest';
import { MIDWEST_GAME } from '../../src/content/game-midwest';
import { MIDWEST } from '../../src/content/scenarios';
import { incidentSubjects, type EvidencePin } from '../../src/game/evidence';
import { hourBaseNote, pinVerdictLines, type ProofResult } from '../../src/game/proof';
import { newRun } from '../../src/game/run';
import type { CapacityBasis, Incident, RunState } from '../../src/game/types';
import { applyPlayCommand, newPlayFile } from '../../tools/playCore';
import { truthOf } from '../helpers/truth';

/** RT-30: the filed answer is accepted (or not), the pins prove the recipe (or not), and every pin says why. */
const content = { ...MIDWEST_GAME, events: [] };
const base = newRun(MIDWEST, content, 7);
const subjects = incidentSubjects(base, MIDWEST, 'RBANK', base.day);

const pin = (id: number, over: Partial<EvidencePin> = {}): EvidencePin => ({
  id, source: 'WLMGL', metric: 'DELAY_CPU', subject: subjects.classes[0]!, system: 'PROD1',
  tick: base.sim.tick, value: 2, text: `pin ${id}`, ...over,
});

function state(pins: EvidencePin[], over: Partial<Incident> = {}): RunState {
  const inc: Incident = {
    id: 7, workloadId: 'RBANK', day: base.day, startTick: base.sim.tick, endTick: null,
    hours: 1, worstAttainmentPct: 80, truth: truthOf('CPU_PRIORITY', 'POLICY'), subjects, rca: null, trustLost: 0, ...over,
  };
  return { ...base, incidents: [inc], pins, nextId: 20 };
}

function file(r: RunState, mechanism: 'CPU_PRIORITY' | 'CPU_CAPACITY' | 'IO' = 'CPU_PRIORITY', trigger: 'POLICY' | 'CHANGE_REGRESSION' = 'POLICY') {
  return applyPlayCommand({ ...newPlayFile(7), run: r }, {
    cmd: 'rca', incidentId: 7, mechanism, trigger, evidenceIds: r.pins.map((p) => p.id),
  });
}

describe('RCA reply wording (RT-30)', () => {
  it('says the answer is accepted and the pins did not prove it, and quotes the pin that missed the line', () => {
    const out = file(state([pin(1, { value: 2 })]));
    expect(out.ok, out.text).toBe(true);
    // The answer is right; the recipe is not proven. The old reply said "Mechanism right" beside "✗ not proven".
    expect(out.text).toContain('Mechanism CPU_PRIORITY accepted, trigger Policy or configuration accepted');
    expect(out.text).toContain('Mechanism CPU_PRIORITY: your pins did not prove it');
    // The failed predicate names the fact the pin must show and quotes what it showed.
    expect(out.text).toContain('✗ CPU or zIIP delay ≥ 10 %');
    expect(out.text).toContain('your pin PIN1: CPU delay 2.0%');
    expect(out.text).not.toContain('proven:');
  });

  it('marks an accepted alternate with the primary it was not', () => {
    // CPU_CAPACITY is accepted for this hour through the band, but the truth's primary is CPU_PRIORITY.
    const basis: CapacityBasis = { lparId: 'PROD1', cpcId: 'CPCA', lparBusyPct: 80, cpcBusyPct: 88, donorPct: 12, full: false };
    const out = file(state([pin(1, { value: 25 })], {
      basis,
      truth: truthOf('CPU_PRIORITY', 'POLICY', { accepted: { mechanisms: ['CPU_PRIORITY', 'CPU_CAPACITY'], triggers: ['POLICY'] } }),
    }), 'CPU_CAPACITY');
    expect(out.ok, out.text).toBe(true);
    expect(out.text).toContain('Mechanism CPU_CAPACITY accepted, trigger Policy or configuration accepted (primary CPU_PRIORITY/Policy or configuration)');
  });

  it('lists every filed pin, with why the ones that met no predicate did not count', () => {
    const r = state([
      pin(1, { value: 25 }),
      // The same class's I/O delay inside normal: related, but it meets no predicate.
      pin(2, { metric: 'DELAY_IO', value: 1 }),
      // Another class on a host the work runs on: about the machine, not this work.
      pin(3, { subject: 'SOMEOTHER#1', value: 25 }),
    ]);
    const out = file(r);
    expect(out.ok, out.text).toBe(true);
    expect(out.text).toContain('Pins: PIN1 counted for the mechanism and trigger; PIN2 did not count: value is unremarkable; PIN3 did not count: another class\'s row, not the hurt work\'s');
  });

  it('says the truth reads the clock hour when a pin met a line the hour average misses', () => {
    // Midwest seed 11 INC6 (RT-31's report): the pin's 13:00–13:30 interval was 90.1 %, the hour averaged 87.1 %.
    const basis: CapacityBasis = { lparId: 'PROD1', cpcId: 'CPCA', lparBusyPct: 80, cpcBusyPct: 87.1, donorPct: 12, full: false };
    const out = file(state([
      pin(1, { value: 25 }),
      pin(2, { source: 'CPC', metric: 'CPC_BUSY', subject: 'CPCA', system: 'CPCA', value: 90.1 }),
    ], { basis }), 'CPU_CAPACITY');
    expect(out.ok, out.text).toBe(true);
    expect(out.text).toContain('The truth reads the clock hour: CPC CPCA averaged 87.1 % busy, under the 90 % line your pin met.');
    // Recorded at filing: the note is not recomputed from whatever pins are left on the board (RT-30).
    expect(out.file.run.incidents[0]!.rca!.hourNote).toContain('averaged 87.1 % busy');
  });

  it('quotes an ended rate as an ended rate, not as the cost metric that carries it', () => {
    // A CPU_PER_TXN pin's cost is normal but its ended rate is far up: the rate predicate fails on the rate.
    const out = file(state([
      pin(1, { value: 25 }),
      pin(2, { metric: 'CPU_PER_TXN', value: 10, rate: { value: 20, baseline: 2 } }),
    ]), 'CPU_PRIORITY', 'CHANGE_REGRESSION');
    expect(out.ok, out.text).toBe(true);
    expect(out.text).toContain('your pin PIN2: ended/s 20.0 /s');
    expect(out.text).not.toContain('CP ms/txn 20.0');
  });

  it('does not quote a wrong-class pin as the reason a predicate failed', () => {
    // The own row is 2 %; another class on the same image is 61 % and says nothing about this work.
    const out = file(state([
      pin(1, { value: 2 }),
      pin(2, { subject: 'SOMEOTHER#1', value: 61 }),
    ]));
    expect(out.ok, out.text).toBe(true);
    expect(out.text).toContain('your pin PIN1: CPU delay 2.0%');
    expect(out.text).not.toContain('61.0%');
    expect(out.text).toContain('PIN2 did not count: another class\'s row, not the hurt work\'s');
  });

  it('says a complete recipe earns nothing when the truth does not accept the claim', () => {
    const r = state([
      pin(1, { metric: 'DELAY_IO', value: 25 }),
      pin(2, { source: 'DASD', metric: 'DASD_DISC', subject: '21', system: '*PLEX', value: 0.5, baseline: 0.2 }),
    ], { truth: truthOf('CPU_PRIORITY', 'POLICY') });
    const out = file(r, 'IO');
    expect(out.ok, out.text).toBe(true);
    expect(out.text).toContain('Mechanism IO not accepted');
    expect(out.text).toContain('Mechanism IO: proven, and it earns nothing: it was not the cause');
  });

  it('adds no hour note when the clock hour itself is over the line', () => {
    const basis: CapacityBasis = { lparId: 'PROD1', cpcId: 'CPCA', lparBusyPct: 80, cpcBusyPct: 91, donorPct: 12, full: true };
    const out = file(state([
      pin(1, { value: 25 }),
      pin(2, { source: 'CPC', metric: 'CPC_BUSY', subject: 'CPCA', system: 'CPCA', value: 92 }),
    ], { basis }), 'CPU_CAPACITY');
    expect(out.ok, out.text).toBe(true);
    expect(out.text).not.toContain('The truth reads the clock hour');
    expect(out.file.run.incidents[0]!.rca!.hourNote).toBeUndefined();
  });
});

describe('RT-30 reply helpers', () => {
  const check = (claim: ProofResult['mechanism']['claim'], pinIds: number[][]): ProofResult['mechanism'] => ({
    claim, complete: pinIds.every((x) => x.length > 0), predicates: pinIds.map((ids, k) => ({ label: `p${k}`, met: ids.length > 0, pinIds: ids })),
  });
  const label = (id: number) => `PIN${id}`;

  it('names the clause each pin counted for, and says a consistent pin that met no predicate fits but proves nothing', () => {
    const proof: ProofResult = { mechanism: check('CPU_CAPACITY', [[1, 2], []]), trigger: check('POLICY', [[2, 3], []]) };
    const lines = pinVerdictLines(proof, [
      { pinId: 1, text: '', relevance: 1, why: '' },
      { pinId: 2, text: '', relevance: 1, why: '' },
      { pinId: 3, text: '', relevance: 1, why: '' },
      { pinId: 4, text: '', relevance: 0.5, why: 'unused' },
      { pinId: 5, text: '', relevance: 0, why: 'value is unremarkable' },
    ], label);
    expect(lines).toEqual([
      'PIN1 counted for the mechanism',
      'PIN2 counted for the mechanism and trigger',
      'PIN3 counted for the trigger',
      'PIN4 did not count: it fits the cause but proves no predicate',
      'PIN5 did not count: value is unremarkable',
    ]);
  });

  it('writes the hour note only for a met pin over the line in an hour under it, on the CPC or the LPAR', () => {
    const proof: ProofResult = { mechanism: check('CPU_CAPACITY', [[1, 2]]), trigger: check('POLICY', [[]]) };
    const cpc = pin(1, { source: 'CPC', metric: 'CPC_BUSY', subject: 'CPCA', system: 'CPCA', value: 90.1 });
    const lpar = pin(2, { source: 'CPC', metric: 'LPAR_BUSY', subject: 'PROD1', system: 'PROD1', value: 95 });
    const basis = (cpcBusyPct: number, lparBusyPct: number): CapacityBasis => ({ lparId: 'PROD1', cpcId: 'CPCA', lparBusyPct, cpcBusyPct, donorPct: 0, full: false });
    expect(hourBaseNote(proof, [cpc], basis(87.1, 80))).toContain('CPC CPCA averaged 87.1 % busy');
    expect(hourBaseNote(proof, [cpc], basis(90, 80))).toBeNull();
    expect(hourBaseNote(proof, [lpar], basis(95, 88))).toContain('LPAR PROD1 averaged 88.0 % busy');
    expect(hourBaseNote(proof, [lpar], basis(95, 90))).toBeNull();
    // A pin that met no predicate, or an incident with no recorded basis, gets no note.
    expect(hourBaseNote({ ...proof, mechanism: check('CPU_CAPACITY', [[]]) }, [cpc], basis(87.1, 80))).toBeNull();
    expect(hourBaseNote(proof, [cpc], undefined)).toBeNull();
  });
});
