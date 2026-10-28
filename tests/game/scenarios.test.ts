import { BATCH_INCIDENT } from '../../src/game/sla';
import { PACKS, packOf } from '../../src/content/packs';
import { EVENT_RUMOURS } from '../../src/content/inquiries';
import { MIDWEST_EVENTS } from '../../src/content/events/midwest-events';
import { FIXES } from '../../src/game/catalog';
import { PREFILL_APP, REVENUE_EVENTS, REVENUE_STORY } from '../../src/content/events/revenue-events';
import { REVPOL } from '../../src/content/wlm/revpol';
import { advance, newRun, overallTrust, startDay } from '../../src/game/run';
import { FACETS, facetsOf } from '../../src/game/types';
import { TICKS_PER_HOUR } from '../../src/sim/core/units';
import { classify } from '../../src/sim/wlm/classify';
import { revenueTextbookPolicy } from '../../tools/strategies';

const revenue = packOf('revenue');
const quiet = { ...revenue.game, events: [] };

describe('scenario packs', () => {
  it('every SLA-owning stakeholder is a facet of its pack, and Finance and Regulator are always there', () => {
    for (const p of Object.values(PACKS)) {
      const facets = p.game.facets?.map((f) => f.id) ?? FACETS;
      expect(facets).toEqual(expect.arrayContaining(['Finance', 'Regulator']));
      const owners = [...p.scenario.workloads, ...p.game.story.flatMap((b) => b.commands ?? []).flatMap((c) => (c.kind === 'ADD_WORKLOAD' ? [c.workload] : []))]
        .filter((w) => w.sla.kind !== 'NONE')
        .map((w) => w.stakeholder);
      for (const o of owners) expect(facets, `${p.id}: ${o}`).toContain(o);
    }
  });

  it('a Midwest run keeps the bank facets; a revenue run tracks its own', () => {
    expect(facetsOf(newRun(PACKS.midwest!.scenario, PACKS.midwest!.game, 7))).toEqual([...FACETS]);
    const r = newRun(revenue.scenario, quiet, 7);
    expect(r.scenarioId).toBe('revenue');
    expect(facetsOf(r)).toEqual(['Taxpayers', 'Refunds', 'Agents', 'Employers', 'Finance', 'Regulator']);
    expect(r.trust.Retail).toBeUndefined();
    expect(overallTrust(r)).toBeCloseTo(r.trust.Taxpayers!);
  });

  it('a revenue day runs deterministically and SLA breaches only touch its own facets', () => {
    const play = () => {
      let r = startDay(newRun(revenue.scenario, quiet, 11), quiet);
      for (let h = 0; h < 6; h++) r = advance(r, revenue.scenario, quiet, TICKS_PER_HOUR);
      return r;
    };
    const a = play();
    expect(JSON.stringify(play().sim)).toBe(JSON.stringify(a.sim));
    expect(Object.keys(a.trust)).toEqual(facetsOf(newRun(revenue.scenario, quiet, 11)));
    for (const v of Object.values(a.trust)) expect(Number.isFinite(v)).toBe(true);
  });
});

describe('State Revenue Agency flaws (SPEC §13.4)', () => {
  const cls = (def: typeof REVPOL, w: { work: Parameters<typeof classify>[1] }) => classify(def, w.work).serviceClass;
  const wl = (id: string) => revenue.scenario.workloads.find((w) => w.id === id)!;

  it('G1: e-filing shares a velocity class with compliance analytics; the fix gives it a response-time goal', () => {
    expect(cls(REVPOL, wl('EFILE'))).toBe('WEBDDF');
    expect(cls(REVPOL, wl('ANALYTICS'))).toBe('WEBDDF');
    expect(REVPOL.classes.find((c) => c.id === 'WEBDDF')!.periods[0]!.goal.kind).toBe('VEL');
    const fixed = revenueTextbookPolicy();
    expect(cls(fixed, wl('EFILE'))).toBe('EFILE');
    expect(cls(fixed, wl('ANALYTICS'))).toBe('DDFBI');
  });

  it('G2: compliance batch is high batch and the refund run is not; G3: MQ falls to the lowest STC class', () => {
    expect(classify(REVPOL, { subsystem: 'JES', TN: 'CMP001', TC: 'A' }).serviceClass).toBe('BATCHHI');
    expect(classify(REVPOL, { subsystem: 'JES', TN: 'REF001', TC: 'A' }).serviceClass).toBe('BATCHPRD');
    expect(classify(REVPOL, { subsystem: 'STC', TN: 'MQ1AMSTR' }).serviceClass).toBe('STCLO');
    const fixed = revenueTextbookPolicy();
    expect(classify(fixed, { subsystem: 'JES', TN: 'REF001', TC: 'A' }).serviceClass).toBe('BATCHHI');
    expect(classify(fixed, { subsystem: 'STC', TN: 'MQ1AMSTR' }).serviceClass).toBe('STCHI');
  });

  it('H1/H2: PROD1 is soft-capped and PROD2 keeps zIIP work off the CPs', () => {
    expect(revenue.scenario.world.lpars.find((l) => l.id === 'PROD1')!.definedCapacityMsu).not.toBeNull();
    expect(revenue.scenario.world.systems.find((s) => s.lparId === 'PROD2')!.iipHonorPriority).toBe(false);
  });

  it('the pre-filled returns API lands in SYSOTHER, and the deadline surge is undone after the deadline', () => {
    expect(classify(REVPOL, PREFILL_APP.work).serviceClass).toBe('SYSOTHER');
    const on = REVENUE_STORY.find((b) => b.id === 'DEADLINE_WEEK')!.commands!;
    const off = REVENUE_STORY.find((b) => b.id === 'DEADLINE_PASSED')!.commands!;
    expect(off.map((c) => (c.kind === 'SET_MODIFIER' ? [c.key, c.value] : null))).toEqual(on.map((c) => (c.kind === 'SET_MODIFIER' ? [c.key, 1] : null)));
  });
});

describe('State Revenue Agency event deck', () => {
  const workloadIds = new Set([...revenue.scenario.workloads.map((w) => w.id), 'PREFILL']);
  const lparIds = new Set(revenue.scenario.world.lpars.map((l) => l.id));
  const facets = revenue.game.facets!.map((f) => f.id);

  it('card ids are unique', () => {
    const ids = REVENUE_EVENTS.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('commands only touch workloads, LPARs and CFs of the revenue world', () => {
    for (const e of REVENUE_EVENTS) {
      for (const w of e.affects) expect([...workloadIds, BATCH_INCIDENT], `${e.id} affects ${w}`).toContain(w);
      for (const c of [...e.begin, ...e.end]) {
        if (c.kind === 'SET_MODIFIER' && c.mod !== 'asCpu') expect(workloadIds, `${e.id} ${c.key}`).toContain(c.key);
        if ('lparId' in c && typeof c.lparId === 'string') expect(lparIds, `${e.id} ${c.kind}`).toContain(c.lparId);
        if (c.kind === 'ADD_ADDRESS_SPACE') expect(lparIds, e.id).toContain(c.addressSpace.lparId);
      }
    }
  });

  it('every fix exists and charges a facet of the run', () => {
    for (const e of REVENUE_EVENTS) {
      if (!e.fix) continue;
      const fix = FIXES.find((f) => f.id === e.fix);
      expect(fix, `${e.id} fix ${e.fix}`).toBeDefined();
      if (fix!.trustCost) expect(facets, `${e.fix}`).toContain(fix!.trustCost.facet);
    }
  });

  it('no card text names a Midwest workload, stakeholder or product', () => {
    const banned = /RBANK|CARDAUTH|MOBILE|TELLER|PAYMQ|ADHOC|Retail|Digital|Cards/;
    for (const e of REVENUE_EVENTS) {
      for (const t of [e.name, e.clue, e.announcement, e.forewarning, e.perkTip?.text]) expect(t ?? '', e.id).not.toMatch(banned);
    }
  });

  it('every agency card with a new id has a rumour', () => {
    const midwest = new Set(MIDWEST_EVENTS.map((e) => e.id));
    for (const e of REVENUE_EVENTS.filter((x) => !midwest.has(x.id))) expect(EVENT_RUMOURS[e.id], e.id).toBeTruthy();
  });
});

describe('forewarnings', () => {
  it('speak of the day they arrive: the mail lands in the morning briefing of the card day', () => {
    for (const p of Object.values(PACKS))
      for (const e of p.game.events) if (e.forewarning) expect(e.forewarning, e.id).not.toMatch(/tomorrow/i);
  });
});
