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
