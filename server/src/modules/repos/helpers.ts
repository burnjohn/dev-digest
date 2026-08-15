import { type Repo } from '@devdigest/shared';
import * as t from '../../db/schema.js';
import { AppError } from '../../platform/errors.js';
import {
  GITHUB_URL_REGEX,
  GITHUB_OWNER_REGEX,
  GITHUB_REPO_NAME_REGEX,
  GIT_TOKEN_USERNAME,
  GITHUB_HTTPS_HOST,
} from './constants.js';

/**
 * F1 — repos pure helpers (extracted from routes.ts; no behaviour change).
 * Pure functions only — no I/O, no DB, no container.
 */

/**
 * Parse `owner`/`name` from a GitHub URL (https or ssh form).
 *
 * Both captures are validated against GitHub's charset, not just extracted: they
 * end up as path segments in `clones/<owner>/<name>` and in the clone remote, so
 * a value like `..` would write outside the clone directory.
 */
export function parseRepoUrl(url: string): { owner: string; name: string } {
  // https://github.com/owner/repo(.git)  |  git@github.com:owner/repo.git
  const match = url.match(GITHUB_URL_REGEX);
  if (!match?.[1] || !match[2]) {
    throw new AppError('invalid_repo_url', `Could not parse owner/repo from '${url}'`, 400);
  }
  const [, owner, name] = match;
  if (!GITHUB_OWNER_REGEX.test(owner) || !GITHUB_REPO_NAME_REGEX.test(name)) {
    throw new AppError('invalid_repo_url', `Invalid owner/repo in '${url}'`, 400);
  }
  return { owner, name };
}

/**
 * The https clone remote for an already-parsed repo, optionally authenticated.
 *
 * Built from the validated `owner`/`name` rather than reusing the user's original
 * string, so whatever reaches `git clone` cannot be anything but a github.com URL.
 */
export function cloneUrlFor(owner: string, name: string, token?: string | null): string {
  const auth = token ? `${GIT_TOKEN_USERNAME}:${token}@` : '';
  return `https://${auth}${GITHUB_HTTPS_HOST}/${owner}/${name}.git`;
}


/** Map a persisted repo row to the API `Repo` DTO. */
export function toRepoDto(row: typeof t.repos.$inferSelect): Repo {
  return {
    id: row.id,
    workspace_id: row.workspaceId,
    owner: row.owner,
    name: row.name,
    full_name: row.fullName,
    default_branch: row.defaultBranch,
    clone_path: row.clonePath,
    last_polled_at: row.lastPolledAt?.toISOString() ?? null,
    created_by: row.createdBy,
  };
}
