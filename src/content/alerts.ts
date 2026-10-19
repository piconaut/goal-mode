// Alerting rules (tool ALERTS): what a rule can watch, and what a page costs.

export type AlertMetric = 'PI' | 'CPC_BUSY' | 'CAPPED' | 'R4HA_DC' | 'BATCH_SLACK';

export interface AlertMetricDef {
  label: string;
  unit: string;
  /** Fires when the value is above (or below) the threshold. */
  op: '>' | '<';
  subject: 'period' | 'lpar' | 'none';
  defaultThreshold: number;
  help: string;
}

export const ALERT_METRICS: Record<AlertMetric, AlertMetricDef> = {
  PI: { label: 'PI of a service-class period', unit: '', op: '>', subject: 'period', defaultThreshold: 1.5, help: 'Sysplex PI from Monitor III (goal missed above 1).' },
  CPC_BUSY: { label: 'CPC busy', unit: '%', op: '>', subject: 'none', defaultThreshold: 95, help: 'General CPs delivered as a share of the CPC.' },
  CAPPED: { label: 'LPAR soft-capped', unit: '%', op: '>', subject: 'lpar', defaultThreshold: 0, help: 'Share of the last interval the LPAR was capped.' },
  R4HA_DC: { label: 'R4HA as % of defined capacity', unit: '%', op: '>', subject: 'lpar', defaultThreshold: 95, help: 'Capping starts at 100%.' },
  BATCH_SLACK: { label: 'Batch slack to the 06:00 deadline', unit: 'min', op: '<', subject: 'none', defaultThreshold: 30, help: 'Projected critical-path end vs the deadline.' },
};

// FICTIONAL: alert economy.
export const ALERTS = {
  maxRules: 10,
  /** Evaluated once per sim-minute. */
  evalTicks: 6,
  logKept: 50,
  /** Fatigue per page between nightStart and nightEnd (on-call wakes someone up). */
  nightFatigue: 0.5,
  nightStart: 20,
  nightEnd: 6,
};

// FICTIONAL: WLM service-policy schedule.
export const POLICY_SCHEDULE = {
  maxSaved: 4,
  maxEntries: 4,
  /** Engineer-hours to change the schedule (test the switch, update the automation table). */
  editHours: 0.5,
};

// FICTIONAL: automation (System Automation-style rules and Capacity Provisioning).
export const AUTOMATION = {
  maxRules: 8,
  /** Chance an automated action does not do what was intended (stale table, wrong system, race). */
  misfireFrac: 0.08,
  /** Default and hard cap on actions per rule per day. */
  maxPerDayDefault: 2,
  logKept: 50,
};

// FICTIONAL: AIOps hypothesis quality. Right often enough to be worth 50 Insight, wrong often enough
// that accepting it blindly loses RCAs.
export const AIOPS = {
  /** Chance the top-ranked mechanism is the true one. */
  mechanismAccuracy: 0.7,
  triggerAccuracy: 0.75,
  hypotheses: 3,
  /** Confidence shown for the top hypothesis (uniform in this range; uncorrelated with being right). */
  topConfidence: [0.55, 0.88] as [number, number],
};
