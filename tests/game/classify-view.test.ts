import { generateMidwestNetwork } from '../../src/content/batch/midwest-batch';
import { MIDWEST } from '../../src/content/scenarios';
import { BASEPOL } from '../../src/content/wlm/basepol';
import { diffRows, explainClassification, workItems } from '../../src/game/classifyExplain';
import { applyWlmEdit } from '../../src/game/wlmEdit';
import type { ServiceDefinition } from '../../src/sim/wlm/types';

const items = workItems(MIDWEST.workloads, MIDWEST.addressSpaces, generateMidwestNetwork(1, 0, 10));
const edit = (def: ServiceDefinition, e: Parameters<typeof applyWlmEdit>[1]) => {
  const r = applyWlmEdit(def, e);
  if (typeof r === 'string') throw new Error(r);
  return r;
};

describe('explainClassification', () => {
  const ex = explainClassification(BASEPOL, items);
  const stc = ex.subsystems.find((s) => s.subsystem === 'STC')!;
  const row = (pattern: string) => stc.rows.find((r) => r.pattern === pattern)!;

  it('DB* catches the Db2 MSTR/DBM1/DIST address spaces but not IRLM (*IRLM matches first)', () => {
    expect(row('DB*').catches).toEqual(expect.arrayContaining(['DB1AMSTR', 'DB1ADBM1', 'DB1ADIST']));
    expect(row('DB*').catches).not.toContain('DB1AIRLM');
    expect(row('*IRLM').catches).toContain('DB1AIRLM');
  });

  it('lists forced-SYSTEM address spaces and the STC default', () => {
    expect(ex.forcedSystem).toEqual(expect.arrayContaining(['XCFAS', 'GRS', '*MASTER*']));
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
});

describe('rule edits by path', () => {
  it('moves a rule and changes what it catches', () => {
    // Moving DB* above *IRLM lets DB* catch IRLM too (a classic misclassification).
    const stcRules = BASEPOL.subsystems.find((s) => s.subsystem === 'STC')!.rules;
    const db = stcRules.findIndex((r) => r.pattern === 'DB*');
    let def = BASEPOL;
    for (let i = db; i > stcRules.findIndex((r) => r.pattern === '*IRLM'); i--) def = edit(def, { op: 'MOVE_RULE', subsystem: 'STC', path: [i], delta: -1 });
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
