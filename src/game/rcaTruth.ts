// Accepted answer sets for incident truth (RT-07, docs/rca-design.md §4.1).
//
// The primary answer is what the rules in game/sla.ts rank first, and nothing here changes it: hints, AIOps and the
// bots keep reading it. `accepted` adds the answers a fair expert could also defend from what the player can see, so
// an RCA scores full credit for a defensible reading of the same evidence. Each source below is a rule, never a
// hand-listed answer per incident, and each accepted answer carries the one line the reply shows for it.

import { CPU_BANDS, CPU_CAPACITY } from '../content/incidents';
import { TICKS_PER_HOUR } from '../sim/core/units';
import type { GameContent } from './run/shared';
import { blamedCard, cappedForHour } from './sla';
import type { ActiveEvent, CapacityBasis, HourAcc, IncidentTruth, Mechanism, Trigger } from './types';

/** The CPU family: one machine's shortage, seen three ways. Used for the cause's identity and to scope the
 * capacity-card rule (a machine that lost capacity explains CPU work, not an I/O or storage miss). */
export const CPU_FAMILY: readonly Mechanism[] = ['CPU_CAPACITY', 'CPU_PRIORITY', 'CAPPING'];

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
  /** The window the cards must overlap: the incident's hour, or a batch night (18:00 to the day end). */
  window?: { startTick: number; endTick: number };
  /** The images the work runs on, for the cause's host. */
  hosts: readonly { lparId: string; cpcId: string }[];
  /** Region and Db2 images serving the work (RT-04's snapshot), for the DEPENDENCY server test. */
  servers?: readonly { jobname: string; lparId: string }[];
  /** Every image in the sysplex, to place a server's host on its CPC. */
  lpars: readonly { id: string; cpcId: string }[];
  content: GameContent;
  isNew: boolean;
}

const pct = (x: number) => `${x.toFixed(1)} %`;

/**
 * The accepted set for a truth, with one line of reasoning per answer that is not the primary.
 *
 * Sources (docs/rca-design.md §4.1), all of which leave the primary alone:
 *  - the blamed card's declared alternates (`alsoTriggers`/`alsoMechanisms` in content);
 *  - a card that lowered the processor's capacity adds CPU_CAPACITY;
 *  - a CPU verdict inside the §4.3 band adds the other side of the capacity/priority split;
 *  - DEPENDENCY on a server whose own image was short of CPU adds CPU_PRIORITY;
 *  - with no card to blame, GROWTH and POLICY are both accepted.
 */
export function acceptedAnswers(ctx: TruthContext): Required<Pick<IncidentTruth, 'accepted'>> & { notes: Record<string, string> } {
  const mechanisms: Mechanism[] = [ctx.mechanism];
  const triggers: Trigger[] = [ctx.trigger];
  const notes: Record<string, string> = {};
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

  const card = ctx.card ?? blamedCard(ctx.events, ctx.workloadId, ctx.mechanism, ctx.hour.hourIndex);
  const [windowStart, windowEnd] = ctx.window
    ? [ctx.window.startTick, ctx.window.endTick]
    : [ctx.hour.hourIndex * TICKS_PER_HOUR, (ctx.hour.hourIndex + 1) * TICKS_PER_HOUR];
  const overlaps = (e: ActiveEvent) => e.started && e.startTick < windowEnd && (e.endTick === null || e.endTick > windowStart);
  const defOf = (e: ActiveEvent) => ctx.content.events.find((d) => d.id === e.defId);

  // The card's own declared alternates: a looping archiver is also the policy that ran it, a storage shortage is
  // also a thread limit, and so on (the §4.1 table).
  const def = card ? defOf(card) : undefined;
  if (def) {
    for (const m of def.alsoMechanisms ?? []) offerMechanism(m, `the ${def.name} card can read as ${m} too`);
    for (const t of def.alsoTriggers ?? []) offerTrigger(t, `the ${def.name} card can read as ${t} too`);
  }

  // A card that lowered capacity: the machine, not the policy, decided the hour, whatever the bands say. §4.3 scopes
  // this to a CPU-family verdict or a server-CPU dependency: a machine with fewer engines does not explain an I/O,
  // storage, lock or thread-limit miss, and accepting CPU_CAPACITY there would teach a cause the data cannot support.
  const cpuSide = CPU_FAMILY.includes(ctx.mechanism) || ctx.mechanism === 'DEPENDENCY';
  const capCard = cpuSide
    ? ctx.events.find((e) => overlaps(e) && (e.affects.includes(ctx.workloadId) || e.uid === card?.uid) && (defOf(e)?.capacityDrop ?? 0) > 0)
    : undefined;
  if (capCard) offerMechanism('CPU_CAPACITY', `${capCard.name} lowered the processor's capacity`);

  // The §4.3 bands: the evidence does not separate capacity from priority, so both are accepted. Measured against
  // the hour-average basis the verdict used (APPROX: its donor share stands in for §4.3's displaceable CPU, RT-16).
  const b = ctx.basis;
  if (b && (ctx.mechanism === 'CPU_CAPACITY' || ctx.mechanism === 'CPU_PRIORITY')) {
    const hostPct = Math.max(b.cpcBusyPct, b.lparBusyPct);
    const hostFull = hostPct >= 100 * CPU_BANDS.hostFullFrac;
    const hostRoom = hostPct < 100 * CPU_BANDS.hostRoomFrac;
    const donorRoom = b.donorPct < 100 * CPU_BANDS.donorRoomFrac;
    const where = `${pct(hostPct)} busy with ${pct(b.donorPct)} of the CP displaceable`;
    // A row that clearly says one side keeps the other answer out: a host with room rules out capacity, and capacity
    // is the only answer when the host was full with almost nothing displaceable. Everywhere between, both hold.
    if (ctx.mechanism === 'CPU_PRIORITY' && !hostRoom) offerMechanism('CPU_CAPACITY', `${where}: the machine may have been the constraint`);
    if (ctx.mechanism === 'CPU_CAPACITY' && !(hostFull && donorRoom)) offerMechanism('CPU_PRIORITY', `${where}: the policy may have been able to serve it`);
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
        || avg(ctx.hour.lparBusyById?.[s.lparId]) >= CPU_CAPACITY.lparBusyFrac
        || avg(ctx.hour.cpcBusyById?.[cpcId]) >= CPU_CAPACITY.cpcBusyFrac;
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

  return { accepted: { mechanisms, triggers }, notes };
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
  isNew: boolean;
}): string {
  const card = ctx.card ?? blamedCard(ctx.events, ctx.workloadId, ctx.mechanism, ctx.hour.hourIndex);
  if (card) return card.uid;
  if (ctx.isNew || ctx.trigger === 'NEW_WORKLOAD') return `new:${ctx.workloadId}`;
  const family = CPU_FAMILY.includes(ctx.mechanism) ? 'CPU' : ctx.mechanism;
  const host = ctx.basis?.lparId ?? ctx.hosts[0]?.lparId ?? '';
  return `none:${family}:${host}`;
}
