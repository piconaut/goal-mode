// Chapter start states (PRO-02, docs/prologue-design.md §6.5, §11.6): replayed from a reference command log rather
// than stored saves, so skip, replay and put-it-back start from states that stay correct as the sim changes.
import type { DifficultyId } from '../../content/difficulty';
import { packOf } from '../../content/packs';
import { scenarioFor } from '../difficulty';
import { applyGameCommand, type GameCommand } from '../commands';
import { advance, newRun } from '../run';
import type { RunState } from '../types';
import type { ServiceDefinition } from '../../sim/wlm/types';

export type ReplayEntry = GameCommand | { kind: 'ADVANCE'; ticks: number } | { kind: 'CHAPTER'; id: string };

export interface ReplayLog {
  scenario: string;
  seed: number;
  difficulty: DifficultyId;
  entries: ReplayEntry[];
}

/** Every state of the log's replay, after each entry, with the chapter markers passed (for tests and tools). A command
 *  the game refuses is a stale log, so it throws rather than replaying a different week. */
export function* replayStates(log: ReplayLog): Generator<{ run: RunState; pending: ServiceDefinition | null; entry: ReplayEntry }> {
  const pack = packOf(log.scenario);
  if (pack.id !== log.scenario) throw new Error(`Unknown scenario ${log.scenario}`);
  let run = newRun(pack.scenario, pack.game, log.seed, log.difficulty);
  let pending: ServiceDefinition | null = null;
  yield { run, pending, entry: { kind: 'CHAPTER', id: '' } };
  for (const e of log.entries) {
    if (e.kind === 'ADVANCE') run = advance(run, pack.scenario, pack.game, e.ticks);
    else if (e.kind !== 'CHAPTER') {
      const out = applyGameCommand(run, pending, e, pack.game, scenarioFor(pack.scenario, run.difficulty));
      if (!out.ok) throw new Error(`Replay refused ${e.kind}: ${out.message}`);
      run = out.run;
      pending = out.pending;
    }
    yield { run, pending, entry: e };
  }
}

/** Replay the log from a new run up to the `CHAPTER` marker of `chapterId` (the whole log when it is null). */
export function replayToChapter(log: ReplayLog, chapterId: string | null): { run: RunState; pending: ServiceDefinition | null } {
  let last: { run: RunState; pending: ServiceDefinition | null } | null = null;
  for (const st of replayStates(log)) {
    if (st.entry.kind === 'CHAPTER' && st.entry.id === chapterId && chapterId !== null) return { run: st.run, pending: st.pending };
    last = st;
  }
  if (chapterId !== null) throw new Error(`No chapter ${chapterId} in the log`);
  return { run: last!.run, pending: last!.pending };
}
