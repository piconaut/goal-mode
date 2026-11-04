import { describe, expect, it } from 'vitest';
import { decodeRunFileText, encodeRunJson } from '../../src/game/runFile';

describe('decodeRunFileText', () => {
  const value = { body: 'Change board: "REBIND ran."', path: 'C:\\saves', cap: Infinity };
  const text = encodeRunJson(value);

  it('reads an intact run file', () => {
    expect(decodeRunFileText(text)).toEqual(value);
  });

  it('repairs a file whose every backslash was doubled on the way to disk', () => {
    const doubled = text.replace(/\\/g, '\\\\');
    expect(() => JSON.parse(doubled)).toThrow();
    expect(decodeRunFileText(doubled)).toEqual(value);
  });

  it('accepts text pasted with its surrounding backticks', () => {
    expect(decodeRunFileText('`' + text + '`\n')).toEqual(value);
  });

  it('still rejects text that is not a run file', () => {
    expect(() => decodeRunFileText('{"a": \\\\x')).toThrow();
  });
});
