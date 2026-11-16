import { SCENARIOS } from '../../src/content/scenarios';
import { initState } from '../../src/sim/core/init';
import { step } from '../../src/sim/core/step';
import { TICKS_PER_HOUR } from '../../src/sim/core/units';

// One short pair per scenario. The sim state must be a pure function of the seed and the commands, and this is the
// cheap check that every scenario still is: the golden runs cover Midwest in full, and the per-file pairs elsewhere in
// the suite are gone. Revenue's game-layer test (scenarios.test.ts) still replays six hours through `advance` and
// compares its sim slice; the golden runs compare the whole RunState (Midwest, seed 42).
describe('scenario determinism', () => {
  for (const sc of Object.values(SCENARIOS)) {
    it(`${sc.id} replays one hour identically`, () => {
      const run = () => {
        let s = initState(7, sc);
        for (let i = 0; i < TICKS_PER_HOUR; i++) s = step(s, [], sc);
        return s;
      };
      expect(JSON.stringify(run())).toBe(JSON.stringify(run()));
    });
  }
});
