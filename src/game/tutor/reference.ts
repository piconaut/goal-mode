// The prologue's reference command log (design §6.5, §11.6): one played-through week with a `CHAPTER` marker at each
// chapter's start. Skip, replay and "put it back" all start from a state replayed from it (`replayToChapter`), so
// the states stay correct as the sim changes. PRO-04 … PRO-06 extend it with each chapter they add.
import type { ReplayLog } from './replay';

export const PROLOGUE_REFERENCE: ReplayLog = {
  scenario: 'midwest-prologue',
  seed: 42,
  difficulty: 'NORMAL',
  entries: [
    { kind: 'CHAPTER', id: 'MON' },
    { kind: 'START' },
    { kind: 'ADVANCE', ticks: 1 },
    { kind: 'TUTOR_ACK' },
    { kind: 'TUTOR_NOTE', noteKind: 'tab', ref: 'console' },
    { kind: 'ADVANCE', ticks: 2000 },
    { kind: 'TUTOR_ACK' },
    { kind: 'ADVANCE', ticks: 360 },
  ],
};
