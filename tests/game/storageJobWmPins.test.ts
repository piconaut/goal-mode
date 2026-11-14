import { beforeAll, describe, expect, it } from 'vitest';
import { MIDWEST_GAME } from '../../src/content/game-midwest';
import { MIDWEST } from '../../src/content/scenarios';
import { addPin, incidentSubjects, judgeEvidence, pinRelation } from '../../src/game/evidence';
import { advance, newRun, startDay } from '../../src/game/run';
import type { Incident, Mechanism, RunState, Trigger } from '../../src/game/types';
import { renderWlmSummary } from '../../src/sim/measure/reports';
import type { WorkManagerSamples } from '../../src/sim/wlm/reporting';

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

const cause = (mechanism: Mechanism, trigger: Trigger) => ({ truth: { mechanism, trigger } });

function pin(r: RunState, req: Parameters<typeof addPin>[2]): RunState {
  const out = addPin(r, MIDWEST, req);
  expect(out.ok, out.message).toBe(true);
  return out.run;
}

function verdict(r: RunState, inc: Incident) {
  const [v] = judgeEvidence(r, MIDWEST, inc, r.pins.slice(-1));
  return v!;
}

/** An hour's region storage row (SMF 110 storage manager statistics), the earlier hours normal. */
const withStorage = (region: string, sosSec: number): RunState => {
  const h = regressed.smfHours.at(-1)!;
  return {
    ...regressed,
    smfHours: [...regressed.smfHours.slice(0, -1), { ...h, cicsStorage: { ...(h.cicsStorage ?? {}), [region]: { peakMb: 800, limitMb: 800, sosSec } } }],
  };
};

describe('CICS region SOS minutes (RT-11)', () => {
  it("pins the AOR's time short on storage as a server-side clue", () => {
    const r = pin(withStorage('CICSAOR1', 1200), { source: 'CICS_STORAGE', hour: hourKey, region: 'CICSAOR1' });
    const p = r.pins.at(-1)!;
    expect(p.source).toBe('CICS 110');
    expect(p.subject).toBe('CICSAOR1');
    expect(p.value).toBeCloseTo(20);
    expect(p.text).toMatch(/^CICS 110 D1 \d\d:00–\d\d:00 CICSAOR1 SOS minutes 20.0 min/);
    // CICS_SOS is THREAD_LIMIT with STORAGE accepted as the alternates' view of the same fact.
    expect(verdict(r, incident(r, cause('THREAD_LIMIT', 'APPLICATION_ERROR'))).relevance).toBe(1);
    expect(verdict(r, incident(r, cause('STORAGE', 'APPLICATION_ERROR'))).relevance).toBe(1);
    expect(verdict(r, incident(r, cause('CPU_PRIORITY', 'POLICY'))).relevance).toBe(0);
  });

  it('is unremarkable at zero minutes, and about nothing from a region that does not serve the work', () => {
    const calm = pin(withStorage('CICSAOR1', 0), { source: 'CICS_STORAGE', hour: hourKey, region: 'CICSAOR1' });
    expect(verdict(calm, incident(calm, cause('THREAD_LIMIT', 'APPLICATION_ERROR')))).toMatchObject({ relevance: 0, why: 'value is unremarkable' });
    const other = pin(withStorage('CICSAOR9', 1200), { source: 'CICS_STORAGE', hour: hourKey, region: 'CICSAOR9' });
    expect(verdict(other, incident(other, cause('THREAD_LIMIT', 'APPLICATION_ERROR')))).toMatchObject({ relevance: 0, why: 'not about RBANK' });
    expect(addPin(regressed, MIDWEST, { source: 'CICS_STORAGE', hour: hourKey, region: 'NOSUCH' }).message).toBe('No such region row');
  });
});

describe('PROCU job CPU (RT-11)', () => {
  it('counts a runaway job on the hurt work\'s image as a competitor', () => {
    // XLOG_LOOP: a looping log archiver burns ~0.9 engine on PROD1 (RT-11's 25 % line is cleared).
    const xlog = advance({
      ...regressed,
      pendingCommands: [{ kind: 'ADD_ADDRESS_SPACE', addressSpace: { jobname: 'CICSXLOG', lparId: 'PROD1', role: null, subsystem: 'STC', baseEnginesRef: 0.9, ziipFrac: 0 } }],
    }, MIDWEST, content, HOUR);
    const r = pin(xlog, { source: 'PROCU', system: 'PROD1', jobname: 'CICSXLOG' });
    const p = r.pins.at(-1)!;
    expect(p.source).toBe('PROCU');
    expect(p.subject).toBe('CICSXLOG');
    expect(p.value).toBeGreaterThan(25);
    expect(p.text).toMatch(/^PROCU D1 \d\d:\d\d PROD1 CICSXLOG job EAppl CPU \d+\.\d%/);
    expect(verdict(r, incident(r, cause('CPU_PRIORITY', 'RUNAWAY_WORK'))).relevance).toBe(1);
    expect(verdict(r, incident(r, cause('CPU_CAPACITY', 'POLICY'))).relevance).toBe(1);
    expect(verdict(r, incident(r, cause('IO', 'HARDWARE_FAULT'))).relevance).toBe(0);
  });

  it('is unremarkable for a normal agent, and not about the work from another image', () => {
    const agent = pin(regressed, { source: 'PROCU', system: 'PROD2', jobname: 'MONAGENT' });
    expect(agent.pins.at(-1)!.value).toBeLessThan(25);
    expect(verdict(agent, incident(agent, cause('CPU_PRIORITY', 'RUNAWAY_WORK')))).toMatchObject({ relevance: 0, why: 'value is unremarkable' });
    // RBANK runs on PROD1/PROD2: DEVT is another system's job.
    const devt = pin(regressed, { source: 'PROCU', system: 'DEVT', jobname: 'DEV001' });
    expect(verdict(devt, incident(devt, cause('CPU_PRIORITY', 'POLICY')))).toMatchObject({ relevance: 0, why: 'not about RBANK' });
    expect(addPin(regressed, MIDWEST, { source: 'PROCU', system: 'PROD1', jobname: 'NOJOB' }).message).toBe('No such job row');
  });

  it("counts a serving AOR's own CPU as the work's server, and a non-serving job as a competitor", () => {
    // CARDAUTH runs in CICSAOR1/3 on PROD1 and CICSAOR2/4 on PROD2 (incidentSubjects records them as servers).
    const r = pin(regressed, { source: 'PROCU', system: 'PROD1', jobname: 'CICSAOR1' });
    const cardauth = incident(r, { workloadId: 'CARDAUTH' });
    // The server relation itself, not just the verdict: forcing the server branch false must fail this.
    expect(pinRelation(r, cardauth, r.pins.at(-1)!, incidentSubjects(r, MIDWEST, 'CARDAUTH', 0))).toBe('server');
    expect(verdict(r, cardauth)).toMatchObject({ relevance: 1, why: 'points at the cause' });
    // A job that does not serve CARDAUTH, on an image it runs on, is a specific competitor instead.
    const agentRun = pin(regressed, { source: 'PROCU', system: 'PROD1', jobname: 'MONAGENT' });
    expect(pinRelation(agentRun, cardauth, agentRun.pins.at(-1)!, incidentSubjects(agentRun, MIDWEST, 'CARDAUTH', 0))).toBe('competitor');
    // The same AOR row says nothing about ADHOC work, which runs on PROD2 only.
    expect(verdict(r, incident(r, { workloadId: 'ADHOC' }))).toMatchObject({ relevance: 0, why: 'not about ADHOC' });
  });
});

describe('WLMGL work-manager states (RT-11)', () => {
  const index = () => regressed.sim.rmf.intervals.length - 1;

  /** The last interval with one CICS transaction row's states set, the earlier intervals its normal. */
  const withStates = (w: Partial<WorkManagerSamples>): RunState => {
    const i = index();
    const intervals = regressed.sim.rmf.intervals.map((iv, k) =>
      k !== i
        ? iv
        : {
            ...iv,
            wlm: iv.wlm.map((r) =>
              r.lparId === 'PROD1' && r.scKey === 'ONLHI#1'
                ? { ...r, workManager: { active: 1, ready: 0, idle: 0, waitingIo: 0, waitingLock: 0, waitingProd: 0, waitingMisc: 0, regionKeys: ['STCHI'], ...w } }
                : r,
            ),
          },
    );
    return { ...regressed, sim: { ...regressed.sim, rmf: { ...regressed.sim.rmf, intervals } } };
  };

  it('counts WAITING FOR LOCK for a lock-contention incident', () => {
    // LOCK_ESCALATION: the settlement job holds locks, so the class spends its response time waiting for them.
    const r = pin(withStates({ active: 0.4, waitingLock: 0.6 }), { source: 'WLMGL', index: index(), system: 'PROD1', scKey: 'ONLHI#1', metric: 'WM_LOCK' });
    const p = r.pins.at(-1)!;
    expect(p.subject).toBe('ONLHI#1');
    expect(p.value).toBeCloseTo(60);
    expect(p.text).toMatch(/^WLMGL D1 \d\d:\d\d PROD1 ONLHI#1 LOCK state 60\.0%/);
    expect(verdict(r, incident(r, cause('LOCK_CONTENTION', 'BATCH_OVERLAP'))).relevance).toBe(1);
    expect(verdict(r, incident(r, cause('CPU_PRIORITY', 'POLICY'))).relevance).toBe(0);
  });

  it('counts READY for QR/CPU delay at half weight, and only above its line', () => {
    // QR_RELEASE: one region's non-threadsafe code serialises the class on the QR TCB.
    const r = pin(withStates({ active: 0.6, ready: 0.4 }), { source: 'WLMGL', index: index(), system: 'PROD1', scKey: 'ONLHI#1', metric: 'WM_READY' });
    expect(r.pins.at(-1)!.value).toBeCloseTo(40);
    // The report and the pin read one figure (workManagerStatePct): READY 40.0 is what the player sees.
    expect(renderWlmSummary(r.sim.rmf.intervals[index()]!, 'PROD1')).toContain('40.0');
    const v = verdict(r, incident(r, cause('QR_TCB', 'POLICY')));
    expect(v).toMatchObject({ relevance: 0.5, why: 'consistent with the cause (but not specific)' });
    expect(verdict(r, incident(r, cause('CPU_PRIORITY', 'POLICY'))).relevance).toBe(0.5);
    // A normal dispatch wait (midwest's day-0 maxima are under 3 %) is not evidence.
    const calm = pin(withStates({ active: 0.99, ready: 0.01 }), { source: 'WLMGL', index: index(), system: 'PROD1', scKey: 'ONLHI#1', metric: 'WM_READY' });
    expect(verdict(calm, incident(calm, cause('QR_TCB', 'POLICY')))).toMatchObject({ relevance: 0, why: 'value is unremarkable' });
  });

  it("raises READY's line with the row's own baseline, not just its 5 % floor", () => {
    // A row whose normal READY share is 8 % has a 16 % line (2× its median), so a 10 % reading is still its own
    // normal even though it is above the 5 % floor: only a reading above 16 % is evidence.
    const normal = { active: 0.92, ready: 0.08 };
    const everyInterval = (measured: Partial<WorkManagerSamples>) => {
      const i = index();
      const intervals = regressed.sim.rmf.intervals.map((iv, k) => ({
        ...iv,
        wlm: iv.wlm.map((r) =>
          r.lparId === 'PROD1' && r.scKey === 'ONLHI#1'
            ? { ...r, workManager: { idle: 0, waitingIo: 0, waitingLock: 0, waitingProd: 0, waitingMisc: 0, regionKeys: ['STCHI'], ...normal, ...(k === i ? measured : {}) } }
            : r,
        ),
      }));
      return { ...regressed, sim: { ...regressed.sim, rmf: { ...regressed.sim.rmf, intervals } } };
    };
    const pinReady = (run: RunState) => pin(run, { source: 'WLMGL', index: index(), system: 'PROD1', scKey: 'ONLHI#1', metric: 'WM_READY' });
    const quiet = pinReady(everyInterval({ active: 0.9, ready: 0.1 }));
    expect(quiet.pins.at(-1)!.baseline).toBeCloseTo(8);
    expect(verdict(quiet, incident(quiet, cause('QR_TCB', 'POLICY')))).toMatchObject({ relevance: 0, why: 'value is unremarkable' });
    const busy = pinReady(everyInterval({ active: 0.78, ready: 0.22 }));
    expect(busy.pins.at(-1)!.value).toBeCloseTo(22);
    expect(verdict(busy, incident(busy, cause('QR_TCB', 'POLICY'))).relevance).toBe(0.5);
  });

  it('rejects the states on a row that has none (region classes, not transactions)', () => {
    const i = index();
    const region = regressed.sim.rmf.intervals[i]!.wlm.find((w) => !w.workManager)!;
    const out = addPin(regressed, MIDWEST, { source: 'WLMGL', index: i, system: region.lparId, scKey: region.scKey, metric: 'WM_LOCK' });
    expect(out.ok).toBe(false);
    expect(out.message).toMatch(/no work manager states/);
  });
});
