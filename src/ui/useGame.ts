import { useCallback, useEffect, useRef, useState } from 'react';
import type { ViewModel } from '../game/view';
import type { FromWorker, ToWorker } from '../worker/protocol';

export interface GameHandle {
  view: ViewModel | null;
  report: string;
  policy: string;
  toast: { ok: boolean; message: string } | null;
  send: (m: ToWorker) => void;
}

export function useGame(): GameHandle {
  const worker = useRef<Worker | null>(null);
  const [view, setView] = useState<ViewModel | null>(null);
  const [report, setReport] = useState('');
  const [policy, setPolicy] = useState('');
  const [toast, setToast] = useState<GameHandle['toast']>(null);

  useEffect(() => {
    const w = new Worker(new URL('../worker/game.worker.ts', import.meta.url), { type: 'module' });
    worker.current = w;
    w.onmessage = (e: MessageEvent<FromWorker>) => {
      const m = e.data;
      if (m.type === 'VIEW') setView(m.view);
      else if (m.type === 'REPORT') setReport(m.text);
      else if (m.type === 'POLICY') setPolicy(m.json);
      else if (m.type === 'RESULT') {
        setToast({ ok: m.ok, message: m.message });
        window.setTimeout(() => setToast(null), 4000);
      }
    };
    return () => w.terminate();
  }, []);

  const send = useCallback((m: ToWorker) => worker.current?.postMessage(m), []);
  return { view, report, policy, toast, send };
}
