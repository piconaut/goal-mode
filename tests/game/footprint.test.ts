// RT-14 card footprints (docs/rca-design.md §4.4(1–3)), on built fixtures: a card, its footprint, an incident with a
// given mechanism on a given host. Seed incidents move with every WLM change, so none is replayed here.
import { describe, expect, it } from 'vitest';
import { cardMechanisms, RESOURCE_MECHANISMS } from '../../src/content/footprint';
import { HARBOURLINE_GAME } from '../../src/content/game-harbourline';
import { MIDWEST_GAME } from '../../src/content/game-midwest';
import { REVENUE_GAME } from '../../src/content/game-revenue';
import { HARBOURLINE, MIDWEST, REVENUE } from '../../src/content/scenarios';
import { resolveReach } from '../../src/game/footprint';
import { acceptedAnswers, type TruthContext } from '../../src/game/rcaTruth';
import { advance, newRun, startDay } from '../../src/game/run';
import { newHour } from '../../src/game/run/hourly';
import { batchMissTrigger, footprintRelation, markMet, qualifyingCards, triggerOf } from '../../src/game/sla';
import type { ActiveEvent, Mechanism } from '../../src/game/types';
import { TICKS_PER_HOUR } from '../../src/sim/core/units';

const H = TICKS_PER_HOUR;
/** The incident's opening hour: [T, T + 1 h). */
const T = 100 * H;
const hour = { ...newHour(T), ticks: 1 };
const MIN = H / 60;

function card(defId: string, over: Partial<ActiveEvent> = {}): ActiveEvent {
  const def = MIDWEST_GAME.events.find((d) => d.id === defId)!;
  return {
    uid: `${defId}@1`, defId, name: def.name, startTick: T - 3 * H, endTick: null, trigger: def.trigger,
    affects: def.affects, mechanisms: cardMechanisms(def) ?? [], endCommands: [], started: true, ended: false, ...over,
  };
}

const on = (...lpars: string[]) => ({ hosts: lpars.map((lparId) => ({ lparId })) });
const lpars = newRun(MIDWEST, MIDWEST_GAME, 3).sim.config.lpars.map((l) => ({ id: l.id, cpcId: l.cpcId }));

const ctx = (workloadId: string, mechanism: Mechanism, events: ActiveEvent[], scope: ReturnType<typeof on> & { servers?: TruthContext['servers'] }): TruthContext => ({
  workloadId, mechanism, trigger: triggerOf(workloadId, mechanism, events, hour, false, scope), hour, events,
  hosts: scope.hosts.map((h) => ({ ...h, cpcId: 'CPCA' })), ...(scope.servers ? { servers: scope.servers } : {}),
  lpars, content: MIDWEST_GAME, isNew: false,
});

describe('the design calls (docs/rca-design.md §3, U-1 … U-3)', () => {
  it('U-1: a fresh power cap beats a background mandate on CARDAUTH; the mandate is still accepted', () => {
    // PT-04's scope is the cap's direct set: CARDAUTH is routed onto the capped CPC.
    const cap = card('POWER_CAP', { startTick: T - H, endTick: T + 5 * H, affects: ['CARDAUTH', 'MOBILE'], reach: ['PROD1', 'PROD2'] });
    const mandate = card('ENCRYPTION_MANDATE', { startTick: T - 50 * H, reach: ['PROD1', 'PROD2'], metWith: ['CARDAUTH', 'PAYMQ'] });
    const scope = on('PROD1', 'PROD2');
    for (const events of [[mandate, cap], [cap, mandate]]) {
      expect(triggerOf('CARDAUTH', 'CPU_PRIORITY', events, hour, false, scope)).toBe('HARDWARE_FAULT');
      expect(acceptedAnswers(ctx('CARDAUTH', 'CPU_PRIORITY', events, scope)).accepted.triggers).toEqual(['HARDWARE_FAULT', 'CHANGE_REGRESSION']);
    }
  });

  it('U-2: a CPU regression does not take an I/O incident from the DASD fault', () => {
    const dasd = card('DASD_DEGRADED', { startTick: T + 20 * MIN, endTick: T + 3 * H, reach: ['DEVT', 'PROD1', 'PROD2'] });
    const regression = card('REGRESSION', { startTick: T - 3 * H, endTick: T + 27 * H, reach: ['PROD1', 'PROD2'] });
    expect(triggerOf('RBANK', 'IO', [regression, dasd], hour, false, on('PROD1', 'PROD2'))).toBe('HARDWARE_FAULT');
  });

  it('U-3: a campaign starting in the hour beats agent creep MOBILE has already met its goal through', () => {
    const campaign = card('CAMPAIGN', { startTick: T + 20 * MIN, endTick: T + 2 * H, reach: ['PROD1', 'PROD2'] });
    const creep = card('MONITOR_CREEP', { startTick: T - 5 * H, endTick: T + 43 * H, reach: ['DEVT', 'PROD1', 'PROD2'] });
    const scope = on('PROD1', 'PROD2');
    expect(triggerOf('MOBILE', 'CPU_PRIORITY', [creep, campaign], hour, false, scope)).toBe('CHANGE_REGRESSION');
    const background = { ...creep, metWith: ['MOBILE'] };
    expect(triggerOf('MOBILE', 'CPU_PRIORITY', [background, campaign], hour, false, scope)).toBe('DEMAND_SURGE');
    expect(acceptedAnswers(ctx('MOBILE', 'CPU_PRIORITY', [background, campaign], scope)).accepted.triggers).toContain('CHANGE_REGRESSION');
  });
});

describe('qualification by footprint', () => {
  const regression = card('REGRESSION', { reach: ['PROD2'] });

  it('work on an image the card loads is collateral; work elsewhere is not', () => {
    expect(footprintRelation(regression, 'RBANK', on('PROD1'))).toBe('direct');
    expect(footprintRelation(regression, 'CARDAUTH', on('PROD1', 'PROD2'))).toBe('collateral');
    expect(footprintRelation(regression, 'CARDAUTH', on('PROD1'))).toBeNull();
    // R-3's shape: the regression starves Db2 on RBANK's image, and CARDAUTH there takes the card's trigger.
    expect(triggerOf('CARDAUTH', 'DEPENDENCY', [regression], hour, false, on('PROD2'))).toBe('CHANGE_REGRESSION');
    expect(triggerOf('CARDAUTH', 'DEPENDENCY', [regression], hour, false, on('PROD1'))).toBe('POLICY');
  });

  it('a region resource reaches the work its regions serve, and only that', () => {
    const qr = card('QR_RELEASE', { reach: ['CICSAOR1@PROD1', 'CICSAOR3@PROD1'] });
    const served = { ...on('PROD1'), servers: [{ jobname: 'CICSAOR1', lparId: 'PROD1' }] };
    const other = { ...on('PROD1'), servers: [{ jobname: 'CICSAOR5', lparId: 'PROD1' }] };
    expect(triggerOf('CARDAUTH', 'QR_TCB', [qr], hour, false, served)).toBe('CHANGE_REGRESSION');
    expect(triggerOf('CARDAUTH', 'QR_TCB', [qr], hour, false, other)).toBe('POLICY');
  });

  it('the work collateral through a server image alone', () => {
    const scope = { ...on('PROD1'), servers: [{ jobname: 'CICSAOR2', lparId: 'PROD2' }] };
    expect(footprintRelation(regression, 'TELLER', scope)).toBe('collateral');
  });

  it('the mechanism must be one the resource causes', () => {
    expect(triggerOf('CARDAUTH', 'IO', [regression], hour, false, on('PROD2'))).toBe('GROWTH');
    expect(RESOURCE_MECHANISMS.CP).not.toContain('IO');
  });

  it('direct beats collateral, even when the direct card is background and the collateral one fresh', () => {
    const creep = card('MONITOR_CREEP', { reach: ['PROD1', 'PROD2'], metWith: ['RBANK'] });
    const campaign = card('CAMPAIGN', { startTick: T + 20 * MIN, reach: ['PROD1', 'PROD2'] });
    const ranked = qualifyingCards([campaign, creep], 'RBANK', 'DEPENDENCY', { startTick: T, endTick: T + H }, on('PROD1'));
    expect(ranked.map((q) => [q.card.defId, q.direct, q.background])).toEqual([['MONITOR_CREEP', true, true], ['CAMPAIGN', false, false]]);
    // R-9's shape: the campaign's trigger is still accepted for RBANK, and is the primary for CARDAUTH beside it.
    expect(acceptedAnswers(ctx('RBANK', 'DEPENDENCY', [campaign, creep], on('PROD1'))).accepted.triggers).toContain('DEMAND_SURGE');
    const cardauth = { ...creep, metWith: ['CARDAUTH', 'RBANK'] };
    expect(triggerOf('CARDAUTH', 'DEPENDENCY', [cardauth, campaign], hour, false, on('PROD1'))).toBe('DEMAND_SURGE');
  });

  it('a tie accepts both triggers, the earlier start leads, and the uid plays no part', () => {
    // Both started before the hour and run through it: same footprint relation, both fresh, the full overlap.
    const a = card('CF_LINK', { uid: 'Z@1', startTick: T - 2 * H, affects: [], reach: ['PROD1', 'PROD2'] });
    const b = card('LOCK_ESCALATION', { uid: 'A@1', startTick: T - H, affects: [], reach: ['PROD1', 'PROD2'] });
    const scope = on('PROD1');
    for (const events of [[a, b], [b, a]]) {
      expect(triggerOf('PAYMQ', 'LOCK_CONTENTION', events, hour, false, scope)).toBe('HARDWARE_FAULT');
      expect(acceptedAnswers(ctx('PAYMQ', 'LOCK_CONTENTION', events, scope)).accepted.triggers.slice(0, 2)).toEqual(['HARDWARE_FAULT', 'BATCH_OVERLAP']);
    }
  });

  it('a collateral victim also accepts the fallback: the policy or headroom that left it exposed', () => {
    const out = acceptedAnswers(ctx('CARDAUTH', 'DEPENDENCY', [regression], on('PROD2')));
    expect(out.accepted.triggers).toEqual(['CHANGE_REGRESSION', 'POLICY']);
    expect(out.notes.POLICY).toMatch(/neighbour/);
    // A direct victim does not.
    expect(acceptedAnswers(ctx('RBANK', 'DEPENDENCY', [regression], on('PROD2'))).accepted.triggers).toEqual(['CHANGE_REGRESSION']);
  });

  it('BATCH is a workload like any other: a card on a critical job image reaches it', () => {
    const night = T;
    const creep = card('MONITOR_CREEP', { startTick: night - H, reach: ['PROD1'] });
    expect(batchMissTrigger('CPU_PRIORITY', [creep], hour, night, on('PROD1'))).toBe('CHANGE_REGRESSION');
    expect(batchMissTrigger('CPU_PRIORITY', [creep], hour, night, on('DEVT'))).toBe('POLICY');
  });

  it('SMF_AUDIT has a footprint now: extra CP in the SMF address spaces, which can only fill a full machine', () => {
    const def = MIDWEST_GAME.events.find((d) => d.id === 'SMF_AUDIT')!;
    expect(def.reach).toEqual({ jobs: ['SMF'] });
    expect(cardMechanisms(def)).toEqual(['CPU_CAPACITY']);
    const audit = card('SMF_AUDIT', { reach: ['PROD1', 'PROD2'] });
    expect(triggerOf('CARDAUTH', 'CPU_CAPACITY', [audit], hour, false, on('PROD1'))).toBe('CHANGE_REGRESSION');
    for (const m of ['CPU_PRIORITY', 'CAPPING', 'DEPENDENCY', 'THREAD_LIMIT'] as const) {
      expect(triggerOf('CARDAUTH', m, [audit], hour, false, on('PROD1'))).not.toBe('CHANGE_REGRESSION');
    }
  });
});

describe('background cards (§4.4(2))', () => {
  it('markMet makes a card background only for work that met a goal with it already running', () => {
    const running = card('REGRESSION', { startTick: T - H });
    const starting = card('CAMPAIGN', { startTick: T + 10 });
    const reached = () => on('PROD2');
    const out = markMet([{ ...running, reach: ['PROD2'] }, { ...starting, reach: ['PROD2'] }], ['TELLER', 'CARDAUTH'], T, reached);
    expect(out[0]!.metWith).toEqual(['CARDAUTH', 'TELLER']);
    expect(out[1]!.metWith).toBeUndefined();
    expect(markMet(out, ['CARDAUTH'], T + H, reached)[0]).toBe(out[0]);
    // Work the card did not reach stays fresh for it: a later routing move into its reach is news.
    expect(markMet([{ ...running, reach: ['PROD2'] }], ['TELLER'], T, () => on('PROD1'))[0]!.metWith).toBeUndefined();
  });

  it('a permanent card stops disturbing the baseline once it is background; a time-limited one does not', () => {
    const run = startDay(newRun(MIDWEST, MIDWEST_GAME, 3), MIDWEST_GAME);
    const baselineAfter = (c: ActiveEvent, hours: number) => {
      let r = { ...run, events: [c] };
      const seen: (number | undefined)[] = [];
      for (let i = 0; i < hours; i++) {
        r = advance(r, MIDWEST, MIDWEST_GAME, H);
        seen.push(r.baselines.TELLER?.cpu);
      }
      return { seen, card: r.events[0]! };
    };
    // Started already, so no begin commands apply: the card changes nothing but the bookkeeping.
    const control = card('VENDOR_PRICE', { startTick: 0, endTick: null });
    expect(baselineAfter(control, 1).seen[0]).toBeGreaterThan(0);
    const mandate = card('ENCRYPTION_MANDATE', { startTick: 0, endTick: null });
    const permanent = baselineAfter(mandate, 2);
    expect(permanent.card.metWith).toContain('TELLER');
    expect(permanent.seen[0]).toBeUndefined();
    expect(permanent.seen[1]).toBeGreaterThan(0);
    const limited = baselineAfter({ ...mandate, endTick: 10 * H }, 2);
    expect(limited.card.metWith).toContain('TELLER');
    expect(limited.seen).toEqual([undefined, undefined]);
    // Collateral work too (§4.4(1), A2): a regression on RBANK loads CP on TELLER's images, so TELLER's degraded but
    // passing hours stay out of its healthy baseline while the card runs.
    const neighbour = baselineAfter(card('REGRESSION', { startTick: 0, endTick: 10 * H }), 2);
    expect(neighbour.card.reach).toEqual(expect.arrayContaining(['PROD1', 'PROD2']));
    expect(neighbour.seen).toEqual([undefined, undefined]);
  });
});

describe('reach at run time', () => {
  it('resolves each kind of reach from the routing and the address spaces', () => {
    const r = newRun(MIDWEST, MIDWEST_GAME, 3);
    const world = { sim: r.sim, workloads: MIDWEST.workloads, addressSpaces: MIDWEST.addressSpaces };
    expect(resolveReach({ hostsOf: ['RBANK'] }, world)).toEqual(['PROD1', 'PROD2']);
    expect(resolveReach({ hostsOf: ['ADHOC'] }, world)).toEqual(['PROD2']);
    expect(resolveReach({ jobs: ['MONAGENT'] }, world)).toEqual(expect.arrayContaining(['DEVT', 'PROD1', 'PROD2']));
    expect(resolveReach({ regions: ['CICSAOR2'] }, world)).toEqual(['CICSAOR2@PROD2']);
    expect(resolveReach({ images: ['PROD1', 'NOPE'] }, world)).toEqual(['PROD1']);
    expect(resolveReach('sysplex', world)).toEqual(r.sim.config.lpars.map((l) => l.id).sort());
    const cpc = r.sim.config.lpars[0]!.cpcId;
    expect(resolveReach('capacityCpcs', world, [cpc])).toEqual(r.sim.config.lpars.filter((l) => l.cpcId === cpc).map((l) => l.id).sort());
  });

  it('a running card keeps the union of the images it reached in the hour after a routing move', () => {
    const run = startDay(newRun(MIDWEST, MIDWEST_GAME, 3), MIDWEST_GAME);
    const regression = card('REGRESSION', { startTick: 0, endTick: null, affects: ['RBANK'] });
    let r = advance({ ...run, events: [regression], pendingCommands: [{ kind: 'SET_ROUTING', workloadId: 'RBANK', routing: { PROD1: 1, PROD2: 0 } }] }, MIDWEST, MIDWEST_GAME, 1);
    expect(r.events[0]!.reach).toEqual(['PROD1']);
    r = advance({ ...r, pendingCommands: [{ kind: 'SET_ROUTING', workloadId: 'RBANK', routing: { PROD1: 0, PROD2: 1 } }] }, MIDWEST, MIDWEST_GAME, 1);
    expect(r.events[0]!.reach).toEqual(['PROD1', 'PROD2']);
    // The next hour starts from what the card reaches then.
    r = advance(r, MIDWEST, MIDWEST_GAME, H);
    expect(r.events[0]!.reach).toEqual(['PROD2']);
  });
});

describe('the decks', () => {
  const decks = [
    { game: MIDWEST_GAME, scenario: MIDWEST },
    { game: HARBOURLINE_GAME, scenario: HARBOURLINE },
    { game: REVENUE_GAME, scenario: REVENUE },
  ];

  it("every card's reach names real workloads, address spaces and images, and covers what its begin commands load", () => {
    for (const { game, scenario } of decks) {
      const workloads = [...scenario.workloads, ...game.events.flatMap((e) => e.begin.flatMap((c) => (c.kind === 'ADD_WORKLOAD' ? [c.workload] : [])))];
      const jobs = [...scenario.addressSpaces, ...game.events.flatMap((e) => e.begin.flatMap((c) => (c.kind === 'ADD_ADDRESS_SPACE' ? [c.addressSpace] : [])))].map((a) => a.jobname);
      const images = scenario.world.lpars.map((l) => l.id);
      for (const e of game.events) {
        const reach = e.reach;
        if (!reach || typeof reach === 'string') continue;
        const names = 'hostsOf' in reach ? reach.hostsOf : 'jobs' in reach ? reach.jobs : 'images' in reach ? reach.images : reach.regions;
        const known = 'hostsOf' in reach ? workloads.map((w) => w.id) : 'images' in reach ? images : jobs;
        for (const n of names) expect(known, `${scenario.id} ${e.id} reaches ${n}`).toContain(n);
        // A workload whose rate or CPU the card changes is in its direct set or its reach.
        for (const c of e.begin) {
          if (c.kind !== 'SET_MODIFIER' || (c.mod !== 'rate' && c.mod !== 'cpu' && c.mod !== 'ziipEligMult')) continue;
          const inReach = 'hostsOf' in reach && reach.hostsOf.includes(c.key);
          expect(e.affects.includes(c.key) || inReach, `${scenario.id} ${e.id} loads ${c.key}`).toBe(true);
        }
      }
    }
  });

  it('a card with no resource hurts no work: it is a control for the validator', () => {
    for (const { game } of decks) {
      for (const e of game.events.filter((x) => !x.resource)) {
        expect(e.affects, e.id).toEqual([]);
        expect(e.reach, e.id).toBeUndefined();
      }
    }
  });
});
