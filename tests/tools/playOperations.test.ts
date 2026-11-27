import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { packOf } from '../../src/content/packs';
import { applyGameCommand } from '../../src/game/commands';
import { scenarioFor } from '../../src/game/difficulty';
import { operationsView } from '../../src/game/operations';
import { applyCommand } from '../../src/sim/core/commands';
import type { Operation } from '../../src/sim/core/operations';
import { releaseNetwork } from '../../src/sim/subsys/batch';
import { applyPlayCommand, encodePlayFile, newPlayFile, opsText, type PlayFile } from '../../tools/playCore';

function live(): PlayFile {
  const started = applyPlayCommand(newPlayFile(42), { cmd: 'start' });
  expect(started.ok).toBe(true);
  return started.file;
}

function compare(file: PlayFile, op: Operation, expectedOk: boolean) {
  const pack = packOf(file.run.scenarioId);
  const scenario = scenarioFor(pack.scenario, file.run.difficulty);
  const before = encodePlayFile(file);
  const browser = applyGameCommand(file.run, file.pendingPolicy, { kind: 'OPERATION', op }, pack.game, scenario);
  const play = applyPlayCommand(file, { cmd: 'operation', op });
  expect(browser.ok, browser.message).toBe(expectedOk);
  expect(play.ok).toBe(browser.ok);
  expect(play.text).toBe(browser.message);
  expect(play.file.run).toEqual(browser.run);
  expect(play.file.pendingPolicy).toEqual(browser.pending);
  expect(encodePlayFile(file)).toBe(before);
  if (expectedOk) expect(play.file.log.at(-1)).toEqual({ cmd: 'operation', op });
  else expect(encodePlayFile(play.file)).toBe(before);
  return play.file;
}

describe('play operator commands', () => {
  it('matches the browser for each operation and preserves refusals', () => {
    const file = live();
    const pack = packOf(file.run.scenarioId);
    const scenario = scenarioFor(pack.scenario, file.run.difficulty);
    const batch = releaseNetwork(file.run.sim.batch, 0, scenario.batchNetwork(file.run.seed, 0, 1));
    const job = batch.jobs[0]!;
    Object.assign(job, { status: 'RUNNING', lparId: 'PROD1', startTick: 0 });
    const sim = applyCommand({ ...file.run.sim, batch }, { kind: 'SET_UTILITY_OVERRUN', utility: 'REORG', seqIops: 55_000 }).state;
    const ready = { ...file, run: { ...file.run, sim } };
    const view = operationsView(ready.run, scenario);
    const utility = view.utilities.find((u) => u.kind === 'REORG')!;
    const rosterTarget = ({ kind, id, workloadId, lparId, day }: typeof view.tso[number]) => ({ kind, id, workloadId, lparId, day });
    const cases: Operation[] = [
      { kind: 'CANCEL_JOB', day: job.day, jobname: job.def.name, lparId: 'PROD1' },
      { kind: 'CANCEL_ADDRESS_SPACE', ...view.addressSpaces.find((a) => a.jobname === 'MONAGENT')! },
      { kind: 'CANCEL_SESSION', target: rosterTarget(view.tso[0]!) },
      { kind: 'CANCEL_SESSION', target: rosterTarget(view.threads[0]!) },
      { kind: 'TERM_UTILITY', id: utility.id, member: utility.member, day: utility.day },
      { kind: 'RECYCLE_CICS', targets: view.regions.slice(0, 2).map(({ name, lparId }) => ({ name, lparId })) },
      { kind: 'SET_GATEWAY', workloadId: view.gateway[0]!.id, mode: 'LIMIT' },
      { kind: 'SET_GATEWAY', workloadId: view.gateway[0]!.id, mode: 'BACKOFF' },
      { kind: 'SET_GATEWAY', workloadId: view.gateway[0]!.id, mode: 'BLOCK' },
      { kind: 'HOLD_HSM_RECALL', held: true },
    ];
    for (const op of cases) compare(ready, op, true);
    const protectedFile = compare(ready, { kind: 'SET_GATEWAY', workloadId: view.gateway[0]!.id, mode: 'BLOCK' }, true);
    compare(protectedFile, { kind: 'SET_GATEWAY', workloadId: view.gateway[0]!.id, mode: null }, true);
    const heldFile = compare(ready, { kind: 'HOLD_HSM_RECALL', held: true }, true);
    compare(heldFile, { kind: 'HOLD_HSM_RECALL', held: false }, true);
    for (const op of cases) compare(compare(ready, op, true), op, false);
    compare(ready, { kind: 'RECYCLE_CICS', targets: [] }, false);
    compare(ready, { kind: 'CANCEL_ADDRESS_SPACE', jobname: 'NO_SUCH_TASK', lparId: 'PROD1' }, false);
  });

  it('lists the current operations view without changing the file', () => {
    const file = live();
    const pack = packOf(file.run.scenarioId);
    const scenario = scenarioFor(pack.scenario, file.run.difficulty);
    const before = encodePlayFile(file);
    const view = operationsView(file.run, scenario);
    const visibleRoster = (rows: typeof view.tso) => rows.map(({ shareFrac: _shareFrac, ...row }) => row);
    expect(JSON.parse(opsText(file, true))).toEqual({ ...view, tso: visibleRoster(view.tso), threads: visibleRoster(view.threads) });
    const text = opsText(file);
    expect(text).toContain(view.tso[0]!.id);
    expect(text).toContain(view.threads[0]!.id);
    expect(text).toContain(view.regions[0]!.name);
    expect(text).toContain(view.gateway[0]!.id);
    expect(encodePlayFile(file)).toBe(before);
  });
});

describe('operator CLI', () => {
  it('lists without saving, converts displayed days and preserves a refused save', () => {
    const dir = mkdtempSync(join(tmpdir(), 'goal-ops-'));
    const path = join(dir, 'run.json');
    const cli = (...args: string[]) => spawnSync(process.execPath, ['--import', 'tsx', 'tools/play.ts', path, ...args], { encoding: 'utf8' });
    try {
      const file = live();
      writeFileSync(path, encodePlayFile(file));
      const before = readFileSync(path, 'utf8');
      const listing = cli('ops', '--json');
      expect(listing.status, listing.stderr).toBe(0);
      const view = JSON.parse(listing.stdout);
      expect(view.tso.length).toBeGreaterThan(0);
      expect(readFileSync(path, 'utf8')).toBe(before);
      const target = view.tso[0];
      const success = cli('logoff-tso', `D${target.day + 1}`, target.id, target.workloadId, target.lparId);
      expect(success.status, success.stdout + success.stderr).toBe(0);
      const saved = JSON.parse(readFileSync(path, 'utf8'));
      expect(saved.log.at(-1)).toMatchObject({ cmd: 'operation', op: { kind: 'CANCEL_SESSION', target: { kind: 'TSO_USER', day: target.day, id: target.id } } });
      const after = readFileSync(path, 'utf8');
      const refusal = cli('logoff-tso', `D${target.day + 1}`, target.id, target.workloadId, target.lparId);
      expect(refusal.status).toBe(2);
      expect(refusal.stdout).toContain('REFUSED:');
      expect(refusal.stdout).toContain('no longer active');
      expect(readFileSync(path, 'utf8')).toBe(after);
      const validOp = { kind: 'HOLD_HSM_RECALL', held: true };
      const validJson = cli('json', JSON.stringify({ cmd: 'operation', op: validOp }));
      expect(validJson.status, validJson.stdout + validJson.stderr).toBe(0);
      expect(JSON.parse(readFileSync(path, 'utf8')).log.at(-1)).toEqual({ cmd: 'operation', op: validOp });
      const afterJson = readFileSync(path, 'utf8');
      const invalidJson = cli('json', JSON.stringify({ cmd: 'operation', op: { kind: 'HOLD_HSM_RECALL', held: 'yes' } }));
      expect(invalidJson.status).toBe(2);
      expect(invalidJson.stdout).toContain('REFUSED: Invalid operation');
      expect(readFileSync(path, 'utf8')).toBe(afterJson);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 20_000);
});
