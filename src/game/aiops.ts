// AIOps anomaly detection (tool AIOPS, SPEC §8 tier 4): ranked root-cause hypotheses for a new
// incident, built from the same response-time evidence the player can see. Usually right, sometimes
// confidently wrong (seeded); accepting a wrong one is the player's call.

import { AIOPS } from '../content/alerts';
import type { Rng } from '../sim/core/rng';
import { MECHANISMS, TRIGGERS } from './sla';
import type { Incident, Mechanism, Trigger } from './types';

export interface Hypothesis {
  mechanism: Mechanism;
  trigger: Trigger;
  confidence: number;
}

const groupToMechanism = (g: string): Mechanism => (g === 'CPU' ? 'CPU_PRIORITY' : (g as Mechanism));

export function aiopsHypotheses(truth: Incident['truth'], rankedGroups: readonly string[], rng: Rng): Hypothesis[] {
  // Plausible alternatives first: what else grew, then the rest of the taxonomy.
  const alternatives = [...new Set([...rankedGroups.map(groupToMechanism), ...MECHANISMS])].filter((m) => m !== truth.mechanism);
  const mechs: Mechanism[] = rng.chance(AIOPS.mechanismAccuracy) ? [truth.mechanism, ...alternatives] : [alternatives[0]!, truth.mechanism, ...alternatives.slice(1)];
  const otherTriggers = TRIGGERS.filter((t) => t !== truth.trigger);
  const wrongTrigger = otherTriggers[rng.int(0, otherTriggers.length)]!;
  const topTrigger = rng.chance(AIOPS.triggerAccuracy) ? truth.trigger : wrongTrigger;
  let conf = rng.range(AIOPS.topConfidence[0], AIOPS.topConfidence[1]);
  return mechs.slice(0, AIOPS.hypotheses).map((mechanism, i) => {
    const h = { mechanism, trigger: i === 0 ? topTrigger : truth.trigger, confidence: Math.round(conf * 100) / 100 };
    conf = conf * rng.range(0.35, 0.6);
    return h;
  });
}
