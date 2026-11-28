// The prologue's step engine (PRO-02, docs/prologue-design.md §6.2, §11.2–§11.3). Beats are stop ticks: `advance`
// stops the clock when the next beat is due, and the beat's steps complete as their predicates hold, however the
// player gets there. Pure functions over `RunState.tutor`; the sim never sees any of it.
import type { PrologueRules, TutorBeat, TutorStep } from '../../content/types';
import { tickOfPlayedHour } from '../../sim/core/clock';
import { TICKS_PER_DAY } from '../../sim/core/units';
import { hourOfText } from '../run/events';
import type { RunState, TutorState } from '../types';
import { holds } from './predicates';

export const newTutor = (): TutorState => ({
  chapter: 0, beat: -1, step: 0, done: [], hintsUsed: 0, hintRung: 0, refiles: {}, notes: [], undoBase: null, scriptedFailures: [],
});

/** Every beat in script order, with its chapter's index. */
export const beatsOf = (rules: PrologueRules): { chapter: number; beat: TutorBeat }[] =>
  rules.chapters.flatMap((c, chapter) => c.beats.map((beat) => ({ chapter, beat })));

/** The tick a beat's `at` names (its played day plus the wall-clock time), or null for a pure condition beat. */
export const beatTick = (beat: TutorBeat): number | null =>
  beat.at ? beat.at.day * TICKS_PER_DAY + tickOfPlayedHour(hourOfText(beat.at.time)) : null;

/** The current beat and step, or null before the first beat and after the script. */
export function currentStep(run: RunState, rules: PrologueRules): { beat: TutorBeat; step: TutorStep | null; chapter: number } | null {
  const t = run.tutor;
  if (!t || t.beat < 0) return null;
  const b = beatsOf(rules)[t.beat];
  if (!b) return null;
  return { beat: b.beat, step: b.beat.steps[t.step] ?? null, chapter: b.chapter };
}

/**
 * The beat due at the clock's current tick, if any: the first later timed beat whose tick has come, or the next beat
 * when it is a condition beat whose condition holds at an hour boundary (and its `at`, if any, has come). Entering a
 * later beat skips the ones between, so a condition that never came cannot hold the script.
 */
export function dueBeat(run: RunState, rules: PrologueRules, atHourBoundary: boolean): number | null {
  const t = run.tutor;
  if (!t) return null;
  const beats = beatsOf(rules);
  const tick = run.sim.tick;
  for (let j = t.beat + 1; j < beats.length; j++) {
    const b = beats[j]!.beat;
    const at = beatTick(b);
    if (!b.when) {
      if (at !== null && at <= tick) return j;
      return null;
    }
    if (j === t.beat + 1 && atHourBoundary && (at === null || at <= tick) && holds(run, b.when)) return j;
  }
  return null;
}

/** Make beat `index` current and complete whatever of it already holds. */
export function enterBeat(run: RunState, rules: PrologueRules, index: number): RunState {
  const t = run.tutor!;
  const beats = beatsOf(rules);
  const skipped = beats.slice(t.beat + 1, index).flatMap((b) => b.beat.steps.map((s) => `skipped:${s.id}`));
  const rest = currentStep(run, rules)?.beat.steps.slice(t.step).map((s) => `skipped:${s.id}`) ?? [];
  const tutor: TutorState = { ...t, beat: index, step: 0, hintRung: 0, chapter: beats[index]!.chapter, done: [...t.done, ...rest, ...skipped] };
  return progressTutor({ ...run, tutor }, rules);
}

/** Complete the current beat's steps while their predicates hold; skip a step whose precondition does not. */
export function progressTutor(run: RunState, rules: PrologueRules): RunState {
  let t = run.tutor;
  if (!t || t.beat < 0) return run;
  const beat = beatsOf(rules)[t.beat]?.beat;
  if (!beat) return run;
  while (t.step < beat.steps.length) {
    const s: TutorStep = beat.steps[t.step]!;
    const r = { ...run, tutor: t };
    if (s.precondition && !holds(r, s.precondition)) t = { ...t, step: t.step + 1, hintRung: 0, done: [...t.done, `skipped:${s.id}`] };
    else if (holds(r, s.done)) t = { ...t, step: t.step + 1, hintRung: 0, done: [...t.done, s.id] };
    else break;
  }
  return t === run.tutor ? run : { ...run, tutor: t };
}

/** Next (a read-only step) or Skip step: the current step completes, skipped unless it waits for Next. */
export function tutorAck(run: RunState, rules: PrologueRules): { run: RunState; ok: boolean; message: string } {
  const cur = currentStep(run, rules);
  if (!cur?.step) return { run, ok: false, message: 'Nothing to acknowledge: no step is waiting.' };
  const s = cur.step;
  const t = run.tutor!;
  const id = s.done.id === 'ack' ? s.id : `skipped:${s.id}`;
  const next = progressTutor({ ...run, tutor: { ...t, step: t.step + 1, hintRung: 0, done: [...t.done, id] } }, rules);
  return { run: next, ok: true, message: s.done.id === 'ack' ? 'Next.' : `Skipped step ${s.id}.` };
}

/** Navigation the UI reports (a tab, a Codex entry, a report interval): recorded, then the steps re-checked. */
export function tutorNote(run: RunState, rules: PrologueRules, kind: string, ref: string): RunState {
  const t = run.tutor;
  if (!t) return run;
  return progressTutor({ ...run, tutor: { ...t, notes: [...t.notes, { kind, ref, tick: run.sim.tick }] } }, rules);
}

/** The next rung of the current step's hint ladder (§6.3). Past the last rung the last one repeats, uncounted. */
export function tutorHint(run: RunState, rules: PrologueRules): { run: RunState; ok: boolean; message: string } {
  const s = currentStep(run, rules)?.step;
  if (!s || s.hints.length === 0) return { run, ok: false, message: 'No hint for this step.' };
  const t = run.tutor!;
  const rung = Math.min(t.hintRung, s.hints.length - 1);
  const fresh = t.hintRung < s.hints.length;
  const tutor = fresh ? { ...t, hintRung: t.hintRung + 1, hintsUsed: t.hintsUsed + 1 } : t;
  return { run: { ...run, tutor }, ok: true, message: s.hints[rung]! };
}

/** The prologue's text for the CLI and tests: the chapter, beat and step counter, the step's words and target. */
export function tutorText(run: RunState, rules: PrologueRules): string {
  const cur = currentStep(run, rules);
  if (!run.tutor) return 'Not a prologue run.';
  if (!cur) return run.tutor.beat < 0 ? 'Ruth: waiting for the first beat.' : 'The script is finished.';
  const chapter = rules.chapters[cur.chapter]!;
  const where = `${chapter.title} · beat ${cur.beat.id}`;
  if (!cur.step) return `${where}: all steps done; the clock runs to the next beat.`;
  return `${where} · ${run.tutor.step + 1}/${cur.beat.steps.length}\nRuth: ${cur.step.say}${cur.step.target ? `\ntarget: ${cur.step.target}` : ''}${cur.step.done.id === 'ack' ? '\n(tutor ack to continue)' : ''}`;
}
