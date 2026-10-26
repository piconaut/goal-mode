import { askAround, inquiriesView } from '../../src/game/inquiries';
import { buyTool, expireToolTrials, trialTool } from '../../src/game/tools';
import { failRiskFor, hardwareItem, hoursFor, opexBudgetFor } from '../../src/game/catalog';
import { endReport } from '../../src/game/endReport';
import { MIDWEST_GAME } from '../../src/content/game-midwest';
import { MIDWEST, SCENARIOS } from '../../src/content/scenarios';
import { advance, chooseDraft, continueEndless, drawEvents, newRun, requestChange, startDay, submitRca, sysotherByLpar } from '../../src/game/run';
import { TICKS_PER_DAY } from '../../src/sim/core/units';
import { streamRng } from '../../src/sim/core/rng';
import type { RmfInterval, WlmRecord } from '../../src/sim/measure/rmf';
import { applyCommands } from '../../src/sim/core/commands';
import { scoreRca } from '../../src/game/sla';
import type { RunState } from '../../src/game/types';

const content = { ...MIDWEST_GAME, events: [] }; // deterministic: no random events

function fresh(): RunState {
  return newRun(MIDWEST, content, 7);
}

describe('changes', () => {
  it('planned changes cost hours and apply at the start of the day', () => {
    let r = fresh();
    const out = requestChange(r, content, { label: 'PROD1 weight 565', commands: [{ kind: 'SET_WEIGHT', lparId: 'PROD1', pool: 'CP', weight: 565 }] });
    expect(out.ok).toBe(true);
    r = out.run;
    expect(r.hoursLeft).toBeCloseTo(7.5);
    r = startDay(r, content);
    r = advance(r, MIDWEST, content, 1);
    const status = r.changes[0]!.status;
    if (status === 'APPLIED') expect(r.sim.config.lpars.find((l) => l.id === 'PROD1')!.pools[0]!.weight).toBe(565);
    else expect(status).toBe('FAILED');
  });

  it('hardware orders spend capex and arrive after their lead time', () => {
    const out = requestChange(fresh(), content, { label: 'zIIP', hardwareId: 'ADD_ZIIP' });
    expect(out.ok).toBe(true);
    expect(out.run.capexRemaining).toBe(content.capexQuarter - 95_000);
    expect(out.run.changes[0]!.activateDay).toBe(4);
  });

  it('rejects changes beyond hours + overtime', () => {
    const r = { ...fresh(), hoursLeft: 0 };
    const out = requestChange(r, content, {
      label: 'big',
      commands: Array.from({ length: 4 }, () => ({ kind: 'ADD_AOR' as const, lparId: 'PROD1', name: 'X', maxTasks: 200, qrFrac: 0.6 })),
    });
    expect(out.ok).toBe(false);
  });

  it('emergency changes during the live day cost trust', () => {
    let r = startDay(fresh(), content);
    const before = r.trust.Retail;
    r = requestChange(r, content, { label: 'RMF 15', commands: [{ kind: 'SET_RMF_INTERVAL', minutes: 15 }] }).run;
    expect(r.trust.Retail).toBeLessThan(before!);
  });

  it('a change freeze blocks planned changes', () => {
    const r = { ...fresh(), constraints: ['FREEZE'] };
    expect(requestChange(r, content, { label: 'x', commands: [{ kind: 'SET_RMF_INTERVAL', minutes: 15 }] }).ok).toBe(false);
  });
});

describe('incidents and RCA', () => {
  it('a CPU regression on retail opens an incident with a CPU mechanism', () => {
    let r = startDay(fresh(), content);
    r = { ...r, pendingCommands: [{ kind: 'SET_MODIFIER', mod: 'cpu', key: 'RBANK', value: 12 }] };
    r = advance(r, MIDWEST, content, 360 * 6); // 06:00 → 12:00
    const inc = r.incidents.find((i) => i.workloadId === 'RBANK');
    expect(inc).toBeDefined();
    // Longer CICS tasks also push concurrency past MXT, so the queue can dominate.
    expect(['CPU_CAPACITY', 'CPU_PRIORITY', 'QR_TCB', 'THREAD_LIMIT']).toContain(inc!.truth.mechanism);
    expect(r.trust.Retail).toBeLessThan(70);
    const scored = submitRca(r, inc!.id, inc!.truth.mechanism, inc!.truth.trigger);
    expect(scored.incidents.find((i) => i.id === inc!.id)!.rca!.points).toBe(5);
    expect(scored.insight).toBe(r.insight + 5);
  });

  it('a breach still running at 06:00 counts towards the new day, not the day it started', () => {
    let r = startDay(fresh(), content);
    r = { ...r, pendingCommands: [{ kind: 'SET_MODIFIER', mod: 'cpu', key: 'RBANK', value: 12 }] };
    r = advance(r, MIDWEST, content, 360 * 2);
    const first = r.incidents.find((i) => i.workloadId === 'RBANK' && i.endTick === null)!;
    expect(first).toBeDefined();
    // Pretend the incident opened yesterday and is still open as the new played day begins.
    r = { ...r, incidents: r.incidents.map((i) => (i.id === first.id ? { ...i, day: r.day - 1 } : i)) };
    const hourEnd = r.sim.tick + 360;
    r = advance(r, MIDWEST, content, 360);
    expect(r.incidents.find((i) => i.id === first.id)!.endTick).toBe(hourEnd - 360);
    const today = r.incidents.find((i) => i.workloadId === 'RBANK' && i.endTick === null)!;
    expect(today.day).toBe(r.day);
    expect(today.hours).toBe(1);
  });

  it('RCA scoring gives partial credit', () => {
    expect(scoreRca({ mechanism: 'CF_SERVICE', trigger: 'HARDWARE_FAULT' }, { mechanism: 'CF_SERVICE', trigger: 'GROWTH' })).toBe(3);
    expect(scoreRca({ mechanism: 'CF_SERVICE', trigger: 'HARDWARE_FAULT' }, { mechanism: 'IO', trigger: 'HARDWARE_FAULT' })).toBe(2);
  });
});

describe('draft', () => {
  it('perks and bonuses apply and move to the next day', () => {
    const r: RunState = { ...fresh(), phase: 'REVIEW', draft: [{ id: 'CFO_BONUS', title: '', description: '' }] };
    const n = chooseDraft(r, content, 'CFO_BONUS');
    expect(n.phase).toBe('BRIEFING');
    expect(n.day).toBe(1);
    expect(n.capexRemaining).toBe(r.capexRemaining + 300_000);
    expect(chooseDraft(r, content, 'HMC_NINJA').perks).toContain('HMC_NINJA');
    expect(chooseDraft(r, content, 'RC_HOARDER').tools).toEqual(['RC_ADVISOR']);
    const twice = chooseDraft({ ...chooseDraft(r, content, 'SQL_SPRINT'), phase: 'REVIEW' }, content, 'SQL_SPRINT');
    expect(twice.projects?.find((p) => p.id === 'SQL_TUNING')).toMatchObject({ hoursDone: 12, done: true });
    expect(twice.hoursLeft).toBeGreaterThan(0);
    expect(twice.pendingCommands.some((c) => c.kind === 'SET_MODIFIER' && c.mod === 'efficiency' && c.key === 'RBANK')).toBe(true);
  });
});

describe('events', () => {
  it('fixes end persistent events', () => {
    const withEvents = MIDWEST_GAME;
    let r = startDay(newRun(MIDWEST, withEvents, 7), withEvents);
    r = {
      ...r,
      events: [
        {
          uid: 'RUNAWAY@0',
          defId: 'RUNAWAY',
          name: 'Runaway',
          startTick: 1,
          endTick: null,
          trigger: 'RUNAWAY_WORK',
          affects: ['ADHOC'],
          endCommands: [{ kind: 'SET_MODIFIER', mod: 'cpu', key: 'ADHOC', value: 1 }],
          started: false,
          ended: false,
        },
      ],
    };
    r = advance(r, MIDWEST, withEvents, 5);
    expect(r.sim.mods.cpu.ADHOC).toBe(10);
    r = requestChange(r, withEvents, { label: 'cancel', fixId: 'CANCEL_RUNAWAY' }).run;
    r = advance(r, MIDWEST, withEvents, 2);
    expect(r.sim.mods.cpu.ADHOC).toBeUndefined();
    expect(r.events[0]!.ended).toBe(true);
  });
});

describe('event cards resolved at start', () => {
  const sc = SCENARIOS.midwest!;
  const withCard = (defId: string, setting: 4 | 5 | 6 | 7) => {
    let r = startDay(newRun(sc, MIDWEST_GAME, 3), MIDWEST_GAME);
    r = { ...r, events: [], sim: applyCommands(r.sim, [{ kind: 'SET_CPC_CAPACITY', cpcId: 'CPCA', capacitySetting: setting }]) };
    const ev = { uid: `${defId}@0`, defId, name: defId, startTick: r.sim.tick, endTick: r.sim.tick + 2, trigger: 'HARDWARE_FAULT' as const, affects: [], endCommands: [], started: false, ended: false };
    return { ...r, events: [ev] };
  };

  it('Db2 Whisperer turns the silent REBIND regression into a DBA tip', () => {
    const tip = (perks: string[]) => advance({ ...withCard('REGRESSION', 7), perks }, sc, MIDWEST_GAME, 1).inbox.some((m) => m.from === 'DBA team');
    expect(tip([])).toBe(false);
    expect(tip(['DB2_WHISPERER'])).toBe(true);
  });

  it('a power cap drops one setting from the current one and restores that setting, not a fixed one', () => {
    let r = advance(withCard('POWER_CAP', 7), sc, MIDWEST_GAME, 1);
    expect(r.sim.config.cpcs[0]!.capacitySetting).toBe(6);
    r = advance(r, sc, MIDWEST_GAME, 3);
    expect(r.sim.config.cpcs[0]!.capacitySetting).toBe(7);
  }, 60_000);

  it('game rolls are keyed streams, so an extra player action does not reshuffle events or drafts', () => {
    const r = { ...newRun(sc, MIDWEST_GAME, 3), events: [] as RunState['events'] };
    const busier = requestChange(startDay(r, MIDWEST_GAME), MIDWEST_GAME, { label: 'extra', hardwareId: 'COD_CP', cpcId: r.sim.config.cpcs[0]!.id }).run;
    for (let day = 1; day < 40; day += 7) expect(drawEvents(busier, MIDWEST_GAME, day).events.slice(busier.events.length)).toEqual(drawEvents(r, MIDWEST_GAME, day).events.slice(r.events.length));
    const a = streamRng(3, 'draft', 5).float();
    expect(streamRng(3, 'draft', 5).float()).toBe(a);
    expect(streamRng(3, 'draft', 6).float()).not.toBe(a);
    expect(streamRng(4, 'draft', 5).float()).not.toBe(a);
  });

  it('a once-per-run card is not drawn again', () => {
    const r = { ...newRun(sc, MIDWEST_GAME, 3), events: [{ defId: 'NEW_APP_GOLIVE' }] } as unknown as RunState;
    for (let day = 9; day < 40; day++) expect(drawEvents(r, MIDWEST_GAME, day).events.filter((e) => e.defId === 'NEW_APP_GOLIVE')).toHaveLength(1);
  });

  it('a vendor price rise lifts MLC 8% until the price is negotiated back', () => {
    const game = MIDWEST_GAME;
    const def = game.events.find((e) => e.id === 'VENDOR_PRICE')!;
    let r = startDay(newRun(sc, game, 3), game);
    r = { ...r, events: [{ uid: 'VENDOR_PRICE@0', defId: def.id, name: def.name, startTick: 1, endTick: null, trigger: def.trigger, affects: def.affects, endCommands: def.end, started: false, ended: false }] };
    r = advance(r, sc, game, 5);
    expect(r.sim.cost.priceMult).toBe(1.08);
    r = requestChange(r, game, { label: 'negotiate', fixId: 'NEGOTIATE_MLC_PRICE' }).run;
    r = advance(r, sc, game, 2);
    expect(r.sim.cost.priceMult).toBe(1);
    expect(r.events.find((e) => e.defId === 'VENDOR_PRICE')!.ended).toBe(true);
  }, 60_000);

  it('a hiring freeze lowers engineer-hours for exactly five days and never below zero', () => {
    let r = { ...newRun(sc, MIDWEST_GAME, 3), events: [] as RunState['events'] };
    const def = MIDWEST_GAME.events.find((e) => e.id === 'HIRING_FREEZE')!;
    const drawn = drawEvents(r, { ...MIDWEST_GAME, events: [{ ...def, minDay: 0, weight: 1e6 }] }, 13);
    expect(drawn.events.some((e) => e.defId === 'HIRING_FREEZE')).toBe(true);
    expect(drawn.hoursLeft).toBe(r.baseHours - 2);
    expect(drawn.bonusHours).toEqual([{ hours: -2, untilDay: 18 }]);
    // an active freeze is not drawn again on top of itself
    const again = drawEvents(drawn, { ...MIDWEST_GAME, events: [{ ...def, minDay: 0, weight: 1e6 }] }, 14);
    expect(again.bonusHours).toHaveLength(1);
    r = { ...drawn, baseHours: 1 };
    expect(Math.max(0, r.baseHours + r.bonusHours.reduce((a, b) => a + b.hours, 0))).toBe(0);
  });
});

describe('regulator audit of unclassified work', () => {
  const sc = SCENARIOS.midwest!;
  const row = (lparId: string, serviceClass: string, applCpPct: number) => ({ lparId, serviceClass, scKey: `${serviceClass}.1`, applCpPct }) as WlmRecord;
  const iv = (endTick: number, wlm: WlmRecord[]) => ({ endTick, wlm }) as unknown as RmfInterval;

  it('sysotherByLpar peaks per LPAR, sums periods, and ignores *PLEX, other classes and other days', () => {
    const out = sysotherByLpar(
      [
        iv(100, [row('PROD1', 'SYSOTHER', 0.4), row('PROD1', 'SYSOTHER', 0.2), row('*PLEX', 'SYSOTHER', 9), row('PROD1', 'ONLHI', 30)]),
        iv(200, [row('PROD1', 'SYSOTHER', 0.3), row('PROD2', 'SYSOTHER', 0.05)]),
        iv(TICKS_PER_DAY + 5, [row('PROD1', 'SYSOTHER', 7)]),
      ],
      0,
    );
    expect(out.PROD1).toBeCloseTo(0.6);
    expect(out.PROD2).toBeCloseTo(0.05);
    expect(out['*PLEX']).toBeUndefined();
  });

  // Start one tick before the day boundary so advance runs endDay on its next tick.
  const atBoundary = (sysother: number, audit = true) => {
    let r = startDay(newRun(sc, MIDWEST_GAME, 3), MIDWEST_GAME);
    const ev = { uid: 'AUDIT_UNCLASSIFIED@0', defId: 'AUDIT_UNCLASSIFIED', name: 'Audit', startTick: 0, endTick: null, trigger: 'POLICY' as const, affects: [], endCommands: [], started: true, ended: false };
    const rmf = { ...r.sim.rmf, intervals: [iv(TICKS_PER_DAY - 6, sysother > 0 ? [row('PROD1', 'SYSOTHER', sysother)] : [row('PROD1', 'ONLHI', 20)])] };
    r = { ...r, events: audit ? [ev] : [], trust: { ...r.trust, Regulator: 50 }, sim: { ...r.sim, tick: TICKS_PER_DAY - 1, rmf } };
    return advance(r, sc, MIDWEST_GAME, 1);
  };

  it('costs 5 Regulator trust with a finding when SYSOTHER ran', () => {
    const r = atBoundary(2.5);
    expect(r.trust.Regulator).toBeCloseTo(atBoundary(2.5, false).trust.Regulator! - 5);
    expect(r.inbox.some((m) => m.from === 'Regulator' && m.body.includes('SYSOTHER on PROD1'))).toBe(true);
  }, 60_000);

  it('gives +1 Regulator trust when nothing ran in SYSOTHER', () => {
    const r = atBoundary(0);
    expect(r.trust.Regulator).toBeCloseTo(atBoundary(0, false).trust.Regulator! + 1);
    expect(r.inbox.some((m) => m.from === 'Regulator' && m.body.includes('no findings'))).toBe(true);
  }, 60_000);
});

describe('endless mode', () => {
  // One-day quarter, started one tick before the boundary so the next tick ends the day.
  const atEnd = (r: RunState) => advance({ ...r, sim: { ...r.sim, tick: (r.day + 1) * TICKS_PER_DAY - 1 } }, MIDWEST, content, 1);

  it('continues past VICTORY with fresh capex, and the run still counts as a win', () => {
    let r = atEnd(startDay({ ...fresh(), maxDays: 1 }, content));
    expect(r.phase).toBe('VICTORY');
    const capex = r.capexRemaining;
    r = continueEndless(r, content);
    expect(r.phase).toBe('REVIEW');
    expect(r.endlessFromDay).toBe(0);
    expect(r.endReason).toBeNull();
    expect(r.capexRemaining).toBe(capex + content.capexQuarter);
    expect(continueEndless(r, content)).toBe(r);
    r = chooseDraft(r, content, null);
    expect(r.day).toBe(1);
    // Skipped ticks mean no batch ran, so clear yesterday's miss to stay clear of the two-miss rule.
    r = atEnd(startDay({ ...r, consecutiveBatchMisses: 0 }, content));
    expect(r.phase).toBe('REVIEW');
    const rep = endReport(r, 50);
    expect(rep.victory).toBe(true);
    expect(rep.endlessDays).toBe(1);
  }, 120_000);
});

describe('draft perks', () => {
  const review = (r: RunState): RunState => ({ ...r, phase: 'REVIEW' });

  it('weekend push adds hours for one day and fatigue', () => {
    const r = chooseDraft(review(fresh()), content, 'OVERTIME_PUSH');
    expect(r.hoursLeft).toBe(fresh().hoursLeft + 3);
    expect(r.fatigue).toBe(15);
    expect(r.bonusHours).toEqual([{ hours: 3, untilDay: 2 }]);
  });

  it('friend at the vendor brings long-lead hardware a day sooner', () => {
    const r = chooseDraft(review(fresh()), content, 'VENDOR_FRIEND');
    const out = requestChange(r, content, { label: 'zIIP', hardwareId: 'ADD_ZIIP' });
    expect(out.run.changes[0]!.activateDay).toBe(r.day + 3);
  });

  it('vendor tool trial lends a tool for 3 days unless bought', () => {
    const base = fresh();
    const t = trialTool(base)!;
    expect(t.overhead).toBeNull();
    const r = chooseDraft(review(base), content, 'TOOL_TRIAL');
    expect(r.tools).toContain(t.id);
    expect(r.toolTrials).toEqual([{ id: t.id, untilDay: base.day + 4 }]);
    expect(expireToolTrials(r, base.day + 2).tools).toContain(t.id);
    const gone = expireToolTrials(r, base.day + 3);
    expect(gone.tools).not.toContain(t.id);
    expect(gone.toolTrials).toEqual([]);
    const bought = buyTool({ ...r, insight: 100 }, MIDWEST, t.id);
    expect(bought.ok).toBe(true);
    expect(bought.run.tools.filter((x) => x === t.id)).toHaveLength(1);
    expect(expireToolTrials(bought.run, base.day + 3).tools).toContain(t.id);
  });

  it('zIIP promotion discounts zIIP capex only', () => {
    const r = chooseDraft(review(fresh()), content, 'ZIIP_PROMO');
    const zi = requestChange(r, content, { label: 'zIIP', hardwareId: 'ADD_ZIIP' });
    expect(r.capexRemaining - zi.run.capexRemaining).toBe(Math.round(hardwareItem('ADD_ZIIP')!.capex * 0.75));
    const cp = requestChange(r, content, { label: 'CP', hardwareId: 'PERM_CP' });
    expect(r.capexRemaining - cp.run.capexRemaining).toBe(hardwareItem('PERM_CP')!.capex);
  });

  it('WLM course halves policy activation hours only', () => {
    const r = chooseDraft(review(fresh()), content, 'WLM_COURSE');
    expect(r.perks).toContain('WLM_COURSE');
    const cmds = [{ kind: 'ACTIVATE_POLICY' }, { kind: 'SET_WEIGHT' }] as unknown as Parameters<typeof hoursFor>[0];
    expect(hoursFor(cmds, r.perks)).toBe(hoursFor(cmds, []) - 0.75);
  });

  it('well connected makes asking around free', () => {
    const r = chooseDraft(review(fresh()), content, 'WELL_CONNECTED');
    const out = askAround(r, 'CALENDAR', null, MIDWEST);
    expect(out.ok).toBe(true);
    expect(out.run.hoursLeft).toBe(r.hoursLeft);
    expect(inquiriesView(r, MIDWEST).topics.every((t) => t.hours === 0)).toBe(true);
  });

  it('night desk pact: two more hours every day, riskier changes', () => {
    const base = fresh();
    const r = chooseDraft(review(base), content, 'NIGHT_DESK');
    expect(r.hoursLeft).toBe(base.hoursLeft + 2);
    expect(failRiskFor(0, r.perks)).toBeCloseTo(failRiskFor(0, []) * 1.3);
    expect(r.bonusHours.every((b) => b.untilDay > 1000)).toBe(true);
  });

  it('capex-for-opex pact: capex now, smaller opex budget', () => {
    const base = fresh();
    const r = chooseDraft(review(base), content, 'BUDGET_SWAP');
    expect(r.capexRemaining).toBe(base.capexRemaining + 500_000);
    expect(opexBudgetFor(r.opexBudgetMonthly, r.perks)).toBeCloseTo(base.opexBudgetMonthly * 0.9);
  });
});
