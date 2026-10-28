// "Ask around": questions to people in the organisation, sent from the Inbox. Each costs a little
// engineer time, is answered hours later, and reveals at most one fragment of what the game hides
// (critical jobs, lock-heavy jobs, job classes, how an app is classified, growth, what's coming up).

import { storyBeatsFor } from './difficulty';
import { APP_OWNERS, CALENDAR_FACTS, CURT_PREFIX, EVENT_RUMOURS, FRIENDLY_PREFIX, INQUIRY, INQUIRY_TOPICS, JOB_CLASS_MEANING, RUDE_REPLIES, STORY_RUMOURS, STREAM_STORY, type InquiryKind } from '../content/inquiries';
import { clockAt } from '../sim/core/clock';
import { type Rng, streamRng } from '../sim/core/rng';
import type { Scenario } from '../sim/core/scenario';
import { TICK_SEC, TICKS_PER_DAY } from '../sim/core/units';
import type { GameContent } from './run';
import { facetsOf, type RunState } from './types';
import { allWorkloads } from './workloads';

export interface PendingInquiry {
  id: number;
  topic: InquiryKind;
  workloadId: string | null;
  askedTick: number;
  replyTick: number;
}

export interface InquiryState {
  pending: PendingInquiry[];
  /** Fragments already given (never repeated). */
  revealed: string[];
}

const empty = (): InquiryState => ({ pending: [], revealed: [] });

type Out = { run: RunState; ok: boolean; message: string };

export function askAround(run: RunState, topicId: InquiryKind, workloadId: string | null, scenario: Scenario): Out {
  const t = INQUIRY_TOPICS.find((x) => x.id === topicId);
  if (!t) return { run, ok: false, message: `Unknown question; topics: ${INQUIRY_TOPICS.map((x) => x.id).join(', ')}` };
  // REVIEW spends tomorrow's hours, like planning a change; the reply clock starts at once.
  if (run.phase !== 'BRIEFING' && run.phase !== 'LIVE' && run.phase !== 'REVIEW') return { run, ok: false, message: 'The run is over' };
  const st = run.inquiries ?? empty();
  if (st.pending.length >= INQUIRY.maxOpen) return { run, ok: false, message: `Wait for answers first (at most ${INQUIRY.maxOpen} open questions)` };
  if (t.perWorkload && !allWorkloads(scenario, run).some((w) => w.id === workloadId)) return { run, ok: false, message: 'Pick an application' };
  const wid = t.perWorkload ? workloadId : null;
  if (st.pending.some((p) => p.topic === topicId && p.workloadId === wid)) return { run, ok: false, message: 'Already asked; the answer is on its way' };
  const hours = inquiryHours(t.hours, run.perks);
  if (run.hoursLeft < hours) return { run, ok: false, message: `Asking takes ${hours}h` };
  const rng = streamRng(run.seed, 'inquiry-ask', run.sim.tick, topicId, wid ?? '');
  const delayH = rng.range(t.replyHours[0], t.replyHours[1]);
  const p: PendingInquiry = { id: run.nextId, topic: topicId, workloadId: wid, askedTick: run.sim.tick, replyTick: run.sim.tick + Math.round((delayH * 3600) / TICK_SEC) };
  return {
    run: { ...run, nextId: run.nextId + 1, hoursLeft: run.hoursLeft - hours, inquiries: { ...st, pending: [...st.pending, p] } },
    ok: true,
    message: `Asked ${who(topicId, wid)}; expect an answer in a few hours`,
  };
}

const who = (topic: InquiryKind, wid: string | null) => (topic === 'APP_ENTRY' && wid ? (APP_OWNERS[wid] ?? `the ${wid} owner`) : INQUIRY_TOPICS.find((t) => t.id === topic)!.contact);

/** Deliver answers that are due (called each sim-hour). */
export function deliverInquiries(run: RunState, scenario: Scenario, content: GameContent): RunState {
  const st = run.inquiries;
  if (!st || st.pending.length === 0) return run;
  // People answer during office hours.
  const hour = clockAt(run.sim.tick).hourOfDay;
  if (hour < INQUIRY.officeHours[0] || hour >= INQUIRY.officeHours[1]) return run;
  const due = st.pending.filter((p) => p.replyTick <= run.sim.tick);
  if (due.length === 0) return run;
  let revealed = [...st.revealed];
  const inbox = [...run.inbox];
  for (const p of due) {
    const rng = streamRng(run.seed, 'inquiry-reply', p.askedTick, p.topic, p.workloadId ?? '');
    const t = INQUIRY_TOPICS.find((x) => x.id === p.topic)!;
    const subject = `Re: ${t.question}${p.workloadId ? ` (${p.workloadId})` : ''}`;
    const mood = moodOf(trustOf(run, scenario, p), rng);
    let body: string;
    if (mood === 'RUDE') body = pick(rng, RUDE_REPLIES);
    else if (rng.chance(t.dontKnowFrac * (mood === 'CURT' ? INQUIRY.mood.grumpyDontKnowMult : mood === 'FRIENDLY' ? INQUIRY.mood.friendlyDontKnowMult : 1))) body = shrug(p.topic, rng);
    else {
      const ans = answer(run, scenario, content, p, revealed, rng);
      body = (mood === 'CURT' ? pick(rng, CURT_PREFIX) : mood === 'FRIENDLY' ? pick(rng, FRIENDLY_PREFIX) : '') + ans.text;
      if (ans.key) revealed = [...revealed, ans.key];
    }
    inbox.push({ day: run.day, from: who(p.topic, p.workloadId), subject, body });
  }
  return { ...run, inbox, inquiries: { pending: st.pending.filter((p) => !due.includes(p)), revealed } };
}

type Mood = 'RUDE' | 'CURT' | 'NEUTRAL' | 'FRIENDLY';

/** Trust of whoever answers: app owners speak for their workload's stakeholder, planning for Finance,
 * the relationship manager for the business overall; IT colleagues (null) answer on the merits. */
function trustOf(run: RunState, scenario: Scenario, p: PendingInquiry): number | null {
  if (p.topic === 'APP_ENTRY') {
    const w = allWorkloads(scenario, run).find((x) => x.id === p.workloadId);
    return w && w.stakeholder !== 'Internal' ? run.trust[w.stakeholder] ?? null : null;
  }
  if (p.topic === 'GROWTH') return run.trust.Finance ?? null;
  if (p.topic === 'CALENDAR') return facetsOf(run).reduce((a, f) => a + run.trust[f]!, 0) / facetsOf(run).length;
  return null;
}

function moodOf(trust: number | null, rng: Rng): Mood {
  const m = INQUIRY.mood;
  if (trust === null) return 'NEUTRAL';
  if (trust < m.hostileBelow) return 'RUDE';
  if (trust < m.grumpyBelow) return rng.chance((m.grumpyBelow - trust) / (m.grumpyBelow - m.hostileBelow)) ? 'RUDE' : 'CURT';
  return trust >= m.friendlyFrom ? 'FRIENDLY' : 'NEUTRAL';
}

const SHRUGS: Record<InquiryKind, string[]> = {
  CRITICAL_PATH: ['Honestly the scheduler knows better than I do. Nobody has drawn the critical path out in years.', 'Not sure off the top of my head. I can try again when the month-end rush is over.'],
  LOCK_HEAVY: ['I would need accounting traces to tell you that, and we only keep them for a day.', 'No idea which jobs, sorry. The lock waits just show up on the online side.'],
  JOB_CLASSES: ['The class setup predates me. I just start initiators when someone shouts.'],
  APP_ENTRY: ["I'd have to ask the developers; they're heads-down on a release."],
  GROWTH: ['Our forecasts are being redone this quarter. Ask me again next week?'],
  CALENDAR: ['Nothing I have heard of. That does not mean nothing is coming.'],
};
const shrug = (k: InquiryKind, rng: Rng) => SHRUGS[k][Math.floor(rng.float() * SHRUGS[k].length) % SHRUGS[k].length]!;

const pick = <T,>(rng: Rng, xs: readonly T[]): T => xs[Math.floor(rng.float() * xs.length) % xs.length]!;

function answer(run: RunState, scenario: Scenario, content: GameContent, p: PendingInquiry, revealed: readonly string[], rng: Rng): { text: string; key: string | null } {
  const network = scenario.batchNetwork(run.seed, run.day, clockAt(run.sim.tick).dayOfMonth);
  const fresh = <T,>(items: { key: string; v: T }[]) => items.filter((x) => !revealed.includes(x.key));
  switch (p.topic) {
    case 'CRITICAL_PATH': {
      const c = fresh(network.filter((j) => j.critical).map((j) => ({ key: `crit:${j.name}`, v: j })));
      if (c.length === 0) return { text: 'That is every critical job I know of. The rest is the scheduler’s business.', key: null };
      const j = pick(rng, c);
      const feeds = STREAM_STORY[j.v.stream] ?? 'the morning deadline';
      return { text: `I know ${j.v.name} is on the critical path: if it runs late, ${feeds} is late, and so is the 06:00 deadline. There are others but I don't have the list in front of me.`, key: j.key };
    }
    case 'LOCK_HEAVY': {
      const c = fresh(network.filter((j) => j.usesDb2 && j.lockIntensity >= 0.5).map((j) => ({ key: `lock:${j.name}`, v: j })));
      if (c.length === 0) return { text: 'The ones I remember I have told you about already.', key: null };
      const j = pick(rng, c);
      return { text: `${j.v.name} takes a lot of row locks on the account tables. When it runs while online is busy, online sees lock waits rather than CPU delay.`, key: j.key };
    }
    case 'JOB_CLASSES': {
      const classes = [...new Set(network.map((j) => j.jobClass))].sort();
      const facts = [
        ...classes.filter((c) => JOB_CLASS_MEANING[c]).map((c) => ({ key: `class:${c}`, v: `Job class ${c}: ${JOB_CLASS_MEANING[c]}.` })),
        ...network
          .filter((j) => j.critical)
          .map((j) => ({ key: `jobclass:${j.name}`, v: `${j.name} runs in class ${j.jobClass}${j.sysaff ? ` with affinity to ${j.sysaff}` : ''}, same as the reporting jobs around it.` })),
      ];
      const c = fresh(facts);
      if (c.length === 0) return { text: 'That is all there is to the class setup, really.', key: null };
      const f = pick(rng, c);
      return { text: f.v, key: f.key };
    }
    case 'APP_ENTRY': {
      const w = allWorkloads(scenario, run).find((x) => x.id === p.workloadId);
      if (!w) return { text: 'That application has been retired.', key: null };
      const work = w.work;
      const facts: { key: string; v: string }[] = [{ key: `app:${w.id}:SUB`, v: `It runs through ${work.subsystem}.` }];
      if (work.TN) facts.push({ key: `app:${w.id}:TN`, v: `Our transaction codes all start with ${work.TN.slice(0, 2)}.` });
      if (work.UI) facts.push({ key: `app:${w.id}:UI`, v: `It connects with the user ID ${work.UI}.` });
      if (work.CI) facts.push({ key: `app:${w.id}:CI`, v: `The requests come through ${work.CI}; that is what sets the correlation ID.` });
      if (work.PK) facts.push({ key: `app:${w.id}:PK`, v: `The SQL is bound in package ${work.PK}.` });
      const c = fresh(facts.map((f) => ({ key: f.key, v: f.v })));
      if (c.length === 0) return { text: 'I have told you everything I know about how we connect.', key: null };
      const f = pick(rng, c);
      return { text: f.v, key: f.key };
    }
    case 'GROWTH': {
      const w = allWorkloads(scenario, run).find((x) => x.id === p.workloadId);
      if (!w) return { text: 'That application has been retired.', key: null };
      const monthly = (Math.pow(1 + w.growthPerDay, 30) - 1) * (1 + (rng.float() * 2 - 1) * INQUIRY.growthNoiseFrac);
      const pct = Math.round(monthly * 100);
      return { text: pct <= 0 ? `We expect ${w.name} to stay flat.` : `Planning has ${w.name} growing roughly ${pct}% a month, give or take.`, key: null };
    }
    case 'CALENDAR': {
      const now = run.sim.tick;
      const rumours: { key: string; v: string }[] = [];
      for (const e of run.events) {
        if (e.started || e.startTick <= now || e.startTick > now + 2 * TICKS_PER_DAY || !EVENT_RUMOURS[e.defId]) continue;
        const when = Math.floor(e.startTick / TICKS_PER_DAY) === run.day ? 'later today' : 'in the next day or so';
        rumours.push({ key: `ev:${e.uid}`, v: `I heard ${EVENT_RUMOURS[e.defId]}, ${when}.` });
      }
      for (let d = run.day + 1; d <= run.day + 5; d++) {
        for (const b of storyBeatsFor(content.story, run.difficulty, d)) {
          if (STORY_RUMOURS[b.id]) rumours.push({ key: `story:${b.id}`, v: `Word is ${STORY_RUMOURS[b.id]}, within the week.` });
        }
      }
      const c = fresh(rumours);
      if (c.length > 0) {
        const f = pick(rng, c);
        return { text: f.v, key: f.key };
      }
      const facts = fresh(CALENDAR_FACTS.map((f) => ({ key: `cal:${f.id}`, v: f.text })));
      if (facts.length === 0) return { text: 'Nothing new that I know of.', key: null };
      const f = pick(rng, facts);
      return { text: f.v, key: f.key };
    }
  }
}

const inquiryHours = (hours: number, perks: readonly string[]) => (perks.includes('WELL_CONNECTED') ? 0 : hours);

export function inquiriesView(run: RunState, scenario: Scenario) {
  const st = run.inquiries ?? empty();
  return {
    apps: allWorkloads(scenario, run).map((w) => ({ id: w.id, name: w.name })),
    topics: INQUIRY_TOPICS.map((t) => ({ id: t.id, contact: t.contact, question: t.question, hours: inquiryHours(t.hours, run.perks), perWorkload: !!t.perWorkload })),
    pending: st.pending.map((p) => ({ id: p.id, topic: p.topic, workloadId: p.workloadId, who: who(p.topic, p.workloadId), question: INQUIRY_TOPICS.find((t) => t.id === p.topic)!.question })),
    maxOpen: INQUIRY.maxOpen,
  };
}
