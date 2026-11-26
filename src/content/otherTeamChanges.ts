import type { Facet } from './types';

export interface OtherTeamChangeDef {
  eventId: string;
  owner: string;
  label: string;
  kind: 'REBIND' | 'DEPLOYMENT';
  trustFacet: Facet;
  benefitTarget: string;
  // FICTIONAL: a backout takes 1–2 engineer-hours depending on the rollout.
  hours: number;
}

// FICTIONAL: a modest CPU saving during the routine rollout, and an owner-trust cost for a backout.
export const ROUTINE_CHANGE_CPU_MULT = 0.95;
export const BACKOUT_TRUST = 1;

const retailRebind: OtherTeamChangeDef = {
  eventId: 'REGRESSION', owner: 'Db2 DBA team', label: 'REBIND package RB01',
  kind: 'REBIND', trustFacet: 'Retail', benefitTarget: 'RBANK', hours: 1.5,
};
const monitoring: OtherTeamChangeDef = {
  eventId: 'MONITOR_CREEP', owner: 'Monitoring vendor', label: 'MONAGENT rollout',
  kind: 'DEPLOYMENT', trustFacet: 'Finance', benefitTarget: 'MONAGENT', hours: 1,
};
const mobileProcedures: OtherTeamChangeDef = {
  eventId: 'ZIIP_LOSS', owner: 'Mobile API team', label: 'Mobile API procedures deployment',
  kind: 'DEPLOYMENT', trustFacet: 'Digital', benefitTarget: 'MOBILE', hours: 2,
};

export const MIDWEST_CHANGES = [retailRebind, monitoring, mobileProcedures, {
  eventId: 'QR_RELEASE', owner: 'Branch Systems team', label: 'Teller release',
  kind: 'DEPLOYMENT', trustFacet: 'Retail', benefitTarget: 'TELLER', hours: 1.5,
}] satisfies OtherTeamChangeDef[];

export const HARBOURLINE_CHANGES = [
  { ...retailRebind, benefitTarget: 'RETAIL' }, monitoring, { ...mobileProcedures, trustFacet: 'Retail' },
];

export const REVENUE_CHANGES = [
  { ...retailRebind, eventId: 'EFILE_REGRESSION', label: 'REBIND package EF01', trustFacet: 'Taxpayers', benefitTarget: 'EFILE' },
  monitoring,
  { ...mobileProcedures, owner: 'E-filing team', label: 'E-filing procedures deployment', trustFacet: 'Taxpayers', benefitTarget: 'EFILE' },
];
