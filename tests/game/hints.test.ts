import { describe, expect, it } from 'vitest';
import { morningHints } from '../../src/game/hints';
import type { Incident, Mechanism } from '../../src/game/types';

const inc = (workloadId: string, mechanism: Mechanism, hours: number, worstAttainmentPct = 90): Incident => ({
  id: 0, workloadId, day: 3, startTick: 0, endTick: 1, hours, worstAttainmentPct,
  truth: { mechanism, trigger: 'GROWTH' }, rca: null, trustLost: 0,
});
const onTime = { missed: false, criticalEndSec: 3 * 3600, deadlineSec: 6 * 3600 };

describe('morningHints', () => {
  it('gives nothing on Hard/Ironman or on a clean day', () => {
    expect(morningHints('NONE', [inc('MOBILE', 'CAPPING', 3)], { ...onTime, missed: true })).toEqual([]);
    expect(morningHints('CLEAR', [], onTime)).toEqual([]);
  });

  it('points the worst workload at the report for its true mechanism without naming the cause', () => {
    const [h] = morningHints('CLEAR', [inc('TELLER', 'IO', 1), inc('MOBILE', 'CAPPING', 3)], onTime);
    expect(h).toContain('MOBILE');
    expect(h).toContain('Partition Data');
    expect(h!.toLowerCase()).not.toContain('capping');
  });

  it('caps the count per level and keeps Normal vaguer', () => {
    const incs = [inc('A', 'IO', 3), inc('B', 'QR_TCB', 2), inc('C', 'STORAGE', 1)];
    expect(morningHints('CLEAR', incs, onTime)).toHaveLength(2);
    const vague = morningHints('VAGUE', incs, onTime);
    expect(vague).toHaveLength(1);
    expect(vague[0]!.length).toBeLessThan(morningHints('CLEAR', incs, onTime)[0]!.length);
  });

  it('leads with a missed batch deadline and mentions a tight window after incidents', () => {
    expect(morningHints('CLEAR', [inc('A', 'IO', 3)], { ...onTime, missed: true })[0]).toContain('late');
    const tight = morningHints('CLEAR', [inc('A', 'IO', 3)], { ...onTime, criticalEndSec: 6 * 3600 - 600 });
    expect(tight[1]).toContain('10 min');
  });
});
