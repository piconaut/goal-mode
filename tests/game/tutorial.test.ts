import { describe, expect, it } from 'vitest';
import { BASEPOL } from '../../src/content/wlm/basepol';
import { db2AboveItsClients } from '../../src/game/tutorial';

const withDb2In = (serviceClass: string) => {
  const def = structuredClone(BASEPOL);
  const stc = def.subsystems.find((s) => s.subsystem === 'STC')!;
  stc.rules = stc.rules.map((r) => (r.pattern === 'DB*' ? { ...r, serviceClass } : r));
  return def;
};

describe('tutorial F1 check', () => {
  it('flags the starting policy (Db2 in STCMED, importance 3, below CICS in STCHI)', () => {
    expect(db2AboveItsClients(BASEPOL)).toBe(false);
  });
  it('accepts Db2 in STCHI or SYSSTC', () => {
    expect(db2AboveItsClients(withDb2In('STCHI'))).toBe(true);
    expect(db2AboveItsClients(withDb2In('SYSSTC'))).toBe(true);
  });
});
