// Bot strategies: how a bot behaves in each phase.

import type { GameContent } from '../src/game/run';
import { chooseDraft, submitRca } from '../src/game/run';
import type { RunState } from '../src/game/types';
import type { Scenario } from '../src/sim/core/scenario';

export interface Strategy {
  briefing(run: RunState, scenario: Scenario, content: GameContent): RunState;
  hourly(run: RunState, scenario: Scenario, content: GameContent): RunState;
  review(run: RunState, scenario: Scenario, content: GameContent): RunState;
}

const passive: Strategy = {
  briefing: (r) => r,
  hourly: (r) => r,
  review: (r, _s, c) => chooseDraft(r, c, r.draft?.[0]?.id ?? null),
};

/** Does nothing but answers RCAs perfectly (upper bound on RCA rewards). */
const oracleRca: Strategy = {
  ...passive,
  review: (r, s, c) => {
    let run = r;
    for (const i of run.incidents.filter((x) => !x.rca)) run = submitRca(run, i.id, i.truth.mechanism, i.truth.trigger);
    return passive.review(run, s, c);
  },
};

export const STRATEGIES: Record<string, Strategy> = { donothing: passive, oraclerca: oracleRca };

// ---------------------------------------------------------------------------
// Textbook: on day 1 fix the known starting flaws F1–F11 with well-known settings
// (SPEC §13), then behave like a competent operator: restart abended critical jobs and
// apply the fix for an event once an incident points at it.

import { BASEPOL } from '../src/content/wlm/basepol';
import { requestChange } from '../src/game/run';
import type { ServiceDefinition } from '../src/sim/wlm/types';

export function textbookPolicy(): ServiceDefinition {
  const def = structuredClone(BASEPOL);
  def.policyName = 'TEXTBOOK';
  const cls = (id: string) => def.classes.find((c) => c.id === id)!;
  // F2: card authorisation gets its own CPU-critical class with its real SLA.
  def.classes.push({ id: 'CARDS', description: 'Card authorisation', periods: [{ goal: { kind: 'PCT', pct: 99, rtSec: 0.1 }, importance: 1, durationSu: null }], cpuCritical: true, storageCritical: false, resourceGroup: null, honorPriority: true });
  // F3: BI ad-hoc out of the mobile class.
  def.classes.push({ id: 'DDFBI', description: 'BI ad-hoc DDF', periods: [{ goal: { kind: 'VEL', velocity: 20 }, importance: 5, durationSu: 20000 }, { goal: { kind: 'DISC' }, importance: 5, durationSu: null }], cpuCritical: false, storageCritical: false, resourceGroup: null, honorPriority: true });
  // F5: developers down to importance 3.
  cls('TSO').periods[0]!.importance = 3;
  // F4: non-critical batch below critical batch.
  cls('BATCHPRD').periods[0]!.importance = 5;
  const stc = def.subsystems.find((x) => x.subsystem === 'STC')!;
  // F1: Db2 address spaces in the high STC class (IRLM stays in SYSSTC).
  stc.rules = stc.rules.map((r) => (r.pattern === 'DB*' ? { ...r, serviceClass: 'STCHI' } : r));
  const cics = def.subsystems.find((x) => x.subsystem === 'CICS')!;
  cics.rules = cics.rules.map((r) => (r.pattern === 'AUTH*' ? { ...r, serviceClass: 'CARDS' } : r));
  const ddf = def.subsystems.find((x) => x.subsystem === 'DDF')!;
  ddf.rules = [{ qualifier: 'UI', pattern: 'BIUSER', serviceClass: 'DDFBI', reportClass: null, children: [] }];
  const jes = def.subsystems.find((x) => x.subsystem === 'JES')!;
  jes.rules = [...['STL*', 'CRD*', 'GLF*', 'STM*'].map((p) => ({ qualifier: 'TN' as const, pattern: p, serviceClass: 'BATCHHI', reportClass: null, children: [] })), ...jes.rules];
  return def;
}

const FIX_BY_TRIGGER: Partial<Record<string, string>> = {
  RUNAWAY_WORK: 'CANCEL_RUNAWAY',
  ACCESS_PATH_REGRESSION: 'REBIND_REVERT',
};

const textbook: Strategy = {
  briefing: (r, _s, c) => {
    if (r.day !== 0) return r;
    let run = r;
    const plan = (label: string, commands: import('../src/sim/core/commands').Command[]) => {
      const out = requestChange(run, c, { label, commands });
      run = out.run;
    };
    plan('Textbook WLM policy (F1–F5)', [{ kind: 'ACTIVATE_POLICY', definition: textbookPolicy() }]);
    plan('zIIP online on PROD2 (F7)', [{ kind: 'SET_LOGICAL', lparId: 'PROD2', pool: 'ZIIP', logical: 1 }]);
    plan('CF02 thin interrupts (F8)', [{ kind: 'SET_CF', lparId: 'CF02', thinInterrupts: true }]);
    plan('Weights 565/335/65/35 (F10)', [
      { kind: 'SET_WEIGHT', lparId: 'PROD1', pool: 'CP', weight: 565 },
      { kind: 'SET_WEIGHT', lparId: 'PROD2', pool: 'CP', weight: 335 },
      { kind: 'SET_WEIGHT', lparId: 'DEVT', pool: 'CP', weight: 65 },
      { kind: 'SET_WEIGHT', lparId: 'SYSP', pool: 'CP', weight: 35 },
    ]);
    plan('DEVT soft cap 60 MSU (F9)', [{ kind: 'SET_DEFINED_CAPACITY', lparId: 'DEVT', msu: 60 }]);
    plan('RMF 15-minute interval (F11)', [{ kind: 'SET_RMF_INTERVAL', minutes: 15 }]);
    return run;
  },
  hourly: (r, _s, c) => {
    let run = r;
    for (const j of run.sim.batch.jobs.filter((x) => x.status === 'ABENDED' && x.def.critical)) {
      run = requestChange(run, c, { label: `Restart ${j.def.name}`, commands: [{ kind: 'RESTART_JOB', day: j.day, name: j.def.name }] }).run;
    }
    for (const inc of run.incidents.filter((i) => i.endTick === null)) {
      const fixId = FIX_BY_TRIGGER[inc.truth.trigger];
      const active = run.events.some((e) => e.started && !e.ended && e.trigger === inc.truth.trigger);
      if (fixId && active) run = requestChange(run, c, { label: `Fix ${fixId}`, fixId }).run;
    }
    return run;
  },
  review: passive.review,
};

STRATEGIES.textbook = textbook;
