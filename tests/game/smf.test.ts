import { MIDWEST } from '../../src/content/scenarios';
import { MIDWEST_GAME } from '../../src/content/game-midwest';
import { cardMechanisms } from '../../src/content/footprint';
import { lsprCategory } from '../../src/content/smf';
import { advance, newRun, startDay } from '../../src/game/run';
import { addPin } from '../../src/game/evidence';
import { batchNight, cicsMonitoring, db2Accounting, db2Statistics, smf113, smfHourRefs } from '../../src/game/smf';
import { slotBaseline } from '../../src/game/sla';
import type { RunState } from '../../src/game/types';
import { midwestContent, midwestNoon } from '../helpers/fixtureCache';
import { TICKS_PER_DAY } from '../../src/sim/core/units';

const content = midwestContent;
const HOUR = 360;
let noon: RunState;

beforeAll(() => {
  noon = midwestNoon();
}, 60_000);

describe('LSPR category table', () => {
  it('follows the published L1MP/RNI bands', () => {
    expect(lsprCategory(2, 0.5)).toBe('LOW');
    expect(lsprCategory(2, 0.9)).toBe('AVERAGE');
    expect(lsprCategory(4, 0.5)).toBe('LOW');
    expect(lsprCategory(4, 0.8)).toBe('AVERAGE');
    expect(lsprCategory(4, 1.2)).toBe('HIGH');
    expect(lsprCategory(7, 0.6)).toBe('AVERAGE');
    expect(lsprCategory(7, 0.9)).toBe('HIGH');
  });
});

describe('SMF hours', () => {
  it('keeps closed hours with labels, newest first in the picker', () => {
    expect(noon.smfHours.length).toBe(6);
    const refs = smfHourRefs(noon);
    expect(refs[0]!.key).toBe('current');
    expect(refs[1]!.label).toMatch(/11:00–12:00/);
  });
});

describe('vs base (PT-13)', () => {
  it('a closed hour keeps its ratio when later hours move the baseline', () => {
    let r = advance(noon, MIDWEST, content, HOUR);
    const last = r.smfHours.at(-1)!;
    const key = `${last.day}:${last.hourOfDay}`;
    const frozen = Object.keys(last.cpuVsBase ?? {});
    expect(frozen.length).toBeGreaterThan(0);
    const shown = new Map(db2Accounting(r, MIDWEST, key).map((x) => [x.workloadId, x.cpuVsBaseline]));
    // Six hours of a 3x CPU regression: the EWMA moves, the closed hour's row must not.
    r = advance({ ...r, pendingCommands: [{ kind: 'SET_MODIFIER', mod: 'cpu', key: 'RBANK', value: 3 }] }, MIDWEST, content, 6 * HOUR);
    for (const id of frozen) expect(db2Accounting(r, MIDWEST, key).find((x) => x.workloadId === id)!.cpuVsBaseline).toBe(shown.get(id)!);
  });

  it('a closed hour with no baseline in force for a workload shows no ratio, not the live one', () => {
    const r = advance(noon, MIDWEST, content, HOUR);
    const last = r.smfHours.at(-1)!;
    const key = `${last.day}:${last.hourOfDay}`;
    const id = db2Accounting(r, MIDWEST, key).find((x) => x.cpuVsBaseline !== null)?.workloadId;
    expect(id).toBeDefined();
    const { [id!]: _dropped, ...rest } = last.cpuVsBase!;
    const unbased = { ...r, smfHours: [...r.smfHours.slice(0, -1), { ...last, cpuVsBase: rest }] };
    expect(r.baselines[id!]?.cpu).toBeGreaterThan(0);
    expect(db2Accounting(unbased, MIDWEST, key).find((x) => x.workloadId === id)!.cpuVsBaseline).toBeNull();
  });

  it('does not learn the healthy baseline from an hour a card disturbed', () => {
    const base = startDay(newRun(MIDWEST, content, 7), content);
    const regression = MIDWEST_GAME.events.find((e) => e.id === 'REGRESSION')!;
    const card: RunState['events'][number] = { uid: 'REGRESSION@0', defId: 'REGRESSION', name: 'REGRESSION', startTick: 0, endTick: 100_000, trigger: 'CHANGE_REGRESSION', affects: ['RBANK'], mechanisms: cardMechanisms(regression) ?? [], endCommands: [], started: true, ended: false };
    const quiet = advance(base, MIDWEST, content, HOUR);
    const disturbed = advance({ ...base, events: [card] }, MIDWEST, content, HOUR);
    expect(quiet.baselines.RBANK).toBeDefined();
    expect(disturbed.baselines.RBANK).toBeUndefined();
  });

  it('folds a met hour into its clock-hour slot and freezes "vs base" against that slot (RT-17)', () => {
    // A slot for 12:00 far below the rolling baseline: the closed hour's ratio must read the slot.
    const r0 = { ...noon, hourBaselines: { RBANK: { '12': { cpu: 0.001 } } }, baselines: { ...noon.baselines, RBANK: { ...noon.baselines.RBANK, cpu: 1 } } };
    const r = advance(r0, MIDWEST, content, HOUR);
    const closed = r.smfHours.at(-1)!;
    expect(closed.hourOfDay).toBe(12);
    expect(r.hourBaselines?.RBANK?.['12']?.cpu).toBeGreaterThan(0);
    // With the slot (0.001 s per transaction) the ratio is tens; the rolling baseline (1 s) would put it under 0.1.
    expect(closed.cpuVsBase!.RBANK!).toBeGreaterThan(1);
    // A workload with no slot at that hour reads the rolling EWMA; an unknown one reads nothing.
    expect(slotBaseline(r.hourBaselines, r.baselines, 'RBANK', 0).cpu).toBeGreaterThan(0);
    expect(slotBaseline(r.hourBaselines, r.baselines, 'NOPE', 12)).toEqual({});
  });
});

describe('Db2 accounting', () => {
  it('points an access-path regression at the package', () => {
    const r = advance({ ...noon, pendingCommands: [{ kind: 'SET_MODIFIER', mod: 'cpu', key: 'RBANK', value: 3 }] }, MIDWEST, content, HOUR);
    const rows = db2Accounting(r, MIDWEST, r.smfHours.at(-1) ? `${r.smfHours.at(-1)!.day}:${r.smfHours.at(-1)!.hourOfDay}` : 'current');
    const rb = rows.find((x) => x.package === 'RB01')!;
    expect(rb.cpuVsBaseline!).toBeGreaterThan(2.3);
    for (const x of rows.filter((y) => y.package !== 'RB01')) expect(x.cpuVsBaseline ?? 1).toBeLessThan(1.3);
  });

  it('shows lock escalation as class 3 lock suspension', () => {
    const calm = advance(noon, MIDWEST, content, 30);
    const before = db2Accounting(calm, MIDWEST, 'current').find((x) => x.workloadId === 'RBANK')!;
    const r = advance({ ...noon, pendingCommands: [{ kind: 'SET_LOCK_BOOST', value: 6 }] }, MIDWEST, content, 30);
    const after = db2Accounting(r, MIDWEST, 'current').find((x) => x.workloadId === 'RBANK')!;
    expect(after.lockMs).toBeGreaterThan(before.lockMs * 1.5 + 0.1);
  });

  it('Db2 statistics counts the DBAT requests that waited (QUEDBAT), not the peak queue depth', () => {
    // MAXDBAT 1 on every member: DDF threads queue, so requests wait for a DBAT.
    const starved = advance({ ...noon, pendingCommands: MIDWEST.world.db2.map((m) => ({ kind: 'SET_DB2' as const, ssid: m.ssid, maxDbat: 1 })) }, MIDWEST, content, 30);
    // The open hour carries the last tick's wait (B1: accumulateHour must return the count).
    const tick = starved.sim.last.lpars.reduce((a, l) => a + (l.dbatWaited ?? 0), 0);
    expect(tick).toBeGreaterThan(0);
    expect(db2Statistics(starved, MIDWEST, 'current').reduce((a, r) => a + r.dbatQueued, 0)).toBeGreaterThanOrEqual(tick);
    // The closed hour keeps the hour's total, one row per member, and the DBAT_QUEUE pin reads it.
    const r = advance(starved, MIDWEST, content, HOUR - 30);
    const h = r.smfHours.at(-1)!;
    const key = `${h.day}:${h.hourOfDay}`;
    for (const row of db2Accounting(r, MIDWEST, key)) expect(row).not.toHaveProperty('dbatQueueMs');
    const stats = db2Statistics(r, MIDWEST, key);
    const byLpar = h.dbatQueuedByLpar ?? {};
    for (const m of MIDWEST.world.db2) {
      const row = stats.find((x) => x.ssid === m.ssid)!;
      expect(row.lparId).toBe(m.lparId);
      expect(row.dbatQueued).toBe(byLpar[m.lparId] ?? 0);
    }
    const busiest = Object.entries(byLpar).sort((a, b) => b[1] - a[1])[0]!;
    expect(busiest[1]).toBeGreaterThan(0);
    const pinned = addPin(r, MIDWEST, { source: 'DB2_STATS', hour: key, lparId: busiest[0], metric: 'DBAT_QUEUE' });
    expect(pinned.ok, pinned.message).toBe(true);
    expect(pinned.run.pins.at(-1)!.value).toBe(busiest[1]);
  });
});

describe('CICS monitoring', () => {
  it('lists transactions by id', () => {
    const rows = cicsMonitoring(advance(noon, MIDWEST, content, 30), MIDWEST, 'current');
    expect(rows.map((x) => x.tranId)).toContain('RB01');
    expect(rows.every((x) => x.cpuMs > 0)).toBe(true);
  });
});

describe('SMF 113', () => {
  it('reports plausible counters and categories', () => {
    for (const r of smf113(noon)) {
      expect(r.rni).toBeGreaterThan(0.4);
      expect(r.rni).toBeLessThan(1.8);
      expect(['LOW', 'AVERAGE', 'HIGH']).toContain(r.lspr);
    }
    const rows = smf113(noon);
    const most = rows.reduce((a, b) => (b.nonVhFrac > a.nonVhFrac ? b : a));
    const least = rows.reduce((a, b) => (b.nonVhFrac < a.nonVhFrac ? b : a));
    if (most.nonVhFrac > least.nonVhFrac) expect(most.rni).toBeGreaterThan(least.rni);
  });
});

describe('SMF 30 batch', () => {
  it('gives last night a Gantt with the critical path', () => {
    const r = advance(noon, MIDWEST, content, TICKS_PER_DAY - 6 * HOUR - 1);
    const n = batchNight(r)!;
    expect(n.day).toBe(0);
    expect(n.jobs.length).toBeGreaterThan(50);
    expect(n.jobs.some((j) => j.critical)).toBe(true);
    expect(n.criticalEnd).not.toBeNull();
    for (const j of n.jobs) expect(j.endSec).toBeGreaterThanOrEqual(j.startSec);
  });

  it('exposes the critical jobs\' delay shares once the night has a report', () => {
    const r = advance(noon, MIDWEST, content, TICKS_PER_DAY - 6 * HOUR - 1);
    expect(batchNight(r)!.critical).toBeUndefined();
    const withReport: RunState = {
      ...r,
      reports: [...r.reports, {
        day: 0, sla: [], batchMissed: false, trustDelta: {} as never, score: 0, mlcEstimate: 0, events: [], piWorst: {},
        batch: {
          day: 0, jobs: 40, done: 40, criticalJobs: 14, criticalDone: 14, criticalEndSec: null, missedDeadline: false,
          criticalDelaySec: { cpu: 300, io: 200, lock: 400, db2: 100, swap: 0, init: 0 },
          criticalAbended: ['STL009'],
        },
      }],
    };
    const c = batchNight(withReport)!.critical!;
    expect(c.delaySharePct!.lock).toBeCloseTo(40);
    expect(c.delaySharePct!.cpu).toBeCloseTo(30);
    expect(c.abended).toEqual(['STL009']);
  });
});
