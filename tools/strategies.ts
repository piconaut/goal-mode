// Bot strategies: how a bot behaves in each phase.

import type { GameContent } from '../src/game/run';
import { chooseDraft, submitRca } from '../src/game/run';
import { cicsStorageReach, regionKey } from '../src/game/footprint';
import { requestOperation } from '../src/game/operations';
import { operationsForEvent } from '../src/game/run/eventEffects';
import { requestBackout } from '../src/game/run/otherTeamChanges';
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
import { REVPOL } from '../src/content/wlm/revpol';
import { GATEWAY_TRAFFIC_CARDS } from '../src/content/operations';
import { HBPOL } from '../src/content/wlm/hbpol';
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

// Keep the cards the textbook strategy reacts to when an incident points at them (RT-09).
const OBVIOUS_FIX_CARD_IDS = new Set([
  'RUNAWAY',
  'REGRESSION',
  'XLOG_LOOP',
  'RUNAWAY_COMPLIANCE',
  'EFILE_REGRESSION',
]);

/** Work that arrives with no classification rule and lands in SYSOTHER (the MERGER story beat, the
 * NEW_APP_GOLIVE card): give each its own goal class, all in one policy change so neither overwrites the other. */
const NEW_ARRIVALS = [
  { workloadId: 'ACQBANK', classId: 'ACQAPI', description: 'Acquired bank API', userid: 'ACQSVC' },
  { workloadId: 'BOOKING', classId: 'BOOKAPI', description: 'Branch booking', userid: 'BOOKSVC' },
  { workloadId: 'PREFILL', classId: 'PFILAPI', description: 'Pre-filled returns', userid: 'PFILSVC' },
];
function classifyNewArrivals(run: RunState, c: GameContent): RunState {
  const def = structuredClone(run.sim.wlm.definition);
  const due = NEW_ARRIVALS.filter((a) => run.sim.workloads.some((w) => w.id === a.workloadId) && !def.classes.some((x) => x.id === a.classId));
  if (due.length === 0) return run;
  let omvs = def.subsystems.find((x) => x.subsystem === 'OMVS');
  if (!omvs) def.subsystems.push((omvs = { subsystem: 'OMVS', defaultServiceClass: null, defaultReportClass: null, rules: [] }));
  for (const a of due) {
    def.classes.push({ id: a.classId, description: a.description, periods: [{ goal: { kind: 'PCT', pct: 90, rtSec: 0.5 }, importance: 2, durationSu: null }], cpuCritical: false, storageCritical: false, resourceGroup: null, honorPriority: true });
    omvs.rules = [{ qualifier: 'UI', pattern: a.userid, serviceClass: a.classId, reportClass: null, children: [] }, ...omvs.rules];
  }
  return requestChange(run, c, { label: `Classify ${due.map((a) => a.description).join(', ')}`, commands: [{ kind: 'ACTIVATE_POLICY', definition: def }] }).run;
}

/** Critical batch is a single-threaded chain: once it trends toward the deadline only faster engines help. */
const BATCH_MARGIN_SEC = 45 * 60;
function batchCapacity(run: RunState, c: GameContent): RunState {
  const end = run.reports.at(-1)?.batch?.criticalEndSec;
  if (end == null || end < run.batchDeadlineSec - BATCH_MARGIN_SEC) return run;
  if (run.changes.some((x) => x.label === 'Capacity setting +1' && x.status !== 'FAILED')) return run;
  return capSettingUp(run, c);
}

/** Capacity setting +1 on the first CPC that is not already at the top setting. */
function capSettingUp(run: RunState, c: GameContent): RunState {
  const cpc = run.sim.config.cpcs.find((x) => x.capacitySetting < 7);
  return cpc ? requestChange(run, c, { label: 'Capacity setting +1', hardwareId: 'CAP_SETTING_UP', cpcId: cpc.id }).run : run;
}

function reactBriefing(r: RunState, c: GameContent): RunState {
  return batchCapacity(classifyNewArrivals(r, c), c);
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

/** State Revenue Agency: G1 e-filing gets a response-time goal and analytics its own low class; G2 the refund
 * run, not compliance analytics, is high batch; G3 the queue managers get a rule. */
export function revenueTextbookPolicy(): ServiceDefinition {
  const def = structuredClone(REVPOL);
  def.policyName = 'TEXTBOOK';
  def.classes.push({ id: 'EFILE', description: 'Online tax filing', periods: [{ goal: { kind: 'PCT', pct: 95, rtSec: 0.5 }, importance: 2, durationSu: null }], cpuCritical: false, storageCritical: false, resourceGroup: null, honorPriority: true });
  def.classes.push({ id: 'DDFBI', description: 'Compliance analytics DDF', periods: [{ goal: { kind: 'VEL', velocity: 20 }, importance: 5, durationSu: 20000 }, { goal: { kind: 'DISC' }, importance: 5, durationSu: null }], cpuCritical: false, storageCritical: false, resourceGroup: null, honorPriority: true });
  const stc = def.subsystems.find((x) => x.subsystem === 'STC')!;
  stc.rules = [...stc.rules, { qualifier: 'TN', pattern: 'MQ*', serviceClass: 'STCHI', reportClass: null, children: [] }];
  const ddf = def.subsystems.find((x) => x.subsystem === 'DDF')!;
  ddf.rules = [
    { qualifier: 'UI', pattern: 'EFILAPI', serviceClass: 'EFILE', reportClass: null, children: [] },
    { qualifier: 'UI', pattern: 'CMPUSER', serviceClass: 'DDFBI', reportClass: null, children: [] },
  ];
  const jes = def.subsystems.find((x) => x.subsystem === 'JES')!;
  jes.rules = [...jes.rules.filter((x) => x.pattern !== 'CMP*'), ...['REF*', 'EMP*', 'NTC*'].map((p) => ({ qualifier: 'TN' as const, pattern: p, serviceClass: 'BATCHHI', reportClass: null, children: [] }))];
  return def;
}

/** Day 0: the known-good fixes for the State Revenue Agency's planted flaws (SPEC §13.4). */
function revenueDay0(r: RunState, c: GameContent): RunState {
  let run = r;
  const plan = (label: string, commands: import('../src/sim/core/commands').Command[]) => {
    run = requestChange(run, c, { label, commands }).run;
  };
  plan('Textbook WLM policy (G1–G3)', [{ kind: 'ACTIVATE_POLICY', definition: revenueTextbookPolicy() }]);
  plan('PROD1 soft cap 560 MSU (H1)', [{ kind: 'SET_DEFINED_CAPACITY', lparId: 'PROD1', msu: 560 }]);
  plan('IIPHONORPRIORITY=YES on PROD2 (H2)', [{ kind: 'SET_IEAOPT', lparId: 'PROD2', changes: { iipHonorPriority: true } }]);
  return run;
}

/** Harbourline: MKTORD's average goal (a mean hides the burst tail) becomes a percentile goal. */
export function harbourlineTextbookPolicy(): ServiceDefinition {
  const def = structuredClone(HBPOL);
  def.policyName = 'TEXTBOOK';
  def.classes.find((x) => x.id === 'MKTORD')!.periods = [{ goal: { kind: 'PCT', pct: 90, rtSec: 0.2 }, importance: 1, durationSu: null }];
  return def;
}

/** Day 0: the known-good fixes for Harbourline's planted flaws B1–B4 and the PRDA absolute cap (SPEC §13.5). */
function harbourlineDay0(r: RunState, c: GameContent): RunState {
  let run = r;
  const plan = (label: string, commands: import('../src/sim/core/commands').Command[]) => {
    run = requestChange(run, c, { label, commands }).run;
  };
  const cpsm = { method: 'CPSM_GOAL' as const, abendThreshFrac: 0.1, abendCritFrac: 0.2, quiesced: [] };
  plan('Textbook WLM policy (MKTORD percentile goal)', [{ kind: 'ACTIVATE_POLICY', definition: harbourlineTextbookPolicy() }]);
  plan('MKTQRY on SERVERWLM weights (B1, B3)', [{ kind: 'SET_ROUTING_POLICY', workloadId: 'MKTQRY', policy: { method: 'WLM', distMethod: 'SERVERWLM' } }]);
  plan('MOBILE SERVERWLM weights (B3)', [{ kind: 'SET_ROUTING_POLICY', workloadId: 'MOBILE', policy: { method: 'WLM', distMethod: 'SERVERWLM' } }]);
  plan('CPSM ABENDTHRESH/ABENDCRIT (B2)', [
    { kind: 'SET_ROUTING_POLICY', workloadId: 'MKTORD', policy: cpsm },
    { kind: 'SET_ROUTING_POLICY', workloadId: 'CARDS', policy: cpsm },
  ]);
  plan('Payments affinity to CPC1 (B4)', [{ kind: 'SET_ROUTING', workloadId: 'PAYMENTS', routing: { PRDA: 0.35, PRDB: 0.35, PRDC: 0.15, PRDD: 0.15 } }]);
  plan('Remove the PRDA absolute cap', [{ kind: 'SET_ABSOLUTE_CAP', lparId: 'PRDA', engines: null }]);
  plan('Threadsafe AORs (QR 30 %) for the market-open bursts', [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ kind: 'SET_CICS' as const, name: `CICSAOR${n}`, qrFrac: 0.3 })));
  return run;
}

/** Day 0: the known-good fixes for the planted flaws F1–F11 (SPEC §13.3). */
function textbookDay0(r: RunState, c: GameContent): RunState {
  if (r.scenarioId === 'revenue') return revenueDay0(r, c);
  if (r.scenarioId === 'harbourline') return harbourlineDay0(r, c);
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
}

/** Operate on the card's known target. PT-55 moves target selection to the reports. */
function remedy(run: RunState, scenario: Scenario, content: GameContent, event: RunState['events'][number]): RunState {
  const def = content.events.find((d) => d.id === event.defId);
  if (!def || !event.started || event.ended || (event.endTick !== null && event.endTick <= run.sim.tick)) return run;
  for (const operation of operationsForEvent(run, scenario, def, event)) {
    if (operation.kind === 'BACKOUT_CHANGE') {
      run = requestBackout(run, content, operation.changeId).run;
      continue;
    }
    if (operation.kind === 'HOLD_HSM_RECALL' && run.sim.hsmRecalls?.heldSinceTick != null) continue;
    if (operation.kind === 'RECYCLE_CICS' && def.relief === 'CICS_STORAGE') {
      const pressure = cicsStorageReach(operation.targets.map((target) => target.name), run.sim.last.lpars);
      const targets = operation.targets.filter((target) => pressure.includes(regionKey(target.name, target.lparId)) &&
        !run.sim.cicsRecycles?.some((r) => r.name === target.name && r.lparId === target.lparId && r.restartTick > run.sim.tick));
      if (targets.length > 0) run = requestOperation(run, scenario, content, { ...operation, targets }).run;
      continue;
    }
    run = requestOperation(run, scenario, content, operation).run;
  }
  return run;
}

/** Restart abended critical jobs and react to open incidents the operator recognizes. */
function obviousHourly(r: RunState, scenario: Scenario, content: GameContent): RunState {
  let run = r;
  for (const j of run.sim.batch.jobs.filter((x) => x.status === 'ABENDED' && x.def.critical)) {
    run = requestChange(run, content, { label: `Restart ${j.def.name}`, commands: [{ kind: 'RESTART_JOB', day: j.day, name: j.def.name }] }).run;
  }
  for (const inc of run.incidents.filter((i) => i.endTick === null)) {
    const active = run.events.find((e) => e.started && !e.ended && e.trigger === inc.truth.trigger && OBVIOUS_FIX_CARD_IDS.has(e.defId));
    if (active) run = remedy(run, scenario, content, active);
  }
  return run;
}

// Textbook fixes the planted flaws on day 0 and reacts to abends and SLA incidents.
const textbook: Strategy = {
  briefing: (r, _s, c) => (r.day === 0 ? textbookDay0(r, c) : r),
  hourly: obviousHourly,
  review: passive.review,
};

const ON_SIGHT_CARDS = new Set(['REORG_OVERRUN', 'MONITOR_CREEP', 'SHADOW_IT', 'QR_RELEASE', 'HSM_RECALL_STORM', 'CICS_SOS']);
const HARBOURLINE_ON_SIGHT_CARDS = new Set(['BOT_ATTACK', 'RETRY_STORM', 'ZIIP_LOSS']);

// The bot knows the storm's end from the card. PT-55 will release protection from report data.
function releaseProtection(run: RunState, scenario: Scenario, content: GameContent): RunState {
  const active = run.events.filter((e) => e.started && !e.ended && (e.endTick === null || e.endTick > run.sim.tick));
  if (run.sim.hsmRecalls?.heldSinceTick != null && !active.some((e) => e.defId === 'HSM_RECALL_STORM')) {
    run = requestOperation(run, scenario, content, { kind: 'HOLD_HSM_RECALL', held: false }).run;
  }
  for (const workloadId of Object.keys(run.sim.gatewayModes ?? {})) {
    const storm = active.some((e) => GATEWAY_TRAFFIC_CARDS[e.defId] &&
      content.events.some((d) => d.id === e.defId && d.endedBy?.kind === 'SET_GATEWAY' && d.endedBy.workloadId === workloadId));
    if (!storm) run = requestOperation(run, scenario, content, { kind: 'SET_GATEWAY', workloadId, mode: null }).run;
  }
  return run;
}

// Fixer also reacts to cards whose clues show trouble before an SLA page.
const fixer: Strategy = {
  briefing: (r, _s, c) => (r.day === 0 ? textbookDay0(r, c) : reactBriefing(r, c)),
  hourly: (r, scenario, content) => {
    let run = obviousHourly(releaseProtection(moveStructuresHome(r, content), scenario, content), scenario, content);
    const cards = scenario.id === 'harbourline' ? [...ON_SIGHT_CARDS, ...HARBOURLINE_ON_SIGHT_CARDS] : ON_SIGHT_CARDS;
    for (const id of cards) {
      const event = run.events.find((e) => e.defId === id && e.started && !e.ended);
      if (event) run = remedy(run, scenario, content, event);
    }
    return run;
  },
  review: passive.review,
};

STRATEGIES.textbook = textbook;


// Limits the expert raises toward; well inside the products' ranges (MAXDBAT up to 19999, MXT up to 2000).
const MAXDBAT_CEILING = 2000;
const MXT_CEILING = 1000;
const QR_FLOOR_FRAC = 0.1;

/** Yesterday's incidents with no event behind them (trigger POLICY; RT-09 moved the five change cards off POLICY,
 * so a card-caused CHANGE_REGRESSION incident is deliberately not tuned) are the analyst's to tune away, read
 * from the report each mechanism points at: DBAT or MXT queueing (THREAD_LIMIT) raises MAXDBAT or MXT on
 * the images the workload runs on, and QR TCB saturation moves more of its AORs' work off QR.
 * CPU_PRIORITY is left alone: raising importance traded one workload's incidents for another's in trials. */
function tunePolicyIncidents(run: RunState, s: Scenario, c: GameContent): RunState {
  const yday = run.incidents.filter((i) => i.day === run.day - 1 && i.truth.trigger === 'POLICY');
  if (yday.length === 0) return run;
  const cfg = run.sim.config;
  const commands: import('../src/sim/core/commands').Command[] = [];
  const done = new Set<string>();
  const lparsOf = (w: Scenario['workloads'][number]) => Object.entries(run.sim.routing[w.id] ?? w.routing).filter(([, f]) => f > 0).map(([l]) => l);
  for (const inc of yday) {
    const w = s.workloads.find((x) => x.id === inc.workloadId);
    if (!w) continue;
    const lpars = lparsOf(w);
    if (inc.truth.mechanism === 'THREAD_LIMIT') {
      if (w.subsystem === 'DDF') {
        for (const d of cfg.db2.filter((x) => lpars.includes(x.lparId) && x.maxDbat < MAXDBAT_CEILING && !done.has(x.ssid))) {
          done.add(d.ssid);
          commands.push({ kind: 'SET_DB2', ssid: d.ssid, maxDbat: Math.min(MAXDBAT_CEILING, Math.round(d.maxDbat * 1.5)) });
        }
      } else if (w.subsystem === 'CICS') {
        for (const a of cfg.cics.filter((x) => lpars.includes(x.lparId) && x.maxTasks < MXT_CEILING && !done.has(`${x.name}:mxt`))) {
          done.add(`${a.name}:mxt`);
          commands.push({ kind: 'SET_CICS', name: a.name, maxTasks: Math.min(MXT_CEILING, Math.round(a.maxTasks * 1.5)) });
        }
      }
    } else if (inc.truth.mechanism === 'QR_TCB') {
      for (const a of cfg.cics.filter((x) => lpars.includes(x.lparId) && x.qrFrac > QR_FLOOR_FRAC + 1e-9 && !done.has(`${x.name}:qr`))) {
        done.add(`${a.name}:qr`);
        commands.push({ kind: 'SET_CICS', name: a.name, qrFrac: Math.max(QR_FLOOR_FRAC, a.qrFrac / 2) });
      }
    }
  }
  if (commands.length === 0) return run;
  return requestChange(run, c, { label: 'Raise thread limits / threadsafe AORs for yesterday’s incidents', commands }).run;
}

/** Distinct days with CPU_CAPACITY incidents on a CPC, within this many days, that justify a permanent CP. */
const PERM_CP_WINDOW_DAYS = 7;
const PERM_CP_MIN_DAYS = 2;
/** Capacity planning with capex: repeated no-donor CPU incidents on a CPC buy it a permanent CP (4-day lead), and
 * once installed its production images get a logical CP more so they can use it. One purchase per CPC per window. */
function buyCapacityForIncidents(run: RunState, s: Scenario, c: GameContent): RunState {
  const cfg = run.sim.config;
  const cpcOf = (l: string) => cfg.lpars.find((x) => x.id === l)?.cpcId ?? '';
  const days = new Map<string, Set<number>>();
  for (const inc of run.incidents.filter((i) => i.day >= run.day - PERM_CP_WINDOW_DAYS && i.truth.mechanism === 'CPU_CAPACITY')) {
    const w = s.workloads.find((x) => x.id === inc.workloadId);
    if (!w) continue;
    for (const [l, f] of Object.entries(run.sim.routing[w.id] ?? w.routing)) {
      if (f <= 0) continue;
      const id = cpcOf(l);
      if (!days.has(id)) days.set(id, new Set());
      days.get(id)!.add(inc.day);
    }
  }
  let r = run;
  for (const cpc of cfg.cpcs) {
    const label = `Permanent CP on ${cpc.id} for capacity incidents`;
    const bought = r.changes.filter((x) => x.label === label && x.status !== 'FAILED');
    if ((days.get(cpc.id)?.size ?? 0) >= PERM_CP_MIN_DAYS && !bought.some((x) => x.plannedDay > r.day - PERM_CP_WINDOW_DAYS)) {
      r = requestChange(r, c, { label, hardwareId: 'PERM_CP', cpcId: cpc.id }).run;
    }
    const prod = cfg.lpars.filter((l) => l.cpcId === cpc.id && !l.id.startsWith('CF') && !['DEV1', 'TST1', 'DEVT', 'SYSP'].includes(l.id));
    const commands = prod.flatMap((l) => {
      const p = l.pools.find((x) => x.pool === 'CP');
      return p && p.logical < cpc.engines.CP ? [{ kind: 'SET_LOGICAL' as const, lparId: l.id, pool: 'CP' as const, logical: p.logical + 1 }] : [];
    });
    // One logical CP per installed purchase, not a climb toward the physical count.
    const raised = r.changes.filter((x) => x.label === `Logical CPs on ${cpc.id}` && x.status !== 'FAILED').length;
    if (commands.length > 0 && raised < bought.filter((x) => x.status === 'APPLIED').length) {
      r = requestChange(r, c, { label: `Logical CPs on ${cpc.id}`, commands }).run;
    }
  }
  return r;
}

// ---------------------------------------------------------------------------
// Expert: fixer plus capacity planning ahead of need. Buys the faster capacity setting on day 1
// (critical batch is a serial chain and batch volumes grow every night) instead of waiting for the
// deadline to bite.
const expert: Strategy = {
  briefing: (r, s, c) => {
    let run = fixer.briefing(r, s, c);
    if (run.day > 0) run = tunePolicyIncidents(run, s, c);
    if (run.day > 0) run = buyCapacityForIncidents(run, s, c);
    // At the first briefing with the hours for it (Harbourline's day-0 flaw fixes use the whole day).
    if (run.day <= 2 && !run.changes.some((x) => x.label === 'Capacity setting +1' && x.status !== 'FAILED')) run = capSettingUp(run, c);
    return run;
  },
  hourly: fixer.hourly,
  // Turns down the capex-for-opex pact: its 10% lower opex budget turns an ordinary month-1 bill into a
  // >25% overrun (the expert's opex game overs were all that pick).
  review: (r, _s, c) => chooseDraft(r, c, r.draft?.find((d) => d.id !== 'BUDGET_SWAP')?.id ?? null),
};
STRATEGIES.expert = expert;

// ---------------------------------------------------------------------------
// Spend-to-win: fixer plus a fresh On/Off CoD CP every morning (each lasts three days). SLAs should hold,
// but the temporary-capacity opex and the higher MLC peak should trip the budget (SPEC §16).
const spendToWin: Strategy = {
  briefing: (r, s, c) => requestChange(fixer.briefing(r, s, c), c, { label: 'On/Off CoD +1 CP', hardwareId: 'COD_CP' }).run,
  hourly: fixer.hourly,
  review: passive.review,
};
STRATEGIES.spendtowin = spendToWin;
