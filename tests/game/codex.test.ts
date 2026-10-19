import { readdirSync, readFileSync } from 'node:fs';
import { CODEX } from '../../src/content/codex/entries';
import { MIDWEST_EVENTS } from '../../src/content/events/midwest-events';
import { MIDWEST_GAME } from '../../src/content/game-midwest';
import { MIDWEST } from '../../src/content/scenarios';
import { PROJECTS } from '../../src/content/projects';
import { TOOLS } from '../../src/content/tools';
import { codexDiscovered } from '../../src/game/codex';
import { newRun } from '../../src/game/run';
import { noteReportOpened, REPORT_FEATURE } from '../../src/game/tools';

describe('Codex', () => {
  it('every entry has a source and its discovery hooks exist', () => {
    const tools = new Set(TOOLS.map((t) => t.id));
    const events = new Set(MIDWEST_EVENTS.map((e) => e.id));
    const reports = new Set(Object.keys(REPORT_FEATURE));
    expect(new Set(CODEX.map((e) => e.id)).size).toBe(CODEX.length);
    for (const e of CODEX) {
      expect(e.sources.length, e.id).toBeGreaterThan(0);
      for (const t of e.discover.tools ?? []) expect(tools.has(t), `${e.id}: tool ${t}`).toBe(true);
      for (const ev of e.discover.events ?? []) expect(events.has(ev), `${e.id}: event ${ev}`).toBe(true);
      for (const r of e.discover.reports ?? []) expect(reports.has(r), `${e.id}: report ${r}`).toBe(true);
    }
  });

  it('every contextual "?" link in the UI names a real entry', () => {
    const ids = new Set(CODEX.map((e) => e.id));
    const used: string[] = [];
    for (const f of readdirSync('src/ui').filter((x) => x.endsWith('.tsx'))) {
      const src = readFileSync(`src/ui/${f}`, 'utf8');
      for (const m of src.matchAll(/(?:ids=\{\[|codex=\{\[)([^\]]*)\]/g)) for (const q of m[1]!.matchAll(/'([a-z0-9-]+)'/g)) used.push(q[1]!);
    }
    expect(used.length).toBeGreaterThan(15);
    for (const id of used) expect(ids.has(id), id).toBe(true);
    for (const p of PROJECTS) if (p.codex) expect(ids.has(p.codex), p.codex).toBe(true);
  });

  it('discovers entries from the start, tools, reports and events', () => {
    const r = newRun(MIDWEST, { ...MIDWEST_GAME, events: [] }, 7);
    const start = codexDiscovered(r);
    expect(start).toContain('perf-index');
    expect(start).not.toContain('hiperdispatch');
    expect(codexDiscovered({ ...r, tools: ['PARTITION_DATA'] })).toContain('hiperdispatch');
    expect(codexDiscovered(noteReportOpened(r, 'CF:3'))).toContain('cf-sync-async');
    const withEvent = { ...r, events: [{ ...({} as (typeof r.events)[number]), defId: 'DASD_DEGRADED', started: true }] };
    expect(codexDiscovered(withEvent)).toContain('hyperpav');
  });
});
