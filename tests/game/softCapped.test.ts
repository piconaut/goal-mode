// The one "capped" state SYSINFO, WFEX and the header show: the image's own soft cap or its capacity group's
// (MVS Planning: WLM 3.1 p.44–47). The cross-report suite covers the positive case; these pin the guards.
import { MIDWEST_GAME } from '../../src/content/game-midwest';
import { MIDWEST } from '../../src/content/scenarios';
import { buildMon3, softCapped } from '../../src/game/mon3';
import { advance, newRun, startDay } from '../../src/game/run';
import type { RunState } from '../../src/game/types';
import { buildView } from '../../src/game/view';

const content = { ...MIDWEST_GAME, events: [] };
let base: RunState;
let zos: string[];

beforeAll(() => {
  base = advance(startDay(newRun(MIDWEST, content, 7), content), MIDWEST, content, 30);
  zos = base.sim.config.lpars.filter((l) => l.kind === 'ZOS').map((l) => l.id);
}, 60_000);

/** The run with capping flags and configuration set by hand: what the flags mean must not depend on how they arose. */
function withCaps(o: { lparFlag?: string; definedCapacity?: [string, number | null]; group?: { members: string[]; capped: boolean } }): RunState {
  const sim = structuredClone(base.sim);
  for (const l of sim.config.lpars) {
    if (o.definedCapacity?.[0] === l.id) l.definedCapacityMsu = o.definedCapacity[1];
    if (o.group?.members.includes(l.id)) l.capacityGroup = 'G1';
  }
  if (o.group) {
    sim.config.capacityGroups = [{ id: 'G1', cpcId: sim.config.cpcs[0]!.id, limitMsu: 100 }];
    sim.capping.groups = [{ ...structuredClone(sim.capping.lpars[0]!), id: 'G1', capped: o.group.capped }];
  }
  sim.capping.lpars = sim.capping.lpars.map((r) => ({ ...r, capped: r.id === o.lparFlag }));
  return { ...base, sim };
}

const shown = (run: RunState, id: string) => ({
  helper: softCapped(run.sim, id),
  sysinfo: buildMon3(run, MIDWEST).systems.find((s) => s.system === id)!.capped,
  wfex: buildMon3(run, MIDWEST).exceptions.some((e) => e.where === id && e.reason === 'CAPPED'),
  header: buildView({ ...run, tools: ['RMF_MON3'] }, MIDWEST).lpars.find((l) => l.id === id)!.capped,
});
const all = (v: boolean) => ({ helper: v, sysinfo: v, wfex: v, header: v });

describe('soft-capped state of an image', () => {
  it('is off with no cap anywhere, and for an unknown image', () => {
    const run = withCaps({});
    for (const id of zos) expect(shown(run, id)).toEqual(all(false));
    expect(softCapped(run.sim, 'NOSUCH')).toBe(false);
    expect(softCapped({ ...run.sim, capping: { lpars: [], groups: [] } }, zos[0]!)).toBe(false);
  });

  it('is on for the image whose own R4HA is over its defined capacity, and only for it', () => {
    const run = withCaps({ lparFlag: zos[0]!, definedCapacity: [zos[0]!, 50] });
    expect(shown(run, zos[0]!)).toEqual(all(true));
    expect(shown(run, zos[1]!)).toEqual(all(false));
  });

  it('ignores a flag left over after the defined capacity was removed', () => {
    // stepR4ha clears the flag at the next tick; a view built in between must not show a cap that no longer exists.
    expect(shown(withCaps({ lparFlag: zos[0]!, definedCapacity: [zos[0]!, null] }), zos[0]!)).toEqual(all(false));
  });

  it('is on for every member of a capped group, and for no image outside it', () => {
    const run = withCaps({ group: { members: [zos[0]!, zos[1]!], capped: true } });
    expect(shown(run, zos[0]!)).toEqual(all(true));
    expect(shown(run, zos[1]!)).toEqual(all(true));
    for (const id of zos.slice(2)) expect(shown(run, id)).toEqual(all(false));
  });

  it('is off for the members of a group that is not capped', () => {
    const run = withCaps({ group: { members: [zos[0]!, zos[1]!], capped: false } });
    expect(shown(run, zos[0]!)).toEqual(all(false));
  });

  it('ignores a capped group the image no longer belongs to, or that has no state yet', () => {
    const run = withCaps({ group: { members: [zos[0]!], capped: true } });
    const left = structuredClone(run.sim);
    left.config.lpars.find((l) => l.id === zos[0])!.capacityGroup = null;
    expect(softCapped(left, zos[0]!)).toBe(false);
    expect(softCapped({ ...run.sim, capping: { ...run.sim.capping, groups: [] } }, zos[0]!)).toBe(false);
  });

  it('a coupling facility image is never shown as capped', () => {
    const run = withCaps({ group: { members: zos, capped: true } });
    for (const l of buildView(run, MIDWEST).lpars.filter((x) => x.kind === 'CF')) expect(l.capped).toBe(false);
  });
});
