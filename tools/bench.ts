// Headless benchmark: one played day with a fixed seed and no player actions.
// Usage: npm run bench [-- --days N --seed S]
import { createHash } from 'node:crypto';
import { SCENARIOS } from '../src/content/scenarios';
import { initState } from '../src/sim/core/init';
import { step } from '../src/sim/core/step';
import { TICKS_PER_DAY } from '../src/sim/core/units';

const arg = (name: string, dflt: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : dflt;
};
const days = Number(arg('days', '1'));
const scenario = SCENARIOS.midwest!;
let s = initState(Number(arg('seed', '42')), scenario);
const t0 = performance.now();
for (let d = 0; d < days; d++) {
  const td = performance.now();
  for (let t = 0; t < TICKS_PER_DAY; t++) s = step(s, [], scenario);
  console.log(`day ${d + 1}: ${((performance.now() - td) / 1000).toFixed(2)} s (${((performance.now() - td) / TICKS_PER_DAY).toFixed(2)} ms/tick)`);
}
console.log(`total ${((performance.now() - t0) / 1000).toFixed(2)} s for ${days} day(s)`);
// Optimisations must not change behaviour: compare this hash before and after.
if (process.argv.includes('--hash')) console.log('state hash', createHash('sha256').update(JSON.stringify(s)).digest('hex').slice(0, 16));
