// What the mentor panel, the spotlight and the top bar show for the prologue (PRO-03, design §6, §11.4).
import { clockAt } from '../../sim/core/clock';
import type { Command } from '../../sim/core/commands';
import type { GameContent } from '../run/shared';
import type { RunState } from '../types';
import { currentStep } from './engine';
import { putBackOffered } from './rules';

export interface TutorView {
  /** "Mon 26 · Shadow week": the top bar's date in place of "Day N / 40". */
  dateLabel: string;
  chapter: { id: string; title: string; index: number };
  chapters: { id: string; title: string }[];
  beatId: string | null;
  /** The current step, or null between beats (the clock runs to the next one) and after the script. */
  step: {
    id: string;
    number: number;
    of: number;
    say: string;
    target: string | null;
    /** Completed only by Next (a read-only step). */
    isAck: boolean;
    /** The tab this step waits for the player to open (a `noted` tab step), so the spotlight points at the tab
     *  rather than opening it for them. */
    opensTab: string | null;
    /** The hint rungs shown so far, and whether another is left. */
    hints: string[];
    moreHints: boolean;
    /** The show-me draft, offered once the ladder's last rung is shown. */
    showMe: { label: string; commands: Command[] } | null;
  } | null;
  finished: boolean;
  putBack: boolean;
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function tutorView(run: RunState, content: GameContent): TutorView | null {
  const rules = content.prologue;
  const t = run.tutor;
  if (!rules || !t) return null;
  const c = clockAt(run.sim.tick, run.sim.monthDayAtStart);
  const cur = currentStep(run, rules);
  const chapter = rules.chapters[t.chapter] ?? rules.chapters[0]!;
  const beats = rules.chapters.flatMap((ch) => ch.beats);
  const s = cur?.step ?? null;
  return {
    dateLabel: `${WEEKDAYS[c.dayOfWeek]} ${c.dayOfMonth} · Shadow week`,
    chapter: { id: chapter.id, title: chapter.title, index: t.chapter },
    chapters: rules.chapters.map((ch) => ({ id: ch.id, title: ch.title })),
    beatId: cur?.beat.id ?? null,
    step: s && {
      id: s.id,
      number: t.step + 1,
      of: cur!.beat.steps.length,
      say: s.say,
      target: s.target ?? null,
      isAck: s.done.id === 'ack',
      opensTab: s.done.id === 'noted' && s.done.args?.kind === 'tab' && typeof s.done.args.ref === 'string' ? s.done.args.ref : null,
      hints: s.hints.slice(0, t.hintRung),
      moreHints: t.hintRung < s.hints.length,
      showMe: s.showMe && t.hintRung >= s.hints.length ? s.showMe : null,
    },
    finished: run.phase === 'VICTORY' || (t.beat === beats.length - 1 && !s),
    putBack: putBackOffered(run, content),
  };
}
