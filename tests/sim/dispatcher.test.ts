import { dispatch } from '../../src/sim/zos/dispatcher';
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
