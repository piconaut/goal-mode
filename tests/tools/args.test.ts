import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { arg, flag, isMain, num, takeFlag, taker } from '../../tools/args';

// The tools' one parser (CL-24). `arg`, `flag` and `num` read process.argv, so each test sets it and puts it back.
const original = process.argv;
const set = (...rest: string[]) => {
  process.argv = ['node', 'tools/some.ts', ...rest];
};
afterEach(() => {
  process.argv = original;
});

describe('tool argument parser', () => {
  it('reads a value, treats a following flag as no value, and falls back', () => {
    set('--days', '3', '--scenario', '--hash');
    expect(arg('days', '1')).toBe('3');
    expect(arg('scenario', 'midwest')).toBe('midwest'); // --hash is not a value
    expect(arg('seed', '42')).toBe('42');
    expect(flag('hash')).toBe(true);
    expect(flag('seed')).toBe(false);
    expect(num('days', 1)).toBe(3);
    expect(num('seed', 42)).toBe(42);
  });

  it('takes flags and their values out of a forwarded argv, leaving positionals', () => {
    const argv = ['--suite', 'tools', '--no-wait', '--filter', 'plan', 'extra'];
    const take = taker(argv);
    expect(take('suite')).toBe('tools');
    expect(takeFlag(argv, 'no-wait')).toBe(true);
    expect(take('filter')).toBe('plan');
    expect(take('missing')).toBeUndefined();
    expect(argv).toEqual(['extra']);
  });

  it('a boolean flag never eats the positional after it, and every copy goes', () => {
    const argv = ['--json', 'run.json', 'dp', 'PROD1'];
    expect(takeFlag(argv, 'json')).toBe(true);
    expect(takeFlag(argv, 'json')).toBe(false);
    expect(argv).toEqual(['run.json', 'dp', 'PROD1']);
    const twice = ['--json', 'x', '--json', 'y'];
    expect(takeFlag(twice, 'json')).toBe(true);
    expect(twice).toEqual(['x', 'y']);
  });

  it('recognises the entry module only when it is the entry module', () => {
    set();
    expect(isMain(import.meta.url)).toBe(false);
    process.argv = ['node', fileURLToPath(import.meta.url)];
    expect(isMain(import.meta.url)).toBe(true);
    process.argv = ['node', 'tools/bench.ts'];
    expect(isMain(import.meta.url)).toBe(false);
  });
});
