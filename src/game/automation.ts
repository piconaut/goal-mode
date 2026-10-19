// Automation rules (tool AUTOMATION, SPEC §8 tier 3): System Automation-style IF/THEN rules and the
// Capacity Provisioning Manager. Actions run as pre-approved changes: no engineer-hours and no
// emergency trust cost, but each one can misfire.

import { AUTOMATION } from '../content/alerts';
import { formatClock } from '../sim/core/clock';
import type { GameContent } from './run';
import type { RunState } from './types';

export type AutoTrigger = { kind: 'ALERT'; alertId: number } | { kind: 'JOB_ABEND'; criticalOnly: boolean };
export type AutoAction = { kind: 'ACTIVATE_POLICY'; policyName: string } | { kind: 'RESTART_JOB' } | { kind: 'COD' };

export interface AutoRule {
  id: number;
  trigger: AutoTrigger;
  action: AutoAction;
  maxPerDay: number;
}

export interface AutomationState {
  rules: AutoRule[];
  /** Actions taken today per rule id. */
  doneToday: Record<string, number>;
  day: number;
  /** Jobs already restarted once (day:name): automation restarts a job only once. */
  restarted: string[];
  log: { tick: number; text: string }[];
}

export const emptyAutomation = (): AutomationState => ({ rules: [], doneToday: {}, day: 0, restarted: [], log: [] });

/** On/Off Capacity on Demand item the CPM activates. */
export const COD_ITEM = 'COD_CP';

export function autoRuleText(r: AutoRule, alertText: (id: number) => string): string {
  const when = r.trigger.kind === 'ALERT' ? `alert “${alertText(r.trigger.alertId)}” fires` : `a${r.trigger.criticalOnly ? ' critical' : ''} batch job abends`;
  const then = r.action.kind === 'ACTIVATE_POLICY' ? `activate policy ${r.action.policyName}` : r.action.kind === 'RESTART_JOB' ? 'restart it once' : 'activate On/Off CoD (+1 CP)';
  return `IF ${when} THEN ${then} (max ${r.maxPerDay}/day)`;
}

type Out = { run: RunState; ok: boolean; message: string };
type RequestChange = (run: RunState, content: GameContent, req: { label: string; commands?: import('../sim/core/commands').Command[]; hardwareId?: string; automated?: { misfireFrac: number } }) => Out;

export function addAutoRule(run: RunState, rule: Omit<AutoRule, 'id'>): Out {
  const st = run.automation ?? emptyAutomation();
  if (st.rules.length >= AUTOMATION.maxRules) return { run, ok: false, message: `At most ${AUTOMATION.maxRules} automation rules` };
  if (rule.trigger.kind === 'ALERT' && !(run.alerts?.rules ?? []).some((a) => a.id === (rule.trigger as { alertId: number }).alertId)) return { run, ok: false, message: 'Pick an existing alert rule' };
  if (rule.trigger.kind === 'ALERT' && rule.action.kind === 'RESTART_JOB') return { run, ok: false, message: 'Job restarts are triggered by abends, not alerts' };
  if (rule.trigger.kind === 'JOB_ABEND' && rule.action.kind !== 'RESTART_JOB') return { run, ok: false, message: 'An abend can only trigger a restart' };
  if (rule.action.kind === 'ACTIVATE_POLICY' && !(run.policies?.saved ?? []).some((p) => p.policyName === (rule.action as { policyName: string }).policyName))
    return { run, ok: false, message: 'Pick a saved policy' };
  const maxPerDay = Math.max(1, Math.min(AUTOMATION.maxPerDayDefault * 3, Math.round(rule.maxPerDay)));
  const r: AutoRule = { ...rule, maxPerDay, id: run.nextId };
  return { run: { ...run, nextId: run.nextId + 1, automation: { ...st, rules: [...st.rules, r] } }, ok: true, message: 'Automation rule added' };
}

export const removeAutoRule = (run: RunState, id: number): RunState => {
  const st = run.automation ?? emptyAutomation();
  return { ...run, automation: { ...st, rules: st.rules.filter((r) => r.id !== id) } };
};

/** Absolute (hard) capping and CPM don't mix: IBM's CPM will not add capacity to hard-capped LPARs. */
const hardCapped = (run: RunState) => run.sim.config.lpars.some((l) => l.pools.some((p) => p.absoluteCapEngines != null));

/** Run due rules: `fired` are alert ids that started firing this evaluation. */
export function runAutomation(run: RunState, content: GameContent, fired: readonly number[], requestChange: RequestChange): RunState {
  let st = run.automation ?? emptyAutomation();
  if (st.rules.length === 0) return run;
  if (st.day !== run.day) st = { ...st, day: run.day, doneToday: {} };
  let r: RunState = { ...run, automation: st };
  const note = (rr: RunState, text: string): RunState => {
    const a = rr.automation;
    return { ...rr, automation: { ...a, log: [...a.log, { tick: rr.sim.tick, text: `${formatClock(rr.sim.tick).slice(-8, -3)} ${text}` }].slice(-AUTOMATION.logKept) } };
  };
  const bump = (rr: RunState, id: number): RunState => ({ ...rr, automation: { ...rr.automation, doneToday: { ...rr.automation.doneToday, [id]: (rr.automation.doneToday[id] ?? 0) + 1 } } });
  for (const rule of st.rules) {
    const done = r.automation.doneToday[rule.id] ?? 0;
    if (done >= rule.maxPerDay) continue;
    if (rule.trigger.kind === 'ALERT') {
      if (!fired.includes(rule.trigger.alertId)) continue;
      if (rule.action.kind === 'ACTIVATE_POLICY') {
        const name = rule.action.policyName;
        const def = r.policies?.saved.find((p) => p.policyName === name);
        if (!def || r.sim.wlm.definition.policyName === name) continue;
        const out = requestChange(r, content, { label: `Automation: V WLM,POLICY=${name}`, commands: [{ kind: 'ACTIVATE_POLICY', definition: structuredClone(def) }], automated: { misfireFrac: AUTOMATION.misfireFrac } });
        r = note(bump(out.run, rule.id), out.ok ? `activated policy ${name}` : `MISFIRE: policy ${name} not activated`);
      } else if (rule.action.kind === 'COD') {
        if (hardCapped(r)) {
          r = note(bump(r, rule.id), 'CPM refused: an LPAR is hard-capped');
          continue;
        }
        const out = requestChange(r, content, { label: 'CPM: On/Off CoD +1 CP', hardwareId: COD_ITEM, automated: { misfireFrac: AUTOMATION.misfireFrac } });
        r = note(bump(out.run, rule.id), out.ok ? 'CPM activated On/Off CoD +1 CP' : `CPM ${out.message.startsWith('Automation misfired') ? 'MISFIRE' : 'refused'}: ${out.message}`);
      }
    } else {
      for (const j of r.sim.batch.jobs) {
        if (j.status !== 'ABENDED' || (rule.trigger.criticalOnly && !j.def.critical)) continue;
        const key = `${j.day}:${j.def.name}`;
        if (r.automation.restarted.includes(key) || (r.automation.doneToday[rule.id] ?? 0) >= rule.maxPerDay) continue;
        const out = requestChange(r, content, { label: `Automation: restart ${j.def.name}`, commands: [{ kind: 'RESTART_JOB', day: j.day, name: j.def.name }], automated: { misfireFrac: AUTOMATION.misfireFrac } });
        r = { ...bump(out.run, rule.id) };
        r = { ...r, automation: { ...r.automation, restarted: [...r.automation.restarted, key] } };
        r = note(r, out.ok ? `restarted ${j.def.name}` : `MISFIRE: ${j.def.name} not restarted`);
      }
    }
  }
  return r;
}
