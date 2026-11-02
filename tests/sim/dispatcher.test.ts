import { dispatch, shareByUnits } from '../../src/sim/zos/dispatcher';
import { queueDelayRatio } from '../../src/sim/zos/erlang';

describe('Erlang-C', () => {
  it('small images queue far more than large ones at the same utilisation', () => {
    expect(queueDelayRatio(2, 0.9)).toBeGreaterThan(3 * queueDelayRatio(12, 0.9));
  });
  it('M/M/1 matches rho/(1-rho)', () => {
    expect(queueDelayRatio(1, 0.5)).toBeCloseTo(1);
    expect(queueDelayRatio(1, 0.8)).toBeCloseTo(4);
  });
});

describe('dispatcher', () => {
  const base = { cpServers: 4, ziipServers: 0, ziipCapacityEngines: 0, cpPrsmDelayFrac: 0 };

  it('serves higher DP first and starves the lowest under overload', () => {
    const r = dispatch({
      ...base,
      cpCapacityEngines: 4,
      demands: [
        { id: 'imp1', dp: 250, cpEngines: 2.5, ziipEngines: 0, ziipMayOverflow: true },
        { id: 'imp3', dp: 230, cpEngines: 1.0, ziipEngines: 0, ziipMayOverflow: true },
        { id: 'disc', dp: 195, cpEngines: 2.0, ziipEngines: 0, ziipMayOverflow: false },
      ],
    });
    const by = Object.fromEntries(r.map((x) => [x.id, x]));
    expect(by.imp1!.cpGranted).toBeCloseTo(2.5);
    expect(by.imp3!.cpGranted).toBeCloseTo(1.0);
    expect(by.disc!.cpGranted).toBeCloseTo(0.5);
    expect(by.disc!.cpUnmet).toBeCloseTo(1.5);
    expect(by.disc!.cpQueueRatio).toBeGreaterThan(by.imp1!.cpQueueRatio);
  });

  it('equal DP shares in proportion to demand', () => {
    const r = dispatch({
      ...base,
      cpCapacityEngines: 2,
      demands: [
        { id: 'a', dp: 240, cpEngines: 3, ziipEngines: 0, ziipMayOverflow: true },
        { id: 'b', dp: 240, cpEngines: 1, ziipEngines: 0, ziipMayOverflow: true },
      ],
    });
    expect(r[0]!.cpGranted).toBeCloseTo(1.5);
    expect(r[1]!.cpGranted).toBeCloseTo(0.5);
  });

  it('equal DP with ready units: light work is served in full, the rest shares per unit', () => {
    // A backlogged class (6 engines wanted, 3 units) and Db2 (0.5 engines over 12 SRBs) on 2 engines.
    const r = dispatch({
      ...base,
      cpCapacityEngines: 2,
      demands: [
        { id: 'onl', dp: 240, cpEngines: 6, ziipEngines: 0, ziipMayOverflow: true, units: 3 },
        { id: 'db2', dp: 240, cpEngines: 0.5, ziipEngines: 0, ziipMayOverflow: true, units: 12 },
      ],
    });
    expect(r[1]!.cpGranted).toBeCloseTo(0.5);
    expect(r[0]!.cpGranted).toBeCloseTo(1.5);
    expect(r[0]!.cpUnmet).toBeCloseTo(4.5);
  });

  it('zIIP-eligible work runs on CP (IIPCP) when the image has no zIIPs', () => {
    const [r] = dispatch({
      ...base,
      cpCapacityEngines: 4,
      demands: [{ id: 'ddf', dp: 240, cpEngines: 0.4, ziipEngines: 0.6, ziipMayOverflow: true }],
    });
    expect(r!.ziipGranted).toBe(0);
    expect(r!.iipcpGranted).toBeCloseTo(0.6);
    expect(r!.cpGranted).toBeCloseTo(0.4);
  });

  it('zIIP overflow to CP only when allowed', () => {
    const mk = (overflow: boolean) =>
      dispatch({
        cpServers: 4,
        cpCapacityEngines: 4,
        ziipServers: 1,
        ziipCapacityEngines: 1,
        cpPrsmDelayFrac: 0,
        demands: [{ id: 'x', dp: 240, cpEngines: 0, ziipEngines: 1.5, ziipMayOverflow: overflow }],
      })[0]!;
    expect(mk(true).iipcpGranted).toBeCloseTo(0.5);
    expect(mk(false).iipcpGranted).toBe(0);
    expect(mk(false).ziipUnmet).toBeCloseTo(0.5);
  });
});

describe('zIIPs offline (Init & Tuning p.431)', () => {
  const demands = [{ id: 'A', dp: 240, cpEngines: 1, ziipEngines: 1, ziipMayOverflow: false }];
  it('eligible work queues like CP work, not like a saturated zIIP pool', () => {
    const [r] = dispatch({ cpCapacityEngines: 4, cpServers: 4, ziipCapacityEngines: 0, ziipServers: 0, cpPrsmDelayFrac: 0, demands });
    expect(r!.iipcpGranted).toBeCloseTo(1);
    expect(r!.ziipQueueRatio).toBeCloseTo(r!.cpQueueRatio);
    expect(r!.ziipQueueRatio).toBeLessThan(1);
  });
});

describe('shareByUnits (max-min by ready units)', () => {
  const run = (total: number, want: number[], units: (number | undefined)[]) => {
    const out = new Array<number>(want.length).fill(0);
    shareByUnits(total, want.map((_, i) => i), want, units, out);
    return out;
  };
  it('without units it shares in proportion to demand', () => {
    const g = run(2, [3, 1], [undefined, undefined]);
    expect(g[0]).toBeCloseTo(1.5);
    expect(g[1]).toBeCloseTo(0.5);
  });
  it('equal units get equal shares when both want more than the fair level', () => {
    const g = run(2, [3, 1], [1, 1]);
    expect(g[0]).toBeCloseTo(1);
    expect(g[1]).toBeCloseTo(1);
  });
  it('what light entries leave goes to the rest by units', () => {
    const g = run(3, [0.2, 4, 4], [2, 1, 3]);
    expect(g[0]).toBeCloseTo(0.2);
    expect(g[1]).toBeCloseTo(0.7);
    expect(g[2]).toBeCloseTo(2.1);
    expect(g.reduce((a, b) => a + b, 0)).toBeCloseTo(3);
  });
  it('enough capacity: everyone gets what they want', () => {
    expect(run(10, [1, 2], [5, 1])).toEqual([1, 2]);
  });
  it('a lone entry gets all of the level even with few units', () => {
    expect(run(2, [5], [0.1])[0]).toBeCloseTo(2);
  });
});
