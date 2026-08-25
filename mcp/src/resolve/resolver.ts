import type { PrStatus } from '@devdigest/shared';
import type { ApiPort, ConventionProjection } from '../ports.js';
import type { RepoCache } from './cache.js';
import { agentDisabled, agentNotFound, malformedRepo, pullNumberUnknown, repoNotImported } from './messages.js';

/**
 * The resolution layer (ring M2) — turns the human coordinates a model
 * writes (`repo = "owner/name"`, a PR `number`, an `agent` name or id) into
 * the internal ids every other DevDigest route is keyed by (§5.2). Pure
 * application logic: no `fetch`, no SDK — everything it
 * needs arrives through `ResolverDeps` (REQ-32), the direct analogue of the
 * server's "a service never takes the whole Container" rule
 * (`server/INSIGHTS.md`, 2026-08-15) one layer removed from a container that
 * does not exist here. This ring never reads an environment variable —
 * that is `config.ts` (M1) alone, per §5.12.2's rule 1.
 */

export interface ResolverDeps {
  api: ApiPort;
  cache: RepoCache;
  now: () => number;
  /** The web UI's base URL, for `repoNotImported`/`agentDisabled`'s
   *  actionable address (2026-08-23 remediation, `config.ts`'s
   *  `McpConfig.webUiUrl`). Optional: a caller that has not wired it yet —
   *  today every existing `ResolverDeps` construction site outside this
   *  package's own tests — still gets a valid, if less actionable, message
   *  rather than a broken interpolation. */
  webUiUrl?: string;
}

const REPO_SLUG_RE = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;
/** Generous relative to a real GitHub `owner/name` (max 39 + 1 + 100 chars);
 *  this is a length CAP against an adversarial model-authored string before
 *  it ever reaches a URL, not a realistic upper bound (§5.11). */
const MAX_REPO_SLUG_LENGTH = 200;

/** `repo` must be `owner/name` — validated here, before it ever reaches
 *  `ApiPort.lookupPull` and therefore before it can become part of a URL
 *  (§5.11; URL construction itself stays M3's job alone). */
export function isValidRepoSlug(repo: string): boolean {
  return repo.length > 0 && repo.length <= MAX_REPO_SLUG_LENGTH && REPO_SLUG_RE.test(repo);
}

/** A resolved pull, narrowed to what the rest of the package needs — never
 *  the wire `PullLookup` verbatim, though today the fields happen to match
 *  1:1 (§5.3's projection rule applies at every ring, not just at the tool
 *  boundary). */
export interface ResolvedPull {
  repoId: string;
  pullId: string;
  number: number;
  fullName: string;
  headSha: string;
  title: string;
  status: PrStatus;
}

export type ResolvePullResult = { ok: true; pull: ResolvedPull } | { ok: false; message: string };

/**
 * Turns `(repo, number)` into `{repoId, pullId}` through exactly ONE
 * `ApiPort.lookupPull` call (REQ-23's route already resolves both in one DB
 * read). Never returns `{findings: []}` or any other silent-success shape on
 * failure — every non-match becomes a `message` an `isError: true` tool
 * result can use verbatim (2026-08-17 fail-open insight).
 *
 * The repo id is cached here on a SUCCESSFUL resolution (REQ-26), for a
 * future repo-only resolution to consume — see this task's report, "Notes
 * for the integrator": `ApiPort` has no repo-only route today, so THIS
 * function itself never reads the cache back to skip a call — a PR's
 * title/status/head must always be fresh, and the one HTTP route resolves
 * both repo and pull together, so there is no partial call to skip.
 */
export async function resolvePull(repo: string, number: number, deps: ResolverDeps): Promise<ResolvePullResult> {
  if (!isValidRepoSlug(repo)) {
    return { ok: false, message: malformedRepo(repo) };
  }

  const result = await deps.api.lookupPull(repo, number);

  if (!result.ok) {
    return {
      ok: false,
      message:
        result.reason === 'repo_not_found'
          ? repoNotImported(repo, result.candidates, deps.webUiUrl)
          : pullNumberUnknown(repo, number, result.candidates),
    };
  }

  deps.cache.set(repo, result.pull.repo_id, deps.now());

  return {
    ok: true,
    pull: {
      repoId: result.pull.repo_id,
      pullId: result.pull.pull_id,
      number: result.pull.number,
      fullName: result.pull.full_name,
      headSha: result.pull.head_sha,
      title: result.pull.title,
      status: result.pull.status,
    },
  };
}

/** A resolved agent — the id `POST /pulls/:id/review` expects, plus the
 *  canonical name for messages that echo it back. */
export interface ResolvedAgent {
  agentId: string;
  name: string;
}

export type ResolveAgentResult = { ok: true; agent: ResolvedAgent } | { ok: false; message: string };

/**
 * Turns an `agent` argument into an agent id: exact id match first, then a
 * case-insensitive name match (§7 T6 "Do"). A disabled match is reported as
 * `agentDisabled`, never silently substituted or dropped — the caller asked
 * for a specific agent, and running a different one without saying so would
 * be a worse surprise than an error.
 */
export async function resolveAgent(agentName: string, deps: ResolverDeps): Promise<ResolveAgentResult> {
  const agents = await deps.api.listAgents();

  const byId = agents.find((a) => a.id === agentName);
  const match = byId ?? agents.find((a) => a.name.toLowerCase() === agentName.toLowerCase());

  if (!match) {
    return { ok: false, message: agentNotFound(agentName) };
  }
  if (!match.enabled) {
    return { ok: false, message: agentDisabled(match.name, deps.webUiUrl) };
  }
  return { ok: true, agent: { agentId: match.id, name: match.name } };
}

/**
 * `resolveAgent`'s read-only counterpart, for `get_findings`.
 *
 * Same id-then-name matching, minus the `enabled` gate — and that omission is
 * the whole point of the second function. Being disabled means "do not start
 * new runs with this agent", not "the reviews it already produced are
 * unreadable"; refusing to read them would push a caller toward
 * `run_agent_on_pr`, which is the one thing a disabled agent cannot do. Kept
 * separate from `resolveAgent` rather than folded in behind an option so the
 * gate can never be dropped from the run path by passing a flag.
 */
export async function resolveAgentForRead(
  agentName: string,
  deps: ResolverDeps,
): Promise<ResolveAgentResult> {
  const agents = await deps.api.listAgents();

  const byId = agents.find((a) => a.id === agentName);
  const match = byId ?? agents.find((a) => a.name.toLowerCase() === agentName.toLowerCase());

  if (!match) {
    return { ok: false, message: agentNotFound(agentName) };
  }
  return { ok: true, agent: { agentId: match.id, name: match.name } };
}

/** A resolved repo id, narrowed to what `get_conventions` needs — no PR in
 *  scope, unlike `ResolvedPull`. */
export type ResolveRepoResult = { ok: true; repoId: string } | { ok: false; message: string };

/**
 * Turns a repo `owner/name` into the `repoId` `ApiPort.listConventions`
 * expects, entirely through `ApiPort.listRepos()` + `RepoCache` (REQ-26).
 * Reads AND writes the ONE `owner/name → repo_id` cache — `resolvePull`
 * above only ever writes it on a successful pull resolution; this is the
 * repo-only counterpart that also reads it back, so the cache now has one
 * coherent read/write policy in one ring instead of a writer here and a
 * reader in a ring above it.
 *
 * This used to be a private helper duplicated inside
 * `tools/get-conventions.ts` (ring M4) because `resolve/**` belonged to
 * another task when that tool was first written, and its own comment said
 * so plainly rather than silently violating the ring. That constraint is
 * gone; the function moved down to where §5.12.1 says resolution belongs.
 */
export async function resolveRepoId(repo: string, deps: ResolverDeps): Promise<ResolveRepoResult> {
  if (!isValidRepoSlug(repo)) {
    return { ok: false, message: malformedRepo(repo) };
  }

  const now = deps.now();
  const cached = deps.cache.get(repo, now);
  if (cached) {
    return { ok: true, repoId: cached };
  }

  const repos = await deps.api.listRepos();
  const match = repos.find((r) => r.full_name === repo);
  if (!match) {
    return {
      ok: false,
      message: repoNotImported(
        repo,
        repos.map((r) => r.full_name),
        deps.webUiUrl,
      ),
    };
  }

  deps.cache.set(repo, match.id, now);
  return { ok: true, repoId: match.id };
}

/**
 * `get_conventions`'s one application-level read (ring M2, REQ-20): every
 * extracted convention for an already-resolved `repoId`, narrowed to the
 * `accepted` ones — "one line per convention with its status" that has
 * actually shipped (§5.13.5's frozen description). This filter used to run
 * inside the M4 tool handler (`tools/get-conventions.ts:83` in the reviewed
 * version) — filtering is application logic, so it moved here, next to the
 * resolution it follows, leaving the handler nothing to do but sequence the
 * two calls and map the result.
 */
export async function listAcceptedConventions(repoId: string, deps: ResolverDeps): Promise<ConventionProjection[]> {
  const candidates = await deps.api.listConventions(repoId);
  return candidates.filter((c) => c.status === 'accepted');
}
