// The fewest pins that can satisfy a set of proof predicates (RT-13 tests): a symbolic reading of the recipe tables,
// in which one pin may serve several options when they read the same metric in a shared relation and their tests can
// hold together on one value (a cost pin's rate reading is a second value on the same row).
// It is a lower bound, not a witness: it ignores which incident kinds have the rows an option reads (Db2 101 for a
// CICS or DDF workload, SMF 30 for a batch night) and the `batchClass`/`displaceable` filters, so a pair it fits in
// three pins could still need a fourth for some incident. The per-claim fixture tests cover reachability.
import type { PredicateOption, ProofPredicate } from '../../src/content/evidence';

type Direction = 'up' | 'down' | 'normal' | 'fresh';

const direction = (o: PredicateOption): Direction => {
  switch (o.test.kind) {
    case 'below':
      return 'down';
    case 'normal':
      return 'normal';
    case 'noHistory':
      return 'fresh';
    default:
      return 'up';
  }
};

const needsBaseline = (o: PredicateOption) => o.test.kind === 'ratioAtLeast' || o.test.kind === 'normal' || o.test.kind === 'riseBy';

/** Can one pin satisfy both options? */
export function compatible(a: PredicateOption, b: PredicateOption): boolean {
  if (a.metric !== b.metric || !a.relations.some((r) => b.relations.includes(r))) return false;
  if ((a.reading ?? 'value') !== (b.reading ?? 'value')) return true;
  const [da, db] = [direction(a), direction(b)];
  if (da === 'fresh' || db === 'fresh') return da === db || (da === 'fresh' ? !needsBaseline(b) && db === 'up' : !needsBaseline(a) && da === 'up');
  return da === db;
}

/** Fewest pins satisfying every predicate, and one choice of options that achieves it. A `rulesOut` option is
 *  only reachable with a first-predicate option whose metric it names (RT-34): its queue's look-alike. */
export function minPins(predicates: readonly ProofPredicate[]): { pins: number; options: PredicateOption[] } {
  let best = { pins: Infinity, options: [] as PredicateOption[] };
  const choose = (k: number, chosen: PredicateOption[]) => {
    if (k === predicates.length) {
      const n = cover(chosen);
      if (n < best.pins) best = { pins: n, options: [...chosen] };
      return;
    }
    for (const o of predicates[k]!.options) {
      if (k > 0 && o.rulesOut && !o.rulesOut.includes(chosen[k - 1]!.metric)) continue;
      choose(k + 1, [...chosen, o]);
    }
  };
  choose(0, []);
  return best;
}

/** Minimum number of groups of mutually compatible options. */
function cover(options: readonly PredicateOption[]): number {
  let best = options.length;
  const groups: PredicateOption[][] = [];
  const place = (k: number) => {
    if (groups.length >= best) return;
    if (k === options.length) {
      best = groups.length;
      return;
    }
    const o = options[k]!;
    for (const g of groups) {
      if (g.every((x) => compatible(x, o))) {
        g.push(o);
        place(k + 1);
        g.pop();
      }
    }
    groups.push([o]);
    place(k + 1);
    groups.pop();
  };
  place(0);
  return best;
}
