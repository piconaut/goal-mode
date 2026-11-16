import { describe, expect, it } from 'vitest';
import { MIDWEST } from '../../src/content/scenarios';
import { BASEPOL } from '../../src/content/wlm/basepol';
import { evaluateDasd } from '../../src/sim/io/dasd';
import { accumulateTick, closeInterval, newRmfAcc } from '../../src/sim/measure/rmf';
import { renderDasdSummary } from '../../src/sim/measure/reports';

const dasd = MIDWEST.world.dasd;

describe('per-LCU DISC time (RT-10)', () => {
  it('rises with back-end degradation, and queueing follows it less', () => {
    const iops = { RANDOM: 10_000, SEQ: 5_000 } as const;
    const normal = evaluateDasd(dasd, iops);
    const degraded = evaluateDasd({ ...dasd, backendDegrade: 5 }, iops);
    for (const [i, l] of normal.lcus.entries()) {
      const d = degraded.lcus[i]!;
      expect(d.id).toBe(l.id);
      // DISC is the cache-miss time: ×5 with the back end. IOSQ follows the longer service time (Little's law) but
      // grows less, so a device's DISC says what its queue cannot.
      expect(d.discSec / l.discSec).toBeCloseTo(5, 6);
      expect(d.iosqSec).toBeGreaterThan(l.iosqSec);
      expect(d.iosqSec / l.iosqSec).toBeLessThan(5);
      expect(d.rtSec).toBeGreaterThan(l.rtSec);
    }
  });

  it('is the LCU\'s own I/O mix, not the sysplex average', () => {
    const mixed = evaluateDasd(dasd, { RANDOM: 6_000, SEQ: 4_000 });
    const randomOnly = evaluateDasd(dasd, { RANDOM: 10_000, SEQ: 0 });
    // SEQ misses less (higher cache hit) and pays a shorter connection: an LCU with more SEQ I/O has less DISC.
    expect(mixed.lcus[0]!.discSec).toBeLessThan(randomOnly.lcus[0]!.discSec);
  });

  it('reaches the interval and the DASD Activity LCU summary', () => {
    const result = evaluateDasd(dasd, { RANDOM: 10_000, SEQ: 5_000 });
    const acc = accumulateTick(newRmfAcc(0), [], [], result, []);
    const iv = closeInterval(acc, { def: BASEPOL, config: MIDWEST.world, r4haByLpar: {}, jobs: [], endTick: 1 });
    const row = iv.lcus[0]!;
    expect(row.discMs).toBeCloseTo(1000 * result.lcus[0]!.discSec, 6);
    const report = renderDasdSummary(iv);
    expect(report).toContain('DISC(ms)');
    expect(report).toMatch(/^21 /m);
  });
});
