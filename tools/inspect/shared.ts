export const hexDp = (n: number) => n.toString(16).toUpperCase();

/** The play CLI's `advance` stops after the hour in which a job abends that was not abended when the advance began
 * (and at the end of a played day); the commands after that point in the log were issued there, so a faithful replay
 * stops too. `before` is the set at the start of the logged advance, not of the hour: a restart that clears an abend
 * mid-advance does not stop the CLI, and neither does a re-abend of a job that was abended at the start. */
export const stoppedEarly = (before: ReadonlySet<string>, after: ReadonlySet<string>): boolean =>
  [...after].some((name) => !before.has(name));

/** Replay one logged `advance` of `hours` an hour at a time, stopping where the play CLI did (`stoppedEarly` against
 * the abended set at the start of the advance). `hour` runs one hour and returns false when the replay must stop for
 * its own reasons (end of range, day over); it may return false before running anything. Returns the number of `hour`
 * calls, which counts such a call too. */
export function replayAdvance(hours: number, abended: () => ReadonlySet<string>, hour: () => boolean): number {
  const before = abended();
  let ran = 0;
  while (ran < hours) {
    ran++;
    if (!hour() || stoppedEarly(before, abended())) break;
  }
  return ran;
}
