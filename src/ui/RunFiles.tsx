import { useEffect, useId, useRef, useState } from 'react';
import type { GameHandle } from './useGame';
import { useConfirmation } from './Confirmation';
import { importOutcome } from './importDialog';

export function RunFileButtons({ game }: { game: GameHandle }) {
  const ask = useConfirmation();
  const dialog = useRef<HTMLDialogElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const exportText = useRef<HTMLTextAreaElement>(null);
  const session = useRef(0);
  const submittedResult = useRef(game.importResult);
  const titleId = useId();
  const [mode, setMode] = useState<'export' | 'import' | null>(null);
  const [text, setText] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);
  const [reading, setReading] = useState(false);
  const { runFile } = game;

  const close = () => {
    // An import already confirmed cannot be abandoned half-done: the worker replaces the run on its own, so the
    // dialog stays open until IMPORT_RESULT arrives (PR-06).
    if (loading) return;
    session.current++;
    setMode(null);
    setLoading(false);
    setReading(false);
  };

  const open = (next: 'export' | 'import') => {
    session.current++;
    setText('');
    setNotice('');
    setLoading(false);
    setReading(false);
    if (next === 'export') game.prepareRunFile();
    setMode(next);
  };

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (mode && !el.open) el.showModal();
    else if (!mode && el.open) el.close();
  }, [mode]);

  useEffect(() => {
    // The worker's explicit import outcome, not a toast's wording (PR-05).
    const outcome = importOutcome(loading, game.importResult, submittedResult.current);
    if (!outcome) return;
    setLoading(false);
    if ('close' in outcome) {
      session.current++;
      setMode(null);
    } else setNotice(outcome.notice);
  }, [loading, game.importResult]);

  const selectText = () => {
    exportText.current?.focus();
    exportText.current?.select();
  };

  const copy = async () => {
    if (!runFile) return;
    const opened = session.current;
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(runFile.text);
      if (opened === session.current) setNotice('Copied save to clipboard.');
    } catch {
      if (opened !== session.current) return;
      selectText();
      setNotice('Clipboard copy was unavailable. The save text is selected; press Ctrl+C or Command+C to copy it manually.');
    }
  };

  const load = async (saveText: string, name: string) => {
    if (!saveText.trim()) {
      setNotice('The save text is empty. Paste save text or choose another file.');
      return;
    }
    const opened = session.current;
    if (!(await ask(`Load ${name}? It replaces the current run and the saved run.`, 'Load save')) || opened !== session.current) return;
    submittedResult.current = game.importResult;
    setNotice('');
    setLoading(true);
    game.send({ type: 'IMPORT_RUN', text: saveText });
  };

  return (
    <>
      <button title="Export this run as save text or a file" onClick={() => open('export')}>⇩ export</button>
      {!game.spectate && (
        <button title="Load an exported save (replaces the current run and the save)" onClick={() => open('import')}>⇧ import</button>
      )}
      <dialog
        ref={dialog}
        className={mode ? 'modal' : undefined}
        aria-labelledby={titleId}
        style={{ maxHeight: '90vh', overflow: 'auto', color: 'var(--text)' }}
        onCancel={(e) => {
          if (loading) e.preventDefault();
          else close();
        }}
        onClose={() => {
          // A queued close event can arrive after the dialog has reopened.
          if (!dialog.current?.open) close();
        }}
      >
        <h2 id={titleId}>{mode === 'export' ? 'Export run' : 'Import run'}</h2>
        <button className="modal-close" onClick={close} disabled={loading} title={loading ? 'Wait for the import to finish' : undefined}>
          Close
        </button>
        {mode === 'export' && (
          <>
            <p className="muted">Save this text to transfer or inspect your run. Past Monitor III ranges are not included.</p>
            {!runFile && <p role="status">Preparing save text…</p>}
            <label>
              Exported save text
              <textarea ref={exportText} readOnly wrap="off" rows={10} style={{ width: '100%' }} value={runFile?.text ?? ''} />
            </label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
              <button disabled={!runFile} onClick={() => runFile && downloadText(runFile.name, runFile.text)}>Download file</button>
              <button disabled={!runFile} onClick={() => void copy()}>Copy save to clipboard</button>
              <button disabled={!runFile} onClick={() => { selectText(); setNotice('Save text selected. Press Ctrl+C or Command+C to copy it manually.'); }}>Select save text for manual copy</button>
            </div>
          </>
        )}
        {mode === 'import' && (
          <>
            <p>Warning: loading a save replaces the current run and the saved run.</p>
            <label>
              Paste save text
              <textarea rows={10} style={{ width: '100%' }} value={text} onChange={(e) => setText(e.target.value)} disabled={loading || reading} />
            </label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
              <button disabled={!text.trim() || loading || reading} onClick={() => void load(text, 'pasted save')}>{loading ? 'Loading…' : 'Load pasted save'}</button>
              <button disabled={loading || reading} onClick={() => fileInput.current?.click()}>{reading ? 'Reading file…' : 'Choose file'}</button>
            </div>
          </>
        )}
        {notice && <p role="status">{notice}</p>}
      </dialog>
      <input
        ref={fileInput}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          const opened = session.current;
          setNotice('');
          setReading(true);
          try {
            const fileText = await file.text();
            if (opened !== session.current) return;
            setText(fileText);
            await load(fileText, file.name);
          } catch (error) {
            if (opened === session.current) setNotice(`Could not read ${file.name}: ${String(error)}`);
          } finally {
            if (opened === session.current) setReading(false);
          }
        }}
      />
    </>
  );
}

function downloadText(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
