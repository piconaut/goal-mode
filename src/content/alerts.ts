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
