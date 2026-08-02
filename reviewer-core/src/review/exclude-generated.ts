import type { UnifiedDiff } from '@devdigest/shared';
import { sliceDiff } from './reduce.js';

/**
 * Machine-written files carry no review signal but dominate the prompt. One
 * drizzle snapshot is ~3.4k lines — on a migration PR it is routinely the
 * majority of the diff, and it is the difference between a prompt the model
 * answers and one it stalls on.
 *
 * These are dropped from the diff the model sees. They stay in the commit, and
 * grounding still works: a finding can only cite a line the model was shown, so
 * excluding a file also means no findings are produced against it.
 */
export const DEFAULT_GENERATED_PATTERNS: RegExp[] = [
  /(^|\/)migrations\/meta\//, // drizzle snapshots + journal
  /(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock|bun\.lockb)$/,
  /(^|\/)(dist|build|out|coverage)\//,
  /\.min\.(js|css)$/,
  /\.(snap|lock)$/,
];

export interface DiffExclusion {
  diff: UnifiedDiff;
  /** Paths withheld from the model, for the run log. */
  excluded: string[];
}

/**
 * Drop generated files from a diff, rebuilding `raw` so the prompt actually
 * shrinks — filtering only `files` would leave the full text in place.
 *
 * If every file matches, the original diff is returned unchanged: a review of
 * generated files is worth more than a review of nothing.
 */
export function excludeGenerated(
  diff: UnifiedDiff,
  patterns: RegExp[] = DEFAULT_GENERATED_PATTERNS,
): DiffExclusion {
  const kept = diff.files.filter((f) => !patterns.some((p) => p.test(f.path)));
  if (kept.length === diff.files.length || kept.length === 0) return { diff, excluded: [] };

  const excluded = diff.files.filter((f) => !kept.includes(f)).map((f) => f.path);
  return {
    diff: { ...diff, files: kept, raw: kept.map((f) => sliceDiff(diff, f.path)).join('\n') },
    excluded,
  };
}
