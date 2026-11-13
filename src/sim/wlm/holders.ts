// Who holds a dispatching priority (docs/wlm-design.md §5.1, §5.8). Regions serving the same set of transaction
// service classes form a dynamic internal service class period, `$SRMSnnn`, which holds the dispatching priority and
// collects the regions' samples (SG24-6472-03 p.86–88; WLM Services p.136–137). The served class is the goal receiver
// or donor and the internal period the resource receiver or donor (WLM Services p.138). The regions' priority follows
// the most important and most unhappy transactions they serve, so less important transactions in the same regions get
// a free ride (SG24-6472-03 p.62–63). Every other goal period holds its own priority.

import type { LparEvalInput, SliceSpec } from './eval/types';

/** The image's one server period. APPROX: one per image, because the sim does not split a workload's transactions
 * between regions (IBM: one per set of regions serving the same classes). */
export const SERVER_KEY = '$SRMS001';

export interface HolderTopology {
  /** The server period, when any AOR on the image is managed to TRANSACTION goals and it serves a goal period. */
  serverKey: string | null;
  /** Goal periods held by another holder → that holder. Absent = the period is its own holder. */
  heldBy: Readonly<Record<string, string>>;
  /** Region classes in `heldBy`, sorted: every member on the image is a transaction-server region, so the class is
   * ignored (SG24-6472-03 p.89: "The external service class of a server is ignored"). It takes the server period's DP
   * but is neither receiver nor donor and gives the server period no importance. */
  attached: readonly string[];
}

export const NO_SERVERS: HolderTopology = { serverKey: null, heldBy: {}, attached: [] };

/**
 * The holders of an image's goal periods (`goalKeys`). CICS transaction periods are held by the server period while
 * any AOR is TRANSACTION (`regions.serverKey`). Under REGION or BOTH the transactions run at the region class's DP
 * and their classes keep a DP each, as before server periods (not a player lever: `wlmEdit.ts`).
 */
export function holderTopology(
  regions: LparEvalInput['regions'],
  goalKeys: Iterable<string>,
  slices: readonly Pick<SliceSpec, 'key' | 'scKey'>[] = [],
): HolderTopology {
  const server = regions?.serverKey;
  if (!server) return NO_SERVERS;
  const goal = new Set(goalKeys);
  const heldBy: Record<string, string> = {};
  for (const k of regions!.keys) if (goal.has(k)) heldBy[k] = server;
  if (Object.keys(heldBy).length === 0) return NO_SERVERS;
  // Structural, so idle regions do not change it; every such class, not only the first AOR's.
  const srv = new Set(regions!.servers ?? []);
  const candidates = new Set(slices.filter((x) => srv.has(x.key)).map((x) => x.scKey));
  const attached: string[] = [];
  for (const c of [...candidates].sort()) {
    if (!goal.has(c) || heldBy[c] !== undefined) continue;
    if (slices.every((x) => x.scKey !== c || srv.has(x.key))) attached.push(c);
  }
  for (const c of attached) heldBy[c] = server;
  return { serverKey: server, heldBy, attached };
}

/** The goal periods a server period serves: its held periods less the attached region classes. */
export const servedKeys = (t: HolderTopology): string[] => Object.keys(t.heldBy).filter((k) => !t.attached.includes(k));

export const holderOf = (t: HolderTopology, k: string): string => t.heldBy[k] ?? k;

/** The goal periods a holder serves, sorted (a period that is its own holder serves itself). */
export function servedBy(t: HolderTopology, holder: string, goalKeys: readonly string[]): string[] {
  return goalKeys.filter((k) => holderOf(t, k) === holder).sort();
}

/** Every served period takes its holder's DP: what reports show and saves keep (§5.1). */
export function expandHolderDps(t: HolderTopology, dps: Record<string, number>): Record<string, number> {
  for (const k of Object.keys(t.heldBy)) {
    const d = dps[t.heldBy[k]!];
    if (d !== undefined) dps[k] = d;
  }
  return dps;
}
