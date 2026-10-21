import { MIDWEST } from '../../src/content/scenarios';
import { applyCommand } from '../../src/sim/core/commands';
import { initState } from '../../src/sim/core/init';
import { step } from '../../src/sim/core/step';
import { TICKS_PER_HOUR } from '../../src/sim/core/units';
import { cpsmGoalShares, wlmShares, type RoutingPolicy } from '../../src/sim/workload/routing';

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

describe('CICSPlex SM goal routing', () => {
  type Goal = Extract<RoutingPolicy, { method: 'CPSM_GOAL' }>;
  const goal = (over: Partial<Goal> = {}): Goal => ({ method: 'CPSM_GOAL', abendThreshFrac: null, abendCritFrac: null, quiesced: [], ...over });
  const reg = (lparId: string, rtSec: number, failFrac = 0) => ({ lparId, rtSec, failFrac });
  const next = (prev: Record<string, number>, regions: ReturnType<typeof reg>[], p = goal()) => cpsmGoalShares(prev, regions, p, 0.004, 0.5, 0.02, 0.01);

  it('holds steady when responses are even and moves toward the faster region', () => {
    expect(next({ A: 0.5, B: 0.5 }, [reg('A', 0.2), reg('B', 0.2)]).A).toBeCloseTo(0.5);
    expect(next({ A: 0.5, B: 0.5 }, [reg('A', 0.1), reg('B', 0.3)]).A!).toBeGreaterThan(0.6);
  });

  it('a fast-failing region looks fast and draws work (storm drain, B2)', () => {
    let s = { A: 0.5, B: 0.5 };
    for (let i = 0; i < 12; i++) s = next(s, [reg('A', 0.2), reg('B', 0.2, 0.4)]) as typeof s;
    expect(s.B).toBeGreaterThan(0.8);
  });

  it('abend compensation halves at ABENDTHRESH and avoids at ABENDCRIT; quiesce removes a region', () => {
    const r = [reg('A', 0.2), reg('B', 0.2, 0.4)];
    const thresh = next({ A: 0.5, B: 0.5 }, r, goal({ abendThreshFrac: 0.3 }));
    expect(thresh.B!).toBeLessThan(next({ A: 0.5, B: 0.5 }, r).B!);
    let s: Record<string, number> = { A: 0.5, B: 0.5 };
    for (let i = 0; i < 8; i++) s = next(s, r, goal({ abendCritFrac: 0.2 }));
    expect(s.B).toBeCloseTo(0.02);
    expect(next({ A: 0.5, B: 0.5 }, [reg('A', 0.2), reg('B', 0.1)], goal({ quiesced: ['B'] })).B).toBe(0);
  });

  it('drains RBANK into a sick PROD2 region in the sim unless ABENDCRIT is set', () => {
    const run = (abendCritFrac: number | null) => {
      const workloads = structuredClone(MIDWEST.workloads);
      workloads.find((w) => w.id === 'RBANK')!.routingPolicy = goal({ abendCritFrac });
      const scenario = { ...MIDWEST, workloads, batchNetwork: MIDWEST.batchNetwork };
      let s = initState(42, scenario);
      for (let i = 0; i < 1.5 * TICKS_PER_HOUR; i++) {
        const cmds = i === TICKS_PER_HOUR ? [{ kind: 'SET_MODIFIER' as const, mod: 'regionFailFrac' as const, key: 'RBANK@PROD2', value: 0.4 }] : [];
        s = step(s, cmds, scenario);
      }
      return s.routing.RBANK!.PROD2!;
    };
    expect(run(null)).toBeGreaterThan(0.8);
    expect(run(0.2)).toBeLessThan(0.05);
  });
});
