import { MIDWEST_GAME } from '../../src/content/game-midwest';
import { MIDWEST } from '../../src/content/scenarios';
import { advance, chooseDraft, newRun, requestChange, startDay, submitRca } from '../../src/game/run';
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
    expect(r.trust.Retail).toBeLessThan(before);
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
