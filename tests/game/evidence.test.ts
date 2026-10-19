import { MIDWEST_GAME } from '../../src/content/game-midwest';
import { EVIDENCE } from '../../src/content/evidence';
import { MIDWEST } from '../../src/content/scenarios';
import { addPin, judgeEvidence } from '../../src/game/evidence';
import { advance, newRun, startDay, submitRca } from '../../src/game/run';
import type { Incident, RunState } from '../../src/game/types';

const content = { ...MIDWEST_GAME, events: [] };
const HOUR = 360;
let regressed: RunState;
let hourKey: string;

beforeAll(() => {
  const noon = advance(startDay(newRun(MIDWEST, content, 7), content), MIDWEST, content, 6 * HOUR);
  regressed = advance({ ...noon, pendingCommands: [{ kind: 'SET_MODIFIER', mod: 'cpu', key: 'RBANK', value: 3 }] }, MIDWEST, content, HOUR);
  const h = regressed.smfHours.at(-1)!;
  hourKey = `${h.day}:${h.hourOfDay}`;
});

const incident = (r: RunState, over: Partial<Incident> = {}): Incident => ({
  id: 999,
  workloadId: 'RBANK',
  day: 0,
  startTick: r.sim.tick - HOUR,
  endTick: null,
  hours: 1,
  worstAttainmentPct: 80,
  truth: { mechanism: 'CPU_CAPACITY', trigger: 'ACCESS_PATH_REGRESSION' },
  rca: null,
  trustLost: 0,
  ...over,
});

function pin(r: RunState, req: Parameters<typeof addPin>[2]): RunState {
  const out = addPin(r, MIDWEST, req);
  expect(out.ok, out.message).toBe(true);
  return out.run;
}

describe('evidence pins', () => {
  it('are built from report data with a readable label', () => {
    const r = pin(regressed, { source: 'DB2', hour: hourKey, workloadId: 'RBANK', metric: 'CPU_VS_BASE' });
    const p = r.pins.at(-1)!;
    expect(p.value).toBeGreaterThan(2);
    expect(p.text).toMatch(/Db2 101 .* RBANK CPU\/txn vs baseline ×/);
    expect(addPin(r, MIDWEST, { source: 'DB2', hour: hourKey, workloadId: 'RBANK', metric: 'CPU_VS_BASE' }).ok).toBe(false);
    const iv = regressed.sim.rmf.intervals.length - 1;
    const w = pin(r, { source: 'WLMGL', index: iv, system: '*PLEX', scKey: 'ONLHI#1', metric: 'APPL' });
    expect(w.pins.at(-1)!.source).toBe('WLMGL');
  });

  it('keeps at most the configured number of pins', () => {
    let r = regressed;
    for (let i = 0; i < EVIDENCE.maxPins + 3; i++) r = { ...r, pins: [...r.pins, { id: 1000 + i, source: 'x', metric: 'PI', subject: 'X', system: '*PLEX', tick: i, value: 1, text: 'x' }] };
    r = pin(r, { source: 'CPC', lparId: 'PROD1', metric: 'PRSM_DELAY' });
    expect(r.pins.length).toBeLessThanOrEqual(EVIDENCE.maxPins + 3);
    expect(r.pins.at(-1)!.source).toBe('CPC');
  });

  it('judges relevance by cause, subject, window and size', () => {
    let r = pin(regressed, { source: 'DB2', hour: hourKey, workloadId: 'RBANK', metric: 'CPU_VS_BASE' });
    r = pin(r, { source: 'MON3', system: '*PLEX', scKey: 'ONLHI#1', metric: 'PI' });
    r = pin(r, { source: 'DB2', hour: hourKey, workloadId: 'MOBILE', metric: 'CPU_VS_BASE' });
    const [cause, symptom, other] = judgeEvidence(r, MIDWEST, incident(r), r.pins.slice(-3));
    expect(cause!.relevance).toBe(1);
    expect(symptom!.why).toMatch(/symptom/);
    expect(other!.relevance).toBe(0);
    const late = judgeEvidence(r, MIDWEST, incident(r, { startTick: r.sim.tick + 10 * HOUR }), r.pins.slice(-3));
    expect(late[0]!.why).toMatch(/window/);
  });

  it('pays evidence points only with the right mechanism', () => {
    let r = pin(regressed, { source: 'DB2', hour: hourKey, workloadId: 'RBANK', metric: 'CPU_VS_BASE' });
    r = pin(r, { source: 'CICS', hour: hourKey, workloadId: 'RBANK', metric: 'CPU_VS_BASE' });
    const ids = r.pins.slice(-2).map((p) => p.id);
    const withInc = { ...r, incidents: [incident(r)] };
    const right = submitRca(withInc, 999, 'CPU_CAPACITY', 'ACCESS_PATH_REGRESSION', MIDWEST, ids);
    expect(right.incidents[0]!.rca!.evidencePoints).toBe(2);
    expect(right.insight - withInc.insight).toBe(5 + 2 + EVIDENCE.strongInsight);
    const wrong = submitRca(withInc, 999, 'LOCK_CONTENTION', 'ACCESS_PATH_REGRESSION', MIDWEST, ids);
    expect(wrong.incidents[0]!.rca!.evidencePoints).toBe(0);
  });
});

describe('SLA attainment', () => {
  it('never shows more than 100% for an average-RT SLA missed on failures', async () => {
    const { hourAttainment } = await import('../../src/game/sla');
    const w = MIDWEST.workloads.find((x) => x.sla.kind === 'AVG')!;
    const att = hourAttainment(w, { completions: 1000, withinSla: 1000, failed: 30, rtSumSec: 1000 * 0.1, parts: {} })!;
    expect(att.met).toBe(false);
    expect(att.attainmentPct).toBeLessThanOrEqual(100);
  });
});
