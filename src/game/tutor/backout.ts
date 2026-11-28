// The handover's back-out list (PRO-02, docs/prologue-design.md §3.2, §11.2): the end-of-prologue configuration
// against the canonical Day 1 state, one line per difference, in a fixed order. Day 1 starts from the canonical state
// either way; the list is what makes that honest.
import type { RunState } from '../types';

/** The configuration a handover covers, by section, in the order the list reads. */
const SECTIONS: { label: string; of: (r: RunState) => unknown }[] = [
  { label: 'WLM policy', of: (r) => r.sim.wlm.definition },
  { label: 'Hardware', of: (r) => r.sim.config.cpcs },
  { label: 'LPAR', of: (r) => r.sim.config.lpars },
  { label: 'Capacity group', of: (r) => r.sim.config.capacityGroups },
  { label: 'Coupling facility', of: (r) => r.sim.config.cfs },
  { label: 'CF structure', of: (r) => r.sim.config.cfStructures },
  { label: 'Db2', of: (r) => r.sim.config.db2 },
  { label: 'CICS', of: (r) => r.sim.config.cics },
  { label: 'Initiators', of: (r) => r.sim.config.jobClasses },
  { label: 'DASD', of: (r) => r.sim.config.dasd },
  { label: 'RMF interval', of: (r) => r.sim.config.rmfIntervalMin },
  { label: 'Routing', of: (r) => r.sim.routing },
  { label: 'Routing policy', of: (r) => r.sim.routingPolicies ?? {} },
  { label: 'Project', of: (r) => r.projects },
];

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const text = (x: unknown): string => (x === undefined || x === null ? 'none' : typeof x === 'object' ? JSON.stringify(x) : String(x));

/** An array element's key: its id, name or name@lparId, else its index. */
function keyOf(x: unknown, i: number): string {
  if (!isObj(x)) return `#${i}`;
  const id = x.id ?? x.name ?? x.policyName ?? x.serviceClass;
  if (id === undefined) return `#${i}`;
  return typeof x.lparId === 'string' ? `${String(id)}@${x.lparId}` : String(id);
}

/** Leaf differences between two values, as `path: before → after`, keys in Day 1's order then the new ones sorted. */
function diff(path: string, a: unknown, b: unknown, out: string[]): void {
  if (JSON.stringify(a) === JSON.stringify(b)) return;
  if (Array.isArray(a) && Array.isArray(b)) {
    const am = new Map(a.map((x, i) => [keyOf(x, i), x]));
    const bm = new Map(b.map((x, i) => [keyOf(x, i), x]));
    const keys = [...am.keys(), ...[...bm.keys()].filter((k) => !am.has(k)).sort()];
    for (const k of keys) {
      if (!bm.has(k)) out.push(`${path} ${k}: removed`);
      else if (!am.has(k)) out.push(`${path} ${k}: added`);
      else diff(`${path} ${k}`, am.get(k), bm.get(k), out);
    }
    return;
  }
  if (isObj(a) && isObj(b)) {
    const keys = [...Object.keys(a), ...Object.keys(b).filter((k) => !(k in a)).sort()];
    for (const k of keys) diff(`${path} ${k}`, a[k], b[k], out);
    return;
  }
  out.push(`${path}: ${text(a)} → ${text(b)}`);
}

/** One line per setting that differs from Day 1's, in section order. Empty when the run changed nothing. */
export function backoutList(end: RunState, day1: RunState): string[] {
  const out: string[] = [];
  for (const s of SECTIONS) diff(s.label, s.of(day1), s.of(end), out);
  return out;
}
