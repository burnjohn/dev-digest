import { RUN_STATUS } from './constants.js';

/** Split an "owner/name" repo string into its parts (best-effort). */
export function splitRepo(full: string): { owner: string; name: string } {
  const [owner, name] = full.split('/');
  return { owner: owner ?? full, name: name ?? full };
}

/** Slugify a name into a filesystem/CI-safe token. */
export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Map an Actions run conclusion (+ findings count) to a ci_runs status. */
export function mapConclusion(conclusion: string | null, findings: number | null): string {
  if (conclusion === 'failure') return RUN_STATUS.failed;
  if (conclusion === 'success') return findings && findings > 0 ? RUN_STATUS.succeeded : RUN_STATUS.noFindings;
  return conclusion ?? RUN_STATUS.running;
}
