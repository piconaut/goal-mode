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

/** The acquired bank's API (SPEC story beat MERGER) arrives unclassified in SYSOTHER; give it a goal. */
function classifyMerger(run: RunState, c: GameContent): RunState {
  if (!run.sim.workloads.some((w) => w.id === 'ACQBANK')) return run;
  const def = structuredClone(run.sim.wlm.definition);
  if (def.classes.some((x) => x.id === 'ACQAPI')) return run;
  def.classes.push({ id: 'ACQAPI', description: 'Acquired bank API', periods: [{ goal: { kind: 'PCT', pct: 90, rtSec: 0.5 }, importance: 2, durationSu: null }], cpuCritical: false, storageCritical: false, resourceGroup: null, honorPriority: true });
  let omvs = def.subsystems.find((x) => x.subsystem === 'OMVS');
  if (!omvs) def.subsystems.push((omvs = { subsystem: 'OMVS', defaultServiceClass: null, defaultReportClass: null, rules: [] }));
  omvs.rules = [{ qualifier: 'UI', pattern: 'ACQSVC', serviceClass: 'ACQAPI', reportClass: null, children: [] }, ...omvs.rules];
  return requestChange(run, c, { label: 'Classify acquired bank API', commands: [{ kind: 'ACTIVATE_POLICY', definition: def }] }).run;
}

/** Critical batch is a single-threaded chain: once it trends toward the deadline only faster engines help. */
const BATCH_MARGIN_SEC = 45 * 60;
function batchCapacity(run: RunState, c: GameContent): RunState {
  const end = run.reports.at(-1)?.batch?.criticalEndSec;
  if (end == null || end < run.batchDeadlineSec - BATCH_MARGIN_SEC) return run;
  if (run.changes.some((x) => x.label === 'Capacity setting +1' && x.status !== 'FAILED')) return run;
  return requestChange(run, c, { label: 'Capacity setting +1', hardwareId: 'CAP_SETTING_UP' }).run;
}

function reactBriefing(r: RunState, c: GameContent): RunState {
  return batchCapacity(classifyMerger(r, c), c);
}

/** After a CF failure XES leaves rebuilt structures where they landed; put them back on their preferred CF. */
function moveStructuresHome(run: RunState, c: GameContent): RunState {
  const cfs = run.sim.config.cfs;
  const pending = new Set(run.changes.filter((x) => x.status === 'PLANNED' || x.activateDay === run.day).flatMap((x) => x.commands).filter((x) => x.kind === 'MOVE_STRUCTURE').map((x) => x.name));
  const moves = run.sim.config.cfStructures
    .filter((st) => {
      const home = st.prefList?.[0];
      return home && st.cfLparId !== home && !pending.has(st.name) && cfs.some((cf) => cf.lparId === home && !cf.failed);
    })
    .map((st) => ({ kind: 'MOVE_STRUCTURE' as const, name: st.name, cfLparId: st.prefList![0]! }));
  if (moves.length === 0) return run;
  return requestChange(run, c, { label: 'Move structures back to their preferred CF', commands: moves }).run;
}

const textbook: Strategy = {
  briefing: (r, _s, c) => {
    if (r.day !== 0) return reactBriefing(r, c);
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
    let run = moveStructuresHome(r, c);
    for (const j of run.sim.batch.jobs.filter((x) => x.status === 'ABENDED' && x.def.critical)) {
      run = requestChange(run, c, { label: `Restart ${j.def.name}`, commands: [{ kind: 'RESTART_JOB', day: j.day, name: j.def.name }] }).run;
    }
    for (const inc of run.incidents.filter((i) => i.endTick === null)) {
      const fixId = FIX_BY_TRIGGER[inc.truth.trigger];
      const active = run.events.some((e) => e.started && !e.ended && e.trigger === inc.truth.trigger);
      if (fixId && active) run = requestChange(run, c, { label: `Fix ${fixId}`, fixId }).run;
    }
    // The REORG overrun raises no SLA incident, only batch stretch (IOSQ on LCU 21): terminate it on sight.
    if (run.events.some((e) => e.defId === 'REORG_OVERRUN' && e.started && !e.ended)) {
      run = requestChange(run, c, { label: 'Fix TERM_UTILITY', fixId: 'TERM_UTILITY' }).run;
    }
    return run;
  },
  review: passive.review,
};

STRATEGIES.textbook = textbook;


// ---------------------------------------------------------------------------
// Expert: textbook plus capacity planning ahead of need. Buys the faster capacity setting on day 1
// (critical batch is a serial chain and batch volumes grow every night) instead of waiting for the
// deadline to bite.
const expert: Strategy = {
  briefing: (r, s, c) => {
    let run = textbook.briefing(r, s, c);
    if (run.day === 0) run = requestChange(run, c, { label: 'Capacity setting +1', hardwareId: 'CAP_SETTING_UP' }).run;
    return run;
  },
  hourly: textbook.hourly,
  review: passive.review,
};
STRATEGIES.expert = expert;

// ---------------------------------------------------------------------------
// Spend-to-win: textbook plus a fresh On/Off CoD CP every morning (each lasts three days). SLAs should hold,
// but the temporary-capacity opex and the higher MLC peak should trip the budget (SPEC §16).
const spendToWin: Strategy = {
  briefing: (r, s, c) => requestChange(textbook.briefing(r, s, c), c, { label: 'On/Off CoD +1 CP', hardwareId: 'COD_CP' }).run,
  hourly: textbook.hourly,
  review: passive.review,
};
STRATEGIES.spendtowin = spendToWin;
