// RT-09 renamed ACCESS_PATH_REGRESSION to CHANGE_REGRESSION. Saves and play files written before the rename still
// name the old id, and both must load to the same state as a file written after it.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MIDWEST } from '../../src/content/scenarios';
import { MIDWEST_GAME } from '../../src/content/game-midwest';
import { canonicalTrigger, triggerLabel } from '../../src/content/rca';
import { newRun, startDay } from '../../src/game/run';
import { normalizeRun } from '../../src/game/tools';
import type { Incident, RunState } from '../../src/game/types';

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const incident = (r: RunState, trigger: string, rcaTrigger?: string): Incident => ({
  id: 999,
  workloadId: 'RBANK',
  day: 0,
  startTick: 0,
  endTick: 360,
  hours: 1,
  worstAttainmentPct: 80,
  truth: {
    mechanism: 'CPU_CAPACITY',
    trigger: trigger as Incident['truth']['trigger'],
    accepted: { mechanisms: ['CPU_CAPACITY'], triggers: [trigger as Incident['truth']['trigger']] },
    notes: { [trigger]: 'the card reached this work' },
  },
  rca: rcaTrigger
    ? { mechanism: 'CPU_CAPACITY', trigger: rcaTrigger as Incident['truth']['trigger'], points: 3, explain: 'x' }
    : null,
  trustLost: 0,
});

const withOldIds = (): RunState => {
  const r = startDay(newRun(MIDWEST, MIDWEST_GAME, 7), MIDWEST_GAME);
  return {
    ...r,
    incidents: [incident(r, 'ACCESS_PATH_REGRESSION', 'ACCESS_PATH_REGRESSION')],
    events: [{ uid: 'REGRESSION@0', defId: 'REGRESSION', name: 'REGRESSION', startTick: 0, endTick: 1000, trigger: 'ACCESS_PATH_REGRESSION' as never, affects: ['RBANK'], endCommands: [], started: true, ended: false }],
  };
};

describe('RT-09 trigger alias', () => {
  it('maps the old id and rejects anything else', () => {
    expect(canonicalTrigger('ACCESS_PATH_REGRESSION')).toBe('CHANGE_REGRESSION');
    expect(canonicalTrigger('CHANGE_REGRESSION')).toBe('CHANGE_REGRESSION');
    expect(canonicalTrigger('POLICY')).toBe('POLICY');
    expect(canonicalTrigger('NOT_A_TRIGGER')).toBeNull();
    // Object prototype keys are not trigger ids.
    expect(canonicalTrigger('toString')).toBeNull();
  });

  it('shows the trigger as a label, not the id', () => {
    expect(triggerLabel('CHANGE_REGRESSION')).toBe('Change regression');
    expect(triggerLabel('POLICY')).toBe('Policy or configuration');
  });

  it('a save written with the old id loads to the same state as one written after the rename', () => {
    const loaded = normalizeRun(withOldIds(), MIDWEST);
    const expected = normalizeRun({
      ...withOldIds(),
      incidents: [incident(withOldIds(), 'CHANGE_REGRESSION', 'CHANGE_REGRESSION')],
      events: [{ uid: 'REGRESSION@0', defId: 'REGRESSION', name: 'REGRESSION', startTick: 0, endTick: 1000, trigger: 'CHANGE_REGRESSION' as never, affects: ['RBANK'], endCommands: [], started: true, ended: false }],
    }, MIDWEST);
    expect(loaded.incidents[0]!.truth.trigger).toBe('CHANGE_REGRESSION');
    expect(loaded.incidents[0]!.truth.accepted!.triggers).toEqual(['CHANGE_REGRESSION']);
    expect(loaded.incidents[0]!.truth.notes).toEqual({ CHANGE_REGRESSION: 'the card reached this work' });
    expect(loaded.incidents[0]!.rca!.trigger).toBe('CHANGE_REGRESSION');
    expect(loaded.events[0]!.trigger).toBe('CHANGE_REGRESSION');
    expect(same(loaded, expected)).toBe(true);
  });

  it('normalizeRun leaves a current save untouched', () => {
    const r = startDay(newRun(MIDWEST, MIDWEST_GAME, 7), MIDWEST_GAME);
    expect(same(normalizeRun(r, MIDWEST), normalizeRun(r, MIDWEST))).toBe(true);
  });
});

describe('RT-09 retired id', () => {
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? walk(p) : [p];
    });

  it('is named only by the alias table, not anywhere else in src or tools', () => {
    const offenders = [...walk('src'), ...walk('tools')]
      .filter((f) => f !== 'src/content/rca.ts')
      .filter((f) => /\bACCESS_PATH_REGRESSION\b/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
