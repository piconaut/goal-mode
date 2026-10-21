import { MIDWEST } from '../../src/content/scenarios';
import { applyCommand } from '../../src/sim/core/commands';
import { initState } from '../../src/sim/core/init';
import { step } from '../../src/sim/core/step';
import { TICKS_PER_HOUR } from '../../src/sim/core/units';
import { wlmShares } from '../../src/sim/workload/routing';

const cand = (lparId: string, cpFreeEngines: number, ziipFreeEngines: number) => ({ lparId, cpFreeEngines, ziipFreeEngines });

describe('WLM routing weights', () => {
  it('follow displaceable CP capacity, with a floor and 1 % steps', () => {
    const s = wlmShares([cand('A', 3, 0), cand('B', 1, 0), cand('C', 0, 0)], 0, false, 0.02, 0.01);
    expect(s.A! + s.B! + s.C!).toBeCloseTo(1);
    expect(s.A! / s.B!).toBeCloseTo(3, 0);
    expect(s.C).toBeCloseTo(0.02);
    expect(Math.round(s.A! * 100) / 100).toBeCloseTo(s.A!, 6);
  });

  it('ignore zIIP capacity unless zIIP-aware (B3)', () => {
    const c = [cand('CPS', 2, 0), cand('ZIIPS', 1, 3)];
    const cpOnly = wlmShares(c, 0.6, false, 0.02, 0.01);
    const aware = wlmShares(c, 0.6, true, 0.02, 0.01);
    expect(cpOnly.CPS!).toBeGreaterThan(cpOnly.ZIIPS!);
    expect(aware.ZIIPS!).toBeGreaterThan(aware.CPS!);
  });

  it('split evenly when nothing is free', () => {
    const s = wlmShares([cand('A', 0, 0), cand('B', 0, 0)], 0, false, 0.02, 0.01);
    expect(s.A).toBeCloseTo(0.5);
  });
});

describe('routing policies in the sim', () => {
  const policied = () => {
    const workloads = structuredClone(MIDWEST.workloads);
    workloads.find((w) => w.id === 'MOBILE')!.routingPolicy = { method: 'WLM', ziipAware: false };
    return { ...MIDWEST, workloads, batchNetwork: MIDWEST.batchNetwork };
  };

  it('static scenarios carry no policy state', () => {
    expect('routingPolicies' in initState(1, MIDWEST)).toBe(false);
  });

  it('WLM policy moves shares each minute, deterministically', () => {
    const scenario = policied();
    const run = () => {
      let s = initState(4, scenario);
      for (let i = 0; i < 2 * TICKS_PER_HOUR; i++) s = step(s, [], scenario);
      return s;
    };
    const a = run();
    expect(JSON.stringify(a)).toBe(JSON.stringify(run()));
    const shares = a.routing.MOBILE!;
    expect(Object.keys(shares).sort()).toEqual(['PROD1', 'PROD2']);
    expect(shares.PROD1! + shares.PROD2!).toBeCloseTo(1);
    expect(a.routing.RBANK).toBeUndefined();
  });

  it('explicit weights need static routing first; switching back clears the policy', () => {
    const s = initState(4, policied());
    const refused = applyCommand(s, { kind: 'SET_ROUTING', workloadId: 'MOBILE', routing: { PROD1: 1, PROD2: 1 } });
    expect(refused.ok).toBe(false);
    const st = applyCommand(s, { kind: 'SET_ROUTING_POLICY', workloadId: 'MOBILE', policy: { method: 'STATIC' } });
    expect('routingPolicies' in st.state).toBe(false);
    expect(applyCommand(st.state, { kind: 'SET_ROUTING', workloadId: 'MOBILE', routing: { PROD1: 1, PROD2: 1 } }).ok).toBe(true);
  });
});
