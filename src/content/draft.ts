// End-of-day draft rewards (SPEC §9.5): pick 1 of 3.

import type { DraftOption } from '../game/types';

export interface DraftDef extends DraftOption {
  weight: number;
}

// FICTIONAL: sizes of the newer draft rewards; the overtime push trades hours now for fatigue (change risk) later.
export const DRAFT_TUNING = { overtimeHours: 3, overtimeFatigue: 15, vendorFriendDays: 1 } as const;

export const DRAFT_OPTIONS: DraftDef[] = [
  { id: 'CONTRACTOR', title: 'Contractor for 3 days', description: '+4 engineer-hours per day for the next 3 days.', weight: 3 },
  { id: 'CFO_BONUS', title: 'Capex top-up', description: '+$300k hardware budget this quarter.', weight: 2 },
  { id: 'QUIET_DAY', title: 'Team offsite', description: 'Fatigue −30.', weight: 2 },
  { id: 'GOODWILL', title: 'Good news story', description: 'Trust +4 with every stakeholder.', weight: 2 },
  { id: 'VENDOR_TRIAL', title: 'Analytics vendor trial', description: '+15 Insight.', weight: 2 },
  { id: 'HMC_NINJA', title: 'Perk: HMC Ninja', description: 'PR/SM changes (weights, logicals, caps) cost no engineer-hours.', weight: 1 },
  { id: 'BELT_AND_BRACES', title: 'Perk: Belt and Braces', description: 'Change failure risk halved.', weight: 1 },
  { id: 'FRIENDS_IN_FINANCE', title: 'Perk: Friends in Finance', description: 'Monthly opex budget +10%.', weight: 1 },
  { id: 'NIGHT_OWL', title: 'Perk: Night Owl', description: 'Emergency changes cost half the trust.', weight: 1 },
  { id: 'OVERTIME_PUSH', title: 'Weekend push', description: '+3 engineer-hours tomorrow, but fatigue +15.', weight: 2 },
  { id: 'VENDOR_FRIEND', title: 'Perk: Friend at the Vendor', description: 'Hardware with a lead time of 2+ days arrives a day sooner.', weight: 1 },
  { id: 'WELL_CONNECTED', title: 'Perk: Well Connected', description: 'Asking around costs no engineer-hours.', weight: 1 },
];
