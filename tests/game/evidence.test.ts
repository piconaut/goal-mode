import { MIDWEST_GAME } from '../../src/content/game-midwest';
import { EVIDENCE } from '../../src/content/evidence';
import { MIDWEST } from '../../src/content/scenarios';
import { addPin, incidentSubjects, judgeEvidence, judgeGroupEvidence, type EvidencePin } from '../../src/game/evidence';
import { buildMon3 } from '../../src/game/mon3';
import { advance, newRun, requestChange, startDay, submitRca } from '../../src/game/run';
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
    expect(p.text).toMatch(/^Db2 101 D1 \d\d:00–\d\d:00 RBANK CPU\/txn vs baseline ×/);
    expect(p.text).toContain(`${hourKey.split(':')[1]!.padStart(2, '0')}:00–`);
    expect(addPin(r, MIDWEST, { source: 'DB2', hour: hourKey, workloadId: 'RBANK', metric: 'CPU_VS_BASE' }).ok).toBe(false);
    const iv = regressed.sim.rmf.intervals.length - 1;
    const w = pin(r, { source: 'WLMGL', index: iv, system: '*PLEX', scKey: 'STCHI#1', metric: 'APPL' });
    expect(w.pins.at(-1)!.source).toBe('WLMGL');
    const c = pin(r, { source: 'CPC', index: iv, lparId: 'PROD1', metric: 'CAPPED' }).pins.at(-1)!;
    expect(c.tick).toBe(regressed.sim.rmf.intervals[iv]!.endTick);
    expect(c.value).toBe(regressed.sim.rmf.intervals[iv]!.cpu.find((x) => x.lparId === 'PROD1')!.cappedPct);
  });

  it('keeps at most the configured number of pins', () => {
    let r = regressed;
    for (let i = 0; i < EVIDENCE.maxPins + 3; i++) r = { ...r, pins: [...r.pins, { id: 1000 + i, source: 'x', metric: 'PI', subject: 'X', system: '*PLEX', tick: i, value: 1, text: 'x' }] };
    r = pin(r, { source: 'CPC', lparId: 'PROD1', metric: 'PRSM_DELAY' });
    expect(r.pins.length).toBeLessThanOrEqual(EVIDENCE.maxPins + 3);
    expect(r.pins.at(-1)!.source).toBe('CPC');
  });

  it('counts the IIPCP subset once in WLMGL APPL evidence', () => {
    const index = regressed.sim.rmf.intervals.length - 1;
    const row = regressed.sim.rmf.intervals[index]!.wlm.find((w) => w.applIipcpPct > 0)!;
    expect(row).toBeDefined();
    const r = pin(regressed, { source: 'WLMGL', index, system: row.lparId, scKey: row.scKey, metric: 'APPL' });
    expect(r.pins.at(-1)!.value).toBe(row.applCpPct + row.applIipPct);
  });

  it('pins the CICS failed share as evidence for ROUTING', () => {
    const failing = advance({ ...regressed, pendingCommands: [{ kind: 'SET_MODIFIER', mod: 'regionFailFrac', key: 'RBANK@PROD1', value: 0.35 }] }, MIDWEST, content, HOUR);
    const h = failing.smfHours.at(-1)!;
    const r = pin(failing, { source: 'CICS', hour: `${h.day}:${h.hourOfDay}`, workloadId: 'RBANK', metric: 'FAIL_PCT' });
    expect(r.pins.at(-1)!.value).toBeGreaterThan(5);
    const [j] = judgeEvidence(r, MIDWEST, incident(r, { truth: { mechanism: 'ROUTING', trigger: 'POLICY' } }), r.pins.slice(-1));
    expect(j!.relevance).toBe(1);
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

  it('counts a competing class\'s CPU as evidence for CPU_PRIORITY (playtest D4/D19)', () => {
    const p = { id: 1000, source: 'WLMGL', metric: 'APPL' as const, subject: 'BATCHHI#1', system: '*PLEX', tick: regressed.sim.tick, value: 442, text: 'BATCHHI#1 APPL 442%' };
    const inc = incident(regressed, { workloadId: 'CARDAUTH', truth: { mechanism: 'CPU_PRIORITY', trigger: 'POLICY' } });
    expect(judgeEvidence(regressed, MIDWEST, inc, [p])[0]).toMatchObject({ relevance: 0.5, why: 'consistent with the cause (but not specific)' });
    // Still nothing for a mechanism where high APPL is not the cause, and still inside the window.
    expect(judgeEvidence(regressed, MIDWEST, incident(regressed, { truth: { mechanism: 'IO', trigger: 'POLICY' } }), [p])[0]!.why).toBe('points elsewhere');
    expect(judgeEvidence(regressed, MIDWEST, inc, [{ ...p, tick: regressed.sim.tick + 10 * HOUR }])[0]!.why).toMatch(/window/);
  });

  it('scores the R-16 pins: a foreign image and a small row fail, the hurt image scores (A9, RT-03)', () => {
    const pinOf = (over: Partial<EvidencePin>): EvidencePin => ({
      id: 1000, source: 'WLMGL', metric: 'DELAY_CPU', subject: 'X', system: '*PLEX',
      tick: regressed.sim.tick, value: 20, text: '', ...over,
    });
    const inc = incident(regressed, { workloadId: 'MOBILE', truth: { mechanism: 'CPU_PRIORITY', trigger: 'DEMAND_SURGE' } });
    const pins = [
      pinOf({ subject: 'TSO#1', system: 'PROD2', value: 19.7 }),
      pinOf({ id: 1001, subject: 'SYSTEM#1', system: 'SYSP', metric: 'APPL', value: 3.4 }),
      pinOf({ id: 1002, subject: 'DDFPRD#1', system: 'PROD1', value: 8.2 }),
      pinOf({ id: 1003, subject: 'DDFPRD#1', system: 'PROD1', metric: 'ENDED_RATE', value: 222 }),
    ];
    const v = judgeEvidence(regressed, MIDWEST, inc, pins);
    expect(v.map((x) => [x.relevance, x.why])).toEqual([
      [1, 'points at the cause'],
      [0, 'not on a system MOBILE runs on'],
      [0, 'value is unremarkable'],
      [0.5, 'consistent with the cause (but not specific)'],
    ]);
  });

  it('keeps a competing class on a host image scoring, and needs 5 % of APPL', () => {
    const pinOf = (over: Partial<EvidencePin>): EvidencePin => ({
      id: 1000, source: 'WLMGL', metric: 'APPL', subject: 'BATCHHI#1', system: 'PROD2',
      tick: regressed.sim.tick, value: 442, text: '', ...over,
    });
    const inc = incident(regressed, { workloadId: 'MOBILE', truth: { mechanism: 'CPU_PRIORITY', trigger: 'POLICY' } });
    expect(judgeEvidence(regressed, MIDWEST, inc, [pinOf({})])[0]).toMatchObject({ relevance: 0.5, why: 'consistent with the cause (but not specific)' });
    expect(judgeEvidence(regressed, MIDWEST, inc, [pinOf({ value: 3.4 })])[0]!.why).toBe('value is unremarkable');
    // A sysplex-wide row has no image to check, and a test image's row is still not about production work.
    expect(judgeEvidence(regressed, MIDWEST, inc, [pinOf({ system: '*PLEX' })])[0]!.relevance).toBe(0.5);
    expect(judgeEvidence(regressed, MIDWEST, inc, [pinOf({ system: 'DEVT' })])[0]!.why).toBe('not on a system MOBILE runs on');
    // The full-weight metrics are under the same image test, not just the half-weight APPL row.
    expect(judgeEvidence(regressed, MIDWEST, inc, [pinOf({ metric: 'DELAY_CPU', system: 'DEVT', value: 25 })])[0]!.why)
      .toBe('not on a system MOBILE runs on');
    // R-16's TSO#1 row is the "competing class on a host image" case the entry keeps: PROD2 hosts MOBILE, so the pin
    // keeps its full weight. The two R-16 pins that must score 0 are the foreign image and the unremarkable value.
    expect(judgeEvidence(regressed, MIDWEST, inc, [pinOf({ metric: 'DELAY_CPU', subject: 'TSO#1', value: 19.7 })])[0])
      .toMatchObject({ relevance: 1, why: 'points at the cause' });
  });

  it('does not treat an image the work was routed away from as a host image', () => {
    const inc = incident(regressed, { workloadId: 'MOBILE', truth: { mechanism: 'CPU_PRIORITY', trigger: 'POLICY' } });
    // SET_ROUTING keeps the zero weight, so PROD2 is still a key in the routing table but hosts no MOBILE work.
    const r = { ...regressed, sim: { ...regressed.sim, routing: { ...regressed.sim.routing, MOBILE: { PROD1: 1, PROD2: 0 } } } };
    const pinOn = (system: string): EvidencePin => ({
      id: 1000, source: 'WLMGL', metric: 'DELAY_CPU', subject: 'TSO#1', system,
      tick: regressed.sim.tick, value: 25, text: '',
    });
    expect(judgeEvidence(r, MIDWEST, inc, [pinOn('PROD2')])[0])
      .toMatchObject({ relevance: 0, why: 'not on a system MOBILE runs on' });
    expect(judgeEvidence(r, MIDWEST, inc, [pinOn('PROD1')])[0]!.relevance).toBe(1);
  });

  it.each(['CPU_PRIORITY', 'CPU_CAPACITY'] as const)('awards two zIIP pins for a %s incident', (mechanism) => {
    const pins = ['WLMGL', 'DELAY'].map((source, i) => ({
      id: 1000 + i, source, metric: 'DELAY_ZIIP' as const, subject: `DDFPRD#${i + 1}`,
      system: '*PLEX', tick: regressed.sim.tick, value: 10 + i, text: 'zIIP delay',
    }));
    const inc = incident(regressed, { workloadId: 'MOBILE', truth: { mechanism, trigger: 'POLICY' } });
    const r = { ...regressed, pins, incidents: [inc] };
    expect(judgeEvidence(r, MIDWEST, inc, pins).map((v) => [v.relevance, v.why]))
      .toEqual([[1, 'points at the cause'], [1, 'points at the cause']]);
    const ids = pins.map((p) => p.id);
    const right = submitRca(r, inc.id, mechanism, 'POLICY', MIDWEST, ids);
    expect(right.incidents[0]!.rca!.evidencePoints).toBe(2);
    expect(right.incidents[0]!.rca!.points).toBe(7);
    expect(right.insight - r.insight).toBe(7 + EVIDENCE.strongInsight);
    const wrong = submitRca(r, inc.id, 'IO', 'POLICY', MIDWEST, ids);
    expect(wrong.incidents[0]!.rca!.evidencePoints).toBe(0);
  });

  it('excludes zero-share AORs without changing existing LPAR or class matching', () => {
    const r = { ...regressed, sim: { ...regressed.sim,
      routing: { ...regressed.sim.routing, CARDAUTH: { PROD1: 0, PROD2: 1 } },
    } };
    const inc = incident(r, { workloadId: 'CARDAUTH' });
    const p = { id: 1000, source: 'SYSWKM', metric: 'VELOCITY' as const, subject: 'CICSAOR1',
      system: 'PROD1', tick: r.sim.tick, value: 10, text: '' };
    expect(judgeEvidence(r, MIDWEST, inc, [p])[0])
      .toMatchObject({ relevance: 0, why: 'not about CARDAUTH' });
    for (const subject of ['PROD1', 'STCHI#1']) {
      expect(judgeEvidence(r, MIDWEST, inc, [{ ...p, subject }])[0]!.why).toBe('a symptom, not a cause');
    }
    expect(judgeEvidence(r, MIDWEST, inc, [{ ...p, subject: 'CICSAOR2', system: 'PROD2' }])[0]!.why)
      .toBe('a symptom, not a cause');
  });

  it.each([
    { pin: { subject: 'DEVONLY#1' }, truth: 'CPU_PRIORITY', why: 'not about MOBILE' },
    { pin: { value: 9.9 }, truth: 'CPU_PRIORITY', why: 'value is unremarkable' },
    { pin: { tick: -2 * HOUR - 1 }, truth: 'CPU_PRIORITY', why: 'outside the incident window' },
    { pin: { tick: HOUR + 1 }, truth: 'CPU_PRIORITY', why: 'outside the incident window' },
    { pin: {}, truth: 'IO', why: 'points elsewhere' },
    { pin: {}, truth: 'CAPPING', why: 'points elsewhere' },
  ] as const)('rejects a zIIP pin: $why ($truth, $pin)', ({ pin: over, truth: mechanism, why }) => {
    const p = {
      id: 1000, source: 'DELAY', metric: 'DELAY_ZIIP' as const, subject: 'DDFPRD#1',
      system: '*PLEX', tick: regressed.sim.tick, value: 20, text: 'zIIP delay', ...over,
    };
    if (over.tick !== undefined) p.tick += regressed.sim.tick;
    const inc = incident(regressed, { workloadId: 'MOBILE', truth: { mechanism, trigger: 'POLICY' } });
    const r = { ...regressed, pins: [p], incidents: [inc] };
    expect(judgeEvidence(r, MIDWEST, inc, [p])[0]).toMatchObject({ relevance: 0, why });
    expect(submitRca(r, inc.id, mechanism, 'POLICY', MIDWEST, [p.id]).incidents[0]!.rca!.evidencePoints).toBe(0);
  });
});

describe('evidence pins on a missed batch night', () => {
  const TPD = 24 * HOUR;
  // A synthetic night: critical STL jobs on PROD1 lost most of their time to locks and one ABENDed.
  const night = (r: RunState): RunState => ({
    ...r,
    reports: [...r.reports, {
      day: 0, sla: [], batchMissed: true, trustDelta: {} as never, score: 0, mlcEstimate: 0, events: [],
      batch: {
        day: 0, jobs: 40, done: 38, criticalJobs: 14, criticalDone: 13, criticalEndSec: null, missedDeadline: true,
        criticalDelaySec: { cpu: 300, io: 200, lock: 1400, db2: 100, swap: 0, init: 0 },
        criticalAbended: ['STL009'],
        criticalHosts: [{ lparId: 'PROD1', name: 'STL001', jobClass: 'A' }],
      },
    }],
  });
  const batchInc = (r: RunState, truth: Incident['truth']): Incident =>
    incident(r, { workloadId: 'BATCH', startTick: 12 * HOUR, endTick: TPD, truth });

  it('pins SMF 30 delay shares and ABENDs, and scores them against the night', () => {
    let r = night(regressed);
    r = pin(r, { source: 'BATCH', day: 0, metric: 'JOB_LOCK' });
    r = pin(r, { source: 'BATCH', day: 0, metric: 'JOB_ABEND' });
    r = pin(r, { source: 'BATCH', day: 0, metric: 'JOB_SWAP' });
    const [lock, abend, swap] = r.pins.slice(-3);
    expect(lock!.value).toBeCloseTo(70);
    expect(lock!.source).toBe('SMF 30');
    expect(abend!.value).toBe(1);
    const v = judgeEvidence(r, MIDWEST, batchInc(r, { mechanism: 'LOCK_CONTENTION', trigger: 'BATCH_OVERLAP' }), [lock!, abend!, swap!]);
    expect(v.map((x) => x.relevance)).toEqual([1, 0, 0]);
    expect(v[2]!.why).toMatch(/unremarkable/);
    const failed = judgeEvidence(r, MIDWEST, batchInc(r, { mechanism: 'JOB_FAILURE', trigger: 'BATCH_OVERLAP' }), [abend!]);
    expect(failed[0]!.relevance).toBe(1);
  });

  it('counts WLMGL-style pins on the critical jobs\' service class as about BATCH', () => {
    const r = night(regressed);
    const p = { id: 1, source: 'WLMGL', metric: 'PI' as const, subject: 'BATCHPRD#1', system: '*PLEX', tick: 20 * HOUR, value: 3, text: '' };
    const v = judgeEvidence(r, MIDWEST, batchInc(r, { mechanism: 'CPU_PRIORITY', trigger: 'BATCH_OVERLAP' }), [p]);
    expect(v[0]!.why).not.toMatch(/not about/);
  });

  it('refuses a night without records', () => {
    const out = addPin(regressed, MIDWEST, { source: 'BATCH', day: 0, metric: 'JOB_LOCK' });
    expect(out.ok).toBe(false);
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

describe('CICS resource evidence on region classes', () => {
  it('rejects transaction resource pins in WLMGL, live Monitor III and saved pin history', () => {
    const index = regressed.sim.rmf.intervals.length - 1;
    const wlm = addPin(regressed, MIDWEST, { source: 'WLMGL', index, system: '*PLEX', scKey: 'ONLHI#1', metric: 'DELAY_CPU' });
    expect(wlm.ok).toBe(false);
    expect(wlm.message).toContain('STCHI#1');
    const live = addPin(regressed, MIDWEST, { source: 'MON3', system: '*PLEX', scKey: 'ONLHI#1', metric: 'APPL' });
    expect(live.ok).toBe(false);
    const historical = addPin(regressed, MIDWEST, { source: 'MON3', system: '*PLEX', scKey: 'ONLHI#1', metric: 'DELAY_CPU', tick: regressed.sim.tick }, () => ({ tick: regressed.sim.tick, view: { rows: [{ system: '*PLEX', scKey: 'ONLHI#1', resourceSamples: false, pi: 2, cpuEngines: 0, endedPerSec: 100, delay: { cpu: 0, ziip: 0, io: 0, stor: 0, cap: 0, other: 0 } }], cpc: [] } }));
    expect(historical.ok).toBe(false);
  });

  it('a SYSWKM Veloc pin records the server\'s velocity, not a CPU delay (playtest round 1)', () => {
    const m = buildMon3(regressed, MIDWEST);
    const s = m.wkm!.find((w) => w.scKey === 'ONLHI#1')!.servers[0]!;
    const r = pin(regressed, { source: 'MON3', system: s.system, scKey: 'ONLHI#1', jobname: s.jobname, metric: 'VELOCITY' });
    const p = r.pins.at(-1)!;
    expect([p.source, p.metric, p.subject, p.system]).toEqual(['SYSWKM', 'VELOCITY', s.jobname, s.system]);
    expect(p.value).toBe(s.velocity);
    expect(p.text).toContain(`${s.jobname} velocity`);
    expect(judgeEvidence(r, MIDWEST, incident(r), [p])[0]!.relevance).toBe(0);
    for (const workloadId of ['RBANK', 'CARDAUTH']) {
      expect(judgeEvidence(r, MIDWEST, incident(r, { workloadId }), [p])[0])
        .toMatchObject({ relevance: 0, why: 'a symptom, not a cause' });
    }
    expect(addPin(regressed, MIDWEST, { source: 'MON3', system: s.system, scKey: 'ONLHI#1', jobname: 'NOSUCH', metric: 'VELOCITY' }).ok).toBe(false);
  });

  it('relates added AORs using current workload routing without changing saved pins', () => {
    const aor = { ...MIDWEST.addressSpaces.find((a) => a.role === 'CICS.AOR')!, jobname: 'EXTRAAOR', lparId: 'DEVT' };
    const r = { ...regressed, sim: { ...regressed.sim,
      extraAddressSpaces: [...regressed.sim.extraAddressSpaces, aor],
      routing: { ...regressed.sim.routing, CARDAUTH: { DEVT: 1 } },
    } };
    const p = { id: 1000, source: 'SYSWKM', metric: 'VELOCITY' as const, subject: aor.jobname,
      system: aor.lparId, tick: r.sim.tick, value: 10, text: 'Saved region velocity' };
    const saved = JSON.stringify(p);
    const inc = incident(r, { workloadId: 'CARDAUTH' });
    expect(judgeEvidence(r, MIDWEST, inc, [JSON.parse(saved) as typeof p])[0])
      .toMatchObject({ relevance: 0, why: 'a symptom, not a cause' });
    expect(judgeEvidence(regressed, MIDWEST, inc, [p])[0]!.why).toBe('not about CARDAUTH');
    expect(judgeEvidence(r, MIDWEST, inc, [{ ...p, subject: 'CICSAOR1', system: 'PROD1' }])[0]!.why)
      .toBe('not about CARDAUTH');
    expect(JSON.stringify(p)).toBe(saved);
  });

  it.each([
    { subject: 'NOSUCH', system: 'PROD1', source: 'SYSWKM', workloadId: 'CARDAUTH' },
    { subject: 'CICSAOR1', system: 'PROD2', source: 'SYSWKM', workloadId: 'CARDAUTH' },
    { subject: 'CICSTOR1', system: 'PROD1', source: 'SYSWKM', workloadId: 'CARDAUTH' },
    { subject: 'CICSAOR1', system: 'PROD1', source: 'SYSINFO', workloadId: 'CARDAUTH' },
    { subject: 'CICSAOR1', system: 'PROD1', source: 'SYSWKM', workloadId: 'MOBILE' },
  ])('rejects unrelated server subjects: $subject/$system/$source/$workloadId', ({ workloadId, ...subject }) => {
    const p = { id: 1000, metric: 'VELOCITY' as const, tick: regressed.sim.tick, value: 10, text: '', ...subject };
    expect(judgeEvidence(regressed, MIDWEST, incident(regressed, { workloadId }), [p])[0])
      .toMatchObject({ relevance: 0, why: `not about ${workloadId}` });
  });

  it('keeps the incident window guard for a related server', () => {
    const p = { id: 1000, source: 'SYSWKM', metric: 'VELOCITY' as const, subject: 'CICSAOR1',
      system: 'PROD1', tick: regressed.sim.tick + HOUR + 1, value: 10, text: '' };
    expect(judgeEvidence(regressed, MIDWEST, incident(regressed, { workloadId: 'CARDAUTH' }), [p])[0])
      .toMatchObject({ relevance: 0, why: 'outside the incident window' });
  });

  it('accepts cap delay on a hosted region class as relevant to the CICS incident', () => {
    const p = { id: 1, source: 'WLMGL', metric: 'DELAY_CAP' as const, subject: 'STCHI#1', system: 'PROD1', tick: regressed.sim.tick, value: 80, text: 'Region CPU delay' };
    const inc = incident(regressed, { truth: { mechanism: 'CAPPING', trigger: 'POLICY' } });
    const [v] = judgeEvidence(regressed, MIDWEST, inc, [p]);
    expect(v!.relevance).toBeGreaterThan(0);
    const [unrelated] = judgeEvidence(regressed, MIDWEST, inc, [{ ...p, subject: 'DEVONLY#1' }]);
    expect(unrelated!.relevance).toBe(0);
  });
});

describe("evidence against the incident's own subjects (RT-04, A10)", () => {
  const MOBILE_TRUTH = { mechanism: 'CPU_PRIORITY', trigger: 'POLICY' } as const;

  it('records the classes, images and serving regions when an incident opens', () => {
    const inc = regressed.incidents[0]!;
    expect(inc.subjects).toEqual(incidentSubjects(regressed, MIDWEST, inc.workloadId, inc.day));
    expect(inc.subjects!.classes).toContain('ONLHI');
    expect(inc.subjects!.lpars).toEqual(expect.arrayContaining(['PROD1', 'PROD2']));
    expect(inc.subjects!.servers.map((s) => s.jobname)).toContain('CICSAOR1');
  });

  it('keeps the verdicts after a reclassification and a rerouting', () => {
    const pins: EvidencePin[] = [
      { id: 1000, source: 'WLMGL', metric: 'DELAY_ZIIP', subject: 'DDFPRD#1', system: '*PLEX', tick: regressed.sim.tick, value: 20, text: '' },
      { id: 1001, source: 'WLMGL', metric: 'DELAY_CPU', subject: 'DDFPRD#1', system: 'PROD2', tick: regressed.sim.tick, value: 25, text: '' },
    ];
    const subjects = incidentSubjects(regressed, MIDWEST, 'MOBILE', regressed.day);
    const verdicts = (r: RunState, over: Partial<Incident>) =>
      judgeEvidence(r, MIDWEST, incident(r, { workloadId: 'MOBILE', truth: MOBILE_TRUTH, ...over }), pins).map((v) => [v.relevance, v.why]);
    expect(verdicts(regressed, { subjects })).toEqual([[1, 'points at the cause'], [1, 'points at the cause']]);

    // Before filing the RCA the player gives MOBILE its own class and stops routing it to PROD2.
    const def = structuredClone(regressed.sim.wlm.definition);
    def.classes.push({
      id: 'MOBILECLS',
      description: 'Mobile API',
      periods: [{ goal: { kind: 'AVG', rtSec: 0.1 }, importance: 2, durationSu: null }],
      cpuCritical: false,
      storageCritical: false,
      resourceGroup: null,
      honorPriority: true,
    });
    const ddf = def.subsystems.find((s) => s.subsystem === 'DDF')!;
    ddf.rules = [{ qualifier: 'CI', pattern: 'ZCONNECT', serviceClass: 'MOBILECLS', reportClass: null, children: [] }, ...ddf.rules];
    const edit = requestChange(regressed, content, {
      label: 'Own class and one image',
      commands: [
        { kind: 'ACTIVATE_POLICY', definition: def },
        { kind: 'SET_ROUTING', workloadId: 'MOBILE', routing: { PROD1: 1 } },
      ],
    });
    expect(edit.ok, edit.message).toBe(true);
    // A live change lands on the next tick (the change desk queues its commands).
    const edited = advance(edit.run, MIDWEST, content, 1);
    expect(edited.sim.wlm.definition.classes.some((c) => c.id === 'MOBILECLS')).toBe(true);
    expect(edited.sim.routing.MOBILE).toEqual({ PROD1: 1 });

    // Judged against what the incident recorded: the same verdicts as before the edits.
    expect(verdicts(edited, { subjects })).toEqual([[1, 'points at the cause'], [1, 'points at the cause']]);
    // Judged against today's values (an incident from an old save has no subjects): the A10 defect.
    expect(verdicts(edited, {})).toEqual([[0, 'not about MOBILE'], [0, 'not on a system MOBILE runs on']]);
  });

  it('a group whose incidents recorded different subjects picks the best verdict per pin', () => {
    const pin = { id: 1000, source: 'WLMGL', metric: 'DELAY_ZIIP' as const, subject: 'DDFPRD#1', system: '*PLEX', tick: regressed.sim.tick, value: 20, text: '' };
    const mobile = incident(regressed, { id: 1, workloadId: 'MOBILE', truth: MOBILE_TRUTH, subjects: incidentSubjects(regressed, MIDWEST, 'MOBILE', regressed.day) });
    const card = incident(regressed, { id: 2, workloadId: 'CARDAUTH', truth: MOBILE_TRUTH, subjects: incidentSubjects(regressed, MIDWEST, 'CARDAUTH', regressed.day) });
    expect(judgeGroupEvidence(regressed, MIDWEST, [card, mobile], [pin])[0]).toMatchObject({ pinId: 1000, relevance: 1, why: 'points at the cause' });
  });

  it("a missed night records the critical jobs' classes and images", () => {
    const night = {
      day: 0, jobs: 40, done: 38, criticalJobs: 14, criticalDone: 13, criticalEndSec: null, missedDeadline: true,
      criticalHosts: [{ lparId: 'PROD1', name: 'STL001', jobClass: 'A' }],
    };
    const s = incidentSubjects(regressed, MIDWEST, 'BATCH', 0, night);
    expect(s.lpars).toEqual(['PROD1']);
    expect(s.hosts).toEqual(['PROD1']);
    expect(s.classes).toHaveLength(1);
    expect(s.servers).toEqual([]);
  });
});
