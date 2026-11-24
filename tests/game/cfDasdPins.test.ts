import { describe, expect, it } from 'vitest';
import { MIDWEST_GAME } from '../../src/content/game-midwest';
import { MIDWEST } from '../../src/content/scenarios';
import { addPin, incidentSubjects, judgeEvidence, type EvidencePin } from '../../src/game/evidence';
import { judgeProof } from '../../src/game/proof';
import { newRun } from '../../src/game/run';
import type { Incident, Mechanism, RunState, Trigger } from '../../src/game/types';
import type { RmfInterval } from '../../src/sim/measure/rmf';
import { truthOf } from '../helpers/truth';

const content = { ...MIDWEST_GAME, events: [] };
const run = newRun(MIDWEST, content, 7);

/** One RMF interval with only the CF/DASD rows a pin reads; earlier ones give a baseline. */
const interval = (index: number, over: Partial<RmfInterval> = {}): RmfInterval => ({
  startTick: index * 900,
  endTick: (index + 1) * 900,
  intervalSec: 900,
  policy: 'BASEPOL',
  cpu: [],
  cpcBusy: [],
  wlm: [],
  dasd: { iops: 1000, rtRandomMs: 0.22, rtSeqMs: 0.2, iosqMs: 0, pendMs: 0.1, discMs: 0.07, connMs: 0.01 },
  lcus: [
    { id: '10', label: 'Db2 data 1', volumes: 32, aliases: 21, iops: 300, iosqMs: 0, discMs: 0.07, rtMs: 0.22, aliasesPerHotVol: 0.7 },
    { id: '21', label: 'Db2 data', volumes: 32, aliases: 21, iops: 500, iosqMs: 0, discMs: 0.07, rtMs: 0.22, aliasesPerHotVol: 0.7 },
    { id: '30', label: 'Catalogs', volumes: 32, aliases: 21, iops: 400, iosqMs: 0, discMs: 0.07, rtMs: 0.22, aliasesPerHotVol: 0.7 },
  ],
  cf: [
    { lparId: 'CF01', busyPct: 20, reqPerSec: 5000, syncUs: 18, asyncPct: 0, serviceUs: 18 },
    // CF02 runs on a weak shared ICF engine (F8): its normal sync service is over a millisecond.
    { lparId: 'CF02', busyPct: 5, reqPerSec: 2000, syncUs: 1368, asyncPct: 98, serviceUs: 1420 },
  ],
  cfStructures: [],
  jobs: [],
  ...over,
});

/** Normal CF/DASD intervals, then one interval carrying the looked-for state. */
const withHistory = (over: Partial<RmfInterval>): RunState => ({
  ...run,
  sim: { ...run.sim, rmf: { ...run.sim.rmf, intervals: [interval(0), interval(1), interval(2, over)] } },
});

/** Every interval carries the same state: the row's own history is flat, so only a peer can make it remarkable. */
const standing = (over: Partial<RmfInterval>): RunState => ({
  ...run,
  sim: { ...run.sim, rmf: { ...run.sim.rmf, intervals: [interval(0, over), interval(1, over), interval(2, over)] } },
});

const incident = (mechanism: Mechanism, trigger: Trigger, r: RunState = run): Incident => ({
  id: 999,
  workloadId: 'RBANK',
  day: 0,
  // The pinned interval is the third of the report (endTick 2700); the window is ± 1 h around the incident.
  startTick: 1800,
  endTick: 3600,
  hours: 1,
  worstAttainmentPct: 80,
  truth: truthOf(mechanism, trigger),
  subjects: incidentSubjects(r, MIDWEST, 'RBANK', 0),
  rca: null,
  trustLost: 0,
});

function pin(r: RunState, req: Parameters<typeof addPin>[2]): RunState {
  const out = addPin(r, MIDWEST, req);
  expect(out.ok, out.message).toBe(true);
  return out.run;
}

function verdict(r: RunState, inc: Incident) {
  const [v] = judgeEvidence(r, MIDWEST, inc, r.pins.slice(-1));
  return v!;
}

describe('CF Activity pins (RT-10)', () => {
  it('counts a degraded CF sync service time for a CF-service hardware fault, as a server-side clue', () => {
    // CF_LINK: CF01 sync service ×6, async conversion rising.
    const r = pin(withHistory({ cf: interval(2).cf.map((c) => (c.lparId === 'CF01' ? { ...c, syncUs: 109, asyncPct: 69 } : c)) }), {
      source: 'CF', cfLparId: 'CF01', metric: 'CF_SYNC', index: 2,
    });
    const p = r.pins.at(-1)!;
    expect(p.source).toBe('CF');
    expect(p.value).toBeCloseTo(109);
    expect(p.baseline).toBeCloseTo(18);
    expect(p.text).toMatch(/^CF D1 \d\d:\d\d–\d\d:\d\d CF01 CF sync service time 109 µs/);
    expect(verdict(r, incident('CF_SERVICE', 'HARDWARE_FAULT')).relevance).toBe(1);
    // The same row says nothing about a non-hardware I/O incident: the mechanism and trigger are a CF service's.
    expect(verdict(r, incident('IO', 'POLICY')).relevance).toBe(0);
  });

  it("counts CF02's standing slowness against its peers, not as a new fault (RT-35)", () => {
    // A normal CF02 row (1.4 ms, unchanged) is unremarkable against its own recent normal, but far slower than CF01.
    const r = pin(withHistory({}), { source: 'CF', cfLparId: 'CF02', metric: 'CF_SYNC', index: 2 });
    const p = r.pins.at(-1)!;
    expect(p.value).toBeCloseTo(1368);
    expect(p.peer).toEqual({ value: 18, of: 'CF01' });
    expect(p.baseline).toBeCloseTo(1368);
    expect(p.text).toMatch(/vs CF01 18\.0 µs \(76×\)/);
    // The peer rule makes it evidence for CF_SERVICE, not for an I/O incident.
    expect(verdict(r, incident('CF_SERVICE', 'POLICY')).relevance).toBe(1);
    expect(verdict(r, incident('IO', 'POLICY')).relevance).toBe(0);
  });

  it("proves CF_SERVICE from a CF far slower than the best CF, even at its own normal (RT-35)", () => {
    const r = pin(withHistory({}), { source: 'CF', cfLparId: 'CF02', metric: 'CF_SYNC', index: 2 });
    // The work's own CF time is up (Db2 101); the discriminator is the CF Activity peer reading.
    const cfWait: EvidencePin = {
      id: 5000, source: 'Db2 101', metric: 'CF_WAIT', subject: 'RBANK', system: '*PLEX', tick: 2700, value: 12, text: 'Db2 101 CF time 12 ms/txn',
    };
    const proof = judgeProof(r, MIDWEST, [incident('CPU_PRIORITY', 'POLICY', r)], 'CF_SERVICE', 'POLICY', [cfWait, r.pins.at(-1)!]).mechanism;
    expect(proof.predicates.map((x) => x.met)).toEqual([true, true]);
    expect(proof.complete).toBe(true);
  });

  it('counts async conversion only above the row normal', () => {
    const normal = pin(withHistory({}), { source: 'CF', cfLparId: 'CF01', metric: 'CF_ASYNC_PCT', index: 2 });
    expect(verdict(normal, incident('CF_SERVICE', 'HARDWARE_FAULT')).relevance).toBe(0);
    const degraded = pin(withHistory({ cf: interval(2).cf.map((c) => (c.lparId === 'CF01' ? { ...c, syncUs: 109, asyncPct: 69 } : c)) }), {
      source: 'CF', cfLparId: 'CF01', metric: 'CF_ASYNC_PCT', index: 2,
    });
    expect(degraded.pins.at(-1)!.value).toBeCloseTo(69);
    expect(verdict(degraded, incident('CF_SERVICE', 'HARDWARE_FAULT')).relevance).toBe(1);
  });
});

describe('DASD Activity pins (RT-10)', () => {
  it('counts the ALL VOLUMES DISC time when the back end degraded, and only for I/O', () => {
    const normal = pin(withHistory({}), { source: 'DASD', lcuId: 'ALL', metric: 'DASD_DISC', index: 2 });
    expect(normal.pins.at(-1)!.value).toBeCloseTo(0.07);
    expect(verdict(normal, incident('IO', 'HARDWARE_FAULT')).relevance).toBe(0);
    // DASD_DEGRADED: DISC ×5.
    const degraded = pin(withHistory({ dasd: { ...interval(2).dasd, discMs: 0.37 } }), { source: 'DASD', lcuId: 'ALL', metric: 'DASD_DISC', index: 2 });
    expect(degraded.pins.at(-1)!.value).toBeCloseTo(0.37);
    expect(degraded.pins.at(-1)!.text).toMatch(/^DASD D1 \d\d:\d\d–\d\d:\d\d ALL DISC time 0\.4 ms/);
    expect(verdict(degraded, incident('IO', 'HARDWARE_FAULT')).relevance).toBe(1);
    expect(verdict(degraded, incident('CF_SERVICE', 'POLICY')).relevance).toBe(0);
  });

  it('counts one LCU\'s IOSQ for a batch overlap while an idle LCU stays unremarkable', () => {    // REORG_OVERRUN: LCU 21 IOSQ high, the others idle.
    const busy = interval(2).lcus.map((l) => (l.id === '21' ? { ...l, iosqMs: 21.5, rtMs: 21.9 } : l));
    const hit = pin(withHistory({ lcus: busy }), { source: 'DASD', lcuId: '21', metric: 'DASD_IOSQ', index: 2 });
    expect(hit.pins.at(-1)!.value).toBeCloseTo(21.5);
    expect(verdict(hit, incident('IO', 'BATCH_OVERLAP')).relevance).toBe(1);
    // The wrong LCU says nothing.
    const idle = pin(withHistory({ lcus: busy }), { source: 'DASD', lcuId: '30', metric: 'DASD_IOSQ', index: 2 });
    expect(verdict(idle, incident('IO', 'BATCH_OVERLAP')).relevance).toBe(0);
  });

  it('counts an LCU far slower than the all-LCU median, even when its own history is flat (RT-35)', () => {
    // LCU 30 DISC 0.4 ms against the 0.07 ms median of three LCUs; its own six-interval normal is 0.4, so only
    // the peer reading makes it remarkable.
    const outlier = interval(2).lcus.map((l) => (l.id === '30' ? { ...l, discMs: 0.4 } : l));
    const r = pin(standing({ lcus: outlier }), { source: 'DASD', lcuId: '30', metric: 'DASD_DISC', index: 2 });
    const p = r.pins.at(-1)!;
    expect(p.baseline).toBeCloseTo(0.4);
    expect(p.peer).toEqual({ value: 0.07, of: 'the LCU median' });
    expect(p.text).toMatch(/vs the LCU median 0\.1 ms \(6×\)/);
    expect(verdict(r, incident('IO', 'POLICY')).relevance).toBe(1);
    // The recipe completes from the DASD Activity row.
    const syncIo: EvidencePin = {
      id: 5001, source: 'Db2 101', metric: 'SYNC_IO', subject: 'RBANK', system: '*PLEX', tick: 2700, value: 8, text: 'Db2 101 sync I/O 8 ms/txn',
    };
    const proof = judgeProof(r, MIDWEST, [incident('CPU_PRIORITY', 'POLICY', r)], 'IO', 'POLICY', [syncIo, p]).mechanism;
    expect(proof.predicates.map((x) => x.met)).toEqual([true, true]);
    expect(proof.complete).toBe(true);
  });

  it('counts device response time for a recall storm, but not the DISC row on the same interval', () => {    // HSM_RECALL_STORM: LCU 30 random I/O up, response up, DISC roughly normal.
    const storm = interval(2).lcus.map((l) => (l.id === '30' ? { ...l, iosqMs: 0.23, rtMs: 0.48 } : l));
    const resp = pin(withHistory({ lcus: storm }), { source: 'DASD', lcuId: '30', metric: 'DASD_RESP', index: 2 });
    expect(resp.pins.at(-1)!.value).toBeCloseTo(0.48);
    expect(verdict(resp, incident('IO', 'DEMAND_SURGE')).relevance).toBe(1);
    const disc = pin(withHistory({ lcus: storm }), { source: 'DASD', lcuId: '30', metric: 'DASD_DISC', index: 2 });
    expect(verdict(disc, incident('IO', 'DEMAND_SURGE')).relevance).toBe(0);
  });

  it('rejects an LCU metric on the ALL row and an unknown CF or LCU', () => {
    const r = withHistory({});
    expect(addPin(r, MIDWEST, { source: 'DASD', lcuId: 'ALL', metric: 'DASD_IOSQ', index: 0 }).message).toMatch(/ALL VOLUMES row has DISC only/);
    expect(addPin(r, MIDWEST, { source: 'DASD', lcuId: '99', metric: 'DASD_IOSQ', index: 0 }).message).toBe('No such LCU row');
    expect(addPin(r, MIDWEST, { source: 'CF', cfLparId: 'CF09', metric: 'CF_SYNC', index: 0 }).message).toBe('No such CF Activity row');
  });
});
