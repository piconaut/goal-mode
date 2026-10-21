import type { Command } from '../sim/core/commands';
import type { RcAdvice } from '../game/rcAdvisor';
import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { ClassificationExplain } from '../game/classifyExplain';
import type { HistoryPoint } from '../game/history';
import type { ViewModel } from '../game/view';
import type { ClassificationResult } from '../sim/wlm/classify';
import type { ChartMarker, Mon3Sample } from '../game/mon3Charts';
import type { WhatIfSummary } from '../game/whatif';
import type { FinanceView } from '../game/finance';
import type { CareerState } from '../game/career';
import { AUTO_SPEED, type FromWorker, type PendingPolicyView, type SmfData, type ToWorker } from '../worker/protocol';

export interface GameHandle {
  view: ViewModel | null;
  /** Spectator mode (`?spectate=<run>`): the watched run file and its latest command, or the fetch error. */
  spectate: { name: string; last: string; note: string; error: string | null } | null;
  report: string;
  policy: string;
  history: HistoryPoint[];
  savedRunDay: number | null;
  pending: PendingPolicyView | null;
  classified: { result: ClassificationResult; pending: boolean } | null;
  smf: SmfData | null;
  finance: FinanceView | null;
  whatIf: { progress: number | null; result: { label: string; base: WhatIfSummary; proposal: WhatIfSummary } | null };
  speed: number;
  /** Career carried across runs, and the XP the run that just ended added. */
  career: { career: CareerState; lastRunXp: number | null } | null;
  charts: { samples: Mon3Sample[]; markers: ChartMarker[] };
  rules: { active: ClassificationExplain; pending: ClassificationExplain | null; classIds: string[]; advice: RcAdvice[] | null } | null;
  toast: { ok: boolean; message: string } | null;
  /** Every change-board result this session, newest last (toasts vanish; this doesn't). */
  results: { ok: boolean; message: string; clock: string }[];
  /** Change Desk basket: kept here so it survives leaving the tab. */
  basket: Command[];
  setBasket: Dispatch<SetStateAction<Command[]>>;
  send: (m: ToWorker) => void;
}

export function useGame(): GameHandle {
  const worker = useRef<Worker | null>(null);
  const [view, setView] = useState<ViewModel | null>(null);
  const [report, setReport] = useState('');
  const [policy, setPolicy] = useState('');
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [savedRunDay, setSavedRunDay] = useState<number | null>(null);
  const [pending, setPending] = useState<PendingPolicyView | null>(null);
  const [classified, setClassified] = useState<GameHandle['classified']>(null);
  const [smf, setSmf] = useState<SmfData | null>(null);
  const [finance, setFinance] = useState<FinanceView | null>(null);
  const [whatIf, setWhatIf] = useState<GameHandle['whatIf']>({ progress: null, result: null });
  const [speed, setSpeed] = useState(1);
  const [career, setCareer] = useState<GameHandle['career']>(null);
  const [basket, setBasket] = useState<Command[]>([]);
  const [charts, setCharts] = useState<GameHandle['charts']>({ samples: [], markers: [] });
  const [rules, setRules] = useState<GameHandle['rules']>(null);
  const [toast, setToast] = useState<GameHandle['toast']>(null);
  const [results, setResults] = useState<GameHandle['results']>([]);
  const clockRef = useRef('');
  const spectateName = useMemo(() => new URLSearchParams(window.location.search).get('spectate'), []);
  const [spectate, setSpectate] = useState<GameHandle['spectate']>(spectateName ? { name: spectateName, last: '', note: '', error: null } : null);

  useEffect(() => {
    const w = new Worker(new URL('../worker/game.worker.ts', import.meta.url), { type: 'module' });
    worker.current = w;
    w.onmessage = (e: MessageEvent<FromWorker>) => {
      const m = e.data;
      if (m.type === 'VIEW') {
        setView(m.view);
        clockRef.current = m.view.clock;
        if (m.history) setHistory(m.history);
        setSavedRunDay(m.savedRunDay);
        setPending(m.pending);
        setSpeed(m.speed);
      } else if (m.type === 'CAREER') setCareer({ career: m.career, lastRunXp: m.lastRunXp });
      else if (m.type === 'CLASSIFIED') setClassified({ result: m.result, pending: m.pending });
      else if (m.type === 'SMF') setSmf(m.data);
      else if (m.type === 'FINANCE') setFinance(m.finance);
      else if (m.type === 'WHATIF_PROGRESS') setWhatIf((w) => ({ ...w, progress: m.frac }));
      else if (m.type === 'WHATIF_RESULT') setWhatIf({ progress: null, result: { label: m.label, base: m.base, proposal: m.proposal } });
      else if (m.type === 'MON3_CHARTS')
        setCharts((c) => ({
          samples: [...(m.fromSample === 0 ? [] : c.samples.slice(0, m.fromSample)), ...m.samples],
          markers: [...(m.fromMarker === 0 ? [] : c.markers.slice(0, m.fromMarker)), ...m.markers],
        }));
      else if (m.type === 'BASKET') setBasket(m.basket);
      else if (m.type === 'RULES') setRules({ active: m.active, pending: m.pending, classIds: m.classIds, advice: m.advice });
      else if (m.type === 'REPORT') setReport(m.text);
      else if (m.type === 'POLICY') setPolicy(m.json);
      else if (m.type === 'RESULT') {
        setToast({ ok: m.ok, message: m.message });
        setResults((r) => [...r, { ok: m.ok, message: m.message, clock: clockRef.current }].slice(-50));
        window.setTimeout(() => setToast(null), 4000);
      }
    };
    // Start at the player's last running speed (never paused: a reload shouldn't leave the clock stopped).
    const stored = Number(readPref(SPEED_KEY));
    if (stored > 0) w.postMessage({ type: 'SET_SPEED', speed: stored } satisfies ToWorker);
    return () => w.terminate();
  }, []);

  const send = useCallback((m: ToWorker) => {
    if (m.type === 'SET_SPEED' && m.speed > 0 && m.speed !== AUTO_SPEED) writePref(SPEED_KEY, String(m.speed));
    worker.current?.postMessage(m);
  }, []);
  // Mirror the basket to the worker so it is saved with the run.
  useEffect(() => send({ type: 'SET_BASKET', basket }), [basket, send]);
  // Dev aid for headless UI checks (tools/screenshot.mjs against `npm run dev`).
  if (import.meta.env.DEV) (globalThis as { __goalMode?: { send: typeof send } }).__goalMode = { send };
  // Spectator mode: poll the run file the dev server exposes and hand every new version to the worker.
  useEffect(() => {
    if (!spectateName) return;
    let lastText = '';
    const poll = async () => {
      try {
        const res = await fetch(`./__spectate/${encodeURIComponent(spectateName)}`, { cache: 'no-store' });
        if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
        const text = await res.text();
        if (text === lastText) return;
        lastText = text;
        worker.current?.postMessage({ type: 'SPECTATE', text } satisfies ToWorker);
        const log = (JSON.parse(text) as { log?: { cmd: string; text?: string }[] }).log ?? [];
        const note = [...log].reverse().find((c) => c.cmd === 'note')?.text ?? '';
        const last = [...log].reverse().find((c) => c.cmd !== 'note');
        setSpectate({ name: spectateName, last: last ? JSON.stringify(last) : '', note, error: null });
      } catch (e) {
        setSpectate((s) => ({ name: spectateName, last: s?.last ?? '', note: s?.note ?? '', error: String(e) }));
      }
    };
    void poll();
    const id = window.setInterval(() => void poll(), SPECTATE_POLL_MS);
    return () => window.clearInterval(id);
  }, [spectateName]);

  return { spectate, view, report, policy, history, savedRunDay, pending, classified, smf, finance, whatIf, speed, career, charts, rules, toast, results, basket, setBasket, send };
}

const SPEED_KEY = 'goalmode.speed';
const SPECTATE_POLL_MS = 1500;
const readPref = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const writePref = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage blocked: the speed just isn't remembered.
  }
};
