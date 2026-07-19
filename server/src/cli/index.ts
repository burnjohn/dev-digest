#!/usr/bin/env -S npx tsx
/**
 * devdigest — pre-push CLI.
 *
 *   devdigest review --mode working    # review the working copy before push
 *   devdigest review --mode staged     # review only `git add`-ed changes
 *   devdigest review --mode branch --base main
 *
 * Reuses the product's Structured Reviewer (@devdigest/reviewer-core) from a new
 * entry point — same agent, same findings — so you get a review in your working
 * copy, before anything is pushed. No server / DB / GitHub required.
 *
 * This file is the thin I/O shell (argv + real adapters + process.exit); all the
 * logic lives in run.ts / diff.ts / render.ts and is unit-tested.
 */
import { OpenRouterProvider } from '@devdigest/reviewer-core';
import { estimateCost } from '../adapters/llm/pricing.js';
import { LocalSecretsProvider } from '../adapters/secrets/local.js';
import { loadConfig } from '../platform/config.js';
import { GENERAL_REVIEWER_PROMPT } from '../db/seed-prompts.js';
import { runReviewCli } from './run.js';
import { makeGitRunner, REVIEW_MODES, type ReviewMode } from './diff.js';

/** Default model — an OpenRouter id (the only key we require), matching the seed. */
const DEFAULT_MODEL = 'deepseek/deepseek-v4-flash';

interface Args {
  command: string;
  mode: ReviewMode;
  base: string;
  model: string;
  color: boolean;
}

function parseArgs(argv: string[]): Args {
  const [command = '', ...rest] = argv;
  const args: Args = { command, mode: 'working', base: 'main', model: DEFAULT_MODEL, color: process.stdout.isTTY ?? false };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--mode') args.mode = rest[++i] as ReviewMode;
    else if (a === '--base') args.base = rest[++i]!;
    else if (a === '--model') args.model = rest[++i]!;
    else if (a === '--no-color') args.color = false;
    else if (a === '--color') args.color = true;
  }
  return args;
}

const USAGE = `Usage: devdigest review --mode <${REVIEW_MODES.join('|')}> [--base <ref>] [--model <id>] [--no-color]`;

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (args.command !== 'review') {
    process.stderr.write(`${USAGE}\n`);
    return 2;
  }
  if (!REVIEW_MODES.includes(args.mode)) {
    process.stderr.write(`Unknown --mode "${args.mode}". ${USAGE}\n`);
    return 2;
  }

  const config = loadConfig();
  const secrets = new LocalSecretsProvider(config.secretsPath);

  return runReviewCli({
    mode: args.mode,
    base: args.base,
    model: args.model,
    color: args.color,
    runGit: makeGitRunner(process.cwd()),
    systemPrompt: GENERAL_REVIEWER_PROMPT,
    write: (s) => process.stdout.write(s),
    makeLlm: async () => {
      const key = await secrets.get('OPENROUTER_API_KEY');
      if (!key) {
        throw new Error(
          'OPENROUTER_API_KEY is not set. Add it to ~/.devdigest/secrets.json, the Settings UI, or the environment.',
        );
      }
      return new OpenRouterProvider(key, { estimateCost });
    },
  }).then((r) => r.exitCode);
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    process.stderr.write(`devdigest: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
