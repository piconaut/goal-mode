// Alerting rules (tool ALERTS, SPEC §8 tier 3): thresholds over Monitor III data, evaluated once per
// sim-minute. A rule fires after its condition has held for `forMin` minutes and clears when it stops.

import { ALERT_METRICS, ALERTS, type AlertMetric } from '../content/alerts';
import { clockAt, formatClock } from '../sim/core/clock';
import type { Scenario } from '../sim/core/scenario';
import { TICK_SEC } from '../sim/core/units';
import { buildMon3 } from './mon3';
import type { RunState } from './types';

export interface AlertRule {
  id: number;
  metric: AlertMetric;
  /** Service-class period or LPAR, '' when the metric has none. */
  subject: string;
  threshold: number;
  forMin: number;
  /** Pause the game when it fires. */
  pause: boolean;
}

export interface AlertEvent {
  tick: number;
  ruleId: number;
  kind: 'FIRED' | 'CLEARED';
  text: string;
}

export interface AlertsState {
  rules: AlertRule[];
  /** Tick each rule's condition started holding (rule id → tick). */
  breachSince: Record<string, number>;
  firing: number[];
  log: AlertEvent[];
  /** Set when a pausing rule fires; the worker pauses and clears it. */
  pauseRequested: boolean;
}

export const emptyAlerts = (): AlertsState => ({ rules: [], breachSince: {}, firing: [], log: [], pauseRequested: false });

export function ruleText(r: AlertRule): string {
  const d = ALERT_METRICS[r.metric];
  const what = d.subject === 'none' ? d.label : `${d.label} ${r.subject}`;
  return `${what} ${d.op} ${r.threshold}${d.unit} for ${r.forMin} min`;
}

/** Current value of a rule's metric, or null when it can't be measured right now. */
export function alertValue(run: RunState, scenario: Scenario, rule: Pick<AlertRule, 'metric' | 'subject'>, mon3 = buildMon3(run, scenario)): number | null {
  const sim = run.sim;
  switch (rule.metric) {
    case 'PI':
      return mon3.rows.find((r) => r.system === '*PLEX' && r.scKey === rule.subject)?.pi ?? null;
    case 'CPC_BUSY': {
      const engines = sim.config.cpcs.reduce((a, c) => a + c.engines.CP, 0);
      const delivered = sim.lpars.reduce((a, l) => a + (l.pools.find((p) => p.pool === 'CP')?.deliveredEngines ?? 0), 0);
      return engines > 0 ? (100 * delivered) / engines : null;
    }
    case 'CAPPED':
      return mon3.cpc.find((c) => c.lparId === rule.subject)?.cappedPct ?? null;
    case 'R4HA_DC': {
      const dc = sim.config.lpars.find((l) => l.id === rule.subject)?.definedCapacityMsu ?? null;
      const r4 = sim.capping.lpars.find((l) => l.id === rule.subject)?.r4ha ?? null;
      return dc && r4 !== null ? (100 * r4) / dc : null;
    }
    case 'BATCH_SLACK': {
      const proj = sim.batch.projectedCriticalEndSec;
      return proj === null ? null : (run.batchDeadlineSec - proj) / 60;
    }
  }
}

const breached = (rule: AlertRule, v: number) => (ALERT_METRICS[rule.metric].op === '>' ? v > rule.threshold : v < rule.threshold);

/** Evaluate every rule; called once per `ALERTS.evalTicks` while the tool and Monitor III are on. */
export function evaluateAlerts(run: RunState, scenario: Scenario): RunState {
  const st = run.alerts ?? emptyAlerts();
  if (st.rules.length === 0) return run;
  const tick = run.sim.tick;
  const mon3 = buildMon3(run, scenario);
  const breachSince = { ...st.breachSince };
  let firing = [...st.firing];
  const log = [...st.log];
  let pause = st.pauseRequested;
  let fatigue = run.fatigue;
  const hour = clockAt(tick).hourOfDay;
  const night = hour >= ALERTS.nightStart || hour < ALERTS.nightEnd;
  for (const rule of st.rules) {
    const v = alertValue(run, scenario, rule, mon3);
    const key = String(rule.id);
    if (v !== null && breached(rule, v)) {
      const since = breachSince[key] ?? tick;
      breachSince[key] = since;
      if (!firing.includes(rule.id) && (tick - since) * TICK_SEC >= rule.forMin * 60) {
        firing.push(rule.id);
        log.push({ tick, ruleId: rule.id, kind: 'FIRED', text: `${formatClock(tick).slice(-8, -3)} PAGE: ${ruleText(rule)} (now ${v.toFixed(v < 10 ? 2 : 0)}${ALERT_METRICS[rule.metric].unit})` });
        if (rule.pause) pause = true;
        if (night) fatigue = Math.min(100, fatigue + ALERTS.nightFatigue);
      }
    } else {
      delete breachSince[key];
      if (firing.includes(rule.id)) {
        firing = firing.filter((x) => x !== rule.id);
        log.push({ tick, ruleId: rule.id, kind: 'CLEARED', text: `${formatClock(tick).slice(-8, -3)} cleared: ${ruleText(rule)}` });
      }
    }
  }
  return { ...run, fatigue, alerts: { ...st, breachSince, firing, log: log.slice(-ALERTS.logKept), pauseRequested: pause } };
}

export function addAlertRule(run: RunState, rule: Omit<AlertRule, 'id'>): { run: RunState; ok: boolean; message: string } {
  const st = run.alerts ?? emptyAlerts();
  const d = ALERT_METRICS[rule.metric];
  if (!d) return { run, ok: false, message: 'Unknown metric' };
  if (st.rules.length >= ALERTS.maxRules) return { run, ok: false, message: `At most ${ALERTS.maxRules} rules` };
  if (d.subject !== 'none' && !rule.subject) return { run, ok: false, message: 'Pick what the rule watches' };
  if (!Number.isFinite(rule.threshold) || !Number.isFinite(rule.forMin) || rule.forMin < 0) return { run, ok: false, message: 'Threshold and duration must be numbers' };
  const r: AlertRule = { ...rule, subject: d.subject === 'none' ? '' : rule.subject, id: run.nextId };
  return { run: { ...run, nextId: run.nextId + 1, alerts: { ...st, rules: [...st.rules, r] } }, ok: true, message: `Alert added: ${ruleText(r)}` };
}

export function removeAlertRule(run: RunState, id: number): RunState {
  const st = run.alerts ?? emptyAlerts();
  const breachSince = { ...st.breachSince };
  delete breachSince[String(id)];
  return { ...run, alerts: { ...st, rules: st.rules.filter((r) => r.id !== id), firing: st.firing.filter((x) => x !== id), breachSince } };
}
