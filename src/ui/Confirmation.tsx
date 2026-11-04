import { createContext, useCallback, useContext, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

type RequestConfirmation = (message: string, actionLabel?: string) => Promise<boolean>;
const ConfirmationContext = createContext<RequestConfirmation | null>(null);

export function ConfirmationProvider({ children }: { children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const resolver = useRef<((confirmed: boolean) => void) | null>(null);
  const mounted = useRef(true);
  const [pending, setPending] = useState<{ message: string; actionLabel: string } | null>(null);
  const id = useId();

  const request = useCallback<RequestConfirmation>((message, actionLabel = 'Confirm') => {
    if (!mounted.current || resolver.current) return Promise.resolve(false);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
      setPending({ message, actionLabel });
    });
  }, []);

  const settle = useCallback((confirmed: boolean) => {
    const resolve = resolver.current;
    if (!resolve) return;
    resolver.current = null;
    setPending(null);
    if (dialog.current?.open) dialog.current.close();
    resolve(confirmed);
  }, []);

  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const resolve = resolver.current;
      resolver.current = null;
      if (dialog.current?.open) dialog.current.close();
      resolve?.(false);
    };
  }, []);

  useLayoutEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (pending && !el.open) el.showModal();
    else if (!pending && el.open) el.close();
  }, [pending]);

  return (
    <ConfirmationContext.Provider value={request}>
      {children}
      <dialog
        ref={dialog}
        className={pending ? 'modal' : undefined}
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-message`}
        style={{ position: 'fixed', maxHeight: '90vh', overflow: 'auto', color: 'var(--text)' }}
        onKeyDown={(event) => event.stopPropagation()}
        onCancel={() => settle(false)}
        onClose={() => {
          // Ignore a queued close event if a new confirmation has already opened.
          if (!dialog.current?.open && resolver.current) settle(false);
        }}
      >
        <h2 id={`${id}-title`}>Confirm action</h2>
        <p id={`${id}-message`}>{pending?.message}</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <button type="button" autoFocus onClick={() => settle(false)}>Cancel</button>
          <button type="button" onClick={() => settle(true)}>{pending?.actionLabel ?? 'Confirm'}</button>
        </div>
      </dialog>
    </ConfirmationContext.Provider>
  );
}

export function useConfirmation(): RequestConfirmation {
  const request = useContext(ConfirmationContext);
  if (!request) throw new Error('useConfirmation must be used within ConfirmationProvider');
  return request;
}
