/**
 * URL builders (ring M3) — every request URL `mcp/` ever constructs is built
 * HERE, and nowhere else. That is what makes "did we escape everything?" a
 * one-file question (§5.11): every interpolated value goes through
 * `encodeURIComponent` and a length cap before it reaches a query string or a
 * path segment, because `repo`, `agent` id and `file` all start as
 * model-authored strings.
 */

/** Defensive ceiling on any single interpolated path/query value. Well above
 *  any real `owner/name`, uuid or filename, and far below anything that could
 *  meaningfully bloat a request URL. */
const MAX_SEGMENT_LENGTH = 512;

function segment(value: string): string {
  const capped = value.length > MAX_SEGMENT_LENGTH ? value.slice(0, MAX_SEGMENT_LENGTH) : value;
  return encodeURIComponent(capped);
}

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}${path}`;
}

/** `GET /lookup/pull?repo=<owner/name>&number=<n>` (REQ-23). */
export function lookupPullUrl(base: string, repo: string, number: number): string {
  const query = new URLSearchParams({ repo: repo.slice(0, MAX_SEGMENT_LENGTH), number: String(number) });
  return joinUrl(base, `/lookup/pull?${query.toString()}`);
}

/** `GET /agents`. */
export function agentsUrl(base: string): string {
  return joinUrl(base, '/agents');
}

/** `GET /repos` — repo-only resolution source for `get_conventions` (T9's
 *  authorized `ApiPort` expansion). A pure DB read, unlike
 *  `GET /repos/:id/pulls`, which §5.2 already rejected. */
export function reposUrl(base: string): string {
  return joinUrl(base, '/repos');
}

/** `GET /pulls/:id/runs/active` — the in-flight source of truth (§5.5). */
export function activeRunsUrl(base: string, pullId: string): string {
  return joinUrl(base, `/pulls/${segment(pullId)}/runs/active`);
}

/** `POST /pulls/:id/review` — body is `{agentId}`, never `{all:true}` here. */
export function startReviewUrl(base: string, pullId: string): string {
  return joinUrl(base, `/pulls/${segment(pullId)}/review`);
}

/** `GET /pulls/:id/runs` — the poll target while waiting on a run (§5.4). */
export function runsUrl(base: string, pullId: string): string {
  return joinUrl(base, `/pulls/${segment(pullId)}/runs`);
}

/** `GET /pulls/:id/reviews`. */
export function reviewsUrl(base: string, pullId: string): string {
  return joinUrl(base, `/pulls/${segment(pullId)}/reviews`);
}

/** `GET /repos/:id/conventions`. */
export function conventionsUrl(base: string, repoId: string): string {
  return joinUrl(base, `/repos/${segment(repoId)}/conventions`);
}

/** `GET /pulls/:id/blast` (REQ-17, docs/plans/06-blast-radius.md). */
export function blastUrl(base: string, pullId: string): string {
  return joinUrl(base, `/pulls/${segment(pullId)}/blast`);
}
