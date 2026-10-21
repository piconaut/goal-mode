import { MIDWEST } from '../../src/content/scenarios';
import { applyCommand } from '../../src/sim/core/commands';
import { initState } from '../../src/sim/core/init';
import { step } from '../../src/sim/core/step';

// Midwest with DEVT moved to a second, smaller CPC: the groundwork for multi-CPC scenarios (SPEC §13.5).
function twoCpcScenario() {
  const world = structuredClone(MIDWEST.world);
  world.cpcs.push({ id: 'CPCB', generation: 'M1', capacitySetting: 5, engines: { CP: 4, ZIIP: 1, ICF: 0 }, memoryGb: 256 });
  const devt = world.lpars.find((l) => l.id === 'DEVT')!;
  devt.cpcId = 'CPCB';
  for (const p of devt.pools) p.logical = Math.min(p.logical, p.pool === 'CP' ? 4 : 1);
  return { ...MIDWEST, world, batchNetwork: MIDWEST.batchNetwork };
}

function run(hours: number) {
  const scenario = twoCpcScenario();
  let s = initState(7, scenario);
  for (let i = 0; i < hours * 360; i++) s = step(s, [], scenario);
  return s;
}

describe('multi-CPC world', () => {
  it('runs deterministically with finite per-LPAR values on both CPCs', () => {
    const a = run(3);
    const b = run(3);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    for (const l of a.lpars) expect(Number.isFinite(l.msuRate)).toBe(true);
    expect(a.lpars.find((l) => l.id === 'DEVT')!.msuRate).toBeGreaterThan(0);
    expect(a.lpars.find((l) => l.id === 'PROD1')!.msuRate).toBeGreaterThan(0);
  });

  it('rejects a capacity group whose members sit on different CPCs', () => {
    const s = initState(7, twoCpcScenario());
    const bad = applyCommand(s, { kind: 'SET_CAPACITY_GROUP', groupId: 'G1', members: ['PROD1', 'DEVT'], limitMsu: 300 });
    expect(bad.ok).toBe(false);
    const good = applyCommand(s, { kind: 'SET_CAPACITY_GROUP', groupId: 'G1', members: ['PROD1', 'PROD2'], limitMsu: 300 });
    expect(good.ok).toBe(true);
    expect(good.state.config.capacityGroups[0]!.cpcId).toBe('CPCA');
  });
});
