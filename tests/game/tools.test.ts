import { MIDWEST_GAME } from '../../src/content/game-midwest';
import { MIDWEST } from '../../src/content/scenarios';
import { INSIGHT } from '../../src/content/tools';
import { advance, chooseDraft, newRun, startDay } from '../../src/game/run';
import { buyTool, features, measurementCommands, normalizeRun, noteReportOpened, setToolActive } from '../../src/game/tools';
import type { RunState } from '../../src/game/types';

const content = { ...MIDWEST_GAME, events: [] };
const fresh = (insight = 0): RunState => ({ ...newRun(MIDWEST, content, 7), insight });

describe('tool tree', () => {
  it('enforces Insight and prerequisites', () => {
    expect(buyTool(fresh(0), MIDWEST, 'PARTITION_DATA').ok).toBe(false);
    const noPrereq = buyTool(fresh(100), MIDWEST, 'CF_DASD');
    expect(noPrereq.ok).toBe(false);
    expect(noPrereq.message).toMatch(/Needs Partition Data/);
    let r = buyTool(fresh(100), MIDWEST, 'PARTITION_DATA').run;
    r = buyTool(r, MIDWEST, 'CF_DASD').run;
    expect(r.insight).toBe(100 - 6 - 12);
    expect([...features(r)].sort()).toEqual(['CF_REPORT', 'DASD_REPORT', 'PARTITION_REPORT']);
    expect(buyTool(r, MIDWEST, 'CF_DASD').ok).toBe(false);
  });

  it('measurement overhead follows the tool on and off', () => {
    let r = buyTool(fresh(20), MIDWEST, 'RMF_MON3').run;
    r = advance(startDay(r, content), MIDWEST, content, 1);
    expect(r.sim.mods.measureCpu.RMFGAT).toBe(2);
    r = setToolActive(r, MIDWEST, 'RMF_MON3', false).run;
    expect(features(r).has('MON3')).toBe(false);
    r = advance(r, MIDWEST, content, 1);
    expect(r.sim.mods.measureCpu.RMFGAT).toBeUndefined();
  });

  it('SMF 110 monitoring overhead shows up in WLMGL APPL%', () => {
    const appl = (r: RunState) => {
      const iv = r.sim.rmf.intervals.at(-1)!;
      return iv.wlm.reduce((a, w) => a + w.applCpPct, 0);
    };
    const base = advance(startDay(fresh(), content), MIDWEST, content, 6 * 360);
    const withMon = { ...fresh(), tools: ['CICS_MON'] };
    const r = advance(startDay({ ...withMon, pendingCommands: measurementCommands(withMon, MIDWEST) }, content), MIDWEST, content, 6 * 360);
    expect(r.sim.mods.measureCpu.RBANK).toBeCloseTo(1.04);
    const ratio = appl(r) / appl(base);
    expect(ratio).toBeGreaterThan(1.005);
    expect(ratio).toBeLessThan(1.04);
  });
});

describe('Insight accounting', () => {
  it('pays per distinct report, capped per day, reset on the next day', () => {
    let r = fresh();
    r = noteReportOpened(r, 'WLM_SUMMARY:1');
    r = noteReportOpened(r, 'WLM_SUMMARY:1');
    expect(r.insight).toBe(INSIGHT.perReport);
    for (let i = 2; i < 10; i++) r = noteReportOpened(r, `WLM_SUMMARY:${i}`);
    expect(r.insight).toBe(INSIGHT.reportCapPerDay * INSIGHT.perReport);
    r = chooseDraft({ ...r, phase: 'REVIEW' }, content, null);
    expect(r.reportsOpenedToday).toEqual([]);
    expect(noteReportOpened(r, 'WLM_SUMMARY:1').insight).toBe(r.insight + INSIGHT.perReport);
  });
});

describe('tier 2 availability', () => {
  it('Db2 accounting, CICS monitoring, SMF 30 and SMF 113 are buyable once prerequisites are owned', () => {
    let r = fresh(200);
    for (const id of ['RMF_MON3', 'PARTITION_DATA', 'DB2_ACCT', 'CICS_MON', 'SMF30_BATCH', 'SMF113']) {
      const out = buyTool(r, MIDWEST, id);
      expect(out.ok, out.message).toBe(true);
      r = out.run;
    }
    expect([...features(r)]).toEqual(expect.arrayContaining(['DB2_ACCOUNTING', 'CICS_MONITORING', 'BATCH_GANTT', 'SMF113']));
  });
});

describe('save migration', () => {
  it('fills a missing period duration with null', () => {
    const r = newRun(MIDWEST, content, 3);
    const def = structuredClone(r.sim.wlm.definition);
    delete (def.classes[0]!.periods[0] as { durationSu?: number | null }).durationSu;
    const n = normalizeRun({ ...r, sim: { ...r.sim, wlm: { ...r.sim.wlm, definition: def } } });
    expect(n.sim.wlm.definition.classes[0]!.periods[0]!.durationSu).toBeNull();
  });
});

describe('save migration: CF structures', () => {
  it('fills size, preference list and loss impact on structures saved before they existed', () => {
    const r = newRun(MIDWEST, content, 3);
    const old = r.sim.config.cfStructures.map(({ sizeGb: _s, prefList: _p, lostImpact: _l, ...rest }) => rest);
    const n = normalizeRun({ ...r, sim: { ...r.sim, config: { ...r.sim.config, cfStructures: old } } }, MIDWEST);
    const lock = n.sim.config.cfStructures.find((x) => x.name === 'DB1G_LOCK1')!;
    expect(lock).toMatchObject({ sizeGb: 2, prefList: ['CF01', 'CF02'], lostImpact: 'DB2_DOWN' });
  });
});
