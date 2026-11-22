// @vitest-environment jsdom
// PR-09: the dialog lifecycle used to be checked by hand with Playwright (#181/#183/#185). jsdom has no <dialog>
// implementation, so this test drives the real React components with a tiny showModal/close stub and fires the
// browser's `cancel` (Escape) and queued `close` events explicitly.
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfirmationProvider, useConfirmation } from '../../src/ui/Confirmation';
import { RunFileButtons } from '../../src/ui/RunFiles';
import type { GameHandle } from '../../src/ui/useGame';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom 26 has neither showModal() nor close(); keep the `open` flag in a WeakMap and never dispatch `close`
// from close() — the tests fire it when they want to model the browser's queued close event.
const opened = new WeakMap<HTMLDialogElement, boolean>();
Object.defineProperty(HTMLDialogElement.prototype, 'open', {
  configurable: true,
  get(this: HTMLDialogElement) {
    return opened.get(this) ?? false;
  },
  set(this: HTMLDialogElement, value: boolean) {
    opened.set(this, value);
  },
});
HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
  if (this.open) throw new Error('showModal on an open dialog');
  this.open = true;
};
HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
  this.open = false;
};

const queuedClose = (dialog: HTMLDialogElement) => dialog.dispatchEvent(new Event('close'));
const escape = (dialog: HTMLDialogElement) => dialog.dispatchEvent(new Event('cancel', { bubbles: true, cancelable: true }));

let container: HTMLDivElement;
let root: Root;
const mount = (node: ReactNode) => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => root.render(node));
  return container;
};
const find = (selector: string): HTMLElement => {
  const el = container.querySelector<HTMLElement>(selector);
  if (!el) throw new Error(`No ${selector}`);
  return el;
};
const dialogs = () => [...container.querySelectorAll('dialog')];
const button = (text: string): HTMLButtonElement => {
  const el = [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === text);
  if (!el) throw new Error(`No button ${text}`);
  return el as HTMLButtonElement;
};
const click = (el: HTMLElement) => act(() => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));
const flush = async () => {
  await act(async () => {});
};

let result: boolean | undefined;
let ask: () => void;
function Requester() {
  const request = useConfirmation();
  ask = () => {
    void request('Discard changes?', 'Discard', 'danger').then((v) => (result = v));
  };
  return null;
}
const mountConfirmation = () => mount(createElement(ConfirmationProvider, null, createElement(Requester)));

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  result = undefined;
});

describe('in-app confirmation lifecycle', () => {
  it('opens with the request text and the action tone', () => {
    mountConfirmation();
    expect(dialogs()[0]!.open).toBe(false);
    act(() => ask());
    const dialog = dialogs()[0]!;
    expect(dialog.open).toBe(true);
    expect(dialog.textContent).toContain('Discard changes?');
    expect(button('Discard').className).toBe('danger');
  });

  it('confirm resolves true and closes the dialog', async () => {
    mountConfirmation();
    act(() => ask());
    click(button('Discard'));
    await flush();
    expect(result).toBe(true);
    expect(dialogs()[0]!.open).toBe(false);
  });

  it('cancel resolves false and closes the dialog', async () => {
    mountConfirmation();
    act(() => ask());
    click(button('Cancel'));
    await flush();
    expect(result).toBe(false);
    expect(dialogs()[0]!.open).toBe(false);
  });

  it('Escape (cancel) resolves false and a queued close does not settle twice', async () => {
    mountConfirmation();
    act(() => ask());
    const dialog = dialogs()[0]!;
    act(() => escape(dialog));
    await flush();
    expect(result).toBe(false);
    act(() => queuedClose(dialog));
    await flush();
    expect(result).toBe(false);
  });

  it('a queued close after reopen leaves the new confirmation pending', async () => {
    mountConfirmation();
    act(() => ask());
    const dialog = dialogs()[0]!;
    click(button('Cancel'));
    await flush();
    act(() => queuedClose(dialog)); // stale close event from the first confirmation
    expect(dialog.open).toBe(false);
    act(() => ask());
    expect(dialog.open).toBe(true);
    act(() => queuedClose(dialog));
    await flush();
    expect(result).toBe(false); // the late close did not settle the new request
    expect(dialog.open).toBe(true);
    click(button('Discard'));
    await flush();
    expect(result).toBe(true);
  });

  it('unmounting while a confirmation is pending resolves false', async () => {
    mountConfirmation();
    act(() => ask());
    expect(dialogs()[0]!.open).toBe(true);
    act(() => root.unmount());
    await flush();
    expect(result).toBe(false);
  });
});

const game = () => {
  const send = vi.fn();
  const stub = {
    spectate: null,
    importResult: null,
    runFile: { name: 'run.json', text: '{"seed":42}' },
    prepareRunFile: vi.fn(),
    send,
  };
  return { game: stub as unknown as GameHandle, send };
};
const mountRunFiles = (g: GameHandle) => mount(createElement(ConfirmationProvider, null, createElement(RunFileButtons, { game: g })));
const type = (text: string) => {
  const input = find('textarea');
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

describe('run-file dialog lifecycle', () => {
  it('opens export and import, and the close button closes', () => {
    mountRunFiles(game().game);
    click(find('[title^="Export this run"]'));
    expect(dialogs()[0]!.open).toBe(true);
    expect(dialogs()[0]!.className).toBe('modal');
    expect(dialogs()[0]!.textContent).toContain('Export run');
    click(button('Close'));
    expect(dialogs()[0]!.open).toBe(false);
    click(find('[title^="Load an exported save"]'));
    expect(dialogs()[0]!.open).toBe(true);
    expect(dialogs()[0]!.textContent).toContain('Import run');
  });

  it('Escape closes, reopen works, and a stale close event cannot close the reopened dialog', () => {
    mountRunFiles(game().game);
    const dialog = dialogs()[0]!;
    click(find('[title^="Load an exported save"]'));
    expect(dialog.open).toBe(true);
    act(() => escape(dialog));
    expect(dialog.open).toBe(false);
    act(() => queuedClose(dialog)); // old session's close event
    click(find('[title^="Load an exported save"]'));
    expect(dialog.open).toBe(true);
    act(() => queuedClose(dialog));
    expect(dialog.open).toBe(true);
    click(button('Close'));
    expect(dialog.open).toBe(false);
  });

  it('a stale close event after reopen cannot close an import mid-confirmation', async () => {
    const { game: g, send } = game();
    mountRunFiles(g);
    const fileDialog = dialogs()[0]!;
    click(find('[title^="Load an exported save"]'));
    act(() => escape(fileDialog));
    click(find('[title^="Load an exported save"]'));
    act(() => queuedClose(fileDialog));
    type('{"seed":7}');
    click(button('Load pasted save'));
    const confirm = dialogs().find((d) => d.textContent?.includes('Confirm action'))!;
    expect(confirm.open).toBe(true);
    act(() => queuedClose(fileDialog));
    expect(confirm.open).toBe(true);
    expect(send).not.toHaveBeenCalled();
    click(button('Cancel'));
    await flush();
    expect(send).not.toHaveBeenCalled();
  });

  it('confirming the import sends IMPORT_RUN; the run-file dialog stays until the worker replies', async () => {
    const { game: g, send } = game();
    mountRunFiles(g);
    click(find('[title^="Load an exported save"]'));
    type('{"seed":7}');
    click(button('Load pasted save'));
    const confirm = dialogs().find((d) => d.textContent?.includes('Confirm action'))!;
    click(button('Load save'));
    await flush();
    expect(send).toHaveBeenCalledWith({ type: 'IMPORT_RUN', text: '{"seed":7}' });
    expect(confirm.open).toBe(false);
    expect(dialogs()[0]!.textContent).toContain('Loading the save');
    expect(dialogs()[0]!.open).toBe(true);
  });
});
