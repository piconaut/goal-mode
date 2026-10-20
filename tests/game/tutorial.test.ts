import { describe, expect, it } from 'vitest';
import { BASEPOL } from '../../src/content/wlm/basepol';
import { db2AboveItsClients } from '../../src/game/tutorial';
import { MIDWEST_GAME } from '../../src/content/game-midwest';
import { MIDWEST } from '../../src/content/scenarios';
import { newRun } from '../../src/game/run';
import { buildView } from '../../src/game/view';

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

describe('weekend days', () => {
  it('flags played days 5 and 6 (Saturday, Sunday) for auto-run', () => {
    const r = newRun(MIDWEST, MIDWEST_GAME, 7);
    expect(buildView(r, MIDWEST)).toMatchObject({ weekendDay: false, weekday: 'Monday' });
    expect(buildView({ ...r, day: 5 }, MIDWEST)).toMatchObject({ weekendDay: true, weekday: 'Saturday' });
    expect(buildView({ ...r, day: 7 }, MIDWEST).weekendDay).toBe(false);
  });
});
