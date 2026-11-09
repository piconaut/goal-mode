// Which Codex entries the player has met in this run (the UI also remembers them across runs).

import { CODEX } from '../content/codex/entries';
import { DB2_CONNECT_FAIL } from '../sim/subsys/batch';
import type { RunState } from './types';

export function codexDiscovered(run: RunState): string[] {
  const reports = new Set((run.codexReports ?? []).map((k) => k.split(':')[0]!));
  const events = new Set(run.events.filter((e) => e.started).map((e) => e.defId));
  const flags = new Set<string>(run.tfpOffer ? ['TFP_OFFER'] : []);
  if (run.log.some((l) => l.includes(DB2_CONNECT_FAIL))) flags.add('DB2_CONNECT_FAIL');
  return CODEX.filter(
    (e) =>
      e.discover.start ||
      (e.discover.tools ?? []).some((t) => run.tools.includes(t)) ||
      (e.discover.reports ?? []).some((r) => reports.has(r)) ||
      (e.discover.events ?? []).some((ev) => events.has(ev)) ||
      (e.discover.flags ?? []).some((f) => flags.has(f)),
  ).map((e) => e.id);
}
