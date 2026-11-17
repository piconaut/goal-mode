import { describe, expect, it } from 'vitest';
import { goalDraftError, goalOf, sameGoal } from '../../src/game/wlmGoal';

// CL-37: the service-class editor's goal logic is pure and lives in game/; these are its unit tests.
describe('service-class goal drafts', () => {
  it('parses each goal kind from the editor fields', () => {
    expect(goalOf('VEL', '60', '90')).toEqual({ kind: 'VEL', velocity: 60 });
    expect(goalOf('AVG', '0.5', '90')).toEqual({ kind: 'AVG', rtSec: 0.5 });
    expect(goalOf('PCT', '0.25', '95')).toEqual({ kind: 'PCT', rtSec: 0.25, pct: 95 });
    expect(goalOf('DISC', '0.25', '95')).toEqual({ kind: 'DISC' });
  });

  it('accepts the field bounds and rejects just outside them', () => {
    expect(goalDraftError('VEL', 1, 90)).toBeNull();
    expect(goalDraftError('VEL', 99, 90)).toBeNull();
    expect(goalDraftError('VEL', 0, 90)).toBe('Velocity is 1–99');
    expect(goalDraftError('VEL', 100, 90)).toBe('Velocity is 1–99');
    expect(goalDraftError('AVG', 0.001, 90)).toBeNull();
    expect(goalDraftError('AVG', 0, 90)).toBe('Response time must be > 0 s');
    expect(goalDraftError('AVG', -1, 90)).toBe('Response time must be > 0 s');
    // The draft check is only "above zero". The applied-edit check (wlmEdit.goalError) enforces 1 ms to 24 h; if the
    // two were merged, these two would start failing inline and the editor would reject values it accepts today.
    expect(goalDraftError('AVG', 0.0005, 90)).toBeNull();
    expect(goalDraftError('AVG', 90_000, 90)).toBeNull();
    expect(goalDraftError('PCT', 0.25, 1)).toBeNull();
    expect(goalDraftError('PCT', 0.25, 99)).toBeNull();
    expect(goalDraftError('PCT', 0.25, 0)).toBe('Percentile is 1–99');
    expect(goalDraftError('PCT', 0.25, 100)).toBe('Percentile is 1–99');
    expect(goalDraftError('DISC', -1, 0)).toBeNull();
  });

  it('tells whether an edit changes the goal', () => {
    expect(sameGoal({ kind: 'VEL', velocity: 60 }, { kind: 'VEL', velocity: 60 })).toBe(true);
    expect(sameGoal({ kind: 'VEL', velocity: 60 }, { kind: 'VEL', velocity: 61 })).toBe(false);
    expect(sameGoal({ kind: 'AVG', rtSec: 0.5 }, { kind: 'AVG', rtSec: 0.5 })).toBe(true);
    expect(sameGoal({ kind: 'AVG', rtSec: 0.5 }, { kind: 'AVG', rtSec: 0.6 })).toBe(false);
    expect(sameGoal({ kind: 'PCT', rtSec: 0.25, pct: 95 }, { kind: 'PCT', rtSec: 0.25, pct: 95 })).toBe(true);
    expect(sameGoal({ kind: 'PCT', rtSec: 0.25, pct: 95 }, { kind: 'PCT', rtSec: 0.25, pct: 90 })).toBe(false);
    expect(sameGoal({ kind: 'VEL', velocity: 60 }, { kind: 'AVG', rtSec: 60 })).toBe(false);
    expect(sameGoal({ kind: 'DISC' }, { kind: 'DISC' })).toBe(true);
  });
});
