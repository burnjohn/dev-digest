/**
 * F1 — repos module constants (extracted from routes.ts; no behaviour change).
 */

/** JobRunner kind for the asynchronous `git clone` job. */
export const CLONE_JOB_KIND = 'clone';

/** Clone depth — shallow clone (latest commit only) keeps imports fast. */
export const CLONE_DEPTH = 1;

/** Secret name (via the Secrets adapter) holding the GitHub PAT for private clones. */
export const GITHUB_TOKEN_SECRET = 'GITHUB_TOKEN';

/**
 * Parse `owner`/`repo` from a GitHub URL — supports both
 * `https://github.com/owner/repo(.git)` and `git@github.com:owner/repo.git`.
 *
 * ANCHORED AT THE START on purpose. An unanchored `github.com[/:]` also matches
 * `https://evil.test/github.com/owner/repo`, and the parsed URL is what gets
 * handed to `git clone` — so an unanchored pattern means an arbitrary remote.
 */
export const GITHUB_URL_REGEX =
  /^(?:https:\/\/github\.com\/|git@github\.com:)([^/]+)\/([^/.]+)(?:\.git)?\/?$/;

/**
 * GitHub's charset for an owner (user or org): alphanumerics and hyphens, never
 * leading with a hyphen. Validated separately from the URL pattern because
 * `owner` becomes a PATH SEGMENT in `clonePathFor` (`clones/<owner>/<name>`) —
 * without this, `https://github.com/../x` resolves outside the clones directory.
 */
export const GITHUB_OWNER_REGEX = /^[A-Za-z0-9][A-Za-z0-9-]*$/;

/** Same reasoning as the owner: `name` is the second path segment. */
export const GITHUB_REPO_NAME_REGEX = /^[A-Za-z0-9_-]+$/;

/** Username embedded into an authenticated https github.com clone URL. */
export const GIT_TOKEN_USERNAME = 'x-access-token';

/** Host for which a token is embedded into an https clone URL. */
export const GITHUB_HTTPS_HOST = 'github.com';
