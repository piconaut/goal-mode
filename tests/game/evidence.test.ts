import { MIDWEST_GAME } from '../../src/content/game-midwest';
import { EVIDENCE } from '../../src/content/evidence';
import { MIDWEST } from '../../src/content/scenarios';
import { addPin, incidentSubjects, judgeEvidence, judgeGroupEvidence, pinRelation, type EvidencePin } from '../../src/game/evidence';
import { buildMon3 } from '../../src/game/mon3';
import { cicsMonitoring } from '../../src/game/smf';
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

  it('counts a competing class\'s CPU from a host image, and a *PLEX row cannot place it (playtest D4/D19, RT-12)', () => {
    const p = { id: 1000, source: 'WLMGL', metric: 'APPL' as const, subject: 'BATCHHI#1', system: 'PROD2', tick: regressed.sim.tick, value: 442, text: 'BATCHHI#1 APPL 442%' };
    const inc = incident(regressed, { workloadId: 'CARDAUTH', truth: { mechanism: 'CPU_PRIORITY', trigger: 'POLICY' } });
    expect(judgeEvidence(regressed, MIDWEST, inc, [p])[0]).toMatchObject({ relevance: 0.5, why: 'consistent with the cause (but not specific)' });
    // A `*PLEX` row is the roll-up of every image: it cannot say the competitor shared the hurt work's host.
    expect(judgeEvidence(regressed, MIDWEST, inc, [{ ...p, system: '*PLEX' }])[0])
      .toMatchObject({ relevance: 0, why: 'a *PLEX row does not show which image the class ran on' });
    // Still nothing for a mechanism where high APPL is not the cause, and still inside the window.
    expect(judgeEvidence(regressed, MIDWEST, incident(regressed, { truth: { mechanism: 'IO', trigger: 'POLICY' } }), [p])[0]!.why).toBe('points elsewhere');
    expect(judgeEvidence(regressed, MIDWEST, inc, [{ ...p, tick: regressed.sim.tick + 10 * HOUR }])[0]!.why).toMatch(/window/);
  });

  it('scores the R-16 pins: a competitor\'s delay is not the work\'s own, a foreign image and a small row fail (A9, RT-12)', () => {
    const pinOf = (over: Partial<EvidencePin>): EvidencePin => ({
      id: 1000, source: 'WLMGL', metric: 'DELAY_CPU', subject: 'X', system: '*PLEX',
      tick: regressed.sim.tick, value: 20, text: '', ...over,
    });
    const inc = incident(regressed, { workloadId: 'MOBILE', truth: { mechanism: 'CPU_PRIORITY', trigger: 'DEMAND_SURGE' } });
    const pins = [
      // R-16's residual: PROD2 is a MOBILE host, but the row is TSO's delay, not MOBILE's. Only a competitor's *CPU*
      // (APPL) is the policy evidence; another class's delay says nothing about why MOBILE waited.
      pinOf({ subject: 'TSO#1', system: 'PROD2', value: 19.7 }),
      pinOf({ id: 1001, subject: 'SYSTEM#1', system: 'SYSP', metric: 'APPL', value: 3.4 }),
      pinOf({ id: 1002, subject: 'DDFPRD#1', system: 'PROD1', value: 8.2 }),
      pinOf({ id: 1003, subject: 'DDFPRD#1', system: 'PROD1', metric: 'ENDED_RATE', value: 222 }),
    ];
    const v = judgeEvidence(regressed, MIDWEST, inc, pins);
    expect(v.map((x) => [x.relevance, x.why])).toEqual([
      [0, "another class's row, not the hurt work's"],
      [0, 'not on a system MOBILE runs on'],
      [0, 'value is unremarkable'],
      [0.5, 'consistent with the cause (but not specific)'],
    ]);
  });

  it('needs a host image for a competing class\'s APPL, and keeps the 5 % line (RT-12)', () => {
    const pinOf = (over: Partial<EvidencePin>): EvidencePin => ({
      id: 1000, source: 'WLMGL', metric: 'APPL', subject: 'BATCHHI#1', system: 'PROD2',
      tick: regressed.sim.tick, value: 442, text: '', ...over,
    });
    const inc = incident(regressed, { workloadId: 'MOBILE', truth: { mechanism: 'CPU_PRIORITY', trigger: 'POLICY' } });
    expect(judgeEvidence(regressed, MIDWEST, inc, [pinOf({})])[0]).toMatchObject({ relevance: 0.5, why: 'consistent with the cause (but not specific)' });
    expect(judgeEvidence(regressed, MIDWEST, inc, [pinOf({ value: 3.4 })])[0]!.why).toBe('value is unremarkable');
    // A sysplex-wide row cannot show which image the class ran on, and a test image is not a host of production work.
    expect(judgeEvidence(regressed, MIDWEST, inc, [pinOf({ system: '*PLEX' })])[0])
      .toMatchObject({ relevance: 0, why: 'a *PLEX row does not show which image the class ran on' });
    expect(judgeEvidence(regressed, MIDWEST, inc, [pinOf({ system: 'DEVT' })])[0]!.why).toBe('not on a system MOBILE runs on');
    // The full-weight metrics are under the same image test, not just the half-weight APPL row.
    expect(judgeEvidence(regressed, MIDWEST, inc, [pinOf({ metric: 'DELAY_CPU', system: 'DEVT', value: 25 })])[0]!.why)
      .toBe('not on a system MOBILE runs on');
    // R-16's TSO#1 row is the residual RT-03 left: PROD2 hosts MOBILE, but TSO's own CPU delay is not MOBILE's, so it
    // scores nothing (RT-12). A competitor's *CPU* row is the policy evidence, at half weight.
    expect(judgeEvidence(regressed, MIDWEST, inc, [pinOf({ metric: 'DELAY_CPU', subject: 'TSO#1', value: 19.7 })])[0])
      .toMatchObject({ relevance: 0, why: "another class's row, not the hurt work's" });
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
    // PROD1 still hosts MOBILE, so the row is a competitor's delay (RT-12), not the work's own.
    expect(judgeEvidence(r, MIDWEST, inc, [pinOn('PROD1')])[0]!.relevance).toBe(0);
    const own = { ...pinOn('PROD1'), subject: 'DDFPRD#2', value: 25 };
    expect(judgeEvidence(r, MIDWEST, inc, [own])[0]).toMatchObject({ relevance: 1, why: 'points at the cause' });
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

  it('matches regions by jobname and image, and finds a region class as the work\'s server (RT-12)', () => {
    const r = { ...regressed, sim: { ...regressed.sim,
      routing: { ...regressed.sim.routing, CARDAUTH: { PROD1: 0, PROD2: 1 } },
    } };
    const inc = incident(r, { workloadId: 'CARDAUTH' });
    const p = { id: 1000, source: 'SYSWKM', metric: 'VELOCITY' as const, subject: 'CICSAOR1',
      system: 'PROD1', tick: r.sim.tick, value: 10, text: '' };
    // An AOR on the zero-share image serves no CARDAUTH work, so it is not a server of the incident.
    expect(judgeEvidence(r, MIDWEST, inc, [p])[0])
      .toMatchObject({ relevance: 0, why: 'not about CARDAUTH' });
    // A SYSWKM row names a region jobname: an LPAR id is not about the work.
    expect(judgeEvidence(r, MIDWEST, inc, [{ ...p, subject: 'PROD1' }])[0]!.why).toBe('not about CARDAUTH');
    // The region's own class row is a `server` relation, which a symptom metric accepts — from an image it serves.
    const wlm = { ...p, source: 'WLMGL', subject: 'STCHI#1' };
    expect(judgeEvidence(r, MIDWEST, inc, [{ ...wlm, system: 'PROD2' }])[0]!.why).toBe('a symptom, not a cause');
    expect(judgeEvidence(r, MIDWEST, inc, [wlm])[0]!.why).toBe('not on a system CARDAUTH runs on');
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
    // Judged against today's values (an incident from an old save has no subjects): the A10 defect, now with the
    // relation's own reasons: DDFPRD is another class, and a *PLEX row cannot place it.
    expect(verdicts(edited, {})).toEqual([
      [0, 'a *PLEX row does not show which image the class ran on'],
      [0, 'not on a system MOBILE runs on'],
    ]);
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

describe('capacity and processor-split pins (RT-05, A11)', () => {
  const iv = () => regressed.sim.rmf.intervals.length - 1;
  const pinOf = (r: RunState, req: Parameters<typeof addPin>[2]): EvidencePin => {
    const out = addPin(r, MIDWEST, req);
    expect(out.ok, out.message).toBe(true);
    return out.run.pins.at(-1)!;
  };

  it('pins the image and CPC busy figures from a Partition Data interval', () => {
    const index = iv();
    const row = regressed.sim.rmf.intervals[index]!.cpu.find((x) => x.lparId === 'PROD1')!;
    const cpc = regressed.sim.config.lpars.find((l) => l.id === 'PROD1')!.cpcId;
    // The image's own busy: its delivered CP engines over its logical CPs.
    const lpar = pinOf(regressed, { source: 'CPC', index, lparId: 'PROD1', metric: 'LPAR_BUSY' });
    expect(lpar).toMatchObject({ subject: 'PROD1', value: row.logicalBusyPct, metric: 'LPAR_BUSY' });
    expect(lpar.text).toContain('image busy');
    // The processor's: its CP pool's physical busy, about the CPC rather than the image.
    const busy = pinOf(regressed, { source: 'CPC', index, lparId: 'PROD1', metric: 'CPC_BUSY' });
    const cpcRow = regressed.sim.rmf.intervals[index]!.cpcBusy.find((x) => x.cpcId === cpc && x.pool === 'CP')!;
    expect(busy).toMatchObject({ subject: cpc, system: cpc, value: cpcRow.physicalBusyPct });
    // No capacity adjustment in a healthy run: 100 % of the setting.
    expect(pinOf(regressed, { source: 'CPC', index, lparId: 'PROD1', metric: 'CAPACITY_ADJ' }).value).toBe(0);
  });

  it('pins the same three from the live Monitor III CPC view, and the CLIs trimmed history refuses them', () => {
    const view = buildMon3(regressed, MIDWEST);
    const c = view.cpc.find((x) => x.lparId === 'PROD1')!;
    // Without a Partition Data interval the pin reads the Monitor III CPC view as it stands now: the *CP row is the
    // box's physical utilisation (LPAR management included, RMF Report Analysis 3.1 p.99), which agrees with the
    // Partition Data figure of the interval that just closed.
    const busy = pinOf(regressed, { source: 'CPC', lparId: 'PROD1', metric: 'CPC_BUSY' });
    const expected = view.cpc.filter((x) => x.cpcId === c.cpcId && x.kind === 'ZOS').reduce((a, x) => a + x.physTotalPct, 0);
    expect(busy.value).toBeCloseTo(expected);
    expect(busy.subject).toBe(c.cpcId);
    const interval = regressed.sim.rmf.intervals[iv()]!.cpcBusy.find((x) => x.cpcId === c.cpcId && x.pool === 'CP')!;
    expect(Math.abs(busy.value - interval.physicalBusyPct)).toBeLessThan(10);
    expect(pinOf(regressed, { source: 'CPC', lparId: 'PROD1', metric: 'LPAR_BUSY' }).value).toBe(c.busyPct);
    expect(pinOf(regressed, { source: 'CPC', lparId: 'PROD1', metric: 'CAPACITY_ADJ' }).value).toBe(0);
    // A past range from the CLI's trimmed history has no such column.
    for (const metric of ['LPAR_BUSY', 'CPC_BUSY', 'CAPACITY_ADJ'] as const) {
      const trimmed = addPin(regressed, MIDWEST, { source: 'CPC', lparId: 'PROD1', metric, tick: regressed.sim.tick }, () => ({
        tick: regressed.sim.tick,
        view: { rows: [], cpc: [{ lparId: 'PROD1', prsmDelayPct: 1, cappedPct: 0 }] },
      }));
      expect(trimmed.ok).toBe(false);
      expect(trimmed.message).toContain('pin the value from a Partition Data interval');
    }
  });

  it('pins a capacity reduction as the loss from the normal setting', () => {
    const reduced = { ...regressed, sim: { ...regressed.sim, config: { ...regressed.sim.config, cpcs: regressed.sim.config.cpcs.map((c) => ({ ...c, peakCapacitySetting: 6 as const, capacitySetting: 4 as const })) } } };
    // The live Monitor III view carries the adjustment of the state it was built from (a past interval keeps the
    // setting it ran at; the view is rebuilt per tick and snapshotted into history).
    const p = pinOf(reduced, { source: 'CPC', lparId: 'PROD1', metric: 'CAPACITY_ADJ' });
    expect(p.value).toBeGreaterThan(1);
    expect(p.value).toBeLessThan(100);
    // It is evidence for a capacity incident and for a hardware fault, not for priority.
    const inc = incident(reduced, { workloadId: 'MOBILE', truth: { mechanism: 'CPU_CAPACITY', trigger: 'HARDWARE_FAULT' } });
    expect(judgeEvidence(reduced, MIDWEST, inc, [p])[0]).toMatchObject({ relevance: 1, why: 'points at the cause' });
    const priority = incident(reduced, { workloadId: 'MOBILE', truth: { mechanism: 'CPU_PRIORITY', trigger: 'POLICY' } });
    expect(judgeEvidence(reduced, MIDWEST, priority, [p])[0]).toMatchObject({ relevance: 0, why: 'points elsewhere' });
    // A past range uses the adjustment recorded with it, not the present capacity setting.
    const past = addPin(reduced, MIDWEST, { source: 'CPC', lparId: 'PROD1', metric: 'CAPACITY_ADJ', tick: reduced.sim.tick - 360 }, () => ({
      tick: reduced.sim.tick - 360,
      view: { rows: [], cpc: [{ lparId: 'PROD1', prsmDelayPct: 1, cappedPct: 0, cpcId: 'CPCA', kind: 'ZOS', physTotalPct: 90, capacityAdjPct: 12 }] },
    }));
    expect(past.ok, past.message).toBe(true);
    expect(past.run.pins.at(-1)!.value).toBe(12);
  });

  it('a CPC pin relates through the images the incident runs on', () => {
    const p: EvidencePin = { id: 1000, source: 'CPC', metric: 'CPC_BUSY', subject: 'CPCA', system: 'CPCA', tick: regressed.sim.tick, value: 96, text: '' };
    const inc = incident(regressed, { workloadId: 'MOBILE', truth: { mechanism: 'CPU_CAPACITY', trigger: 'GROWTH' } });
    expect(judgeEvidence(regressed, MIDWEST, inc, [p])[0]).toMatchObject({ relevance: 1, why: 'points at the cause' });
    // Another processor is not about this incident, and an idle one is unremarkable.
    expect(judgeEvidence(regressed, MIDWEST, inc, [{ ...p, subject: 'CPCZ', system: 'CPCZ' }])[0]!.why).toBe('not about MOBILE');
    expect(judgeEvidence(regressed, MIDWEST, inc, [{ ...p, value: 40 }])[0]!.why).toBe('value is unremarkable');
  });

  it('pins the CP, IIP and IIPCP split of APPL% beside the summed value', () => {
    const index = iv();
    const rows = regressed.sim.rmf.intervals[index]!.wlm.filter((w) => w.lparId !== '*PLEX');
    const row = rows.reduce((a, b) => (b.applIipcpPct > a.applIipcpPct ? b : a));
    expect(row.applIipcpPct).toBeGreaterThan(0);
    const cp = pinOf(regressed, { source: 'WLMGL', index, system: row.lparId, scKey: row.scKey, metric: 'APPL_CP' });
    const iip = pinOf(regressed, { source: 'WLMGL', index, system: row.lparId, scKey: row.scKey, metric: 'APPL_IIP' });
    const iipcp = pinOf(regressed, { source: 'WLMGL', index, system: row.lparId, scKey: row.scKey, metric: 'IIPCP' });
    expect([cp.value, iip.value, iipcp.value]).toEqual([row.applCpPct, row.applIipPct, row.applIipcpPct]);
    // Below the 5 % line this row is unremarkable; a real overflow counts half, like APPL, on any class of a host
    // image (the split is about the processor, not the class).
    const inc = incident(regressed, { workloadId: 'MOBILE', truth: { mechanism: 'CPU_CAPACITY', trigger: 'POLICY' } });
    expect(judgeEvidence(regressed, MIDWEST, inc, [iipcp])[0]!.why).toBe('value is unremarkable');
    expect(judgeEvidence(regressed, MIDWEST, inc, [{ ...iipcp, value: 20 }])[0]).toMatchObject({ relevance: 0.5, why: 'consistent with the cause (but not specific)' });
  });

  it('labels the split pinned from Monitor III as PROCU, like APPL', () => {
    const live = buildMon3(regressed, MIDWEST);
    const row = live.rows.find((r) => r.system !== '*PLEX' && r.resourceSamples !== false && r.ziipEngines > 0)!;
    for (const metric of ['APPL', 'APPL_CP', 'APPL_IIP', 'IIPCP'] as const)
      expect(pinOf(regressed, { source: 'MON3', system: row.system, scKey: row.scKey, metric }).source).toBe('PROCU');
  });
});

describe('pin relations (RT-12, docs/rca-design.md §4.6)', () => {
  const subjects = (workloadId: string) => incidentSubjects(regressed, MIDWEST, workloadId, regressed.day);
  const pinOf = (over: Partial<EvidencePin>): EvidencePin => ({
    id: 1000, source: 'WLMGL', metric: 'DELAY_CPU', subject: 'DDFPRD#1', system: '*PLEX',
    tick: regressed.sim.tick, value: 25, text: '', ...over,
  });

  it('says how each row relates to the incident', () => {
    const card = subjects('CARDAUTH');
    const inc = incident(regressed, { workloadId: 'CARDAUTH' });
    // The work's own class, and its own Db2/CICS accounting.
    expect(pinRelation(regressed, inc, pinOf({ subject: 'ONLHI#1' }), card)).toBe('self');
    expect(pinRelation(regressed, inc, pinOf({ source: 'CICS 110', subject: 'CARDAUTH' }), card)).toBe('self');
    // A region class and a region's own row serve the work.
    expect(pinRelation(regressed, inc, pinOf({ subject: 'STCHI#2', system: 'PROD1' }), card)).toBe('server');
    expect(pinRelation(regressed, inc, pinOf({ source: 'SYSWKM', metric: 'VELOCITY', subject: 'CICSAOR3', system: 'PROD1' }), card)).toBe('server');
    // Another class is only placeable from an image the work runs on.
    expect(pinRelation(regressed, inc, pinOf({ subject: 'BATCHHI#1', system: 'PROD2' }), card)).toBe('competitor');
    expect(pinRelation(regressed, inc, pinOf({ subject: 'BATCHHI#1', system: '*PLEX' }), card)).toBeNull();
    // An image and its processor are the host.
    expect(pinRelation(regressed, inc, pinOf({ source: 'CPC', metric: 'LPAR_BUSY', subject: 'PROD2', system: 'PROD2' }), card)).toBe('host');
    expect(pinRelation(regressed, inc, pinOf({ source: 'CPC', metric: 'CPC_BUSY', subject: 'CPCA', system: 'CPCA' }), card)).toBe('host');
    expect(pinRelation(regressed, inc, pinOf({ source: 'CPC', metric: 'CPC_BUSY', subject: 'CPCZ', system: 'CPCZ' }), card)).toBeNull();
    // A region row from an image it does not serve relates to nothing. A class-shaped row on a host image is a
    // competitor even when today's definition has dropped the class (A10); a subject that is not class-shaped and
    // that no definition knows relates to nothing.
    expect(pinRelation(regressed, inc, pinOf({ source: 'SYSWKM', metric: 'VELOCITY', subject: 'CICSAOR1', system: 'PROD2' }), card)).toBeNull();
    expect(pinRelation(regressed, inc, pinOf({ subject: 'NOSUCH#1', system: 'PROD2' }), card)).toBe('competitor');
    expect(pinRelation(regressed, inc, pinOf({ subject: 'NOCLASS', system: 'PROD2' }), card)).toBeNull();
    // The work's own class on an image it never ran on is not about the incident either (the mirror of A9).
    expect(pinRelation(regressed, inc, pinOf({ subject: 'ONLHI#1', system: 'DEVT' }), card)).toBeNull();
  });

  it('records a CICS workload\'s region classes apart from its own', () => {
    const card = subjects('CARDAUTH');
    expect(card.serverClasses).toEqual(['STCHI']);
    expect(card.classes).toEqual(expect.arrayContaining(['ONLHI', 'STCHI']));
    // A workload with no regions records none, so every class it has is its own.
    expect(subjects('MOBILE').serverClasses).toBeUndefined();
  });

  it('counts only the relations the metric is evidence for', () => {
    const inc = incident(regressed, { workloadId: 'MOBILE', truth: { mechanism: 'CPU_PRIORITY', trigger: 'POLICY' } });
    // R-16's residual: TSO ran on a MOBILE image, but its own CPU delay is not MOBILE's delay.
    const tsoDelay = pinOf({ subject: 'TSO#1', system: 'PROD2', value: 19.7 });
    expect(judgeEvidence(regressed, MIDWEST, inc, [tsoDelay])[0])
      .toMatchObject({ relevance: 0, why: "another class's row, not the hurt work's" });
    // Its CPU share is the competitor clue the policy question needs, at the half weight APPL carries.
    const tsoAppl = { ...tsoDelay, metric: 'APPL' as const, value: 40 };
    expect(judgeEvidence(regressed, MIDWEST, inc, [tsoAppl])[0])
      .toMatchObject({ relevance: 0.5, why: 'consistent with the cause (but not specific)' });
    // The same applies to an APPL row of one of MOBILE's own classes: it is accepted as itself, still at half weight.
    const own = { ...tsoDelay, subject: 'DDFPRD#1' };
    expect(judgeEvidence(regressed, MIDWEST, inc, [{ ...own, metric: 'APPL' as const, value: 40 }])[0]!.relevance).toBe(0.5);
  });

  it('posits no relation for an own-class row from an image the work was routed away from', () => {
    const r = { ...regressed, sim: { ...regressed.sim, routing: { ...regressed.sim.routing, CARDAUTH: { PROD1: 0, PROD2: 1 } } } };
    const inc = incident(r, { workloadId: 'CARDAUTH', truth: { mechanism: 'CPU_PRIORITY', trigger: 'DEMAND_SURGE' } });
    // A DDF/TSO row of another class on the abandoned image is not the work's own delay, and neither is its own class's
    // row there: only PROD2 hosts CARDAUTH now.
    expect(judgeEvidence(r, MIDWEST, inc, [pinOf({ subject: 'ONLHI#1', system: 'PROD1' })])[0])
      .toMatchObject({ relevance: 0, why: 'not on a system CARDAUTH runs on' });
    expect(judgeEvidence(r, MIDWEST, inc, [pinOf({ subject: 'ONLHI#1', system: 'PROD2' })])[0]!.relevance).toBe(1);
    // The same holds for the host facts of an image it no longer runs on.
    for (const metric of ['LPAR_BUSY', 'CAPPED', 'PRSM_DELAY'] as const) {
      const host = pinOf({ source: 'CPC', metric, subject: 'PROD1', system: 'PROD1', value: 99 });
      expect(judgeEvidence(r, MIDWEST, inc, [host])[0]!.why, metric).toBe('not about CARDAUTH');
    }
  });

  it('reads a region class as the work\'s own when the incident predates RT-12', () => {
    const card = subjects('CARDAUTH');
    const { serverClasses: _drop, ...old } = card;
    const inc = incident(regressed, { workloadId: 'CARDAUTH', subjects: old });
    expect(pinRelation(regressed, inc, pinOf({ subject: 'STCHI#1', system: 'PROD1' }), old)).toBe('self');
  });

  it('stores a baseline beside the value so a predicate can ask for "normal" (RT-12)', () => {
    // CPU per transaction is already a ratio to the baseline.
    const db2 = pin(regressed, { source: 'DB2', hour: hourKey, workloadId: 'RBANK', metric: 'CPU_VS_BASE' }).pins.at(-1)!;
    expect(db2.baseline).toBe(1);
    // A rate's baseline is the median of the closed hours before the pinned one, which the pinned hour is not part of.
    const rate = pin(regressed, { source: 'CICS', hour: hourKey, workloadId: 'CARDAUTH', metric: 'ENDED_RATE' }).pins.at(-1)!;
    expect(rate.baseline).toBeGreaterThan(0);
    const hourIndex = regressed.smfHours.findIndex((h) => `${h.day}:${h.hourOfDay}` === hourKey);
    const earlierRates = regressed.smfHours.slice(Math.max(0, hourIndex - 6), hourIndex)
      .map((h) => cicsMonitoring(regressed, MIDWEST, `${h.day}:${h.hourOfDay}`).find((x) => x.workloadId === 'CARDAUTH')?.txnPerSec)
      .filter((x): x is number => x !== undefined)
      .sort((a, b) => a - b);
    const rateMid = earlierRates.length >> 1;
    expect(rate.baseline).toBeCloseTo(earlierRates.length % 2 === 1 ? earlierRates[rateMid]! : (earlierRates[rateMid - 1]! + earlierRates[rateMid]!) / 2);
    // A Workload Activity share's baseline is the median of the report intervals before the pinned one.
    const iv = regressed.sim.rmf.intervals.length - 1;
    const row = regressed.sim.rmf.intervals[iv]!.wlm.find((x) => x.lparId !== '*PLEX' && x.applCpPct + x.applIipPct > 5)!;
    const appl = pin(regressed, { source: 'WLMGL', index: iv, system: row.lparId, scKey: row.scKey, metric: 'APPL' }).pins.at(-1)!;
    const earlier = regressed.sim.rmf.intervals.slice(Math.max(0, iv - 6), iv)
      .map((x) => x.wlm.find((r) => r.lparId === row.lparId && r.scKey === row.scKey))
      .filter((r) => r !== undefined)
      .map((r) => r!.applCpPct + r!.applIipPct)
      .sort((a, b) => a - b);
    const mid = earlier.length >> 1;
    expect(appl.baseline).toBeCloseTo(earlier.length % 2 === 1 ? earlier[mid]! : (earlier[mid - 1]! + earlier[mid]!) / 2);
    // The first interval of a run has no earlier rows to compare with.
    expect(pin(regressed, { source: 'WLMGL', index: 0, system: row.lparId, scKey: row.scKey, metric: 'APPL' }).pins.at(-1)!.baseline)
      .toBeUndefined();
    // Partition Data rows carry one too, from the intervals before the pinned one.
    const busy = pin(regressed, { source: 'CPC', index: iv, lparId: 'PROD1', metric: 'LPAR_BUSY' }).pins.at(-1)!;
    const earlierBusy = regressed.sim.rmf.intervals.slice(Math.max(0, iv - 6), iv)
      .map((x) => x.cpu.find((r) => r.lparId === 'PROD1')?.logicalBusyPct)
      .filter((x): x is number => x !== undefined)
      .sort((a, b) => a - b);
    const busyMid = earlierBusy.length >> 1;
    expect(busy.baseline).toBeCloseTo(earlierBusy.length % 2 === 1 ? earlierBusy[busyMid]! : (earlierBusy[busyMid - 1]! + earlierBusy[busyMid]!) / 2);
    // Every Monitor III pin has none: its view normalises APPL and ended/s differently, so a WLMGL median would mislead.
    expect(pin(regressed, { source: 'MON3', system: row.lparId, scKey: row.scKey, metric: 'APPL' }).pins.at(-1)!.baseline)
      .toBeUndefined();
  });
});
