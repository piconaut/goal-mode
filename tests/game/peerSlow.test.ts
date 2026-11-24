// Peer-slow resources (RT-35): the CF/LCU peer rule shared by the recipe's discriminator, the truth's accepted-set
// source and the pin's frozen peer reading.
import { describe, expect, it } from 'vitest';
import { cfPeer, lcuPeer, peersOf, slowCf, slowLcu } from '../../src/game/peerSlow';
import { PEER_SLOW_RATIO } from '../../src/content/sla';
import type { RmfInterval } from '../../src/sim/measure/rmf';

const cf = [
  { lparId: 'CF01', reqPerSec: 5000, syncUs: 18, asyncPct: 0 },
  { lparId: 'CF02', reqPerSec: 2000, syncUs: 1368, asyncPct: 98 },
  { lparId: 'CFTEST', reqPerSec: 0, syncUs: 5000, asyncPct: 0 },
];
const lcus = [
  { id: '10', iops: 300, discMs: 0.07, rtMs: 0.22 },
  { id: '21', iops: 500, discMs: 0.07, rtMs: 0.22 },
  { id: '30', iops: 400, discMs: 0.4, rtMs: 0.22 },
];

describe('peer-slow resources (RT-35)', () => {
  it('reads the best CF of the sysplex, ignoring CFs with no requests', () => {
    expect(cfPeer(cf, 'syncUs')).toEqual({ value: 18, of: 'CF01' });
    // CF01's 0 % async cannot be a denominator; the best positive peer is CF02 itself.
    expect(cfPeer(cf, 'asyncPct')).toEqual({ value: 98, of: 'CF02' });
  });

  it('finds a CF at least PEER_SLOW_RATIO times the best CF, on the work\'s connected CFs', () => {
    const slow = slowCf(cf, ['CF01', 'CF02'])!;
    expect(slow.row.lparId).toBe('CF02');
    expect(slow.metric).toBe('syncUs');
    expect(slow.ratio).toBeCloseTo(1368 / 18);
    // CF02 is not the work's resource when the work connects only to CF01.
    expect(slowCf(cf, ['CF01'])).toBeUndefined();
    // No connection data means every CF counts.
    expect(slowCf(cf)!.row.lparId).toBe('CF02');
    // Exactly the line holds.
    expect(slowCf([cf[0]!, { ...cf[1]!, syncUs: 18 * PEER_SLOW_RATIO }], ['CF02'])!.ratio).toBe(PEER_SLOW_RATIO);
  });

  it('finds an LCU at least PEER_SLOW_RATIO times the all-LCU median', () => {
    expect(lcuPeer(lcus, 'discMs')).toEqual({ value: 0.07, of: 'the LCU median' });
    const slow = slowLcu(lcus)!;
    expect(slow.row.id).toBe('30');
    expect(slow.metric).toBe('discMs');
    expect(slow.ratio).toBeCloseTo(0.4 / 0.07);
    // Response time is flat across the LCUs, so the DISC path is the only one that holds.
    expect(slowLcu(lcus.map((l) => ({ ...l, discMs: 0.07 })))).toBeUndefined();
  });

  it('maps an interval to the rows the truth and the pin read, with the connected CFs', () => {
    const iv = {
      cf,
      lcus,
      cfSystems: [
        { system: 'PROD1', cfLparId: 'CF01', distKm: 0, reqPerSec: 1, syncUs: 18, asyncPct: 0, serviceUs: 18 },
        { system: 'PROD1', cfLparId: 'CF02', distKm: 0, reqPerSec: 1, syncUs: 1368, asyncPct: 98, serviceUs: 1368 },
        { system: 'DEV1', cfLparId: 'CFTEST', distKm: 0, reqPerSec: 1, syncUs: 20, asyncPct: 0, serviceUs: 20 },
      ],
    } as unknown as RmfInterval;
    const rows = peersOf(iv, ['PROD1']);
    expect(rows.cf.map((c) => c.lparId)).toEqual(['CF01', 'CF02', 'CFTEST']);
    expect(rows.lcus.map((l) => l.id)).toEqual(['10', '21', '30']);
    expect(rows.connectedCf).toEqual(['CF01', 'CF02']);
  });
});
