// Harbourline Bank story beats and event deck (SPEC §13.5). Like the agency deck: the neutral Midwest cards,
// adaptations of the workload-specific ones retargeted at Harbourline's workloads, and bank-specific cards for the
// planted flaws (B2 storm drain) and the trading/card calendar. Cards whose Midwest fix charges a facet Harbourline
// does not track have no fix; their clue lists the player-side levers instead.

import type { Command } from '../../sim/core/commands';
import { MIDWEST_EVENTS, type EventDef, type ScriptedBeat } from './midwest-events';

const NEUTRAL_CARDS = ['REORG_OVERRUN', 'JOB_ABEND', 'CP_SPARING', 'HIRING_FREEZE', 'SMF_AUDIT', 'AUDIT_UNCLASSIFIED'];

const midwestCard = (id: string): EventDef => {
  const c = MIDWEST_EVENTS.find((e) => e.id === id);
  if (!c) throw new Error(`No Midwest card ${id}`);
  return c;
};

/** Clone a Midwest card with overrides, retargeting workload ids in its begin/end commands (and affects). */
function adapt(id: string, overrides: Partial<EventDef>, retarget: Record<string, string> = {}): EventDef {
  let json = JSON.stringify(midwestCard(id));
  for (const [from, to] of Object.entries(retarget)) json = json.split(`"${from}"`).join(`"${to}"`);
  return { ...(JSON.parse(json) as EventDef), ...overrides };
}

const mod = (m: 'rate' | 'cpu', key: string, value: number): Command => ({ kind: 'SET_MODIFIER', mod: m, key, value });
const failFrac = (workloadId: string, lparId: string, value: number): Command => ({ kind: 'SET_MODIFIER', mod: 'regionFailFrac', key: `${workloadId}@${lparId}`, value });

const ALL_ONLINE = ['MKTORD', 'MKTQRY', 'RETAIL', 'CARDS', 'PAYMENTS', 'MOBILE'];
const CF_AFFECTED = ['MKTORD', 'MKTQRY', 'RETAIL', 'CARDS', 'PAYMENTS', 'MOBILE'];

const BANK_CARDS: EventDef[] = [
  {
    // B2: with abendThreshFrac/abendCritFrac unset, CPSM goal routing reads fast failures as fast responses.
    id: 'SICK_AOR',
    name: 'Sick CICS AOR (CICSAOR3 on PRDC): the storm drain',
    category: 'SOFTWARE',
    minDay: 4,
    weight: 2,
    trigger: 'POLICY',
    affects: ['MKTORD', 'CARDS'],
    startHour: [9, 15],
    durationHours: 5,
    // FICTIONAL: a third of the transactions routed to the sick region abend almost at once.
    begin: [failFrac('MKTORD', 'PRDC', 0.35), failFrac('CARDS', 'PRDC', 0.35)],
    end: [failFrac('MKTORD', 'PRDC', 0), failFrac('CARDS', 'PRDC', 0)],
    fix: 'RECYCLE_SICK_AOR',
    forewarning: null,
    announcement: null,
    clue: 'CPSM / CICS monitoring: MKTORD and CARDS abends (and the error-rate SLA misses) concentrate on the PRDC region while its response time looks excellent, and PRDC attracts a growing share of the routed work. Without abend compensation the CPSM goal router reads a fast failure as a fast response and sends it more work (the storm drain). Fixes: set ABENDTHRESH/ABENDCRIT on the CPSM routing policy, quiesce the PRDC region, or restart it.',
  },
  {
    // The card volume modifier stands in for the burst arrivals, which no command can retune.
    id: 'MARKET_OPEN_SURGE',
    name: 'Index rebalance and a news-driven open',
    category: 'WORKLOAD',
    minDay: 3,
    weight: 2.5,
    trigger: 'DEMAND_SURGE',
    affects: ['MKTORD', 'MKTQRY'],
    startHour: [9, 9.5],
    // FICTIONAL: two hours of ×1.6 order and price-query volume on top of the usual open and burst traffic.
    durationHours: 2,
    begin: [mod('rate', 'MKTORD', 1.6), mod('rate', 'MKTQRY', 1.6)],
    end: [mod('rate', 'MKTORD', 1), mod('rate', 'MKTQRY', 1)],
    fix: null,
    forewarning: 'Markets desk: "Index rebalance tomorrow, and the central bank speaks at nine. Expect a heavy open."',
    announcement: null,
    clue: 'Mon III SYSSUM (100 s range): MKTORD PI and CPU delay spike from 09:30 while the 15-minute WLMGL interval looks mild; MKTORD END/S up ×1.6 on every PRD image and CICS monitoring shows MXT waits. Fixes: headroom (On/Off CoD on CPC1), a percentile goal for MKTORD, an importance-1 CPU-critical class, CICS MAXTASKS, or lifting the PRDA absolute cap.',
  },
  {
    id: 'HOLIDAY_CARD_SPIKE',
    name: 'Holiday shopping-day card spike',
    category: 'WORKLOAD',
    minDay: 6,
    weight: 2,
    trigger: 'DEMAND_SURGE',
    affects: ['CARDS', 'RETAIL'],
    startHour: [10, 12],
    // FICTIONAL: a shopping holiday lifts card authorisations ×1.7 and retail enquiries ×1.2 for the afternoon.
    durationHours: 8,
    begin: [mod('rate', 'CARDS', 1.7), mod('rate', 'RETAIL', 1.2)],
    end: [mod('rate', 'CARDS', 1), mod('rate', 'RETAIL', 1)],
    fix: null,
    forewarning: 'Cards: "Tomorrow is the big shopping holiday. Last year authorisations ran well above a normal Friday."',
    announcement: null,
    clue: 'CARDS END/S ×1.7 from mid-morning with CPU per transaction unchanged; the 99%-in-0.15 s goal is tight, so CARDS PI creeps up on the busiest images (Mon III SYSSUM, WLMGL). Fixes: headroom, CICS MAXTASKS on the AORs, or protect CARDS at importance 1.',
  },
];

const HB_CARDS: EventDef[] = [
  adapt('CAMPAIGN', {
    forewarning: 'Digital: "Heads up, marketing is pushing a mobile promo tomorrow. Could be big."',
    clue: 'DDF END/S for the mobile channel jumps ×2–3 on all four PRD images; CPU per transaction unchanged.',
  }),
  adapt('RUNAWAY', {
    clue: 'DDFPRD period 2 APPL% and zIIP busy soar on PRDC/PRDD with the analytics end rate flat; with the zIIPs busy the work queues for them (Mon III DELAY, Partition Data). Fixes: cancel the thread, or give analytics a goal class of its own.',
  }),
  adapt('REGRESSION', {
    perkTip: { perk: 'DB2_WHISPERER', from: 'DBA team', text: "EXPLAIN diff after last night's REBIND: package RB01 changed access path (index probe → tablespace scan). Expect more CPU per retail transaction." },
  }, { RBANK: 'RETAIL' }),
  adapt('BOT_ATTACK', {
    fix: null,
    clue: 'Mobile END/S ×4 with lower CPU per transaction; TCP/IP busier; DBAT usage spikes. Fixes: protect Cards and Markets with importance and goals and ride it out, or cap DDF with MAXDBAT.',
  }),
  adapt('RETRY_STORM', {
    fix: null,
    clue: 'Mobile END/S ×2.5 at midday with CPU per transaction unchanged (bot traffic would be cheaper per transaction); DDFPRD APPL% up in step. Fixes: protect Cards and Markets and ride it out, or shed with MAXDBAT.',
  }),
  adapt('ENCRYPTION_MANDATE', {
    clue: 'WLMGL: CPU per transaction up ~6% on cards, retail and payments from one morning, END/S flat; MSU/R4HA up. Fixes: agree a narrower scope with the regulator (Regulator trust), or absorb it with tuning and capacity.',
  }, { CARDAUTH: 'CARDS', TELLER: 'RETAIL', PAYMQ: 'PAYMENTS' }),
  adapt('ZIIP_LOSS', {
    fix: null,
    clue: 'WLMGL: DDFPRD APPL% on CP up and IIP% down on PRDA with END/S and total CPU per transaction flat; MSU and R4HA rise. Fixes: redeploy as native SQL procedures, or absorb it (cap, more CP, route to CPC2 zIIPs).',
  }),
  adapt('CF_LINK', { affects: CF_AFFECTED }),
  adapt('CF_FAILURE', { affects: CF_AFFECTED }),
  adapt('DASD_DEGRADED', { affects: ALL_ONLINE }),
  adapt('LOCK_ESCALATION', { affects: ['CARDS', 'RETAIL'] }),
  adapt('MONITOR_CREEP', { affects: ['MOBILE', 'RETAIL'] }),
  adapt('POWER_CAP', {
    affects: ['MKTORD', 'CARDS'],
    clue: 'SYSINFO / Partition Data: same engines but every LPAR delivers less MSU; CPU delay rises everywhere at once. Fixes: cap or quiesce DEV1 and TST1, defer discretionary batch, protect importance-1 work.',
  }),
  adapt('HSM_RECALL_STORM', { affects: ALL_ONLINE }),
  adapt('GREEN_IT_COD', {
    clue: 'The change desk refuses On/Off CoD (and so does CPM automation). Responses: cap or quiesce DEV1 and TST1, defer discretionary batch, tune policy, or buy permanent capacity.',
  }),
];

export const HARBOURLINE_EVENTS: EventDef[] = [
  ...MIDWEST_EVENTS.filter((e) => NEUTRAL_CARDS.includes(e.id)),
  ...HB_CARDS,
  ...BANK_CARDS,
];

export const HARBOURLINE_STORY: ScriptedBeat[] = [
  { day: 0, id: 'WELCOME', from: 'CIO', title: 'Welcome to Harbourline', body: 'Two CPCs, fifteen kilometres apart, one sysplex, and a trading floor that notices every missed second. Analytics are in place; reading them across images is the job.' },
  { day: 3, id: 'TWO_CPCS', from: 'Capacity planning', title: 'CPC2 is the older machine', body: 'CPC2 has sub-capacity CPs and more zIIPs, and the Db2 lock structure lives on CF01 at the CPC1 site. Work routed to PRDC and PRDD pays for the 15 km link on every lock request.' },
  { day: 7, id: 'ROUTING', from: 'Middleware team', title: 'Routing was set up before the second CPC', body: 'The sysplex distributor weights and the CICSPlex SM router predate CPC2 and the last rebalance. Nobody has checked how they behave when a region misbehaves.' },
  { day: 12, id: 'CFO_MANDATE', from: 'Finance', title: 'Software costs must come down', body: 'Next month the MLC bill must be 10% lower than this month. Finance trust depends on it.', constraint: 'CFO_MANDATE' },
  { day: 20, id: 'REG_DEADLINE', from: 'Regulator', title: 'Earlier reporting deadline', body: 'Critical batch must now complete by 05:00. The regulator will be reading the SMF.', constraint: 'DEADLINE_0500' },
  { day: 33, id: 'FREEZE', from: 'Change board', title: 'Quarter-end change freeze', body: 'Only emergency changes until the quarter closes.', constraint: 'FREEZE' },
];
