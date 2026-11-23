import { readFileSync } from 'node:fs';
import type { Profiler, Runtime } from 'node:inspector';
import { isAbsolute, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMain, takeFlag, taker } from './args';

type CpuProfile = Pick<Profiler.Profile, 'nodes' | 'samples' | 'timeDeltas'>;
interface Frame extends Runtime.CallFrame {
  selfUs: number;
  inclusiveUs: number;
}
interface ProfileNode {
  frame: Frame;
  parent?: ProfileNode;
}

export function summarizeProfile(profile: CpuProfile) {
  const { samples, timeDeltas } = profile;
  if (!Array.isArray(profile.nodes) || !Array.isArray(samples) || !Array.isArray(timeDeltas)
    || !samples.length || samples.length !== timeDeltas.length) {
    throw new Error('Expected a CPU profile with nodes and one time delta per sample.');
  }

  const frames = new Map<string, Frame>();
  const nodes = new Map<number, ProfileNode>();
  for (const { id, callFrame } of profile.nodes) {
    const { functionName, url, lineNumber, columnNumber, scriptId } = callFrame;
    // The same frame can appear on multiple call paths. Keep distinct scripts and source positions separate.
    const key = JSON.stringify([functionName, url, lineNumber, columnNumber, scriptId]);
    let frame = frames.get(key);
    if (!frame) frames.set(key, (frame = { ...callFrame, selfUs: 0, inclusiveUs: 0 }));
    nodes.set(id, { frame });
  }
  for (const { id, children } of profile.nodes) {
    for (const childId of children ?? []) {
      const child = nodes.get(childId);
      if (!child) throw new Error(`Unknown child node ${childId}.`);
      child.parent = nodes.get(id)!;
    }
  }

  let timestampUs = 0;
  let totalUs = 0;
  const seen = new Set<Frame>();
  for (let i = 0; i < samples.length; i++) {
    const node = nodes.get(samples[i]!);
    if (!node) throw new Error(`Unknown sampled node ${samples[i]}.`);
    const intervalUs = timeDeltas[i]!;
    if (!Number.isFinite(intervalUs)) throw new Error(`Invalid time delta at sample ${i + 1}.`);
    timestampUs += intervalUs;
    // V8 can emit a sample out of timestamp order. Count only elapsed time beyond the latest sample so far.
    const deltaUs = Math.max(0, timestampUs - totalUs);
    node.frame.selfUs += deltaUs;
    totalUs += deltaUs;
    seen.clear();
    let depth = 0;
    for (let ancestor: ProfileNode | undefined = node; ancestor; ancestor = ancestor.parent) {
      if (++depth > nodes.size) throw new Error('The profile call tree contains a cycle.');
      if (seen.has(ancestor.frame)) continue;
      // Count a recursive frame only once in the inclusive total for this sample.
      seen.add(ancestor.frame);
      ancestor.frame.inclusiveUs += deltaUs;
    }
  }
  if (totalUs === 0) throw new Error('The profile has zero sampled time.');
  return { frames: [...frames.values()], totalUs };
}

function frameLocation(frame: Frame): string {
  if (!frame.url) return '';
  let path = frame.url.startsWith('file:') ? fileURLToPath(frame.url) : frame.url;
  if (isAbsolute(path)) {
    const local = relative(process.cwd(), path);
    if (!isAbsolute(local) && local !== '..' && !local.startsWith(`..${sep}`)) path = local;
  }
  if (frame.lineNumber >= 0) path += `:${frame.lineNumber + 1}`;
  if (frame.lineNumber >= 0 && frame.columnNumber >= 0) path += `:${frame.columnNumber + 1}`;
  return path;
}

function printSummary(path: string, limit: number): void {
  let summary: ReturnType<typeof summarizeProfile>;
  try {
    summary = summarizeProfile(JSON.parse(readFileSync(path, 'utf8')) as CpuProfile);
  } catch (error) {
    throw new Error(`${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const { frames, totalUs } = summary;
  console.log(`\n${path} (${(totalUs / 1000).toFixed(1)} ms sampled)`);
  for (const field of ['selfUs', 'inclusiveUs'] as const) {
    console.log(field === 'selfUs' ? 'Self time' : 'Inclusive time');
    const top = frames.filter((frame) => frame[field] > 0).sort((a, b) => b[field] - a[field]).slice(0, limit);
    for (const frame of top) {
      const ms = (frame[field] / 1000).toFixed(1).padStart(9);
      const pct = (100 * frame[field] / totalUs).toFixed(1).padStart(5);
      console.log(`  ${ms} ms ${pct}%  ${frame.functionName || '(anonymous)'} ${frameLocation(frame)}`.trimEnd());
    }
  }
}

if (isMain(import.meta.url)) {
  const args = process.argv.slice(2);
  const usage = 'npm run profile:summary -- [--limit 20] <profile.cpuprofile> [<profile.cpuprofile> ...]';
  if (takeFlag(args, 'help')) console.log(usage);
  else {
    try {
      const limit = Number(taker(args)('limit') ?? '20');
      if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('--limit must be a positive integer.');
      if (!args.length || args.some((value) => value.startsWith('--'))) throw new Error(`Usage: ${usage}`);
      for (const path of args) printSummary(path, limit);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  }
}
