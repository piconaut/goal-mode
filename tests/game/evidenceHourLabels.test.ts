import { beforeAll, describe, expect, it } from 'vitest';
import { MIDWEST } from '../../src/content/scenarios';
import { addPin, type PinRequest } from '../../src/game/evidence';
import { advance } from '../../src/game/run';
import { cicsMonitoring, cicsStorageStats, db2Accounting, db2Statistics } from '../../src/game/smf';
import type { RunState } from '../../src/game/types';
import { midwestContent, midwestNoon } from '../helpers/fixtureCache';

let run: RunState;
beforeAll(() => {
  run = advance(midwestNoon(), MIDWEST, midwestContent, 30);
  expect(run.sim.tick).toBe(2190); // D1 12:05: the reported repro, five minutes into the open hour.
});

const sources = [
  { source: 'DB2', workloadId: 'RBANK', metric: 'LOCK_WAIT' },
  { source: 'CICS', workloadId: 'RBANK', metric: 'QR_WAIT' },
  { source: 'DB2_STATS', lparId: 'PROD1', metric: 'DBAT_QUEUE' },
  { source: 'CICS_STORAGE', region: 'CICSAOR1' },
] as const;

describe.each(sources)('$source hourly pin labels', (locator) => {
  it.each([
    { hour: 'current', window: 'D1 12:00–12:05', tick: 2190 },
    { hour: '0:11', window: 'D1 11:00–12:00', tick: 2160 },
  ])('labels $hour with its measured window without changing the end tick or value', ({ hour, window, tick }) => {
    const req: PinRequest = { ...locator, hour };
    const out = addPin(run, MIDWEST, req);
    expect(out.ok, out.message).toBe(true);
    const p = out.run.pins.at(-1)!;
    expect(p.text).toContain(` ${window} `);
    expect(out.message).toContain(p.text);
    expect(p.tick).toBe(tick);
    const value = locator.source === 'DB2' ? db2Accounting(run, MIDWEST, hour).find((r) => r.workloadId === 'RBANK')!.lockMs
      : locator.source === 'CICS' ? cicsMonitoring(run, MIDWEST, hour).find((r) => r.workloadId === 'RBANK')!.qrWaitMs
      : locator.source === 'DB2_STATS' ? db2Statistics(run, MIDWEST, hour).find((r) => r.lparId === 'PROD1')!.dbatQueued
      : cicsStorageStats(run, hour).find((r) => r.region === 'CICSAOR1')!.sosSec / 60;
    expect(p.value).toBe(value);
  });
});
