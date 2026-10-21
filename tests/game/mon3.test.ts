import { MIDWEST_GAME } from '../../src/content/game-midwest';
import { MIDWEST } from '../../src/content/scenarios';
import { buildMon3, explainWlmLog } from '../../src/game/mon3';
import { advance, newRun, startDay } from '../../src/game/run';
import type { RunState } from '../../src/game/types';
import { buildView } from '../../src/game/view';

const content = { ...MIDWEST_GAME, events: [] };
let noon: RunState;

beforeAll(() => {
  noon = advance(startDay(newRun(MIDWEST, content, 7), content), MIDWEST, content, 6 * 360); // 12:00
});

describe('Monitor III views', () => {
  it('are hidden without the tool, and the WLM log is not live', () => {
    const v = buildView(noon, MIDWEST);
    expect(v.mon3).toBeNull();
    expect(v.wlmLog).toEqual([]);
    const w = buildView({ ...noon, tools: ['RMF_MON3'] }, MIDWEST);
    expect(w.mon3).not.toBeNull();
    expect(w.features).toContain('WLM_ACTIVITY_LOG');
  });

  it('PROCU adds up to roughly what the LPAR delivered', () => {
    const m = buildMon3(noon, MIDWEST);
    for (const l of noon.sim.lpars.filter((x) => m.systems.some((s) => s.system === x.id))) {
      const delivered = l.pools.find((p) => p.pool === 'CP')!.deliveredEngines;
      const appl = m.rows.filter((r) => r.system === l.id).reduce((a, r) => a + r.cpuEngines, 0);
      // Smoothed window vs one tick, and PR/SM overhead counts as delivered but not APPL.
      expect(appl).toBeGreaterThan(delivered * 0.6);
      expect(appl).toBeLessThan(delivered * 1.15);
    }
  });

  it('ENCLAVE shows DDF work using zIIPs', () => {
    const m = buildMon3(noon, MIDWEST);
    const mobile = m.enclaves.filter((e) => e.workloadIds.includes('MOBILE'));
    expect(mobile.length).toBeGreaterThan(0);
    expect(mobile.reduce((a, e) => a + e.ziipEngines, 0)).toBeGreaterThan(0);
    expect(m.rows.some((r) => r.system === '*PLEX')).toBe(true);
  });

  it('a CPU regression shows up as delay and a WFEX exception', () => {
    const base = buildMon3(noon, MIDWEST);
    const hot = advance({ ...noon, pendingCommands: [{ kind: 'SET_MODIFIER', mod: 'cpu', key: 'ADHOC', value: 12 }] }, MIDWEST, content, 60);
    const m = buildMon3(hot, MIDWEST);
    const cpuDelay = (mm: typeof m) => mm.rows.filter((r) => r.system !== '*PLEX').reduce((a, r) => a + r.delay.cpu * r.cpuEngines, 0);
    expect(cpuDelay(m)).toBeGreaterThan(cpuDelay(base));
    expect(m.exceptions.length).toBeGreaterThan(base.exceptions.length);
  });
});

describe('WLM log explanations', () => {
  it('explains receivers, donors and unfixable delays', () => {
    expect(explainWlmLog('D1 12:00:10 PROD1 RCVR=ONLHI#1 PI=1.80 BTLNK=CPU ONLHI#1 DP F8→F9')).toMatch(/raised its dispatch priority from F8 to F9/);
    expect(explainWlmLog('D1 12:00:10 PROD1 RCVR=ONLHI#1 PI=1.80 BTLNK=CPU DONOR BATCHPRD#1 DP F8→F7')).toMatch(/lowered donor BATCHPRD#1/);
    expect(explainWlmLog('D1 12:00:10 PROD2 DDFPRD#1 PI=2.10 BTLNK=OTHER not WLM-fixable')).toMatch(/can't fix that/);
  });
});

describe('SYSINFO velocity', () => {
  it('is a percentage', () => {
    for (const r of buildMon3(noon, MIDWEST).rows) if (r.velocity !== null) expect(r.velocity).toBeLessThanOrEqual(100);
  });
});

describe('Monitor III field formulas (RMF Report Analysis)', () => {
  it('WFL %, USG %, DLY % and UKN % partition the active samples', () => {
    for (const r of buildMon3(noon, MIDWEST).rows) {
      if (r.avgUsers.active <= 0) continue;
      expect(r.usingFrac + r.delayFrac + r.unknownFrac).toBeCloseTo(1, 6);
      // % Delayed for adds up to DLY % (no overlap modelled).
      const d = r.delay;
      expect(d.cpu + d.ziip + d.io + d.stor + d.cap).toBeCloseTo(r.delayFrac, 6);
    }
  });

  it('percentile goals report % within goal, and CICS transaction classes show N/A velocity in SYSSUM', () => {
    const rows = buildMon3(noon, MIDWEST).rows.filter((r) => r.system === '*PLEX');
    for (const r of rows.filter((x) => x.goalPct !== null && x.endedPerSec > 0)) {
      expect(r.withinGoalPct).not.toBeNull();
      // PI ≤ 1 exactly when at least the goal percentile ended within the goal time.
      if (r.pi !== null && r.pi <= 1) expect(r.withinGoalPct!).toBeGreaterThanOrEqual(r.goalPct! - 1e-6);
    }
    expect(rows.some((r) => r.velocity !== null && r.velocityAct === null)).toBe(true);
  });

  it('SYSINFO MVS view is at least the LPAR view, and EAppl% ≥ Appl%', () => {
    for (const s of buildMon3(noon, MIDWEST).systems) {
      expect(s.mvsBusyPct).toBeGreaterThanOrEqual(s.cpBusyPct - 1e-9);
      expect(s.eapplPct).toBeGreaterThanOrEqual(s.applPct - 1e-9);
    }
  });

  it('CPC capacity: physical total = effect + LPAR management, Act MSU ≤ capacity', () => {
    const m = buildMon3(noon, MIDWEST);
    for (const c of m.cpc) expect(c.physTotalPct).toBeCloseTo(c.physEffectPct + c.physLparPct, 6);
    for (const h of m.cpcHeaders) {
      expect(h.imageCapacityMsu).toBeLessThanOrEqual(h.cpcCapacityMsu + 1e-6);
      expect(h.max4hMsu).toBeGreaterThanOrEqual(0);
    }
  });

  it('WFEX exceptions carry an RMF-style reason and critical value', () => {
    const hot = advance({ ...noon, pendingCommands: [{ kind: 'SET_MODIFIER', mod: 'cpu', key: 'ADHOC', value: 12 }] }, MIDWEST, content, 60);
    const m = buildMon3(hot, MIDWEST);
    expect(m.exceptions.length).toBeGreaterThan(0);
    for (const e of m.exceptions) expect(e.reason.length).toBeGreaterThan(0);
    expect(m.speed.some((s) => s.name === '*PROC')).toBe(true);
  });
});
