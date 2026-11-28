// PRO-02: the prologue engine (docs/prologue-design.md §11.1–§11.3, §11.6) on its two-beat test script.
import { describe, expect, it } from 'vitest';
import { MIDWEST_GAME } from '../../src/content/game-midwest';
import { PACKS, PROLOGUE_SCENARIOS, packOf } from '../../src/content/packs';
import { MIDWEST_PROLOGUE, MIDWEST_PROLOGUE_GAME } from '../../src/content/prologue/game-prologue';
import { MIDWEST, SCENARIOS } from '../../src/content/scenarios';
import type { GameContent } from '../../src/content/types';
import { cardMechanisms } from '../../src/content/footprint';
import { applyGameCommand, type GameCommand } from '../../src/game/commands';
import { advance, newRun, requestChange, startDay } from '../../src/game/run';
import { backoutList } from '../../src/game/tutor/backout';
import { beatTick, currentStep } from '../../src/game/tutor/engine';
import { replayToChapter } from '../../src/game/tutor/replay';
import { PROLOGUE_REFERENCE } from '../../src/game/tutor/reference';
import type { RunState } from '../../src/game/types';
import { tickOfPlayedHour } from '../../src/sim/core/clock';
import { TICKS_PER_DAY, TICKS_PER_HOUR } from '../../src/sim/core/units';
import { newCost } from '../../src/sim/cost/mlc';

const content = MIDWEST_PROLOGUE_GAME;
const rules = content.prologue!;
const fresh = (c: GameContent = content, seed = 42) => newRun(MIDWEST_PROLOGUE, c, seed);
const cmd = (r: RunState, c: GameCommand, g: GameContent = content) => applyGameCommand(r, null, c, g, MIDWEST_PROLOGUE);
const M2_TICK = tickOfPlayedHour(11);

describe('the prologue engine (PRO-02)', () => {
  it('stops at each beat\'s tick, and the steps complete by ack and by a noted navigation', () => {
    let r = startDay(fresh(), content);
    expect(r.tutor!.beat).toBe(-1);
    r = advance(r, MIDWEST_PROLOGUE, content, 5000);
    // M1 is at 06:00: the clock stops before the first tick runs.
    expect(r.sim.tick).toBe(0);
    expect(currentStep(r, rules)?.step?.id).toBe('M1.hello');
    r = cmd(r, { kind: 'TUTOR_ACK' }).run;
    const hint = cmd(r, { kind: 'TUTOR_HINT' });
    expect(hint.message).toBe(rules.chapters[0]!.beats[0]!.steps[1]!.hints[0]);
    expect(hint.run.tutor!.hintsUsed).toBe(1);
    r = cmd(hint.run, { kind: 'TUTOR_NOTE', noteKind: 'tab', ref: 'console' }).run;
    expect(r.tutor!.done).toEqual(['M1.hello', 'M1.console']);
    r = advance(r, MIDWEST_PROLOGUE, content, 5000);
    expect(r.sim.tick).toBe(M2_TICK);
    expect(beatTick(rules.chapters[0]!.beats[1]!)).toBe(M2_TICK);
    expect(currentStep(r, rules)?.beat.id).toBe('M2');
    // Past the last beat the clock runs on.
    r = advance(cmd(r, { kind: 'TUTOR_ACK' }).run, MIDWEST_PROLOGUE, content, 100);
    expect(r.sim.tick).toBe(M2_TICK + 100);
  });

  it('a scheduled card starts at its tick as a drawn card would, with its severity and duration', () => {
    const g: GameContent = { ...content, scheduledCards: [{ card: 'CAMPAIGN', day: 0, at: '09:30', durationHours: 1, severity: 1.5 }] };
    let r = startDay(fresh(g), g);
    const ev = r.events.find((e) => e.defId === 'CAMPAIGN')!;
    const def = g.events.find((d) => d.id === 'CAMPAIGN')!;
    const start = tickOfPlayedHour(9.5);
    expect(ev).toMatchObject({ uid: 'CAMPAIGN@0', startTick: start, endTick: start + TICKS_PER_HOUR, trigger: def.trigger, affects: def.affects, mechanisms: cardMechanisms(def), severity: 1.5, started: false });
    // Nothing else came from the deck.
    expect(r.events).toHaveLength(1);
    r = advance({ ...r, tutor: undefined }, MIDWEST_PROLOGUE, g, start + 1);
    expect(r.events[0]!.started).toBe(true);
    // CAMPAIGN multiplies MOBILE's rate by 2.5; severity 1.5 scales the excess: 1 + 1.5 × 1.5.
    expect(r.sim.mods.rate.MOBILE).toBeCloseTo(3.25, 9);
    r = advance(r, MIDWEST_PROLOGUE, g, TICKS_PER_HOUR);
    expect(r.events[0]!.ended).toBe(true);
    expect(r.sim.mods.rate.MOBILE ?? 1).toBe(1);
  });

  it('a scheduled card takes the blame for the incident it causes', () => {
    const g: GameContent = { ...content, scheduledCards: [{ card: 'CAMPAIGN', day: 0, at: '11:00', durationHours: 3, severity: 3 }] };
    let r: RunState = { ...startDay(fresh(g), g), tutor: undefined };
    r = advance(r, MIDWEST_PROLOGUE, g, tickOfPlayedHour(14));
    const inc = r.incidents.find((i) => i.workloadId === 'MOBILE' && i.startTick >= tickOfPlayedHour(11));
    expect(inc, 'the campaign hurts MOBILE').toBeDefined();
    expect(inc!.truth.trigger).toBe('DEMAND_SURGE');
    expect(inc!.truth.cause).toBe('CAMPAIGN@0');
  }, 60_000);

  it('applies the starting commands and the seeded month-to-date cost', () => {
    const cost = { ...newCost(MIDWEST.products), usageHours: 600 };
    const g: GameContent = { ...content, startingCommands: [{ kind: 'SET_RMF_INTERVAL', minutes: 15 }], startingCost: cost };
    const r = fresh(g);
    expect(r.sim.config.rmfIntervalMin).toBe(15);
    expect(r.sim.cost.usageHours).toBe(600);
    expect(fresh().sim.config.rmfIntervalMin).toBe(newRun(MIDWEST, MIDWEST_GAME, 42).sim.config.rmfIntervalMin);
  });

  it('a scripted failure fails the first change in its beat only; other prologue changes never fail', () => {
    const scripted: GameContent = { ...content, prologue: { ...rules, chapters: [{ ...rules.chapters[0]!, beats: [{ ...rules.chapters[0]!.beats[0]!, failFirstChange: true }, rules.chapters[0]!.beats[1]!] }] } };
    let r = advance(startDay(fresh(scripted), scripted), MIDWEST_PROLOGUE, scripted, 1);
    const req = { label: 'RMF 15', commands: [{ kind: 'SET_RMF_INTERVAL' as const, minutes: 15 }] };
    const first = requestChange(r, scripted, req);
    expect(first.ok).toBe(false);
    expect(first.run.tutor!.scriptedFailures).toEqual(['M1']);
    expect(requestChange(first.run, scripted, req).ok).toBe(true);
    // Fatigue that would make a normal change risky does not, outside the scripted beat.
    r = { ...r, fatigue: 100 };
    for (let i = 0; i < 5; i++) expect(requestChange(r, content, { ...req, label: `RMF ${i}` }).ok).toBe(true);
  });

  it('one refile per RCA: the first filing is taken back, a second refile is refused', () => {
    let r = advance(startDay(fresh(), content), MIDWEST_PROLOGUE, content, 1);
    r = { ...r, tutor: { ...r.tutor!, beat: 99 } };
    r = advance(r, MIDWEST_PROLOGUE, content, 8 * TICKS_PER_HOUR);
    const inc = r.incidents[0]!;
    expect(inc).toBeDefined();
    const before = { trust: r.trust, insight: r.insight, score: r.score };
    const wrong = inc.truth.mechanism === 'IO' ? 'STORAGE' : 'IO';
    const first = cmd(r, { kind: 'RCA', incidentId: inc.id, mechanism: wrong, trigger: 'HARDWARE_FAULT' });
    expect(first.ok).toBe(true);
    expect(first.run.trust).not.toEqual(before.trust);
    const second = cmd(first.run, { kind: 'RCA', incidentId: inc.id, mechanism: inc.truth.mechanism, trigger: inc.truth.trigger });
    expect(second.ok).toBe(true);
    const filed = second.run.incidents.find((i) => i.id === inc.id)!.rca!;
    expect(filed.mechanism).toBe(inc.truth.mechanism);
    // The refile scores as if the wrong answer had never been filed.
    const direct = cmd(r, { kind: 'RCA', incidentId: inc.id, mechanism: inc.truth.mechanism, trigger: inc.truth.trigger }).run;
    for (const f of Object.keys(direct.trust)) expect(second.run.trust[f]).toBeCloseTo(direct.trust[f]!, 9);
    expect(second.run.score).toBe(direct.score);
    expect(second.run.insight).toBe(direct.insight);
    expect(cmd(second.run, { kind: 'RCA', incidentId: inc.id, mechanism: wrong, trigger: 'HARDWARE_FAULT' }).ok).toBe(false);
    // A normal run still refuses a second filing.
    const midwest = newRun(MIDWEST, MIDWEST_GAME, 42);
    const normal = { ...r, scenarioId: midwest.scenarioId, tutor: undefined };
    const once = applyGameCommand(normal, null, { kind: 'RCA', incidentId: inc.id, mechanism: wrong, trigger: 'HARDWARE_FAULT' }, MIDWEST_GAME, MIDWEST).run;
    expect(applyGameCommand(once, null, { kind: 'RCA', incidentId: inc.id, mechanism: wrong, trigger: 'HARDWARE_FAULT' }, MIDWEST_GAME, MIDWEST).ok).toBe(false);
  }, 60_000);

  it('the trust floor holds at the day\'s end and no loss condition ends the prologue', () => {
    let r = advance(startDay(fresh(), content), MIDWEST_PROLOGUE, content, 1);
    r = { ...r, tutor: { ...r.tutor!, beat: 99 } };
    r = { ...r, trust: Object.fromEntries(Object.keys(r.trust).map((f) => [f, 0])), consecutiveBatchMisses: 5 };
    r = advance(r, MIDWEST_PROLOGUE, content, TICKS_PER_DAY);
    expect(r.phase).not.toBe('GAMEOVER');
    for (const v of Object.values(r.trust)) expect(v).toBeGreaterThanOrEqual(rules.trustFloor);
  }, 60_000);

  it('the back-out list is empty for an unchanged run and has one line per changed setting', () => {
    const day1 = newRun(MIDWEST, MIDWEST_GAME, 42);
    const end = fresh();
    expect(backoutList(end, day1)).toEqual([]);
    const lpars = end.sim.config.lpars.map((l) => (l.id === 'PROD1' ? { ...l, memoryGb: l.memoryGb + 16 } : l));
    const changed = { ...end, sim: { ...end.sim, config: { ...end.sim.config, lpars, rmfIntervalMin: 15 } } };
    const prod1 = day1.sim.config.lpars.find((l) => l.id === 'PROD1')!;
    expect(backoutList(changed, day1)).toEqual([
      `LPAR PROD1 memoryGb: ${prod1.memoryGb} → ${prod1.memoryGb + 16}`,
      `RMF interval: ${day1.sim.config.rmfIntervalMin} → 15`,
    ]);
  });

  it('a chapter start state replays from the reference command log, identically', () => {
    const log = PROLOGUE_REFERENCE;
    const a = replayToChapter(log, null);
    const b = replayToChapter(log, null);
    expect(JSON.stringify(a.run)).toBe(JSON.stringify(b.run));
    expect(a.run.sim.tick).toBe(M2_TICK + 360);
    expect(a.run.tutor!.done).toEqual(['M1.hello', 'M1.console', 'M2.peak']);
    const mon = replayToChapter(log, 'MON').run;
    expect(JSON.stringify(mon)).toBe(JSON.stringify(fresh()));
  }, 60_000);

  it('stays out of SCENARIOS and PACKS, and a Midwest run has no tutor', () => {
    expect(Object.keys(SCENARIOS)).not.toContain('midwest-prologue');
    expect(Object.keys(PACKS)).not.toContain('midwest-prologue');
    expect(packOf('midwest-prologue')).toBe(PROLOGUE_SCENARIOS['midwest-prologue']);
    expect('tutor' in newRun(MIDWEST, MIDWEST_GAME, 42)).toBe(false);
    expect(fresh().sim.monthDayAtStart).toBe(26);
  });
});
