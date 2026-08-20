import type { RepoRow } from '../../db/rows.js';

/**
 * F1 — workspace DTO mapping. Pure.
 *
 * `cloned` is derived rather than stored: a repo row exists from the moment it
 * is added, but its clone lands later via the background clone job, so
 * "has a clone path" is the only honest signal that the working copy is there.
 */
export interface WorkspaceRepoSummary {
  id: string;
  full_name: string;
  clone_path: string | null;
  last_polled_at: string | null;
  cloned: boolean;
}

export function toWorkspaceRepoSummary(r: RepoRow): WorkspaceRepoSummary {
  return {
    id: r.id,
    full_name: r.fullName,
    clone_path: r.clonePath,
    last_polled_at: r.lastPolledAt?.toISOString() ?? null,
    cloned: Boolean(r.clonePath),
  };
}
