// Monitor III charting (tool MON3_CHARTS): a per-minute history of the Monitor III views for the
// played day, plus markers for WLM decisions, changes and events so cause and effect line up.

import { MON3_CHARTS } from '../content/tools';
import type { Scenario } from '../sim/core/scenario';
import { buildMon3 } from './mon3';
import type { RunState } from './types';

export interface Mon3Sample {
  tick: number;
  cpcBusyPct: number;
  /** Per z/OS image. */
  sys: Record<string, { cpPct: number; ziipPct: number | null; cappedPct: number; prsmDelayPct: number }>;
  /** Sysplex PI per goal-bearing period. */
  pi: Record<string, number | null>;
  /** Sysplex delay % of samples per period, by reason. */
  delay: Record<string, { cpu: number; ziip: number; io: number; cap: number; other: number }>;
  /** DDF periods (enclaves). */
  ddf: Record<string, { endedPerSec: number; rtMs: number | null; ziipEngines: number; iipcpEngines: number }>;
}

export type MarkerKind = 'WLM' | 'CHANGE' | 'EVENT';

export interface ChartMarker {
  tick: number;
  kind: MarkerKind;
  text: string;
}

export interface Mon3ChartState {
  samples: Mon3Sample[];
  markers: ChartMarker[];
  /** Last WLM log line already turned into a marker (the sim log is a capped ring). */
  lastWlmLine: string | null;
  /** run.log length already scanned. */
  logSeen: number;
}

export const emptyCharts = (run: RunState): Mon3ChartState => ({ samples: [], markers: [], lastWlmLine: run.sim.wlm.log.at(-1) ?? null, logSeen: run.log.length });

const r1 = (x: number) => Math.round(x * 10) / 10;

export function sampleMon3(run: RunState, scenario: Scenario): Mon3Sample {
  const m = buildMon3(run, scenario);
  const sys: Mon3Sample['sys'] = {};
  for (const s of m.systems) {
    const c = m.cpc.find((x) => x.lparId === s.system);
    sys[s.system] = { cpPct: r1(s.cpBusyPct), ziipPct: s.ziipBusyPct === null ? null : r1(s.ziipBusyPct), cappedPct: r1(c?.cappedPct ?? 0), prsmDelayPct: r1(c?.prsmDelayPct ?? 0) };
  }
  const pi: Mon3Sample['pi'] = {};
  const delay: Mon3Sample['delay'] = {};
  for (const r of m.rows) {
    if (r.system !== '*PLEX') continue;
    if (r.importance !== null) pi[r.scKey] = r.pi === null ? null : Math.round(r.pi * 100) / 100;
    if (r.goal !== 'system') delay[r.scKey] = { cpu: r1(100 * r.delay.cpu), ziip: r1(100 * r.delay.ziip), io: r1(100 * r.delay.io), cap: r1(100 * r.delay.cap), other: r1(100 * r.delay.other) };
  }
  const ddf: Mon3Sample['ddf'] = {};
  for (const e of m.enclaves) {
    const prev = ddf[e.scKey];
    // Several DDF workloads can share a period: add rates and engines, keep the busier one's RT.
    ddf[e.scKey] = prev
      ? { endedPerSec: r1(prev.endedPerSec + e.endedPerSec), rtMs: prev.rtMs, ziipEngines: r1(prev.ziipEngines + e.ziipEngines), iipcpEngines: r1(prev.iipcpEngines + e.iipcpEngines) }
      : { endedPerSec: r1(e.endedPerSec), rtMs: e.avgRtMs === null ? null : Math.round(e.avgRtMs), ziipEngines: Math.round(e.ziipEngines * 100) / 100, iipcpEngines: Math.round(e.iipcpEngines * 100) / 100 };
  }
  const cpcEngines = run.sim.config.cpcs.reduce((a, c) => a + c.engines.CP, 0);
  const delivered = run.sim.lpars.reduce((a, l) => a + (l.pools.find((p) => p.pool === 'CP')?.deliveredEngines ?? 0), 0);
  return { tick: run.sim.tick, cpcBusyPct: r1(cpcEngines > 0 ? (100 * delivered) / cpcEngines : 0), sys, pi, delay, ddf };
}

function newMarkers(run: RunState, st: Mon3ChartState): { markers: ChartMarker[]; lastWlmLine: string | null; logSeen: number } {
  const tick = run.sim.tick;
  const out: ChartMarker[] = [];
  const wlm = run.sim.wlm.log;
  const from = st.lastWlmLine === null ? 0 : wlm.lastIndexOf(st.lastWlmLine) + 1;
  for (const l of wlm.slice(from)) if (l.includes('RCVR=')) out.push({ tick, kind: 'WLM', text: l });
  for (const l of run.log.slice(st.logSeen)) {
    if (l.includes('change') || l.includes('Change') || l.includes('WLM policy')) out.push({ tick, kind: 'CHANGE', text: l });
    else if (l.startsWith('EVENT') || l.startsWith('INCIDENT')) out.push({ tick, kind: 'EVENT', text: l });
  }
  return { markers: out, lastWlmLine: wlm.at(-1) ?? st.lastWlmLine, logSeen: run.log.length };
}

/** Called once per sample period while the tool is active. */
export function recordMon3(run: RunState, scenario: Scenario): RunState {
  const st = run.mon3Charts ?? emptyCharts(run);
  const nm = newMarkers(run, st);
  const markers = [...st.markers, ...nm.markers];
  return {
    ...run,
    mon3Charts: {
      samples: [...st.samples, sampleMon3(run, scenario)],
      // Keep changes and events; drop the oldest WLM decisions first when over the cap.
      markers: markers.length > MON3_CHARTS.maxMarkers ? trimMarkers(markers) : markers,
      lastWlmLine: nm.lastWlmLine,
      logSeen: nm.logSeen,
    },
  };
}

function trimMarkers(ms: ChartMarker[]): ChartMarker[] {
  let excess = ms.length - MON3_CHARTS.maxMarkers;
  return ms.filter((m) => (excess > 0 && m.kind === 'WLM' ? (excess--, false) : true));
}
