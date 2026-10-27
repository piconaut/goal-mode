import { MIDWEST_GAME } from '../../src/content/game-midwest';
import { MIDWEST } from '../../src/content/scenarios';
import { lsprCategory } from '../../src/content/smf';
import { advance, newRun, startDay } from '../../src/game/run';
import { batchNight, cicsMonitoring, db2Accounting, smf113, smfHourRefs } from '../../src/game/smf';
import type { RunState } from '../../src/game/types';
import { TICKS_PER_DAY } from '../../src/sim/core/units';

const content = { ...MIDWEST_GAME, events: [] };
const HOUR = 360;
let noon: RunState;

beforeAll(() => {
  noon = advance(startDay(newRun(MIDWEST, content, 7), content), MIDWEST, content, 6 * HOUR);
});

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
        day: 0, sla: [], batchMissed: false, trustDelta: {} as never, score: 0, mlcEstimate: 0, events: [],
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
