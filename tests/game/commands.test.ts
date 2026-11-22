// CL-18: one command layer. These tests pin the rules that used to live in only one adapter, so the two front
// ends cannot drift apart again: RCA validation and its full reply (CLI-only), the activation goal gate
// (worker-only), and the wording each side keeps.

import { describe, expect, it } from 'vitest';
import { MIDWEST } from '../../src/content/scenarios';
import { MIDWEST_GAME } from '../../src/content/game-midwest';
import { scenarioFor } from '../../src/game/difficulty';
import { applyGameCommand } from '../../src/game/commands';
import { advanceHours } from '../../src/game/advance';
import { newRun, startDay } from '../../src/game/run';
import { policyEditSource } from '../../src/game/policies';
import type { RunState } from '../../src/game/types';
import type { ServiceDefinition } from '../../src/sim/wlm/types';

const sc = () => scenarioFor(MIDWEST, 'NORMAL');
const live = (hours = 1): RunState => advanceHours(startDay(newRun(MIDWEST, MIDWEST_GAME, 42, 'NORMAL'), MIDWEST_GAME), MIDWEST_GAME, hours, {});

describe('the shared command layer (CL-18)', () => {
  it('refuses a start outside the briefing, and keeps the pending policy a day starts with', () => {
    const run = live();
    const o = applyGameCommand(run, null, { kind: 'START' }, MIDWEST_GAME, sc());
    expect(o.ok).toBe(false);
    expect(o.message).toBe(`Cannot start a day in phase ${run.phase}`);
    expect(o.run).toBe(run);
  });

  it('validates an RCA the way only the CLI did: a known mechanism and trigger, a real incident, pins that exist', () => {
    const run = live();
    const bad = applyGameCommand(run, null, { kind: 'RCA', incidentId: 1, mechanism: 'CPU_PRIORITY' as never, trigger: 'NOPE' as never }, MIDWEST_GAME, sc());
    expect(bad.ok).toBe(false);
    expect(bad.message).toMatch(/^Mechanism one of .*; trigger one of /);
    const unknown = applyGameCommand(run, null, { kind: 'RCA', incidentId: 999, mechanism: 'CPU_PRIORITY', trigger: 'CHANGE_REGRESSION' }, MIDWEST_GAME, sc());
    expect(unknown.message).toBe('No incident INC999');
    // With no pins at all, evidence ids are refused with the CLI's guidance rather than silently dropped.
    const pinned = applyGameCommand(run, null, { kind: 'RCA', incidentId: run.incidents[0]?.id ?? 1, mechanism: 'CPU_PRIORITY', trigger: 'CHANGE_REGRESSION', evidenceIds: [1] }, MIDWEST_GAME, sc());
    if (!run.pins.length) expect(pinned.message).toMatch(/No pins yet|No incident/);
  });

  it('keeps the goal-issue gate before activation, from the worker side, and leaves the pending edits in place', () => {
    const run = live();
    // The one error severity: a class that serves CICS transactions cannot be in a resource group.
    const broken: ServiceDefinition = structuredClone(policyEditSource(run));
    const cicsClass = broken.subsystems.find((x) => x.subsystem === 'CICS')?.rules.find((r) => r.serviceClass)?.serviceClass;
    expect(cicsClass, 'the fixture needs a CICS rule target').toBeTruthy();
    broken.classes = broken.classes.map((c) => (c.id === cicsClass ? { ...c, resourceGroup: 'CICSRG' } : c));
    broken.resourceGroups = [...(broken.resourceGroups ?? []), { id: 'CICSRG', type: 1, min: null, max: null }];
    const o = applyGameCommand(run, broken, { kind: 'ACTIVATE' }, MIDWEST_GAME, sc());
    expect(o.ok).toBe(false);
    expect(o.message).toMatch(/^Policy not installed: /);
    expect(o.pending).toBe(broken);
    expect(o.run).toBe(run);
  });

  it('activates the pending policy and clears it only when the request went through', () => {
    const run = live();
    const pending = { ...structuredClone(policyEditSource(run)), policyName: 'CL18POL' };
    const o = applyGameCommand(run, pending, { kind: 'ACTIVATE' }, MIDWEST_GAME, sc());
    expect(o.ok, o.message).toBe(true);
    expect(o.pending).toBe(null);
    expect(o.run.changes.at(-1)?.label).toBe('Activate policy CL18POL');
  });

  it('says "Activate to reschedule." when a cancelled change restores the pending policy', () => {
    // Planned in the briefing: still PLANNED, so it can be cancelled before the day starts.
    const briefing = newRun(MIDWEST, MIDWEST_GAME, 42, 'NORMAL');
    const planned = { ...structuredClone(policyEditSource(briefing)), policyName: 'CL18CXL' };
    const act = applyGameCommand(briefing, null, { kind: 'CHANGE', req: { label: 'Activate policy CL18CXL', commands: [{ kind: 'ACTIVATE_POLICY', definition: planned }] } }, MIDWEST_GAME, sc());
    expect(act.ok, act.message).toBe(true);
    const id = act.run.changes.at(-1)!.id;
    expect(act.run.changes.at(-1)!.status).toBe('PLANNED');
    const o = applyGameCommand(act.run, null, { kind: 'CANCEL', changeId: id }, MIDWEST_GAME, sc());
    expect(o.ok, o.message).toBe(true);
    expect(o.message).toMatch(/Activate to reschedule\.$/);
    expect(o.pending?.policyName).toBe('CL18CXL');
  });

  it('hands a past-range Monitor III pin the history the adapter supplies, and refuses one without it', () => {
    // The browser passes its live history, the CLI its side file: the layer must consult it (B1 of the review:
    // the worker's pin lost it in the first cut of this refactor).
    const run = live(2);
    const tick = run.sim.tick - 60;
    const req = { source: 'MON3' as const, system: 'CPC1', scKey: 'ONLHI#1', metric: 'PI' as const, tick };
    const asked: number[] = [];
    const withHistory = applyGameCommand(run, null, { kind: 'PIN', req }, MIDWEST_GAME, sc(), {
      mon3History: (t) => {
        asked.push(t);
        return null;
      },
    });
    expect(asked).toContain(tick);
    expect(withHistory.message).toMatch(/Monitor III history does not reach back that far/);
    const without = applyGameCommand(run, null, { kind: 'PIN', req }, MIDWEST_GAME, sc());
    expect(without.message).toMatch(/Monitor III history does not reach back that far/);
    expect(without.ok).toBe(false);
  });

  it('refuses an unknown unpin and a draft outside the review, which the worker silently ignored', () => {
    const run = live();
    expect(applyGameCommand(run, null, { kind: 'UNPIN', id: 424242 }, MIDWEST_GAME, sc())).toMatchObject({ ok: false, message: 'No pin PIN424242' });
    const o = applyGameCommand(run, null, { kind: 'DRAFT', optionId: 'CFO_BONUS' }, MIDWEST_GAME, sc());
    expect(o).toMatchObject({ ok: false, message: 'Drafts are chosen in the end-of-day review.' });
    expect(o.run).toBe(run);
  });

  it('words a WLM edit for the phase, and reports a new goal issue the worker already warned about', () => {
    const run = live();
    const classId = run.sim.wlm.definition.classes[0]!.id;
    const o = applyGameCommand(run, null, { kind: 'WLM_EDIT', edit: { op: 'SET_FLAGS', classId, cpuCritical: true } }, MIDWEST_GAME, sc());
    expect(o.ok).toBe(true);
    expect(o.message).toMatch(/^Pending policy \S+ updated\. Activate it to take effect\./);
    expect(o.pending?.classes.find((c) => c.id === classId)?.cpuCritical).toBe(true);
    // Review phase: the CLI's instruction that names the next step.
    const reviewing = { ...run, phase: 'REVIEW' as const };
    const r = applyGameCommand(reviewing, null, { kind: 'WLM_EDIT', edit: { op: 'SET_FLAGS', classId, storageCritical: true } }, MIDWEST_GAME, sc());
    expect(r.message).toContain("close the day (draft <id|none>), then activate at tomorrow's briefing to install it.");
  });

  it('refuses a policy name that cannot be saved, once, for both front ends', () => {
    const run = live();
    const o = applyGameCommand(run, null, { kind: 'POLICY_SAVE', name: 'lowercase' }, MIDWEST_GAME, sc());
    expect(o).toMatchObject({ ok: false, message: 'Policy names are 1–8 characters, starting with a letter' });
    const saved = applyGameCommand(run, null, { kind: 'POLICY_SAVE', name: 'CL18POL' }, MIDWEST_GAME, sc());
    expect(saved.ok, saved.message).toBe(true);
    expect(saved.run.policies?.saved.some((p) => p.policyName === 'CL18POL')).toBe(true);
  });

  it('looks a saved policy up by its uppercased name, and names it so when there is none', () => {
    const run = applyGameCommand(live(), null, { kind: 'POLICY_SAVE', name: 'CL18POL' }, MIDWEST_GAME, sc()).run;
    expect(applyGameCommand(run, null, { kind: 'POLICY_LOAD', name: ' cl18pol ' }, MIDWEST_GAME, sc()).ok).toBe(true);
    expect(applyGameCommand(run, null, { kind: 'POLICY_LOAD', name: 'nope' }, MIDWEST_GAME, sc()).message).toBe('No saved policy NOPE');
    expect(applyGameCommand(run, null, { kind: 'POLICY_LOAD', name: ' ' }, MIDWEST_GAME, sc()).message).toBe('No saved policy (none)');
    const deleted = applyGameCommand(run, null, { kind: 'POLICY_DELETE', name: 'cl18pol' }, MIDWEST_GAME, sc());
    expect(deleted.ok, deleted.message).toBe(true);
    expect(deleted.run.policies?.saved.some((p) => p.policyName === 'CL18POL')).toBe(false);
  });
});
