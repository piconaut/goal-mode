import type { Facet } from './types';

export interface OtherTeamChangeDef {
  eventId: string;
  owner: string;
  label: string;
  routineLabel: string;
  kind: 'REBIND' | 'DEPLOYMENT';
  trustFacet: Facet;
  benefitTarget: string;
  hours: number;
}

// FICTIONAL: a modest CPU saving during the routine rollout, and an owner-trust cost for a backout.
export const ROUTINE_CHANGE_CPU_MULT = 0.95;
export const BACKOUT_TRUST = 1;

const retailRebind: OtherTeamChangeDef = {
  eventId: 'REGRESSION', owner: 'Db2 DBA team', label: 'REBIND package RB01', routineLabel: 'REBIND package RB02',
  kind: 'REBIND', trustFacet: 'Retail', benefitTarget: 'RBANK', hours: 1.5,
};
const monitoring: OtherTeamChangeDef = {
  eventId: 'MONITOR_CREEP', owner: 'Monitoring vendor', label: 'MONAGENT 7.4 rollout', routineLabel: 'MONAGENT 7.3 rollout',
  kind: 'DEPLOYMENT', trustFacet: 'Finance', benefitTarget: 'MONAGENT', hours: 1,
};
const mobileProcedures: OtherTeamChangeDef = {
  eventId: 'ZIIP_LOSS', owner: 'Mobile API team', label: 'Mobile API procedures deployment 5.2', routineLabel: 'Mobile API procedures deployment 5.1',
  kind: 'DEPLOYMENT', trustFacet: 'Digital', benefitTarget: 'MOBILE', hours: 2,
};

export const MIDWEST_CHANGES = [retailRebind, monitoring, mobileProcedures, {
  eventId: 'QR_RELEASE', owner: 'Branch Systems team', label: 'Teller release 4.2', routineLabel: 'Teller release 4.1',
  kind: 'DEPLOYMENT', trustFacet: 'Retail', benefitTarget: 'TELLER', hours: 1.5,
}] satisfies OtherTeamChangeDef[];

export const HARBOURLINE_CHANGES = [
  { ...retailRebind, benefitTarget: 'RETAIL' }, monitoring, { ...mobileProcedures, trustFacet: 'Retail' },
];

export const REVENUE_CHANGES = [
  { ...retailRebind, eventId: 'EFILE_REGRESSION', label: 'REBIND package EF01', routineLabel: 'REBIND package EF02', trustFacet: 'Taxpayers', benefitTarget: 'EFILE' },
  monitoring,
  { ...mobileProcedures, owner: 'E-filing team', label: 'E-filing procedures deployment 5.2', routineLabel: 'E-filing procedures deployment 5.1', trustFacet: 'Taxpayers', benefitTarget: 'EFILE' },
];
