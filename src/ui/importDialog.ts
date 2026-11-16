// What the import dialog does with a worker result. The worker posts IMPORT_RESULT (PR-05) so the dialog never
// infers the outcome from toast wording; a result object is handled once, and only while an import is in flight.
export type ImportResult = { ok: boolean; message: string } | null;

export type ImportOutcome = { close: true } | { notice: string } | null;

export function importOutcome(loading: boolean, result: ImportResult, seen: ImportResult): ImportOutcome {
  if (!loading || !result || result === seen) return null;
  return result.ok ? { close: true } : { notice: result.message };
}
