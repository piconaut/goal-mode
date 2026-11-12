import { repeatsClue } from '../../src/sim/core/tick/control';

const note = (clock: string, pi: string, why = 'harms TSO#2, equal importance (no net gain)', sys = 'PROD2', rcvr = 'DDFPRD#2') =>
  `D1 ${clock} ${sys} ${rcvr} PI=${pi} BTLNK=CPU no action with net value (UP ${rcvr} DP EE→F0 rejected: ${why}), next look 10:00:00`;

describe('skip-clock notes in the WLM log (WT-08)', () => {
  it('repeats an unchanged clue for the same receiver at most every five minutes', () => {
    const log = [note('09:08:00', '1.54')];
    expect(repeatsClue(log, note('09:09:10', '1.52'))).toBe(true); // PI changed, clue did not
    expect(repeatsClue(log, note('09:12:50', '1.50'))).toBe(true);
    expect(repeatsClue(log, note('09:13:00', '1.50'))).toBe(false); // five minutes later
  });

  it('logs a changed reason, another receiver or system, and a clue after a move', () => {
    const log = [note('09:08:00', '1.54')];
    expect(repeatsClue(log, note('09:09:00', '1.52', 'no gain for the receiver'))).toBe(false);
    expect(repeatsClue(log, note('09:09:00', '1.52', undefined, 'PROD1'))).toBe(false);
    expect(repeatsClue(log, note('09:09:00', '1.52', undefined, 'PROD2', 'TSO#2'))).toBe(false);
    const moved = [...log, 'D1 09:08:30 PROD2 RCVR=DDFPRD#2 PI=1.50 BTLNK=CPU UP DDFPRD#2 DP EE→F0'];
    expect(repeatsClue(moved, note('09:09:00', '1.52'))).toBe(false);
    // Lines about other receivers in between do not hide the last one about this receiver.
    const other = [...log, 'D1 09:08:30 PROD2 TSO#2 PI=1.20 BTLNK=CPU not WLM-fixable'];
    expect(repeatsClue(other, note('09:09:00', '1.52'))).toBe(true);
  });
});
