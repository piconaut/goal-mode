import { describe, expect, it } from 'vitest';
import { applyPlayCommand, catalogText, clockText, decodePlayFile, intervalId, mon3Text, encodePlayFile, newPlayFile, statusText, type PlayCommand, type PlayFile } from '../../tools/playCore';
import { TICKS_PER_HOUR } from '../../src/sim/core/units';

function run(file: PlayFile, cmds: PlayCommand[]): PlayFile {
  for (const c of cmds) {
    const r = applyPlayCommand(file, c);
    expect(r.ok, r.text).toBe(true);
    file = r.file;
  }
  return file;
}

describe('headless play interface', () => {
  it('a run file round-trips bit-identically, Infinity included, and keeps the command log', () => {
    const a = run(newPlayFile(7), [{ cmd: 'start' }, { cmd: 'advance', hours: 1 }]);
    const b = decodePlayFile(encodePlayFile(a));
    const next = (f: PlayFile) => encodePlayFile(run(f, [{ cmd: 'advance', hours: 1 }]));
    expect(next(b)).toBe(next(a));
    expect(a.log.map((c) => c.cmd)).toEqual(['new', 'start', 'advance']);
  });

  it('new starts a run from an empty play file, as the CLI does, and refuses an unknown scenario', () => {
    const empty = { version: 1, log: [] } as unknown as PlayFile;
    const r = applyPlayCommand(empty, { cmd: 'new', seed: 3, difficulty: 'NORMAL', scenario: 'harbourline' });
    expect(r.ok).toBe(true);
    expect(r.file.run.scenarioId).toBe('harbourline');
    expect(r.file.log).toHaveLength(1);
    expect(applyPlayCommand(empty, { cmd: 'new', seed: 3, difficulty: 'NORMAL', scenario: 'harbourine' }).ok).toBe(false);
  });

  it('refuses commands that do not fit the phase and does not log them', () => {
    const f = newPlayFile(7);
    const r = applyPlayCommand(f, { cmd: 'advance', hours: 2 });
    expect(r.ok).toBe(false);
    expect(r.file.log).toHaveLength(1);
  });

  it('status shows the briefing but never the incident ground truth', () => {
    const text = statusText(newPlayFile(7));
    expect(text).toContain('BRIEFING');
    expect(text).not.toMatch(/truth|mechanism/i);
  });

  it('catalog lists orderable items; Monitor III shows once the tool is owned', () => {
    let f = newPlayFile(7);
    expect(catalogText(f)).toContain('PERM_CP');
    expect(mon3Text(f)).toContain('needs the MON3 tool');
    f = { ...f, run: { ...f.run, insight: 50 } };
    f = run(f, [{ cmd: 'buy', toolId: 'RMF_MON3' }, { cmd: 'start' }, { cmd: 'advance', hours: 1 }]);
    expect(mon3Text(f)).toMatch(/^Monitor III, last \d+s/);
    expect(mon3Text(f)).toContain('SYSINFO');
    expect(mon3Text(f, { json: true }).split('\n')[1]).toMatch(/^\{/);
    expect(mon3Text(f, { system: 'NOSUCH' })).toContain('No system NOSUCH');
  });

  it('clock text names the weekday: the small hours still belong to the played day that began at 06:00', () => {
    expect(clockText(0)).toBe('D1 Mon 06:00');
    expect(clockText(18.5 * TICKS_PER_HOUR)).toBe('D1 Tue 00:30');
  });

  it('RMF intervals have stable ids for report and pin; a bare class name means period 1', () => {
    let f = run(newPlayFile(7), [{ cmd: 'start' }, { cmd: 'advance', hours: 2 }]);
    expect(applyPlayCommand(f, { cmd: 'report', kind: 'WLM_SUMMARY' }).ok, 'today is hidden without Monitor III').toBe(false);
    f = run(f, [{ cmd: 'advance', hours: 24 }]);
    const iv = f.run.sim.rmf.intervals[0]!;
    const id = intervalId(iv);
    const r = applyPlayCommand(f, { cmd: 'report', kind: 'WLM_DETAIL', id, scKey: 'ONLHI' });
    expect(r.ok, r.text).toBe(true);
    expect(r.text).toContain(`RMF interval ${id}`);
    expect(r.text).toContain('PERIOD=1');
    const bad = applyPlayCommand(f, { cmd: 'report', kind: 'WLM_DETAIL', id, scKey: 'NOPE' });
    expect(bad.ok).toBe(false);
    expect(bad.text).toContain('ONLHI#1');
    f = run(f, [{ cmd: 'pin', req: { source: 'WLMGL', index: -1, system: '*PLEX', scKey: 'ONLHI', metric: 'PI' }, intervalId: id }]);
    expect(f.run.pins).toHaveLength(1);
    expect(statusText(f)).toContain(`RMF intervals (report KIND <id>): ${id}..`);
  });

  it('asking around, pinning evidence and unpinning go through the real game functions', () => {
    // Monitor III makes today's RMF intervals visible, so they can be pinned while the day runs.
    const f0 = newPlayFile(7);
    let f = run({ ...f0, run: { ...f0.run, insight: 50 } }, [{ cmd: 'buy', toolId: 'RMF_MON3' }, { cmd: 'ask', topic: 'CALENDAR' }, { cmd: 'start' }, { cmd: 'advance', hours: 2 }]);
    expect(applyPlayCommand(f, { cmd: 'ask', topic: 'GROWTH' }).ok).toBe(false);
    f = run(f, [{ cmd: 'pin', req: { source: 'WLMGL', index: 0, system: '*PLEX', scKey: 'ONLHI#1', metric: 'PI' } }]);
    const id = f.run.pins[0]!.id;
    expect(statusText(f)).toContain('pinned evidence');
    expect(applyPlayCommand(f, { cmd: 'rca', incidentId: 1, mechanism: 'CPU_PRIORITY', trigger: 'POLICY', evidenceIds: [id + 99] }).ok).toBe(false);
    f = run(f, [{ cmd: 'unpin', id }]);
    expect(f.run.pins).toHaveLength(0);
  });

  it('notes are logged without touching the run; hour-by-hour advance (--pace) ends in the same state', () => {
    const base = run(newPlayFile(7), [{ cmd: 'start' }]);
    const noted = run(base, [{ cmd: 'note', text: 'watching PROD2' }]);
    expect(encodePlayFile({ ...noted, log: [] })).toBe(encodePlayFile({ ...base, log: [] }));
    const once = run(base, [{ cmd: 'advance', hours: 2 }]);
    const paced = run(base, [{ cmd: 'advance', hours: 1 }, { cmd: 'advance', hours: 1 }]);
    expect(encodePlayFile({ ...paced, log: [] })).toBe(encodePlayFile({ ...once, log: [] }));
  });
});
