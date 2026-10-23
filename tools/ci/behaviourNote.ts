// CI gate: a PR that regenerates the goldens must say why in a "## Behaviour change" section of its body,
// so goldens are never regenerated just to turn a red test green.
//
//   PR_BODY="..." npx tsx tools/ci/behaviourNote.ts <base-ref>
import { execFileSync } from 'node:child_process';

const GOLDEN_FILE = 'tests/golden/hashes.json';

export function goldensChanged(baseRef: string): boolean {
  const out = execFileSync('git', ['diff', '--name-only', `${baseRef}...HEAD`, '--', GOLDEN_FILE], { encoding: 'utf8' });
  return out.trim().length > 0;
}

// Text of the "## Behaviour change" section, without HTML comments; '' if missing or a placeholder.
export function behaviourNote(body: string): string {
  const m = /^##\s*Behaviou?r change\s*$([\s\S]*?)(?=^##\s|(?![\s\S]))/im.exec(body.replace(/\r\n/g, '\n'));
  const text = (m?.[1] ?? '').replace(/<!--[\s\S]*?-->/g, '').trim();
  return /^(none|n\/a|-)?\.?$/i.test(text) ? '' : text;
}

if (process.argv[1]?.endsWith('behaviourNote.ts')) {
  const baseRef = process.argv[2];
  if (!baseRef) throw new Error('usage: behaviourNote.ts <base-ref>');
  if (!goldensChanged(baseRef)) {
    console.log(`${GOLDEN_FILE} unchanged: no behaviour note needed.`);
  } else if (behaviourNote(process.env.PR_BODY ?? '')) {
    console.log(`${GOLDEN_FILE} changed and the PR explains why.`);
  } else {
    console.error(
      `${GOLDEN_FILE} changed, but the PR body has no "## Behaviour change" section saying what changed and why.\n` +
        'Add one (see .github/pull_request_template.md); editing the PR body re-runs this check.',
    );
    process.exit(1);
  }
}
