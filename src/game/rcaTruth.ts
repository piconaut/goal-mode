// Accepted answer sets for incident truth (RT-07, docs/rca-design.md §4.1).
//
// The primary answer is what the rules in game/sla.ts rank first, and nothing here changes it: hints, AIOps and the
// bots keep reading it. `accepted` adds the answers a fair expert could also defend from what the player can see, so
// an RCA scores full credit for a defensible reading of the same evidence. Each source below is a rule, never a
// hand-listed answer per incident, and each accepted answer carries the one line the reply shows for it.

import { CPU_BANDS, CPU_CAPACITY } from '../content/incidents';
import { CO_DOMINANT_SHARE } from '../content/sla';
import { CPU_FAMILY } from '../content/footprint';
import { slowCf, slowLcu, type CfPeerRow, type LcuPeerRow } from './peerSlow';
import type { GameContent } from './run/shared';
import { activeIn, cappedForHour, fallbackTrigger, footprintRelation, hourWindow, perTxnParts, qualifyingCards, type WorkScope } from './sla';
import type { ActiveEvent, CapacityBasis, HourAcc, IncidentTruth, Mechanism, Trigger } from './types';

/** The CPU family (content/footprint.ts): used here for the cause's identity and to scope the capacity-card rule (a
 * machine that lost capacity explains CPU work, not an I/O or storage miss). */
export { CPU_FAMILY };

export interface TruthContext {
  workloadId: string;
  mechanism: Mechanism;
  trigger: Trigger;
  /** The hour that decided the truth: the incident's opening SLA hour, or the night's hours for batch. */
  hour: HourAcc;
  /** Cards that can explain the incident (a batch night passes the run's events). */
  events: readonly ActiveEvent[];
  /** A card the caller already holds (batch nights, where no SLA hour names one). Otherwise `blamedCard` decides. */
  card?: ActiveEvent;
  /** The capacity figures behind a CPU verdict, as recorded on the incident. */
  basis?: CapacityBasis | null;
  cpu?: { mechanisms: Mechanism[]; overflowBlocked: boolean };
  /** Delay groups with at least a third of the excess beside the primary (RT-17, §4.2(2)). */
  coDominant?: readonly { mechanism: Mechanism; why: string }[];
  /** The window the cards must overlap: the incident's hour, or a batch night (18:00 to the day end). */
  window?: { startTick: number; endTick: number };
  /** The images the work runs on, for the cause's host. */
  hosts: readonly { lparId: string; cpcId: string }[];
  /** Region and Db2 images serving the work (RT-04's snapshot), for the DEPENDENCY server test. */
  servers?: readonly { jobname: string; lparId: string }[];
  /** Every image in the sysplex, to place a server's host on its CPC. */
  lpars: readonly { id: string; cpcId: string }[];
  /** The CF and DASD Activity rows of the interval that closed the judged hour, for the peer-slow source (RT-35).
   *  Absent on old hours, batch nights and fixtures. */
  peers?: {
    cf?: readonly CfPeerRow[];
    lcus?: readonly LcuPeerRow[];
    /** The CFs the work's hosts connect to (Subchannel Activity): absent means every CF counts (an
     *  interval without Subchannel Activity rows), empty means none is the work's (`slowCf`). */
    connectedCf?: readonly string[];
  };
  content: GameContent;
  isNew: boolean;
}

const pct = (x: number) => `${x.toFixed(1)} %`;

/**
 * The accepted set for a truth, with one line of reasoning per answer that is not the primary.
 *
 * Sources (docs/rca-design.md §4.1), all of which leave the primary alone:
 *  - the blamed card's declared alternates (`alsoTriggers`/`alsoMechanisms` in content);
 *  - every other card whose footprint reaches the work for this mechanism, and for a collateral victim the fallback
 *    (RT-14, §4.4(3));
 *  - a card that lowered the processor's capacity adds CPU_CAPACITY;
 *  - a CPU verdict inside the §4.3 band adds the other side of the capacity/priority split;
 *  - DEPENDENCY on a server whose own image was short of CPU adds CPU_PRIORITY;
 *  - a co-dominant delay group adds its mechanism (RT-17, §4.2(2));
 *  - with no card to blame, GROWTH and POLICY are both accepted.
 */
export function acceptedAnswers(ctx: TruthContext): Required<Pick<IncidentTruth, 'accepted'>> & { notes: Record<string, string>; nearMiss?: Partial<Record<Mechanism, string>> } {
  const mechanisms: Mechanism[] = [ctx.mechanism];
  const triggers: Trigger[] = [ctx.trigger];
  const notes: Record<string, string> = {};
  const nearMiss: Partial<Record<Mechanism, string>> = {};
  // The first reason offered for an answer is the one shown: the card's, then the band's, then the server's.
  const offerMechanism = (m: Mechanism, why: string) => {
    if (mechanisms.includes(m)) return;
    mechanisms.push(m);
    notes[m] = why;
  };
  const offerTrigger = (t: Trigger, why: string) => {
    if (triggers.includes(t)) return;
    triggers.push(t);
    notes[t] = why;
  };

  const window = ctx.window ?? hourWindow(ctx.hour.hourIndex);
  // The context's hosts and servers are the work's footprint scope.
  const scope: WorkScope = ctx;
  const ranked = qualifyingCards(ctx.events, ctx.workloadId, ctx.mechanism, window, scope);
  const card = ctx.card ?? ranked[0]?.card;
  const defOf = (e: ActiveEvent) => ctx.content.events.find((d) => d.id === e.defId);

  // The card's own declared alternates: a looping archiver is also the policy that ran it, a storage shortage is
  // also a thread limit, and so on (the §4.1 table).
  const def = card ? defOf(card) : undefined;
  if (def) {
    for (const m of def.alsoMechanisms ?? []) offerMechanism(m, `the ${def.name} card can read as ${m} too`);
    for (const t of def.alsoTriggers ?? []) offerTrigger(t, `the ${def.name} card can read as ${t} too`);
  }

  // Every other card whose footprint reaches the work and causes this mechanism (RT-14, §4.4(3)): it ranked lower
  // (collateral, background or a shorter overlap) or tied, but it loaded what the work waited for.
  for (const q of ranked) {
    if (q.card.uid === card?.uid) continue;
    const how = q.direct ? 'changed this work' : 'loaded what this work waited for';
    offerTrigger(q.card.trigger, `${q.card.name} ${q.background ? 'had been running' : 'was running'} and ${how}`);
  }

  // A collateral victim: the card loaded a shared resource, and the policy or headroom that left this work exposed to
  // it is the other half of the cause (§4.4(3)).
  const lead = ranked.find((q) => q.card.uid === card?.uid);
  if (lead && !lead.direct) {
    offerTrigger(fallbackTrigger(ctx.mechanism, ctx.hour, ctx.isNew), `${lead.card.name} hit it as a neighbour: the policy or headroom left it exposed`);
  }

  // A card that lowered capacity: the machine, not the policy, decided the hour, whatever the bands say. §4.3 scopes
  // this to a CPU-family verdict or a server-CPU dependency: a machine with fewer engines does not explain an I/O,
  // storage, lock or thread-limit miss, and accepting CPU_CAPACITY there would teach a cause the data cannot support.
  const cpuSide = CPU_FAMILY.includes(ctx.mechanism) || ctx.mechanism === 'DEPENDENCY';
  const capCard = cpuSide
    ? ctx.events.find((e) => activeIn(e, window) && (footprintRelation(e, ctx.workloadId, scope) !== null || e.uid === card?.uid) && (defOf(e)?.capacityDrop ?? 0) > 0)
    : undefined;
  if (capCard) offerMechanism('CPU_CAPACITY', `${capCard.name} lowered the processor's capacity`);

  // APPROX: hour-average displaceable CPU, not a prediction of a WLM move. Old incidents retain donorPct.
  const b = ctx.basis;
  if (b && (ctx.mechanism === 'CPU_CAPACITY' || ctx.mechanism === 'CPU_PRIORITY')) {
    const hostPct = Math.max(b.cpcBusyPct, b.lparBusyPct);
    const hostFull = hostPct >= 100 * CPU_BANDS.hostFullFrac;
    const hostRoom = hostPct < 100 * CPU_BANDS.hostRoomFrac;
    const share = b.displaceablePct ?? b.donorPct;
    const donorRoom = share < 100 * CPU_BANDS.displaceableRoomFrac;
    const where = `${pct(hostPct)} busy with ${pct(share)} of the ${b.pool ?? 'CP'} displaceable`;
    // A row that clearly says one side keeps the other answer out: a host with room rules out capacity, and capacity
    // is the only answer when the host was full with almost nothing displaceable. Everywhere between, both hold.
    if (ctx.mechanism === 'CPU_PRIORITY' && !hostRoom) offerMechanism('CPU_CAPACITY', `${where}: the machine may have been the constraint`);
    if (ctx.mechanism === 'CPU_CAPACITY' && !(hostFull && donorRoom)) offerMechanism('CPU_PRIORITY', `${where}: the policy may have been able to serve it`);
  }

  for (const m of ctx.cpu?.mechanisms ?? []) offerMechanism(m, m === 'ROUTING' ? 'one host carried at least two thirds of the CPU excess while another had room' : 'a substantial co-host contributed this CPU verdict');
  for (const d of ctx.coDominant ?? []) offerMechanism(d.mechanism, d.why);
  if (ctx.cpu?.overflowBlocked || b?.overflowBlocked) offerTrigger('POLICY', 'zIIP work could not overflow while the host CPs had room');

  // A resource far slower than its peers explains the work's CF or I/O time even when nothing grew (RT-35): the
  // primary stays the growth-ranked answer, but a standing misconfiguration is a defensible reading. Each part is
  // judged against the work's own response time, as co-dominance is. A peer-slow resource below the share line is a
  // near miss: the recipe can prove the claim, so the reply says why it earns nothing.
  const wh = ctx.hour.workloads[ctx.workloadId];
  if (ctx.peers && wh) {
    const parts = perTxnParts(wh);
    const total = wh.completions > 0 ? wh.rtSumSec / wh.completions : 0;
    if (total > 0) {
      const share = (part: number) => `${pct((100 * part) / total)} of ${ctx.workloadId}'s response time`;
      const line = `${Math.round(CO_DOMINANT_SHARE * 100)} %`;
      const cf = slowCf(ctx.peers.cf ?? [], ctx.peers.connectedCf);
      if (cf) {
        const why = `${cf.row.lparId} at ${cf.ratio.toFixed(0)}× ${cf.peer.of}'s ${cf.metric === 'syncUs' ? 'sync service time' : 'async conversion'}`;
        if (parts.cf !== undefined && parts.cf >= CO_DOMINANT_SHARE * total) offerMechanism('CF_SERVICE', `${why} (${share(parts.cf)})`);
        else if (parts.cf !== undefined) nearMiss.CF_SERVICE = `${why}, but CF time was ${share(parts.cf)} (accepted from ${line})`;
      }
      const lcu = slowLcu(ctx.peers.lcus ?? []);
      if (lcu) {
        const why = `LCU ${lcu.row.id} at ${lcu.ratio.toFixed(0)}× the LCU median ${lcu.metric === 'discMs' ? 'DISC' : 'response'} time`;
        if (parts.io !== undefined && parts.io >= CO_DOMINANT_SHARE * total) offerMechanism('IO', `${why} (${share(parts.io)})`);
        else if (parts.io !== undefined) nearMiss.IO = `${why}, but I/O time was ${share(parts.io)} (accepted from ${line})`;
      }
    }
  }

  // Server waits: when a transaction class misses its goal, WLM finds the regions serving it through the topology and
  // helps the ones that measured delays (SG24-7621 printed p.81 §3.5, p.126 §3.31; docs/research.md), so a server held
  // back for CPU is the served class's goal problem, not a separate resource. APPROX: the sim keeps no per-server CPU
  // delay at hour granularity (§4.2(3) is RT-19's), so the test is the server image's shortage — capping, or its own
  // busy past its line — and not the region's measured CPU delay. The extra answer is a game rule for what the player
  // can see, not a measurement.
  if (ctx.mechanism === 'DEPENDENCY') {
    const avg = (sum: number | undefined) => (ctx.hour.ticks > 0 ? (sum ?? 0) / ctx.hour.ticks : 0);
    const starved = (ctx.servers ?? []).find((s) => {
      // Each measure against its own line: an image at 40 % of its own CP on a busy machine was not held back.
      const capped = cappedForHour(ctx.hour, s.lparId);
      const cpcId = ctx.lpars.find((l) => l.id === s.lparId)?.cpcId ?? '';
      return capped
        || avg(ctx.hour.lparBusyById[s.lparId]) >= CPU_CAPACITY.lparBusyFrac
        || avg(ctx.hour.cpcBusyById[cpcId]) >= CPU_CAPACITY.cpcBusyFrac;
    });
    if (starved) offerMechanism('CPU_PRIORITY', `${starved.jobname} on ${starved.lparId} was short of CPU itself`);
  }

  // No card to blame: "growth crossed the headroom" and "the configuration has no headroom" describe the same state,
  // and no visible data separates them (§4.4(4)). New work and the batch lock clash are distinguishable, so they keep
  // the single answer.
  if (!card && !ctx.isNew && ctx.trigger !== 'BATCH_OVERLAP') {
    const why = 'with no card, growth and the configuration are the same state';
    offerTrigger('GROWTH', why);
    offerTrigger('POLICY', why);
  }

  return { accepted: { mechanisms, triggers }, notes, ...(Object.keys(nearMiss).length > 0 ? { nearMiss } : {}) };
}

/** The prefixes of the causes that are not a card's `uid` (§4.5): new work, the player's own change (§4.7), or what
 * the configuration was short of. Written here and read by grouping (game/run/grouping.ts), so the two cannot drift. */
export const CAUSE_PREFIX = { new: 'new:', change: 'change:', none: 'none:' } as const;

/** Whether a cause is one of those rather than a card's `uid`. */
export function fallbackCause(cause: string): boolean {
  return Object.values(CAUSE_PREFIX).some((prefix) => cause.startsWith(prefix));
}

/** The cause's identity for grouping (docs/rca-design.md §4.5): the blamed card, new work, or what was short. §4.5's
 * `change:<id>` (an incident the player's own change caused, §4.7) arrives with RT-18's tested player-change trigger. */
export function truthCause(ctx: {
  workloadId: string;
  mechanism: Mechanism;
  trigger: Trigger;
  hour: HourAcc;
  events: readonly ActiveEvent[];
  card?: ActiveEvent;
  basis?: CapacityBasis | null;
  hosts: readonly { lparId: string }[];
  servers?: readonly { jobname: string; lparId: string }[];
  window?: { startTick: number; endTick: number };
  isNew: boolean;
}): string {
  const window = ctx.window ?? hourWindow(ctx.hour.hourIndex);
  const card = ctx.card ?? qualifyingCards(ctx.events, ctx.workloadId, ctx.mechanism, window, ctx)[0]?.card;
  if (card) return card.uid;
  if (ctx.isNew || ctx.trigger === 'NEW_WORKLOAD') return `${CAUSE_PREFIX.new}${ctx.workloadId}`;
  const family = CPU_FAMILY.includes(ctx.mechanism) ? 'CPU' : ctx.mechanism;
  const host = ctx.basis?.lparId ?? ctx.hosts[0]?.lparId ?? '';
  // A resource-group or server cap is a different cause from an image cap on the same image: the group names it, so
  // two groups' hours do not group and neither joins the image's (RT-33, design §3.3).
  if (ctx.mechanism === 'CAPPING' && ctx.basis?.capBy !== undefined && ctx.basis.capBy !== 'IMAGE')
    return `${CAUSE_PREFIX.none}CAPPING:${host}:rg:${ctx.basis.capGroup ?? ''}`;
  return `${CAUSE_PREFIX.none}${family}:${host}`;
}
