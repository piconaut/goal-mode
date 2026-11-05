import { generateMidwestNetwork } from '../../src/content/batch/midwest-batch';
import { MIDWEST } from '../../src/content/scenarios';
import { BASEPOL } from '../../src/content/wlm/basepol';
import { diffRows, explainClassification, workItems, type WorkItem } from '../../src/game/classifyExplain';
import { applyWlmEdit, pendingBase } from '../../src/game/wlmEdit';
import { classify } from '../../src/sim/wlm/classify';
import type { AddressSpaceDef } from '../../src/sim/workload/types';
import type { ServiceDefinition } from '../../src/sim/wlm/types';

const items = workItems(MIDWEST.workloads, MIDWEST.addressSpaces, generateMidwestNetwork(1, 0, 10));
const edit = (def: ServiceDefinition, e: Parameters<typeof applyWlmEdit>[1]) => {
  const r = applyWlmEdit(def, e);
  if (typeof r === 'string') throw new Error(r);
  return r;
};

describe('address-space work items', () => {
  const space = (jobname: string, lparId: string): AddressSpaceDef => ({ jobname, lparId, subsystem: 'STC', role: null, baseEnginesRef: 0.1, ziipFrac: 0 });
  const spaces = [space('HSM', 'PROD1'), space('HSM', 'DEVT'), space('HSM', 'DEVT'), space('DEVONLY', 'DEVT'), space('XCFAS', 'DEVT')];
  const previewItems = workItems([], spaces, []);

  it('keeps one item per jobname/system and identifies shared jobnames', () => {
    expect(previewItems).toEqual([
      { label: 'HSM (PROD1)', kind: 'address space', work: { subsystem: 'STC', TN: 'HSM', SY: 'PROD1' } },
      { label: 'HSM (DEVT)', kind: 'address space', work: { subsystem: 'STC', TN: 'HSM', SY: 'DEVT' } },
      { label: 'DEVONLY', kind: 'address space', work: { subsystem: 'STC', TN: 'DEVONLY', SY: 'DEVT' } },
      { label: 'XCFAS', kind: 'address space', work: { subsystem: 'STC', TN: 'XCFAS', SY: 'DEVT' } },
    ]);
  });

  it('shows DEVT address spaces caught by a system rule, preserving defaults and forced SYSTEM', () => {
    const pending = edit(BASEPOL, { op: 'ADD_RULE', subsystem: 'STC', qualifier: 'SY', pattern: 'DEVT', serviceClass: 'STCHI', at: [0] });
    const preview = explainClassification(pending, previewItems);
    const stc = preview.subsystems.find((s) => s.subsystem === 'STC')!;
    expect(stc.rows[0]).toMatchObject({ qualifier: 'SY', pattern: 'DEVT', effectiveClass: 'STCHI', catches: ['HSM (DEVT)', 'DEVONLY'] });
    expect(stc.defaultCatches).toEqual(['HSM (PROD1)']);
    expect(preview.forcedSystem).toEqual(['XCFAS']);
    expect(explainClassification(BASEPOL, previewItems).subsystems.find((s) => s.subsystem === 'STC')!.defaultCatches).toEqual(['HSM (PROD1)', 'HSM (DEVT)', 'DEVONLY']);
  });

  it('refines a jobname match by system without losing the other system', () => {
    let pending = edit(BASEPOL, { op: 'ADD_RULE', subsystem: 'STC', qualifier: 'TN', pattern: 'HSM', serviceClass: 'STCHI', at: [0] });
    pending = edit(pending, { op: 'ADD_RULE', subsystem: 'STC', qualifier: 'SY', pattern: 'DEVT', serviceClass: 'STCLO', at: [0, 0] });
    const rows = explainClassification(pending, previewItems).subsystems.find((s) => s.subsystem === 'STC')!.rows;
    expect(rows[0]).toMatchObject({ effectiveClass: 'STCHI', catches: ['HSM (PROD1)'] });
    expect(rows[1]).toMatchObject({ effectiveClass: 'STCLO', catches: ['HSM (DEVT)'] });
    for (const item of previewItems.filter((it) => it.work.TN === 'HSM')) {
      const result = classify(pending, item.work);
      expect(rows.find((row) => row.catches.includes(item.label))!.effectiveClass).toBe(result.serviceClass);
    }
  });
});

describe('explainClassification', () => {
  const ex = explainClassification(BASEPOL, items);
  const stc = ex.subsystems.find((s) => s.subsystem === 'STC')!;
  const row = (pattern: string) => stc.rows.find((r) => r.pattern === pattern)!;

  it('DB* catches the Db2 MSTR/DBM1/DIST address spaces but not IRLM (%%%%IRLM matches first)', () => {
    expect(row('DB*').catches).toEqual(expect.arrayContaining(['DB1AMSTR', 'DB1ADBM1', 'DB1ADIST']));
    expect(row('DB*').catches).not.toContain('DB1AIRLM');
    expect(row('%%%%IRLM').catches).toContain('DB1AIRLM');
  });

  it('lists forced-SYSTEM address spaces and the STC default', () => {
    for (const system of ['PROD1', 'PROD2', 'DEVT', 'SYSP']) {
      expect(ex.forcedSystem).toEqual(expect.arrayContaining([`XCFAS (${system})`, `GRS (${system})`, `*MASTER* (${system})`]));
    }
    expect(stc.defaultServiceClass).toBe('STCLO');
    expect(stc.builtInDefault).toBe(false);
  });

  it('puts every critical and non-critical batch stream in BATCHPRD under BASEPOL (flaw F4)', () => {
    const jes = ex.subsystems.find((s) => s.subsystem === 'JES')!;
    expect(jes.defaultCatches.some((l) => l.startsWith('STL001'))).toBe(true);
    expect(jes.defaultServiceClass).toBe('BATCHPRD');
  });

  it('reports work that falls through to SYSOTHER', () => {
    const ex2 = explainClassification(BASEPOL, [...items, { label: 'ACQBANK', kind: 'workload', work: { subsystem: 'OMVS', UI: 'ACQSVC' } }]);
    expect(ex2.sysother).toContain('ACQBANK');
    expect(ex2.subsystems.find((s) => s.subsystem === 'OMVS')!.defaultCatches).toContain('ACQBANK');
  });

  it('shows every supported subsystem even with no policy entries or current work', () => {
    const empty = explainClassification({ ...BASEPOL, subsystems: [] }, []);
    expect(empty.subsystems.map((s) => s.subsystem)).toEqual(['STC', 'JES', 'CICS', 'DDF', 'TSO', 'MQ', 'OMVS']);
    for (const panel of empty.subsystems) {
      expect(panel).toEqual({
        subsystem: panel.subsystem,
        defaultServiceClass: panel.subsystem === 'STC' ? 'SYSSTC' : 'SYSOTHER',
        builtInDefault: true,
        rows: [],
        defaultCatches: [],
      });
    }
  });

  it('retains explicit defaults on empty subsystem panels', () => {
    let def = edit(BASEPOL, { op: 'SET_DEFAULT', subsystem: 'OMVS', serviceClass: 'DDFPRD' });
    def = edit(def, { op: 'SET_DEFAULT', subsystem: 'STC', serviceClass: 'SYSSTC' });
    const panels = explainClassification(def, []).subsystems;
    expect(panels.find((s) => s.subsystem === 'OMVS')).toEqual({
      subsystem: 'OMVS', defaultServiceClass: 'DDFPRD', builtInDefault: false, rows: [], defaultCatches: [],
    });
    expect(panels.find((s) => s.subsystem === 'STC')).toMatchObject({ defaultServiceClass: 'SYSSTC', builtInDefault: false });
  });
});

describe('rule edits by path', () => {
  it('prepares a first OMVS rule before acquisition work arrives without changing the active policy', () => {
    const active = { ...BASEPOL, subsystems: BASEPOL.subsystems.filter((s) => s.subsystem !== 'OMVS') };
    const before = explainClassification(active, items).subsystems.find((s) => s.subsystem === 'OMVS')!;
    expect(before).toEqual({ subsystem: 'OMVS', defaultServiceClass: 'SYSOTHER', builtInDefault: true, rows: [], defaultCatches: [] });

    const pending = edit(pendingBase(null, active), { op: 'ADD_RULE', subsystem: 'OMVS', qualifier: 'UI', pattern: 'ACQSVC', serviceClass: 'DDFPRD' });
    const preview = explainClassification(pending, items).subsystems.find((s) => s.subsystem === 'OMVS')!;
    expect(preview.rows).toHaveLength(1);
    expect(preview.rows[0]).toMatchObject({ path: [0], qualifier: 'UI', pattern: 'ACQSVC', effectiveClass: 'DDFPRD', catches: [] });
    expect(preview.defaultServiceClass).toBe('SYSOTHER');
    expect(preview.builtInDefault).toBe(true);
    expect(diffRows(before.rows, preview.rows)).toEqual({ changes: ['added'], removed: [] });
    expect(explainClassification(active, items).subsystems.find((s) => s.subsystem === 'OMVS')).toEqual(before);
    expect(active.subsystems.some((s) => s.subsystem === 'OMVS')).toBe(false);

    const acquisition: WorkItem = { label: 'ACQBANK', kind: 'workload', work: { subsystem: 'OMVS', UI: 'ACQSVC' } };
    expect(classify(active, acquisition.work).serviceClass).toBe('SYSOTHER');
    expect(classify(pending, acquisition.work).serviceClass).toBe('DDFPRD');
    const forthcoming = explainClassification(pending, [...items, acquisition]);
    expect(forthcoming.subsystems.find((s) => s.subsystem === 'OMVS')!.rows[0]!.catches).toEqual(['ACQBANK']);
    expect(forthcoming.sysother).not.toContain('ACQBANK');
  });

  it('moves a rule and changes what it catches', () => {
    // Moving DB* above %%%%IRLM lets DB* catch IRLM too (a classic misclassification).
    const stcRules = BASEPOL.subsystems.find((s) => s.subsystem === 'STC')!.rules;
    const db = stcRules.findIndex((r) => r.pattern === 'DB*');
    let def = BASEPOL;
    for (let i = db; i > stcRules.findIndex((r) => r.pattern === '%%%%IRLM'); i--) def = edit(def, { op: 'MOVE_RULE', subsystem: 'STC', path: [i], delta: -1 });
    const ex = explainClassification(def, items);
    expect(ex.subsystems.find((s) => s.subsystem === 'STC')!.rows.find((r) => r.pattern === 'DB*')!.catches).toContain('DB1AIRLM');
  });

  it('inserts nested rules, retargets and deletes', () => {
    let def = edit(BASEPOL, { op: 'ADD_RULE', subsystem: 'DDF', qualifier: 'UI', pattern: 'biuser', serviceClass: 'DDFPRD', at: [0] });
    def = edit(def, { op: 'ADD_RULE', subsystem: 'DDF', qualifier: 'CI', pattern: 'QMF*', serviceClass: 'BATCHPRD', at: [0, 0] });
    const ddf = () => explainClassification(def, items).subsystems.find((s) => s.subsystem === 'DDF')!;
    const nested = ddf().rows.find((r) => r.depth === 1)!;
    expect(nested.catches).toContain('ADHOC');
    expect(nested.effectiveClass).toBe('BATCHPRD');
    def = edit(def, { op: 'SET_RULE_TARGET', subsystem: 'DDF', path: [0, 0], serviceClass: 'TSO' });
    expect(ddf().rows.find((r) => r.depth === 1)!.effectiveClass).toBe('TSO');
    def = edit(def, { op: 'DELETE_RULE', subsystem: 'DDF', path: [0] });
    expect(ddf().rows).toHaveLength(0);
  });

  it('rejects impossible edits with a reason', () => {
    expect(applyWlmEdit(BASEPOL, { op: 'MOVE_RULE', subsystem: 'STC', path: [0], delta: -1 })).toMatch(/first/);
    expect(applyWlmEdit(BASEPOL, { op: 'SET_RULE_TARGET', subsystem: 'STC', path: [0], serviceClass: 'NOPE' })).toMatch(/No class/);
    expect(applyWlmEdit(BASEPOL, { op: 'ADD_RULE', subsystem: 'STC', qualifier: 'TN', pattern: ' ', serviceClass: 'STCHI' })).toMatch(/pattern/);
  });
});

describe('diffRows', () => {
  it('marks added, changed and removed rules', () => {
    const before = explainClassification(BASEPOL, items).subsystems.find((s) => s.subsystem === 'STC')!.rows;
    let def = edit(BASEPOL, { op: 'SET_RULE_TARGET', subsystem: 'STC', path: [6], serviceClass: 'STCHI' });
    def = edit(def, { op: 'ADD_RULE', subsystem: 'STC', qualifier: 'TN', pattern: 'ZOSCONN*', serviceClass: 'STCHI' });
    def = edit(def, { op: 'DELETE_RULE', subsystem: 'STC', path: [10] });
    const after = explainClassification(def, items).subsystems.find((s) => s.subsystem === 'STC')!.rows;
    const d = diffRows(before, after);
    expect(d.changes.filter((c) => c === 'added')).toHaveLength(1);
    expect(d.changes.filter((c) => c === 'changed').length).toBeGreaterThan(0);
    expect(d.removed).toHaveLength(1);
  });
});
