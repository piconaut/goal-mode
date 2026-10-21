import { HARBOURLINE_EVENTS, HARBOURLINE_STORY } from '../../src/content/events/harbourline-events';
import { EVENT_RUMOURS } from '../../src/content/inquiries';
import { MIDWEST_EVENTS } from '../../src/content/events/midwest-events';
import { PACKS, packOf } from '../../src/content/packs';
import { FIXES, previewChange } from '../../src/game/catalog';
import { describeCommand } from '../../src/game/changeDesk';
import { buildView } from '../../src/game/view';
import type { Command } from '../../src/sim/core/commands';
import { advance, newRun, previewContext, requestChange, startDay } from '../../src/game/run';
import { facetsOf } from '../../src/game/types';
import { applyCommands } from '../../src/sim/core/commands';
import { initState } from '../../src/sim/core/init';
import { TICKS_PER_HOUR } from '../../src/sim/core/units';

const pack = packOf('harbourline');
const workloadIds = new Set(pack.scenario.workloads.map((w) => w.id));
const lparIds = new Set(pack.scenario.world.lpars.map((l) => l.id));

describe('Harbourline Bank pack', () => {
  it('is registered and a run starts with its own facets', () => {
    expect(PACKS.harbourline).toBe(pack);
    expect(pack.id).toBe('harbourline');
    const run = newRun(pack.scenario, { ...pack.game, events: [] }, 3);
    expect(run.scenarioId).toBe('harbourline');
    expect(facetsOf(run)).toEqual(['Markets', 'Cards', 'Retail', 'Payments', 'Finance', 'Regulator']);
  });

  it('plays a morning deterministically', () => {
    const game = { ...pack.game, events: [] };
    const play = () => advance(startDay(newRun(pack.scenario, game, 5), game), pack.scenario, game, 3 * TICKS_PER_HOUR);
    expect(JSON.stringify(play())).toBe(JSON.stringify(play()));
  });

  it('card ids are unique and commands only touch workloads, LPARs and CFs of the Harbourline world', () => {
    const ids = HARBOURLINE_EVENTS.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const e of HARBOURLINE_EVENTS) {
      for (const w of e.affects) expect(workloadIds, `${e.id} affects ${w}`).toContain(w);
      for (const c of [...e.begin, ...e.end]) {
        if (c.kind === 'SET_MODIFIER' && c.mod === 'regionFailFrac') {
          const [w, l] = c.key.split('@');
          expect(workloadIds, `${e.id} ${c.key}`).toContain(w);
          expect(lparIds, `${e.id} ${c.key}`).toContain(l);
        } else if (c.kind === 'SET_MODIFIER' && c.mod !== 'asCpu') expect(workloadIds, `${e.id} ${c.key}`).toContain(c.key);
        if ('lparId' in c && typeof c.lparId === 'string') expect(lparIds, `${e.id} ${c.kind}`).toContain(c.lparId);
      }
    }
  });

  it('every fix exists and charges a facet of the run; new cards have rumours and clues', () => {
    const facets = pack.game.facets!.map((f) => f.id);
    for (const e of HARBOURLINE_EVENTS) {
      expect(e.clue.length, e.id).toBeGreaterThan(20);
      if (!e.fix) continue;
      const fix = FIXES.find((f) => f.id === e.fix);
      expect(fix, `${e.id} fix ${e.fix}`).toBeDefined();
      if (fix!.trustCost) expect(facets, e.fix).toContain(fix!.trustCost.facet);
    }
    const midwest = new Set(MIDWEST_EVENTS.map((e) => e.id));
    for (const id of ['MARKET_OPEN_SURGE', 'HOLIDAY_CARD_SPIKE']) {
      expect(midwest.has(id)).toBe(false);
      expect(EVENT_RUMOURS[id], id).toBeTruthy();
    }
  });

  it('story beats are in day order and the bank-only Midwest beats are not carried over', () => {
    const days = HARBOURLINE_STORY.map((b) => b.day);
    expect(days).toEqual([...days].sort((a, b) => a - b));
    expect(HARBOURLINE_STORY.some((b) => b.id === 'MERGER')).toBe(false);
  });

  it('SICK_AOR fails transactions on one region and its end removes the modifier', () => {
    const card = HARBOURLINE_EVENTS.find((e) => e.id === 'SICK_AOR')!;
    const s0 = initState(7, pack.scenario);
    const on = applyCommands(s0, card.begin);
    expect(on.mods.regionFailFrac?.['MKTORD@PRDC']).toBeGreaterThan(0);
    expect(Object.keys(on.mods.regionFailFrac ?? {}).every((k) => k.endsWith('@PRDC'))).toBe(true);
    const off = applyCommands(on, card.end);
    expect(off.mods.regionFailFrac ?? {}).toEqual({});
  });
});

describe('Harbourline routing-policy changes', () => {
  const content = { ...pack.game, events: [] };
  it('shows the live policy, describes and plans the change', () => {
    const r = newRun(pack.scenario, content, 3);
    const cfg = buildView(r, pack.scenario).config;
    const mktord = cfg.routing.find((x) => x.workloadId === 'MKTORD')!;
    expect(mktord.policy.method).toBe('CPSM_GOAL');
    const cmd: Command = { kind: 'SET_ROUTING_POLICY', workloadId: 'MKTORD', policy: { method: 'CPSM_GOAL', abendThreshFrac: 0.1, abendCritFrac: 0.2, quiesced: ['PRDB'] } };
    expect(describeCommand(cmd, cfg)).toBe('MKTORD routing CPSM goal → CPSM goal, ABENDTHRESH 10%, ABENDCRIT 20%, quiesced PRDB');
    expect(previewChange(previewContext(r), { commands: [cmd] }).hours).toBeGreaterThan(0);
    const out = requestChange(r, content, { label: 'x', commands: [cmd] });
    expect(out.run.hoursLeft).toBeLessThan(r.hoursLeft);
    expect(out.ok).toBe(true);
    expect(applyCommands(r.sim, [cmd]).routingPolicies?.MKTORD).toEqual(cmd.policy);
  });
});
