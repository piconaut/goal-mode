import { useCallback, useEffect, useRef, useState } from 'react';
import type { ClassificationExplain } from '../game/classifyExplain';
import type { HistoryPoint } from '../game/history';
import type { ViewModel } from '../game/view';
import type { ClassificationResult } from '../sim/wlm/classify';
import type { FromWorker, PendingPolicyView, ToWorker } from '../worker/protocol';

export interface GameHandle {
  view: ViewModel | null;
  report: string;
  policy: string;
  history: HistoryPoint[];
  savedRunDay: number | null;
  pending: PendingPolicyView | null;
  classified: { result: ClassificationResult; pending: boolean } | null;
  rules: { active: ClassificationExplain; pending: ClassificationExplain | null; classIds: string[] } | null;
  toast: { ok: boolean; message: string } | null;
  /** Every change-board result this session, newest last (toasts vanish; this doesn't). */
  results: { ok: boolean; message: string; clock: string }[];
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
  const [rules, setRules] = useState<GameHandle['rules']>(null);
  const [toast, setToast] = useState<GameHandle['toast']>(null);
  const [results, setResults] = useState<GameHandle['results']>([]);
  const clockRef = useRef('');

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
      } else if (m.type === 'CLASSIFIED') setClassified({ result: m.result, pending: m.pending });
      else if (m.type === 'RULES') setRules({ active: m.active, pending: m.pending, classIds: m.classIds });
      else if (m.type === 'REPORT') setReport(m.text);
      else if (m.type === 'POLICY') setPolicy(m.json);
      else if (m.type === 'RESULT') {
        setToast({ ok: m.ok, message: m.message });
        setResults((r) => [...r, { ok: m.ok, message: m.message, clock: clockRef.current }].slice(-50));
        window.setTimeout(() => setToast(null), 4000);
      }
    };
    return () => w.terminate();
  }, []);

  const send = useCallback((m: ToWorker) => worker.current?.postMessage(m), []);
  return { view, report, policy, history, savedRunDay, pending, classified, rules, toast, results, send };
}
