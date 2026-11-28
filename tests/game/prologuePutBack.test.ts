// PRO-03 review (#519): Ruth's put-it-back offer counts only a change followed by an SLA incident below the line,
// never an incident that was already open when the change went in.
import { describe, expect, it } from 'vitest';
import { MIDWEST_PROLOGUE, MIDWEST_PROLOGUE_GAME } from '../../src/content/prologue/game-prologue';
import { advance, newRun, requestChange, startDay } from '../../src/game/run';
import { putBackOffered } from '../../src/game/tutor/rules';
import type { Incident, RunState } from '../../src/game/types';

const content = MIDWEST_PROLOGUE_GAME;
const line = content.prologue!.putBackAttainmentPct;
const req = { label: 'RMF 15', commands: [{ kind: 'SET_RMF_INTERVAL' as const, minutes: 15 }] };

/** A live Monday at tick 60 (06:10), with no change and no incident. */
const live = (): RunState => advance(startDay(newRun(MIDWEST_PROLOGUE, content, 42), content), MIDWEST_PROLOGUE, content, 60);

const incident = (r: RunState, startTick: number, worstAttainmentPct: number): Incident =>
  ({ id: r.incidents.length + 1, workloadId: 'MOBILE', day: r.day, startTick, endTick: null, hours: 1, worstAttainmentPct, truth: {}, subjects: {}, rca: null, trustLost: 0 }) as unknown as Incident;

const withIncident = (r: RunState, startTick: number, pct: number): RunState => ({ ...r, incidents: [...r.incidents, incident(r, startTick, pct)] });

function changed(r: RunState): RunState {
  const out = requestChange(r, content, req);
  expect(out.ok).toBe(true);
  return out.run;
}

describe("Ruth's put-it-back offer (PRO-03)", () => {
  it('no change: a bad incident alone is not offered', () => {
    const r = live();
    expect(putBackOffered(withIncident(r, r.sim.tick, 10), content)).toBe(false);
  });

  it('a change, then an incident below the line: offered', () => {
    const r = changed(live());
    const at = r.tutor!.appliedTicks![String(r.changes.at(-1)!.id)];
    expect(at).toBe(r.sim.tick);
    expect(putBackOffered(r, content)).toBe(false);
    expect(putBackOffered(withIncident(r, at! + 30, line - 1), content)).toBe(true);
  });

  it('an incident already open before the change: not offered', () => {
    const r0 = live();
    const r = changed(withIncident(r0, r0.sim.tick - 30, 10));
    expect(putBackOffered(r, content)).toBe(false);
  });

  it('exactly at the line is not below it', () => {
    const r = changed(live());
    expect(putBackOffered(withIncident(r, r.sim.tick + 30, line), content)).toBe(false);
    expect(putBackOffered(withIncident(r, r.sim.tick + 30, line - 0.1), content)).toBe(true);
  });
});
