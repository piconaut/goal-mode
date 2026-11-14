import { describe, expect, it } from 'vitest';
import { MIDWEST_GAME } from '../../src/content/game-midwest';
import { MIDWEST } from '../../src/content/scenarios';
import { addPin, judgeEvidence } from '../../src/game/evidence';
import { newRun } from '../../src/game/run';
import type { Incident, Mechanism, RunState, Trigger } from '../../src/game/types';
import type { RmfInterval } from '../../src/sim/measure/rmf';

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

const incident = (mechanism: Mechanism, trigger: Trigger, r: RunState = run): Incident => ({
  id: 999,
  workloadId: 'RBANK',
  day: 0,
  // The pinned interval is the third of the report (endTick 2700); the window is ± 1 h around the incident.
  startTick: 1800,
  endTick: 3600,
  hours: 1,
  worstAttainmentPct: 80,
  truth: { mechanism, trigger },
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
    expect(p.text).toMatch(/^CF D1 13:30 CF01 CF sync service time 109 µs/);
    expect(verdict(r, incident('CF_SERVICE', 'HARDWARE_FAULT')).relevance).toBe(1);
    // The same row says nothing about a non-hardware I/O incident: the mechanism and trigger are a CF service's.
    expect(verdict(r, incident('IO', 'POLICY')).relevance).toBe(0);
  });

  it("does not count CF02's chronically slow engine as evidence for every CF incident", () => {
    // A normal CF02 row (1.4 ms, unchanged) clears the absolute line but not its own recent normal.
    const r = pin(withHistory({}), { source: 'CF', cfLparId: 'CF02', metric: 'CF_SYNC', index: 2 });
    expect(r.pins.at(-1)!.value).toBeCloseTo(1368);
    const v = verdict(r, incident('CF_SERVICE', 'HARDWARE_FAULT'));
    expect(v.relevance).toBe(0);
    expect(v.why).toBe('value is unremarkable');
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
    expect(degraded.pins.at(-1)!.text).toMatch(/^DASD D1 13:30 ALL DISC time 0\.4 ms/);
    expect(verdict(degraded, incident('IO', 'HARDWARE_FAULT')).relevance).toBe(1);
    expect(verdict(degraded, incident('CF_SERVICE', 'POLICY')).relevance).toBe(0);
  });

  it('counts one LCU\'s IOSQ for a batch overlap while an idle LCU stays unremarkable', () => {
    // REORG_OVERRUN: LCU 21 IOSQ high, the others idle.
    const busy = interval(2).lcus.map((l) => (l.id === '21' ? { ...l, iosqMs: 21.5, rtMs: 21.9 } : l));
    const hit = pin(withHistory({ lcus: busy }), { source: 'DASD', lcuId: '21', metric: 'DASD_IOSQ', index: 2 });
    expect(hit.pins.at(-1)!.value).toBeCloseTo(21.5);
    expect(verdict(hit, incident('IO', 'BATCH_OVERLAP')).relevance).toBe(1);
    // The wrong LCU says nothing.
    const idle = pin(withHistory({ lcus: busy }), { source: 'DASD', lcuId: '30', metric: 'DASD_IOSQ', index: 2 });
    expect(verdict(idle, incident('IO', 'BATCH_OVERLAP')).relevance).toBe(0);
  });

  it('counts device response time for a recall storm, but not the DISC row on the same interval', () => {
    // HSM_RECALL_STORM: LCU 30 random I/O up, response up, DISC roughly normal.
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
