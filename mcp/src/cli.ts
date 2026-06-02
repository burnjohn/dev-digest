#!/usr/bin/env node
/**
 * `devdigest` — local pre-push review CLI (L04, §11).
 *
 * Usage:
 *   devdigest review [--mode working|push] [--base <ref>] [--pr <prId>] [--json]
 *
 * What it does:
 *   - Computes the diff you're about to push (push mode = base...HEAD, default
 *     base origin/HEAD) or your working-tree diff (working mode).
 *   - If `--pr <id>` (or DEVDIGEST_PR_ID) is set, it triggers the engine's
 *     Structured Reviewer for that PR over HTTP (reuses A2's reviewer).
 *   - Otherwise it runs a fast, offline heuristic pass over the diff (secrets,
 *     migrations, large-diff, debugger/console) so the command is always
 *     runnable without the engine — a real pre-push gate.
 *
 * Exit code is non-zero when a high-severity issue is found, so it can drop
 * straight into `.git/hooks/pre-push`:
 *
 *   #!/bin/sh
 *   exec devdigest review --mode push
 */
import { DevDigestClient } from './client.js';
import { pushDiff, workingDiff } from './local.js';
import { heuristicReview, type LocalFinding } from './review.js';

export { heuristicReview } from './review.js';

interface Args {
  mode: 'working' | 'push';
  base?: string;
  pr?: string;
  json: boolean;
}

function parseArgs(argv: string[]): { cmd: string; args: Args } {
  const cmd = argv[0] ?? 'review';
  const args: Args = { mode: 'push', json: false };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--mode') args.mode = (argv[++i] as Args['mode']) ?? 'push';
    else if (a === '--base') args.base = argv[++i];
    else if (a === '--pr') args.pr = argv[++i];
    else if (a === '--json') args.json = true;
  }
  if (!args.pr && process.env.DEVDIGEST_PR_ID) args.pr = process.env.DEVDIGEST_PR_ID;
  return { cmd, args };
}

function printReport(findings: LocalFinding[], json: boolean): number {
  if (json) {
    process.stdout.write(JSON.stringify({ findings }, null, 2) + '\n');
  } else if (findings.length === 0) {
    process.stdout.write('devdigest review: no issues found in the diff. ✓\n');
  } else {
    process.stdout.write(`devdigest review: ${findings.length} issue(s) found\n`);
    for (const f of findings) {
      const sev = f.severity.toUpperCase().padEnd(6);
      process.stdout.write(`  [${sev}] ${f.file}:${f.line}  ${f.title}\n           → ${f.hint}\n`);
    }
  }
  return findings.some((f) => f.severity === 'high') ? 1 : 0;
}

async function main() {
  const { cmd, args } = parseArgs(process.argv.slice(2));
  if (cmd !== 'review') {
    process.stderr.write(`Unknown command "${cmd}". Usage: devdigest review [--mode working|push] [--base ref] [--pr id] [--json]\n`);
    process.exit(2);
  }

  // Engine-backed review of an imported PR.
  if (args.pr) {
    try {
      const client = new DevDigestClient();
      const res = await client.runReview(args.pr, { all: true });
      process.stdout.write('devdigest review: triggered engine review for PR ' + args.pr + '\n');
      process.stdout.write(JSON.stringify(res, null, 2) + '\n');
      process.exit(0);
    } catch (e) {
      process.stderr.write(`devdigest review: engine review failed (${(e as Error).message}); falling back to local heuristic.\n`);
      // fall through to local
    }
  }

  const diff = args.mode === 'working' ? workingDiff() : pushDiff(args.base);
  if (!diff.trim()) {
    process.stdout.write('devdigest review: no changes to review. ✓\n');
    process.exit(0);
  }
  const findings = heuristicReview(diff);
  process.exit(printReport(findings, args.json));
}

main().catch((err) => {
  process.stderr.write(`devdigest: ${(err as Error).message}\n`);
  process.exit(1);
});
