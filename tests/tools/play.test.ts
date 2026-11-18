import { describe, expect, it } from 'vitest';
import { applyPlayCommand, batchStreamsText, capacityText, financeText, catalogText, clockText, decodePlayFile, openPlayFile, tickOfClock, intervalId, mon3Text, encodePlayFile, newPlayFile, policyText, statusText, wlmLogText, type PlayCommand, type PlayFile } from '../../tools/playCore';
import { OLD_SAVE_MESSAGE, SAVE_VERSION } from '../../src/game/runFile';
import { TICKS_PER_HOUR } from '../../src/sim/core/units';
import { startTfp } from '../../src/sim/cost/mlc';
import { quoteTfp } from '../../src/game/tfp';
import { scenarioFor } from '../../src/game/difficulty';
import { packOf } from '../../src/content/packs';
import { estimateMonth } from '../../src/sim/cost/mlc';
import { dpText, wlmText } from '../../tools/inspect';

function run(file: PlayFile, cmds: PlayCommand[]): PlayFile {
  for (const c of cmds) {
    const r = applyPlayCommand(file, c);
    expect(r.ok, r.text).toBe(true);
    file = r.file;
  }
  return file;
}

// A played start state costs a sim hour per 360 ticks, and most tests below only read one. Build each
// distinct start once, then hand out decoded copies, so a test that edits its file cannot affect another
// (a reload between commands is what the persistence tests already do).
const startedCache = new Map<string, PlayFile>();
function started(hours: number, scenario = 'midwest'): PlayFile {
  if (hours < 1) throw new Error('started() is for played starts; build a start-only file directly');
  const key = `${scenario}:${hours}`;
  let base = startedCache.get(key);
  if (!base) {
    base = run(newPlayFile(7, 'NORMAL', scenario), [{ cmd: 'start' }, { cmd: 'advance', hours }]);
    startedCache.set(key, base);
  }
  return decodePlayFile(encodePlayFile(base));
}

/** A played file with Monitor III owned: buy it if the scenario doesn't start with it. */
function withMon3(base: PlayFile): PlayFile {
  const f = { ...base, run: { ...base.run, insight: Math.max(base.run.insight, 50) } };
  const buy = applyPlayCommand(f, { cmd: 'buy', toolId: 'RMF_MON3' });
  return buy.ok ? buy.file : f;
}

describe('On/Off CoD deactivation', () => {
  it('moves an active lease to tomorrow', () => {
    let f = started(1);
    const day = f.run.day;
    f = {
      ...f,
      run: {
        ...f.run,
        changes: [{
          id: 99, label: 'CPM: On/Off CoD +1 CP', commands: [], hours: 0, capex: 0, opexPerDay: 9000,
          activateDay: day, plannedDay: day, emergency: false, status: 'APPLIED', revertDay: day + 3,
          revertCommands: [{ kind: 'ADD_CPC_ENGINES', cpcId: f.run.sim.config.cpcs[0]!.id, pool: 'CP', delta: -1 }], endsEvent: null,
        }],
      },
    };
    f = run(f, [{ cmd: 'cod-deactivate', changeId: 99 }]);
    expect(f.run.changes[0]!.revertDay).toBe(day + 1);
  });
});

describe('saved policy actions', () => {
  it('loads a saved policy into the editor and activates it now', () => {
    let f = started(1);
    const def = { ...f.run.sim.wlm.definition, policyName: 'NIGHTPOL' };
    f = { ...f, run: { ...f.run, policies: { saved: [def], schedule: [] } } };
    f = run(f, [{ cmd: 'policy-load', name: 'nightpol' }]);
    expect(f.pendingPolicy?.policyName).toBe('NIGHTPOL');
    f = run(f, [{ cmd: 'policy-activate', name: 'NIGHTPOL' }]);
    expect(f.pendingPolicy).toBeNull();
    f = run(f, [{ cmd: 'advance', hours: 1 }]);
    expect(f.run.sim.wlm.definition.policyName).toBe('NIGHTPOL');
  });
});

describe('save version', () => {
  it('refuses a play file from an older build with one message, not a partial load', () => {
    const old = { ...newPlayFile(7), version: 1 } as unknown as PlayFile;
    const text = encodePlayFile(old);
    for (const load of [openPlayFile, decodePlayFile]) expect(() => load(text)).toThrow(OLD_SAVE_MESSAGE);
  });

  it('loads a current play file', () => {
    expect(openPlayFile(encodePlayFile(newPlayFile(7))).version).toBe(2);
  });
});

describe('headless play interface', () => {
  it('a run file round-trips bit-identically, Infinity included, and keeps the command log', () => {
    // Built in memory on purpose: this is the guard that the encode/decode behind `started()` is lossless.
    const a = run(newPlayFile(7), [{ cmd: 'start' }, { cmd: 'advance', hours: 1 }]);
    const b = decodePlayFile(encodePlayFile(a));
    const next = (f: PlayFile) => encodePlayFile(run(f, [{ cmd: 'advance', hours: 1 }]));
    expect(next(b)).toBe(next(a));
    expect(a.log.map((c) => c.cmd)).toEqual(['new', 'start', 'advance']);
  });

  it('new starts a run from an empty play file, as the CLI does, and refuses an unknown scenario', () => {
    const empty = { version: SAVE_VERSION, log: [] } as unknown as PlayFile;
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

  it('wlmlog shows the Monitor WLM activity log, live only with Monitor III', () => {
    let f = started(1);
    expect(wlmLogText(f)).toContain('needs the RMF_MON3 tool');
    f = { ...f, run: { ...f.run, sim: { ...f.run.sim, wlm: { ...f.run.sim.wlm, log: ['D1 06:10:00 PRDA RCVR=ONLHI#1 PI=1.20 BTLNK=CPU ONLHI#1 DP F4→F6', 'D1 06:10:00 PRDB ONLHI#1 PI=1.20 BTLNK=CPU no action with net value'] } } } };
    f = { ...f, run: { ...f.run, insight: 50 } };
    f = run(f, [{ cmd: 'buy', toolId: 'RMF_MON3' }]);
    const all = wlmLogText(f);
    expect(all).toContain('RCVR=ONLHI#1');
    expect(wlmLogText(f, { system: 'PRDB' })).not.toContain('RCVR=');
    expect(wlmLogText(f, { grep: 'rcvr' })).not.toContain('no action');
    expect(wlmLogText(f, { system: 'NOSUCH' })).toContain('(no matching lines)');
  });

  it('finance shows the sub-capacity bill, then TFP pace and overage price per LPAR', () => {
    let f = started(2);
    expect(financeText(f)).toMatch(/pricing SUBCAP[\s\S]*peakR4haMsu/);
    const terms = quoteTfp(f.run, scenarioFor(packOf('midwest').scenario, f.run.difficulty)).terms;
    f = { ...f, run: { ...f.run, sim: { ...f.run.sim, cost: startTfp(f.run.sim.cost, terms, f.run.sim.tick) } } };
    f = run(f, [{ cmd: 'advance', hours: 2 }]);
    const t = financeText(f);
    expect(t).toMatch(/pricing TFP/);
    expect(t).toMatch(/^CICS\s+PROD1,PROD2\s+\d+\s+\d+\s+\d+/m);
    // PROD1 carries all four Midwest products, SYSP only z/OS.
    const per = Object.fromEntries([...t.matchAll(/(PROD1|SYSP) (\d+\.\d+)/g)].map((m) => [m[1], Number(m[2])]));
    expect(per.PROD1).toBeGreaterThan(per.SYSP! * 2);
  });

  it('finance lists the TFP offer per product and its run-rate projection', () => {
    let f = started(2);
    const offer = quoteTfp(f.run, scenarioFor(packOf('midwest').scenario, f.run.difficulty));
    f = { ...f, run: { ...f.run, tfpOffer: offer } };
    const t = financeText(f);
    expect(t).toContain('TFP offer OFFERED');
    expect(t).toMatch(/quoted day \d+ \d\d:\d\d/);
    expect(t).toMatch(/peak [\d,]+ MSU, sub-capacity \$[\d,.]+\/month \(\$\d+\/MSU\)/);
    expect(t).toMatch(/baseline [\d,]+ MSU-hours at \$[\d.]+\/MSU-hour; used [\d,]+ MSU-hours/);
    expect(t).not.toContain('estimated from R4HA samples');
    expect(t).toMatch(/run rate: [\d,]+ MSU-hours against a [\d,]+ baseline/);
    // A pace above the baseline shows the saving as a cost, not a negative "lower".
    const scenario = scenarioFor(packOf('midwest').scenario, f.run.difficulty);
    const usage = Object.fromEntries(Object.keys(f.run.sim.cost.usage!).map((k) => [k, 1e9]));
    const busy = { ...f.run, sim: { ...f.run.sim, cost: { ...f.run.sim.cost, usage } } };
    const over = financeText({ ...f, run: { ...busy, tfpOffer: quoteTfp(busy, scenario) } });
    expect(over).toMatch(/\$[\d,.]+ higher\)/);
    expect(over).not.toContain('-$');
  });

  it('status and finance show the same combined software/CoD estimate and unrounded limit warning', () => {
    const f = newPlayFile(7);
    const products = packOf(f.run.scenarioId).scenario.products;
    for (const peak of f.run.sim.cost.peaks) peak.peakMsu = 100;
    f.run.sim.cost.priceMult = 780_000 / estimateMonth(f.run.sim.cost, products);
    f.run.opexSpentThisMonth = 39_000;
    f.run.opexBudgetMonthly = 780_000;
    for (const render of [statusText, financeText]) {
      expect(render(f)).toContain('$780,000 + $39,000 = $819,000 vs budget $780,000; +5.0% vs budget');
      expect(render(f)).toContain("priced on the month's peak R4HA to date");
    }
    f.run.opexSpentThisMonth = 195_312; // total is 25.04% over, although the rounded display is 25.0%.
    for (const render of [statusText, financeText]) expect(render(f)).toContain('+25.0% vs budget (over limit)');
  });

  it('finance documents month-boundary settlement and status warns when a closed bill awaits day close', () => {
    const f = newPlayFile(7);
    expect(financeText(f)).toContain('software cost resets at 00:00 but CoD settles at 06:00');
    f.run.sim.cost.bills.push({ month: 0, lines: [], total: 0 });
    expect(statusText(f)).toContain("that night's CoD fee is charged to the closing month");
  });

  it('capacity shows the CPC MSU, LPARs, initiators and capacity changes; batch is gated like smf BATCH', () => {
    const f = newPlayFile(7);
    const c = capacityText(f);
    expect(c).toMatch(/^CPCA \S+ capacity setting \d+: CP \d+ x \d+ MSU = \d+ MSU/);
    expect(c).toMatch(/^PROD1\s+ZOS\s+\d+/m);
    expect(c).toContain('job classes (initiators per LPAR): A ');
    expect(batchStreamsText(f)).toContain('SMF30_BATCH');
  });

  it('inspect dp lists dispatching priorities per RMF interval, highest first', () => {
    const f = started(1);
    const t = dpText(encodePlayFile(f), 'PROD1', { cls: 'SYS' });
    const line = t.split('\n')[1]!;
    expect(line).toMatch(/SYSTEM#1=FF SYSSTC#1=FE/);
    expect(dpText(encodePlayFile(f), 'NOSUCH')).toContain('No system NOSUCH');
  });

  it('inspect wlm replays a play log to a past time and traces each policy adjustment there', () => {
    const f = started(2);
    const t = wlmText(encodePlayFile(f), 'PROD1', { at: 'D1 06:30', ticks: 2 }).split('\n');
    expect(t[0]).toContain('replayed from seed + log');
    expect(t.filter((l) => /^D1 06:30:(00|10) PROD1  → /.test(l))).toHaveLength(2);
    // Without a log (a browser save) it can only trace forward from the saved moment.
    const browser = encodePlayFile({ ...f, log: [] });
    expect(wlmText(browser, 'PROD1', { at: 'D1 06:30' })).toContain('traced forward');
    expect(wlmText(browser, 'PROD1', { at: 'D1 08:00', ticks: 1 }).split('\n')[0]).toContain('forward from the saved moment');
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
    // SYSWKM: CICS class breakdown and serving AORs, in text and JSON.
    expect(mon3Text(f, { system: 'PROD1' })).toMatch(/SYSWKM ONLHI period 1[\s\S]*CICS EXE %: ACTIVE[\s\S]*CICSAOR1/);
    expect(mon3Text(f, { json: true }).split('\n').some((l) => l.startsWith('SYSWKM {'))).toBe(true);
    // DELAY columns as RMF Report Analysis p.108–109: no CAP or PRC IIP column.
    const delayCols = mon3Text(f).split('\n').find((l) => l.startsWith('system ') && l.includes(' DLY '))!;
    expect(delayCols).toMatch(/USG\s+DLY\s+IDL\s+UKN\s+PRC\s+DEV\s+STR\s+SUB\s+OPR\s+ENQ\s+primaryReason$/);
    expect(delayCols).not.toMatch(/\bCAP\b|delay\.cap|delay\.ziip/);
  });

  it('mon3 CPC table prints the browser columns with *CP/*ICF group rows and the capacity-adjusted line', () => {
    const f = run(withMon3(started(1)), [{ cmd: 'advance', hours: 1 }]);
    const section = (t: string) => {
      const lines = t.split('\n');
      const i = lines.indexOf('CPC');
      return lines.slice(i, lines.indexOf('', i));
    };
    const s = section(mon3Text(f));
    // RMF's two-level header: the partition table's grouped columns, and no weight/polarity/busy table.
    const leaf = s.find((l) => l.startsWith('Partition '))!;
    expect(leaf).toMatch(/^Partition\s+Def\s+Act\s+Proc Num\s+Effect\s+Total\s+LPAR\s+Effect\s+Total\s+PR\/SM delay %\s+capped %$/);
    const group = s[s.indexOf(leaf) - 1]!;
    expect(group.trim()).toMatch(/^MSU\s+Logical Util %\s+Physical Util %$/);
    // Each group label starts over its first sub-column, not merely somewhere on the line.
    expect(group.indexOf('MSU')).toBe(leaf.indexOf('Def'));
    expect(group.indexOf('Logical Util %')).toBe(leaf.indexOf('Effect'));
    expect(group.indexOf('Physical Util %')).toBe(leaf.indexOf('LPAR'));
    // A group row sums the partitions of its processor type, in the browser's column order.
    const rows = mon3Text(f, { json: true })
      .split('\n')
      .filter((l) => l.startsWith('{') && l.includes('"lparId"'))
      .map((l) => JSON.parse(l) as Record<string, number | string>);
    const sums = (kind: string) => {
      const part = rows.filter((r) => r.kind === kind);
      const sum = (k: string) => part.reduce((a, r) => a + (r[k] as number), 0).toFixed(1);
      return [sum('procNum'), sum('physLparPct'), sum('physEffectPct'), sum('physTotalPct')];
    };
    for (const [kind, label] of [['ZOS', '*CP'], ['CF', '*ICF']] as const) {
      const line = s.find((l) => l.startsWith(label + ' '))!;
      expect(line.trim().split(/\s+/), label).toEqual([label, ...sums(kind)]);
    }
    // *IIP lists the images with zIIPs online, and every group closes with its PHYSICAL line.
    const iip = rows.filter((r) => r.iip !== undefined).map((r) => r.iip as unknown as Record<string, number>);
    expect(iip.length).toBeGreaterThan(0);
    const iipSums = (k: string) => iip.reduce((a, r) => a + (r[k] as number), 0).toFixed(1);
    expect(s.find((l) => l.startsWith('*IIP '))!.trim().split(/\s+/)).toEqual(['*IIP', iipSums('procNum'), iipSums('physLparPct'), iipSums('physEffectPct'), iipSums('physTotalPct')]);
    const physical = mon3Text(f, { json: true })
      .split('\n')
      .filter((l) => l.startsWith('CPC_PHYSICAL '))
      .map((l) => JSON.parse(l.slice('CPC_PHYSICAL '.length)) as { cpcId: string; kind: string; physPct: number });
    const labels = ['*CP', '*IIP', '*ICF'];
    const physLines = s.filter((l) => l.startsWith('PHYSICAL '));
    expect(physLines, 'one PHYSICAL line per group').toHaveLength(labels.length);
    for (const [i, label] of labels.entries()) {
      const at = s.findIndex((l) => l.startsWith(label + ' '));
      const end = labels.slice(i + 1).map((x) => s.findIndex((l) => l.startsWith(x + ' '))).filter((x) => x > at)[0] ?? s.length;
      const line = s.slice(at + 1, end).find((l) => l.startsWith('PHYSICAL '))!;
      const pct = physical.find((x) => x.kind === label.slice(1))!.physPct.toFixed(1);
      expect(line.trim().split(/\s+/), label).toEqual(['PHYSICAL', pct, '0.0', pct]);
    }
    // The capacity-adjusted line appears once per CPC and names the pin that reads it.
    const adj = s.filter((l) => l.includes('capacity adjusted'));
    expect(adj).toHaveLength(1);
    expect(adj[0]).toMatch(/^CPC \S+: capacity adjusted \d+\.\d % \(pin CPC \S+ CAPACITY_ADJ\)$/);
    // A system filter selects the CPC that system runs on and prints the whole of it, as the browser does, so the
    // group rows stay the CPC's totals (what CPC_BUSY reads); --json keeps only the partition asked for.
    for (const system of ['PROD1', 'CF01']) {
      const filtered = section(mon3Text(f, { system }));
      expect(filtered.includes(s.find((l) => l.startsWith('*CP '))!), system).toBe(true);
      expect(filtered.includes(s.find((l) => l.startsWith('*ICF '))!), system).toBe(true);
      expect(mon3Text(f, { system, json: true }).split('\n').filter((l) => l.includes('"lparId"')), system).toHaveLength(1);
    }
    // --json keeps the whole view model: agents and pins read busyPct there, and weight/polarity stay readable.
    expect(rows[0]).toMatchObject({ busyPct: expect.any(Number), weight: expect.any(Number), polarity: expect.any(String) });
  });

  it('mon3 CPC table labels each CPC and keeps its group rows and capacity line on its own partitions', () => {
    const f = run(withMon3(started(1, 'harbourline')), [{ cmd: 'advance', hours: 1 }]);
    const lines = mon3Text(f).split('\n');
    const i = lines.indexOf('CPC');
    const s = lines.slice(i, lines.indexOf('', i));
    const labels = s.filter((l) => /^CPC \S+$/.test(l));
    expect(labels).toHaveLength(2);
    const rows = mon3Text(f, { json: true })
      .split('\n')
      .filter((l) => l.startsWith('{') && l.includes('"lparId"'))
      .map((l) => JSON.parse(l) as Record<string, number | string>);
    for (const [k, label] of labels.entries()) {
      const id = label.slice(4);
      const block = s.slice(s.indexOf(label) + 1, k + 1 < labels.length ? s.indexOf(labels[k + 1]!) : s.length);
      const of = rows.filter((r) => r.cpcId === id);
      const zos = of.filter((r) => r.kind === 'ZOS');
      const sum = (key: string) => zos.reduce((a, r) => a + (r[key] as number), 0).toFixed(1);
      expect(block.find((l) => l.startsWith('*CP '))!.trim().split(/\s+/), id).toEqual(['*CP', sum('procNum'), sum('physLparPct'), sum('physEffectPct'), sum('physTotalPct')]);
      // The capacity line names a partition of this CPC, not the other CPC's first partition.
      const cap = block.find((l) => l.includes('capacity adjusted'))!;
      expect(of.map((r) => r.lparId), id).toContain(cap.match(/pin CPC (\S+) CAPACITY_ADJ/)![1]);
    }
    // A filter naming a partition of one CPC prints that CPC whole and leaves the other out.
    const firstId = labels[0]!.slice(4);
    const firstLpar = rows.find((r) => r.cpcId === firstId)!.lparId as string;
    const oneLines = mon3Text(f, { system: firstLpar }).split('\n');
    const one = oneLines.slice(oneLines.indexOf('CPC'), oneLines.indexOf('', oneLines.indexOf('CPC')));
    expect(one.filter((l) => /^CPC \S+$/.test(l))).toHaveLength(0);
    expect(one.filter((l) => l.includes('capacity adjusted'))).toHaveLength(1);
    expect(one.find((l) => l.startsWith('*CP '))).toBe(s.find((l) => l.startsWith('*CP ')));
    expect(one.some((l) => l.includes('CPC ' + labels[1]!.slice(4)))).toBe(false);
  });

  it('clock text names the weekday: the small hours still belong to the played day that began at 06:00', () => {
    expect(clockText(0)).toBe('D1 Mon 06:00');
    expect(clockText(18.5 * TICKS_PER_HOUR)).toBe('D1 Tue 00:30');
  });

  it('RMF intervals have stable ids for report and pin; a bare class name means period 1', () => {
    let f = started(2);
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

  it('advance stops at the hour a job abends, and restart takes the job by name', () => {
    let f = run(newPlayFile(7), [{ cmd: 'start' }, { cmd: 'advance', hours: 16 }]);
    expect(applyPlayCommand(f, { cmd: 'restart', name: 'NOSUCH' }).text).toContain('Abended jobs: none');
    f = { ...f, run: { ...f.run, pendingCommands: [...f.run.pendingCommands, { kind: 'ABEND_JOB', critical: true }] } };
    const tick = f.run.sim.tick;
    const r = applyPlayCommand(f, { cmd: 'advance', hours: 5 });
    expect(r.file.run.sim.tick - tick).toBe(TICKS_PER_HOUR);
    const name = /STOPPED: (\S+) ABENDED/.exec(r.text)![1]!;
    expect(catalogText(r.file)).toContain(`abended now: ${name}`);
    const back = applyPlayCommand(r.file, { cmd: 'restart', name: name.toLowerCase() });
    expect(back.ok, back.text).toBe(true);
    expect(back.file.run.changes.at(-1)!.label).toBe(`Restart ${name}`);
  });

  it('keeps both edits when two policies are installed in the same briefing', () => {
    let f = newPlayFile(7);
    const edit = (classId: string, rtSec: number): PlayCommand => ({
      cmd: 'wlm', edit: { op: 'SET_PERIOD', classId, period: 0, goal: { kind: 'AVG', rtSec }, importance: 2 },
    });
    f = run(f, [edit('ONLHI', 0.4), { cmd: 'activate' }]);
    expect(f.pendingPolicy).toBeNull();
    expect(f.run.sim.wlm.definition.policyName).toBe('BASEPOL');
    f = run(f, [edit('ONLMED', 0.6)]);
    expect(f.pendingPolicy!.policyName).toBe('BASEPOL3');
    expect(f.pendingPolicy!.classes.find((c) => c.id === 'ONLHI')!.periods[0]!.goal).toEqual({ kind: 'AVG', rtSec: 0.4 });
    // Persist/reload between installs, as in an interrupted browser session.
    f = run(decodePlayFile(encodePlayFile(f)), [{ cmd: 'activate' }, { cmd: 'start' }, { cmd: 'advance', hours: 1 / 360 }]);
    expect(f.run.changes.filter((c) => c.status === 'APPLIED')).toHaveLength(2);
    expect(f.run.sim.wlm.definition.policyName).toBe('BASEPOL3');
    for (const [id, rtSec] of [['ONLHI', 0.4], ['ONLMED', 0.6]] as const) {
      expect(f.run.sim.wlm.definition.classes.find((c) => c.id === id)!.periods[0]!.goal).toEqual({ kind: 'AVG', rtSec });
    }
  });

  it('keeps briefing and live installs when editing again before the next simulation tick', () => {
    const edit = (classId: string, rtSec: number): PlayCommand => ({
      cmd: 'wlm', edit: { op: 'SET_PERIOD', classId, period: 0, goal: { kind: 'AVG', rtSec }, importance: 2 },
    });
    let f = run(newPlayFile(7), [edit('ONLHI', 0.4), { cmd: 'activate' }, edit('ONLMED', 0.6), { cmd: 'activate' }, { cmd: 'start' }]);
    expect(f.run.sim.tick).toBe(0);
    expect(f.run.sim.wlm.definition.policyName).toBe('BASEPOL');
    f = run(decodePlayFile(encodePlayFile(f)), [edit('TSO', 3)]);
    expect(f.pendingPolicy!.policyName).toBe('BASEPOL4');
    f = run(f, [{ cmd: 'activate' }, edit('STCMED', 1)]);
    expect(f.pendingPolicy!.policyName).toBe('BASEPOL5');
    f = run(f, [{ cmd: 'activate' }, { cmd: 'advance', hours: 1 / 360 }]);
    expect(f.run.sim.wlm.definition.policyName).toBe('BASEPOL5');
    expect(f.run.pendingCommands).toEqual([]);
    for (const [id, rtSec] of [['ONLHI', 0.4], ['ONLMED', 0.6], ['TSO', 3], ['STCMED', 1]] as const) {
      expect(f.run.sim.wlm.definition.classes.find((c) => c.id === id)!.periods[0]!.goal).toEqual({ kind: 'AVG', rtSec });
    }
  });

  it('the day-start text says a failed activation went live through the later one', () => {
    const edit = (classId: string, rtSec: number): PlayCommand => ({
      cmd: 'wlm', edit: { op: 'SET_PERIOD', classId, period: 0, goal: { kind: 'AVG', rtSec }, importance: 2 },
    });
    // Seed 43 fails BASEPOL2 at 06:00; BASEPOL3, drafted on its planned policy, installs with the copied edit.
    const f = run(newPlayFile(43), [edit('ONLHI', 0.4), { cmd: 'activate' }, edit('ONLMED', 0.6), { cmd: 'activate' }]);
    const out = applyPlayCommand(f, { cmd: 'start' });
    expect(out.ok).toBe(true);
    expect(out.text).toContain('later activation BASEPOL3 went live with its edits');
    expect(out.text).not.toContain('edits are pending again');
    expect(out.file.pendingPolicy).toBeNull();
  });

  it('does not restore a failed earlier install over a later successful policy', () => {
    const edit = (classId: string, rtSec: number): PlayCommand => ({
      cmd: 'wlm', edit: { op: 'SET_PERIOD', classId, period: 0, goal: { kind: 'AVG', rtSec }, importance: 2 },
    });
    // Seed 43 fails BASEPOL2 at 06:00 but successfully queues BASEPOL3.
    let f = run(newPlayFile(43), [edit('ONLHI', 0.4), { cmd: 'activate' }, edit('ONLMED', 0.6), { cmd: 'activate' }, { cmd: 'start' }]);
    expect(f.run.changes.map((c) => c.status)).toEqual(['FAILED', 'APPLIED']);
    expect(f.pendingPolicy).toBeNull();
    f = run(f, [edit('TSO', 3)]);
    expect(f.pendingPolicy!.policyName).toBe('BASEPOL4');
    expect(f.pendingPolicy!.classes.find((c) => c.id === 'ONLMED')!.periods[0]!.goal).toEqual({ kind: 'AVG', rtSec: 0.6 });
    f = run(f, [{ cmd: 'activate' }, { cmd: 'advance', hours: 1 / 360 }]);
    expect(f.run.sim.wlm.definition.policyName).toBe('BASEPOL4');
    expect(f.run.sim.wlm.definition.classes.find((c) => c.id === 'ONLMED')!.periods[0]!.goal).toEqual({ kind: 'AVG', rtSec: 0.6 });
  });

  it('cancelling an earlier install keeps the later definition without restoring stale pending edits', () => {
    const edit = (classId: string, rtSec: number): PlayCommand => ({
      cmd: 'wlm', edit: { op: 'SET_PERIOD', classId, period: 0, goal: { kind: 'AVG', rtSec }, importance: 2 },
    });
    let f = run(newPlayFile(7), [edit('ONLHI', 0.4), { cmd: 'activate' }, edit('ONLMED', 0.6), { cmd: 'activate' }]);
    const out = applyPlayCommand(f, { cmd: 'cancel', changeId: f.run.changes[0]!.id });
    expect(out.ok).toBe(true);
    expect(out.text).toContain('BASEPOL3');
    expect(out.text).not.toContain('edits are pending again');
    f = out.file;
    expect(f.pendingPolicy).toBeNull();
    f = run(f, [edit('TSO', 3), { cmd: 'activate' }, { cmd: 'start' }, { cmd: 'advance', hours: 1 / 360 }]);
    expect(f.run.sim.wlm.definition.policyName).toBe('BASEPOL4');
    for (const [id, rtSec] of [['ONLHI', 0.4], ['ONLMED', 0.6], ['TSO', 3]] as const) {
      expect(f.run.sim.wlm.definition.classes.find((c) => c.id === id)!.periods[0]!.goal).toEqual({ kind: 'AVG', rtSec });
    }
  });

  it('cancelling the later and then the earlier install leaves the edits pending', () => {
    const edit = (classId: string, rtSec: number): PlayCommand => ({
      cmd: 'wlm', edit: { op: 'SET_PERIOD', classId, period: 0, goal: { kind: 'AVG', rtSec }, importance: 2 },
    });
    let f = run(newPlayFile(7), [edit('ONLHI', 0.4), { cmd: 'activate' }, edit('ONLMED', 0.6), { cmd: 'activate' }]);
    // B was drafted on A's planned policy, so its definition carries A's edit too.
    const cancelB = applyPlayCommand(f, { cmd: 'cancel', changeId: f.run.changes[1]!.id });
    expect(cancelB.ok).toBe(true);
    expect(cancelB.text).toContain('Its edits go back to the pending policy');
    expect(cancelB.text).not.toContain('pending again');
    f = cancelB.file;
    for (const [id, rtSec] of [['ONLHI', 0.4], ['ONLMED', 0.6]] as const) {
      expect(f.pendingPolicy!.classes.find((c) => c.id === id)!.periods[0]!.goal).toEqual({ kind: 'AVG', rtSec });
    }
    const cancelA = applyPlayCommand(f, { cmd: 'cancel', changeId: f.run.changes[0]!.id });
    expect(cancelA.ok).toBe(true);
    expect(cancelA.text).toContain('Its edits go back to the pending policy');
    f = cancelA.file;
    // A's own request is gone, but its edit is still staged in the pending policy.
    expect(f.pendingPolicy!.classes.find((c) => c.id === 'ONLHI')!.periods[0]!.goal).toEqual({ kind: 'AVG', rtSec: 0.4 });
  });

  it('policy shows the service definition, its rules and the processors it runs on', () => {
    const text = policyText(newPlayFile(7, 'NORMAL', 'harbourline'), false);
    expect(text).toMatch(/active policy \S+/);
    expect(text).toContain('MKTORD: #1 AVG 0.150s IMP 1');
    expect(text).toContain('JES (default BATCHPRD)');
    expect(text).toMatch(/PRDA on CPC1: CP \d+.*ZIIP 1/);
    expect(policyText(newPlayFile(7), true)).toBe('No pending policy edits.');
  });

  it('status and policy name the planned policy, in the briefing and once it is queued', () => {
    const edit: PlayCommand = {
      cmd: 'wlm', edit: { op: 'SET_PERIOD', classId: 'ONLHI', period: 0, goal: { kind: 'AVG', rtSec: 0.4 }, importance: 2 },
    };
    // BRIEFING: the activation is a planned change for today, so both say when it takes over.
    let f = run(newPlayFile(7), [edit, { cmd: 'activate' }]);
    expect(statusText(f)).toContain('planned policy BASEPOL2 (activates when the day starts)');
    expect(policyText(f, false)).toContain('planned policy BASEPOL2 (activates when the day starts)');
    // Day start queues it for the first tick: it is still not active, and both say it is queued.
    f = run(f, [{ cmd: 'start' }]);
    expect(f.run.sim.wlm.definition.policyName).toBe('BASEPOL');
    expect(statusText(f)).toContain('planned policy BASEPOL2 (queued; V WLM,POLICY= applies at the next tick)');
    expect(policyText(f, false)).toContain('planned policy BASEPOL2 (queued; V WLM,POLICY= applies at the next tick)');
    // Once the tick runs, the policy is active and no longer planned.
    f = run(f, [{ cmd: 'advance', hours: 1 / 360 }]);
    expect(f.run.sim.wlm.definition.policyName).toBe('BASEPOL2');
    expect(statusText(f)).not.toContain('planned policy');
    expect(policyText(f, false)).not.toContain('planned policy');
  });

  it('notes are logged without touching the run; hour-by-hour advance (--pace) ends in the same state', () => {
    const base = run(newPlayFile(7), [{ cmd: 'start' }]);
    const noted = run(base, [{ cmd: 'note', text: 'watching PROD2' }]);
    expect(encodePlayFile({ ...noted, log: [] })).toBe(encodePlayFile({ ...base, log: [] }));
    const once = run(base, [{ cmd: 'advance', hours: 2 }]);
    const paced = run(base, [{ cmd: 'advance', hours: 1 }, { cmd: 'advance', hours: 1 }]);
    expect(encodePlayFile({ ...paced, log: [] })).toBe(encodePlayFile({ ...once, log: [] }));
  });

  it('reads clock times as clockText prints them; the small hours belong to the played day', () => {
    for (const t of [0, 1234, 4000, 8639, 9000]) expect(tickOfClock(clockText(t))).toBe(Math.floor(t / 6) * 6);
    expect(tickOfClock('D1 06:00')).toBe(0);
    expect(tickOfClock('D2 05:59')).toBe(2 * 8640 - 6);
    expect(tickOfClock('D0 10:00')).toBeNull();
    expect(tickOfClock('10:00')).toBeNull();
    expect(tickOfClock('D2 23:30:00')).toBe(tickOfClock('D2 23:30')); // formatClock's own text (Monitor III Go to)
  });

  it('advance keeps a Monitor III history for mon3 --at and pin --at; paced advance keeps the same one', () => {
    const base = run(newPlayFile(7, 'NORMAL', 'harbourline'), [{ cmd: 'start' }]);
    const f = run(base, [{ cmd: 'advance', hours: 2 }]);
    const paced = run(base, [{ cmd: 'advance', hours: 1 }, { cmd: 'advance', hours: 1 }]);
    expect(encodePlayFile({ ...paced, log: [] })).toBe(encodePlayFile({ ...f, log: [] }));
    expect(f.mon3!.entries.length).toBeGreaterThan(50);
    expect(mon3Text(f)).toContain('history covers D1 Mon 06:02 to D1 Mon 08:00');
    const past = mon3Text(f, { system: 'PRDA', at: 'D1 07:00' });
    expect(past).toMatch(/^Monitor III history, range ending D1 Mon 07:00/);
    expect(past).toContain('MKTORD#1');
    const pinned = run(f, [{ cmd: 'pin', req: { source: 'MON3', system: 'PRDA', scKey: 'MKTORD', metric: 'PI' }, at: 'D1 07:00' }]);
    expect(pinned.run.pins.at(-1)!.text).toMatch(/^SYSINFO D1 07:00 PRDA MKTORD#1 PI/);
    expect(applyPlayCommand(f, { cmd: 'pin', req: { source: 'MON3', system: 'PRDA', scKey: 'MKTORD', metric: 'PI' }, at: 'D1 09:00' }).text).toContain('in the future');
    expect(applyPlayCommand(f, { cmd: 'pin', req: { source: 'DB2', hour: '7', workloadId: 'X', metric: 'PI' }, at: 'D1 07:00' }).ok).toBe(false);
    expect(applyPlayCommand(f, { cmd: 'new', seed: 1 }).file.mon3).toBeUndefined();
  });

  it('pins region SOS minutes and a PROCU job row now, and refuses a past job row from the trimmed history', () => {
    const f = started(2);
    const sos = run(f, [{ cmd: 'pin', req: { source: 'CICS_STORAGE', hour: '7', region: 'CICSAOR1' } }]);
    expect(sos.run.pins.at(-1)!.text).toMatch(/^CICS 110 D1 \d\d:00–\d\d:00 CICSAOR1 SOS minutes/);
    const job = run(f, [{ cmd: 'pin', req: { source: 'PROCU', system: 'PROD1', jobname: 'CICSAOR1' } }]);
    expect(job.run.pins.at(-1)!.text).toMatch(/^PROCU D1 \d\d:\d\d PROD1 CICSAOR1 job EAppl CPU/);
    // The CLI's history keeps no job rows (like SYSWKM), so a past PROCU pin needs the browser.
    const h = started(2, 'harbourline');
    const past = applyPlayCommand(h, { cmd: 'pin', req: { source: 'PROCU', system: 'PRDA', jobname: 'CICSAOR1' }, at: 'D1 07:00' });
    expect(past.ok).toBe(false);
    expect(past.text).toContain('no job rows');
  });
});
