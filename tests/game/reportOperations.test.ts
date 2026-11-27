// PR-26: the day report card's operation lines, built from the sim state at the day's close. The cross-report
// identity (tests/helpers/reportIdentities.ts, `day-report-operations`) checks the report against a closed run; these
// cases pin the branches a report run does not reach: no mode, a mode on an id that is not a gateway channel, a
// released backlog, and an empty recall queue.

import { MIDWEST_GAME } from '../../src/content/game-midwest';
import { MIDWEST } from '../../src/content/scenarios';
import { gatewayStatus, recallStatus } from '../../src/game/operations';
import { newRun } from '../../src/game/run';
import type { RunState } from '../../src/game/types';
import { gatewayChannels } from '../../src/sim/core/operations';

const withSim = (run: RunState, sim: Partial<Pick<RunState['sim'], 'gatewayModes' | 'hsmRecalls'>>): RunState =>
  ({ ...run, sim: { ...run.sim, ...sim } });

describe('day report operation lines (PR-26)', () => {
  const run = newRun(MIDWEST, MIDWEST_GAME, 7);
  const channel = gatewayChannels(run.sim, MIDWEST)[0]!;

  it('names each protected channel with its mode, and no mode elsewhere', () => {
    expect(gatewayStatus(withSim(run, { gatewayModes: undefined }), MIDWEST)).toEqual([]);
    expect(gatewayStatus(withSim(run, { gatewayModes: {} }), MIDWEST)).toEqual([]);
    expect(gatewayStatus(withSim(run, { gatewayModes: { [channel.id]: 'LIMIT' } }), MIDWEST))
      .toEqual([{ id: channel.id, name: channel.name, mode: 'LIMIT' }]);
    // A mode left on an id that is no longer a channel is not an external gateway line.
    expect(gatewayStatus(withSim(run, { gatewayModes: { BATCH: 'BLOCK' } }), MIDWEST)).toEqual([]);
  });

  it('reports a hold, a released backlog, and nothing when the queue is empty', () => {
    expect(recallStatus(withSim(run, { hsmRecalls: undefined }))).toBeNull();
    expect(recallStatus(withSim(run, { hsmRecalls: { heldSinceTick: 100, backlogIo: 0 } })))
      .toEqual({ held: true, heldSinceTick: 100, backlogIo: 0 });
    expect(recallStatus(withSim(run, { hsmRecalls: { heldSinceTick: null, backlogIo: 500 } })))
      .toEqual({ held: false, heldSinceTick: null, backlogIo: 500 });
    expect(recallStatus(withSim(run, { hsmRecalls: { heldSinceTick: null, backlogIo: 0 } }))).toBeNull();
  });
});
