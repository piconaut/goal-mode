import { MIDWEST_GAME } from '../../src/content/game-midwest';
import { MIDWEST } from '../../src/content/scenarios';
import { previewChange } from '../../src/game/catalog';
import { addToBasket, basketLabel, describeCommand, nextAorName, validateDefinedCapacity, validateLogical, validateMemory, validateRouting, validateWeight } from '../../src/game/changeDesk';
import { cancelChange, newRun, previewContext, requestChange, startDay } from '../../src/game/run';
import { buildView } from '../../src/game/view';
import type { Command } from '../../src/sim/core/commands';

const content = { ...MIDWEST_GAME, events: [] };
const fresh = () => newRun(MIDWEST, content, 7);
const weight = (w: number): Command => ({ kind: 'SET_WEIGHT', lparId: 'PROD1', pool: 'CP', weight: w });

describe('change preview', () => {
  it('matches what requestChange actually charges', () => {
    const r = fresh();
    const cmds: Command[] = [weight(500), { kind: 'SET_RMF_INTERVAL', minutes: 15 }];
    const p = previewChange(previewContext(r), { commands: cmds });
    expect(p.ok).toBe(true);
    expect(p.emergency).toBe(false);
    const out = requestChange(r, content, { label: 'x', commands: cmds });
    expect(out.run.hoursLeft).toBeCloseTo(r.hoursLeft - p.hours);
  });

  it('prices emergency changes during the live day and explains rejections', () => {
    const live = startDay(fresh(), content);
    const p = previewChange(previewContext(live), { commands: [weight(500)] });
    expect(p.emergency).toBe(true);
    expect(p.trustCostEach).toBeGreaterThan(0);
    const broke = previewChange({ ...previewContext(live), capexRemaining: 0 }, { hardwareId: 'ADD_ZIIP' });
    expect(broke.ok).toBe(false);
    expect(broke.reason).toMatch(/Capex/);
    expect(previewChange(previewContext(live), { commands: [] }).reason).toBe('Nothing to change');
  });
});

describe('cancel', () => {
  it('refunds capex and same-day hours for planned changes', () => {
    const r0 = fresh();
    let r = requestChange(r0, content, { label: 'zIIP', hardwareId: 'ADD_ZIIP' }).run;
    const id = r.changes[0]!.id;
    const out = cancelChange(r, id);
    expect(out.ok).toBe(true);
    r = out.run;
    expect(r.changes).toHaveLength(0);
    expect(r.capexRemaining).toBe(r0.capexRemaining);
    expect(r.hoursLeft).toBeCloseTo(r0.hoursLeft);
  });

  it('cannot cancel a change once its day has started', () => {
    let r = requestChange(fresh(), content, { label: 'w', commands: [weight(500)] }).run;
    r = startDay(r, content);
    expect(cancelChange(r, r.changes[0]!.id).ok).toBe(false);
  });
});

describe('change desk helpers', () => {
  const cfg = buildView(fresh(), MIDWEST).config;
  const prod1 = cfg.lpars.find((l) => l.id === 'PROD1')!;

  it('validates against the current configuration', () => {
    expect(validateWeight(0)).not.toBeNull();
    expect(validateWeight(1000)).not.toBeNull();
    expect(validateWeight(1.5)).not.toBeNull();
    expect(validateWeight(500)).toBeNull();
    expect(validateLogical(cfg, 'PROD1', 'CP', prod1.cpLogical + prod1.cpReserved)).toBeNull();
    expect(validateLogical(cfg, 'PROD1', 'CP', prod1.cpLogical + prod1.cpReserved + 1)).toMatch(/IPL/);
    expect(validateMemory(cfg, 'PROD1', prod1.memoryGb + cfg.unassignedMemoryGb + 1)).toMatch(/unassigned/);
    expect(validateDefinedCapacity(null)).toBeNull();
    expect(validateDefinedCapacity(0)).not.toBeNull();
    expect(validateRouting({ PROD1: 0.6, PROD2: 0.4 })).toBeNull();
    expect(validateRouting({ PROD1: 0.6, PROD2: 0.5 })).toMatch(/110%/);
  });

  it('describes changes as now → new', () => {
    expect(describeCommand(weight(500), cfg)).toBe(`PROD1 CP weight ${prod1.weight} → 500`);
    expect(describeCommand({ kind: 'SET_RMF_INTERVAL', minutes: 5 }, cfg)).toBe(`RMF interval ${cfg.rmfIntervalMin} → 5 min`);
  });

  it('basket replaces an earlier edit of the same target and keeps order', () => {
    let b = addToBasket([], [weight(400), { kind: 'SET_RMF_INTERVAL', minutes: 5 }]);
    b = addToBasket(b, [weight(450), { kind: 'SET_WEIGHT', lparId: 'PROD2', pool: 'CP', weight: 300 }]);
    expect(b).toHaveLength(3);
    expect(b[0]).toEqual(weight(450));
    expect(basketLabel(b, cfg)).toMatch(/^3 changes:/);
    expect(basketLabel([weight(450)], cfg)).toBe(describeCommand(weight(450), cfg));
  });

  it('names new AORs deterministically', () => {
    expect(nextAorName(['CICSAOR1', 'CICSAOR2', 'CICSAOR3'])).toBe('CICSAOR4');
    expect(nextAorName(Array.from({ length: 9 }, (_, i) => `CICSAOR${i + 1}`))).toBe('CICSAO10');
  });
});

describe('alias moves in the basket', () => {
  it('counts staged releases as spare and submits releases first', async () => {
    const { orderBasket, spareAfterBasket } = await import('../../src/game/changeDesk');
    const cfg = buildView(fresh(), MIDWEST).config;
    const add: Command = { kind: 'SET_LCU', lcuId: '21', aliases: 41 };
    const free: Command = { kind: 'SET_LCU', lcuId: '30', aliases: 1 };
    expect(spareAfterBasket(cfg, [free], '21')).toBe(20);
    expect(orderBasket(cfg, [add, free])).toEqual([free, add]);
    const out = requestChange(fresh(), content, { label: 'move', commands: orderBasket(cfg, [add, free]) });
    expect(out.ok).toBe(true);
  });
});
