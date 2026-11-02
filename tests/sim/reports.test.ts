import { renderWlmSummary, wlmHeader } from '../../src/sim/measure/reports';
import type { RmfInterval, WlmRecord } from '../../src/sim/measure/rmf';

const rec = (over: Partial<WlmRecord>): WlmRecord => ({
  lparId: '*PLEX',
  scKey: 'ONLRETL#1',
  serviceClass: 'ONLRETL',
  period: 1,
  goalText: '95% < 0.250s',
  importance: 1,
  dp: null,
  ended: 1109155,
  endPerSec: 616.2,
  failed: 0,
  avgRtSec: 0.054,
  execVelocity: 82.8,
  pi: 12.62,
  applCpPct: 616.2,
  applIipcpPct: 166.2,
  applIipPct: 0,
  usingPct: { cpu: 19, ziip: 0, io: 7 },
  delayPct: { cpu: 69, ziip: 1, io: 4, storage: 2, cap: 3, other: 5 },
  buckets: [],
  ...over,
});

describe('WLMGL layout', () => {
  it('every value sits under its column label (right edges line up)', () => {
    const iv = { startTick: 0, endTick: 180, intervalSec: 1800, policy: 'P', wlm: [rec({})] } as unknown as RmfInterval;
    const lines = renderWlmSummary(iv).split('\n');
    const h2 = wlmHeader('SERVICE')[1]!;
    const row = lines.find((l) => l.startsWith('ONLRETL'))!;
    // The second header line names every numeric column; each label must end where its value ends.
    const labels = [...h2.matchAll(/\S+/g)].slice(2); // skip CLASS and RESP's left part
    const values = [...row.matchAll(/\S+/g)];
    const ends = (ms: RegExpMatchArray[]) => ms.map((m) => m.index! + m[0].length);
    const valueEnds = new Set(ends(values));
    for (const l of labels) expect(valueEnds.has(l.index! + l[0].length), `${l[0]} at ${l.index}`).toBe(true);
    // The worst delay (CPU 69) is right under the DELAY % CPU label.
    const delayCpuEnd = ends([...h2.matchAll(/CPU/g)])[1]!;
    expect(row.slice(delayCpuEnd - 2, delayCpuEnd)).toBe('69');
  });
});

it('shows CICS work manager states and region sample owners without invented transaction resource percentages', async () => {
  const { renderWlmDetail } = await import('../../src/sim/measure/reports');
  const wm = { active: 4, ready: 2, idle: 0, waitingIo: 1, waitingLock: 0.25, waitingProd: 1.5, waitingMisc: 0.5, regionKeys: ['STCHI#1'] };
  const iv = { startTick: 0, endTick: 180, intervalSec: 1800, policy: 'P', wlm: [rec({ resourceSamples: false, workManager: wm })] } as unknown as RmfInterval;
  const detail = renderWlmDetail(iv, 'ONLRETL#1');
  expect(detail).toContain('WORK MANAGER STATES');
  // Total 9.25: ACTIVE 43.2, READY 21.6, IDLE -, LOCK 2.7, I/O 10.8, CONV -, PROD 16.2, MISC 5.4.
  expect(detail).toMatch(/CICS EXE +43\.2 +21\.6 +- +2\.7 +10\.8 +- +16\.2 +5\.4/);
  expect(detail).toMatch(/ACTIVE\* +READY +IDLE +LOCK +I\/O +CONV +PROD +MISC/);
  expect(detail).toContain('CICS EXE');
  expect(detail).toContain('BTE (BEGIN-TO-END/TOR): NOT MODELLED');
  expect(detail).not.toContain('PHASE BTE 0');
  expect(detail).toContain('REGION CLASSES STCHI#1');
  expect(detail).not.toContain('USING% CPU');
  expect(detail).not.toContain('APPL% CP');
  const summary = renderWlmSummary(iv);
  expect(summary).toContain('WORK MANAGER STATES');
  const row = summary.split('\n').find((l) => l.startsWith('ONLRETL'))!;
  expect(row.trimEnd().endsWith('-')).toBe(true);
});

it('lists the CICS transaction classes a region class serves (RMF Report Analysis p.525)', async () => {
  const { renderWlmDetail } = await import('../../src/sim/measure/reports');
  const wm = { active: 1, ready: 0, idle: 0, waitingIo: 0, waitingLock: 0, waitingProd: 0, waitingMisc: 0, regionKeys: ['STCHI#1'] };
  const iv = {
    startTick: 0, endTick: 180, intervalSec: 1800, policy: 'P',
    wlm: [rec({ resourceSamples: false, workManager: wm }), rec({ scKey: 'ONLMED#1', serviceClass: 'ONLMED', resourceSamples: false, workManager: wm }), rec({ scKey: 'STCHI#1', serviceClass: 'STCHI' })],
  } as unknown as RmfInterval;
  expect(renderWlmDetail(iv, 'STCHI#1')).toContain('SERVICE CLASSES BEING SERVED: ONLMED ONLRETL');
  expect(renderWlmDetail(iv, 'ONLMED#1')).not.toContain('BEING SERVED');
});
