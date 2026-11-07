import { MIDWEST_GAME } from '../../src/content/game-midwest';
import { MIDWEST } from '../../src/content/scenarios';
import { previewChange } from '../../src/game/catalog';
import { addToBasket, basketAfterFailure, basketLabel, describeCommand, nextAorName, validateDefinedCapacity, validateLogical, validateMemory, validateRouting, validateWeight } from '../../src/game/changeDesk';
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

  it("offers only fixes whose card this run has revealed, and accepts only the scenario's fixes", () => {
    const r = newRun(MIDWEST, MIDWEST_GAME, 7);
    const sos = MIDWEST_GAME.events.find((e) => e.id === 'CICS_SOS')!;
    const started = {
      ...r,
      events: [{ uid: 'CICS_SOS@0', defId: sos.id, name: sos.name, startTick: 0, endTick: null, trigger: sos.trigger, affects: sos.affects, endCommands: sos.end, started: true, ended: false }],
    };
    const drawn = { ...started, events: started.events.map((e) => ({ ...e, started: false })) };
    expect(buildView(started, MIDWEST).fixIds).toContain('RECYCLE_PROD2_AORS');
    // Drawn for today but not started and not forewarned: the Operations list must not spoil the card.
    expect(buildView(drawn, MIDWEST).fixIds).not.toContain('RECYCLE_PROD2_AORS');
    expect(buildView(started, MIDWEST).fixIds).not.toContain('RECYCLE_PROD2_AORS_REV');
    expect(previewChange(previewContext(started, MIDWEST_GAME), { fixId: 'RECYCLE_PROD2_AORS' }).ok).toBe(true);
    expect(requestChange(r, MIDWEST_GAME, { label: 'x', fixId: 'RECYCLE_PROD2_AORS_REV' }).ok).toBe(false);
  });

  it('reveals a fix when the card was only forewarned', () => {
    const r = newRun(MIDWEST, MIDWEST_GAME, 7);
    const enc = MIDWEST_GAME.events.find((e) => e.id === 'ENCRYPTION_MANDATE')!;
    const forewarned = {
      ...r,
      events: [{ uid: 'ENCRYPTION_MANDATE@1', defId: enc.id, name: enc.name, startTick: 999, endTick: null, trigger: enc.trigger, affects: enc.affects, endCommands: enc.end, started: false, ended: false }],
    };
    expect(buildView(r, MIDWEST).fixIds).not.toContain('SCOPE_ENCRYPTION');
    expect(buildView(forewarned, MIDWEST).fixIds).toContain('SCOPE_ENCRYPTION');
  });

  it('reveals a fix when the card was only rumoured through Ask Around', () => {
    const r = newRun(MIDWEST, MIDWEST_GAME, 7);
    const enc = MIDWEST_GAME.events.find((e) => e.id === 'ENCRYPTION_MANDATE')!;
    const card = { uid: 'ENCRYPTION_MANDATE@1', defId: enc.id, name: enc.name, startTick: 999, endTick: null, trigger: enc.trigger, affects: enc.affects, endCommands: enc.end, started: false, ended: false };
    const rumoured = { ...r, events: [card], inquiries: { pending: [], revealed: [`ev:${card.uid}`] } };
    expect(buildView(rumoured, MIDWEST).fixIds).toContain('SCOPE_ENCRYPTION');
  });

  it('an operator command during the live day skips the change-board trust cost but still takes hours', () => {
    const live = startDay(newRun(MIDWEST, MIDWEST_GAME, 7), MIDWEST_GAME);
    const op = previewChange(previewContext(live, MIDWEST_GAME), { fixId: 'CANCEL_RUNAWAY' });
    expect(op.trustCostEach).toBe(0);
    expect(op.hours).toBeGreaterThan(0);
    expect(previewChange(previewContext(live, MIDWEST_GAME), { fixId: 'REBIND_REVERT' }).trustCostEach).toBeGreaterThan(0);
  });

  it('a running power-budget card refuses On/Off CoD but not permanent hardware', () => {
    const r = fresh();
    const card = { uid: 'e1', defId: 'GREEN_IT_COD', name: 'Data centre power budget', startTick: 0, endTick: null, trigger: 'POLICY' as const, affects: [] as string[], blocksHardware: ['COD_CP'], endCommands: [] as Command[] };
    const running = { ...r, events: [{ ...card, started: true, ended: false }] };
    expect(previewChange(previewContext(running), { hardwareId: 'COD_CP' }).reason).toMatch(/power budget/);
    expect(previewChange(previewContext(running), { hardwareId: 'ADD_ZIIP' }).ok).toBe(true);
    expect(previewChange(previewContext({ ...r, events: [{ ...card, started: true, ended: true }] }), { hardwareId: 'COD_CP' }).ok).toBe(true);
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

  it('hands back the policy of a cancelled activation and names the id on a repeat cancel', () => {
    const r0 = fresh();
    const definition = r0.sim.wlm.definition;
    const r = requestChange(r0, content, { label: 'Activate policy', commands: [{ kind: 'ACTIVATE_POLICY', definition }] }).run;
    const id = r.changes[0]!.id;
    const out = cancelChange(r, id);
    expect(out.restoredPolicy).toBe(definition);
    const again = cancelChange(out.run, id);
    expect(again.ok).toBe(false);
    expect(again.message).toContain(`CHG${id}`);
  });

  it('does not restore an older policy when a later activation for the same day is kept', () => {
    let r = fresh();
    for (const name of ['FIRST', 'SECOND']) {
      r = requestChange(r, content, { label: name, commands: [{ kind: 'ACTIVATE_POLICY', definition: { ...r.sim.wlm.definition, policyName: name } }] }).run;
    }
    const first = r.changes[0]!;
    const second = r.changes[1]!;
    const cancelled = cancelChange(r, first.id);
    expect(cancelled.ok).toBe(true);
    expect(cancelled.restoredPolicy).toBeUndefined();
    expect(cancelled.message).toContain('Later policy SECOND keeps its current edits');
    expect(cancelled.run.changes).toEqual([second]);
    expect(cancelled.run.hoursLeft).toBe(r.hoursLeft + first.hours);
    // Cancelling the last install still returns its policy, even if an earlier one remains.
    expect(cancelChange(r, second.id).restoredPolicy?.policyName).toBe('SECOND');
    // A later failed or future-day activation doesn't supersede this day's cancelled policy.
    for (const later of [{ ...second, status: 'FAILED' as const }, { ...second, activateDay: r.day + 1 }]) {
      expect(cancelChange({ ...r, changes: [first, later] }, first.id).restoredPolicy?.policyName).toBe('FIRST');
    }
  });

  it('cannot cancel a change once its day has started', () => {
    let r = requestChange(fresh(), content, { label: 'w', commands: [weight(500)] }).run;
    r = startDay(r, content);
    expect(cancelChange(r, r.changes[0]!.id).ok).toBe(false);
  });

  it('refuses a command whose target does not exist, naming the real ones, and charges nothing', () => {
    const r0 = fresh();
    const out = requestChange(r0, content, { label: 'mxt', commands: [{ kind: 'SET_CICS', name: 'NOSUCH', maxTasks: 200 }] });
    expect(out.ok).toBe(false);
    expect(out.message).toMatch(/No CICS region NOSUCH; CICS regions: \S+/);
    expect(out.run.hoursLeft).toBe(r0.hoursLeft);
    expect(requestChange(r0, content, { label: 'w', commands: [{ kind: 'SET_WEIGHT', lparId: 'PROD9', pool: 'CP', weight: 500 }] }).message).toMatch(/LPARs: .*PROD1/);
  });

  it('accepts a command on a region added by a change already planned', () => {
    const r = requestChange(fresh(), content, { label: 'aor', commands: [{ kind: 'ADD_AOR', lparId: 'PROD1', name: 'CICSNEW', maxTasks: 100, qrFrac: 0.5 }] }).run;
    expect(requestChange(r, content, { label: 'mxt', commands: [{ kind: 'SET_CICS', name: 'CICSNEW', maxTasks: 200 }] }).ok).toBe(true);
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

// Playtest round 1: a failed 9-change request was unrecoverable; its changes now go back to the basket.
describe('basketAfterFailure', () => {
  const change = (id: number, status: 'PLANNED' | 'APPLIED' | 'FAILED', commands: Command[], over: Record<string, unknown> = {}) => ({
    id, label: `c${id}`, commands, hours: 1, capex: 0, opexPerDay: 0, activateDay: 0, plannedDay: 0, emergency: false, status, revertDay: null, revertCommands: [], endsEvent: null, ...over,
  });
  it('hands back the desk changes of newly failed changes, keeping later drafts of the same target', () => {
    const r = fresh();
    const before = { ...r, changes: [change(1, 'PLANNED', [weight(500), { kind: 'SET_WEIGHT', lparId: 'PROD2', pool: 'CP', weight: 400 }]), change(2, 'FAILED', [weight(300)])] };
    const after = {
      ...before,
      changes: [
        change(1, 'FAILED', before.changes[0]!.commands),
        change(2, 'FAILED', [weight(300)]),
        change(3, 'FAILED', [weight(450)], { capex: 100 }),
        change(4, 'FAILED', [{ kind: 'ACTIVATE_POLICY', definition: r.sim.wlm.definition } as Command]),
      ],
    };
    const drafted = [weight(600)];
    const out = basketAfterFailure(before, after, drafted)!;
    expect(out).toHaveLength(2);
    expect(out).toContainEqual(weight(600));
    expect(out).toContainEqual({ kind: 'SET_WEIGHT', lparId: 'PROD2', pool: 'CP', weight: 400 });
    expect(basketAfterFailure(before, before, drafted)).toBeNull();
  });
});
