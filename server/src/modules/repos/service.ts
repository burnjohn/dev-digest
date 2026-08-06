import type { Container } from '../../platform/container.js';
import { type GitHubTokenTestResult, type RepoWithToken } from '@devdigest/shared';
import { MissingTokenError, NotFoundError } from '../../platform/errors.js';
import { RepoRepository } from './repository.js';
import { parseRepoUrl, withGitHubToken, toRepoWithTokenDto } from './helpers.js';
import { resolveGitHubToken } from '../github-tokens/resolver.js';
import { GitHubTokenService } from '../github-tokens/service.js';
import { CLONE_JOB_KIND, CLONE_DEPTH } from './constants.js';
import {
  INDEX_JOB_KIND,
  REFRESH_JOB_KIND,
} from '../repo-intel/constants.js';

/**
 * F1 — repos service. Business logic for the Repositories feature:
 *   - add / list / refresh / remove
 *   - the asynchronous `clone` job (real `git clone` via the GitClient adapter)
 *
 * No HTTP and no raw SQL live here — persistence goes through RepoRepository,
 * pure transforms through helpers.ts, literals through constants.ts.
 */

/** Payload enqueued for (and consumed by) the `clone` job. */
export interface CloneJobPayload {
  repoId: string;
  owner: string;
  name: string;
  url: string;
  /** The repo's own token, carried so the job never guesses which one to use. */
  githubTokenId?: string | null;
}

export class RepoService {
  private repo: RepoRepository;

  constructor(private container: Container) {
    this.repo = new RepoRepository(container.db);
  }

  /**
   * Register the `clone` job handler once. Authenticates the clone with the
   * PAT of the repo's OWN token (so private repos work), clones via the
   * GitClient adapter, then persists the resulting path + last_polled_at.
   */
  registerCloneJobHandler(): void {
    this.container.jobs.register(CLONE_JOB_KIND, async (payload) => {
      await this.runCloneJob(payload as CloneJobPayload);
    });
  }

  async runCloneJob(payload: CloneJobPayload): Promise<void> {
    const { repoId, owner, name, url, githubTokenId } = payload;
    // The repo's own token, or none — there is deliberately no fallback to a
    // bare GITHUB_TOKEN in the environment. Anonymous clones stay supported
    // because public repos need no token at all; when one of THOSE fails, the
    // error below names the missing token instead of leaving a raw git auth
    // error as the only clue.
    let token: string | null = null;
    try {
      token = await resolveGitHubToken(this.container.secrets, githubTokenId ?? null);
    } catch (err) {
      if (!(err instanceof MissingTokenError)) throw err;
    }
    const cloneUrl = token ? withGitHubToken(url, token) : url;
    let path: string;
    try {
      ({ path } = await this.container.git.clone({ owner, name }, cloneUrl, {
        depth: CLONE_DEPTH,
      }));
    } catch (err) {
      // `cloneUrl` is never interpolated here: with no token it carries no
      // credentials, and with a token the original error is rethrown untouched
      // for JobRunner's redaction to handle.
      if (!token) {
        throw new Error(
          `Clone of ${owner}/${name} failed and no GitHub token is assigned to this repository — assign one in repo settings. Underlying error: ${(err as Error).message}`,
        );
      }
      throw err;
    }
    await this.repo.updateClonePath(repoId, path);

    // T2.2 — kick off the indexer in the background. ENQUEUE (not call) so the
    // clone job closes immediately and the (heavier) index runs as its own
    // job under JobRunner's timeout/retry. If the handler isn't registered
    // (e.g. repo-intel disabled at module wiring), enqueue() throws — log and
    // continue so the clone result is preserved either way.
    const workspaceId = await this.repo.workspaceIdFor(repoId);
    if (workspaceId) {
      try {
        await this.container.jobs.enqueue(workspaceId, INDEX_JOB_KIND, {
          repoId,
          owner,
          name,
        });
      } catch {
        // No handler registered or transient enqueue failure — clone has
        // already succeeded, so we don't fail the job for an index-followup
        // miss. The user can hit POST /repos/:id/reindex to retry.
      }
    }
  }

  /**
   * Add a repo: parse the URL, dedupe within the workspace, persist, and enqueue
   * the real clone (non-blocking). `created` is false when the repo already
   * existed (the caller returns 200 instead of 201).
   */
  async add(
    workspaceId: string,
    userId: string,
    url: string,
    githubTokenId: string | null = null,
  ): Promise<{ repo: RepoWithToken; created: boolean }> {
    const { owner, name } = parseRepoUrl(url);
    const fullName = `${owner}/${name}`;

    const existing = await this.repo.getWithTokenByFullName(workspaceId, fullName);
    if (existing) {
      return { repo: toRepoWithTokenDto(existing, existing.githubTokenLabel), created: false };
    }

    // Fail here, not in the clone job minutes later: a PAT can authenticate
    // fine and still 404 on a private repo it cannot see.
    if (githubTokenId) await this.probeToken(githubTokenId, fullName);

    const row = await this.repo.insert({
      workspaceId,
      owner,
      name,
      fullName,
      createdBy: userId,
      githubTokenId,
    });
    await this.container.jobs.enqueue(workspaceId, CLONE_JOB_KIND, {
      repoId: row.id,
      owner,
      name,
      url,
      githubTokenId,
    } satisfies CloneJobPayload);

    const created = await this.repo.getWithToken(workspaceId, row.id);
    return { repo: toRepoWithTokenDto(row, created?.githubTokenLabel ?? null), created: true };
  }

  async list(workspaceId: string): Promise<RepoWithToken[]> {
    const rows = await this.repo.listWithToken(workspaceId);
    return rows.map((r) => toRepoWithTokenDto(r, r.githubTokenLabel));
  }

  /**
   * Point a repo at a different token (or at none, with null). The new token is
   * probed against THIS repo first, for the same reason `add` probes: a token
   * that cannot read the repo must fail now, not in the next clone job.
   */
  async assignToken(
    workspaceId: string,
    repoId: string,
    githubTokenId: string | null,
  ): Promise<RepoWithToken> {
    const repo = await this.repo.getById(workspaceId, repoId);
    if (!repo) throw new NotFoundError('Repo not found');
    if (githubTokenId) await this.probeToken(githubTokenId, repo.fullName);

    const updated = await this.repo.assignToken(workspaceId, repoId, githubTokenId);
    if (!updated) throw new NotFoundError('Repo not found');
    const withToken = await this.repo.getWithToken(workspaceId, repoId);
    return toRepoWithTokenDto(withToken ?? updated, withToken?.githubTokenLabel ?? null);
  }

  /**
   * Probe a repo's OWN stored token, server-side. The raw value is resolved
   * here and never crosses the HTTP boundary in either direction — the client
   * sends only the repo id and gets back a pass/fail message.
   */
  async testAccess(workspaceId: string, repoId: string): Promise<GitHubTokenTestResult> {
    const repo = await this.repo.getById(workspaceId, repoId);
    if (!repo) throw new NotFoundError('Repo not found');
    let token: string;
    try {
      token = await resolveGitHubToken(this.container.secrets, repo.githubTokenId);
    } catch (err) {
      // A missing token is a RESULT here, not a request failure: the client
      // renders it in the same place as "GitHub rejected that token".
      if (!(err instanceof MissingTokenError)) throw err;
      return { ok: false, login: null, message: err.message };
    }
    return new GitHubTokenService(this.container).test({ token, full_name: repo.fullName });
  }

  /**
   * Resolve a token id and prove it can read `fullName`. Throws
   * MissingTokenError (422) when the id has no stored value, ValidationError
   * (422) when the token cannot read the repo. Never returns the value.
   */
  private async probeToken(githubTokenId: string, fullName: string): Promise<void> {
    const token = await resolveGitHubToken(this.container.secrets, githubTokenId);
    await new GitHubTokenService(this.container).probeAccess(token, fullName);
  }

  /** Re-fetch the clone for an existing repo (enqueues a fresh `clone` job). */
  /** Status of one background job, scoped to the workspace. */
  async jobStatus(
    workspaceId: string,
    jobId: string,
  ): Promise<{ id: string; kind: string; status: string; error: string | null } | null> {
    return this.repo.jobById(workspaceId, jobId);
  }

  /** Tail of the pending refresh chain, per repo — see `refresh`. */
  private refreshChain = new Map<string, Promise<unknown>>();

  refresh(workspaceId: string, id: string): Promise<{ status: 'refreshing'; job_id: string }> {
    // "Is one already queued?" then "queue one" is check-then-act, and five
    // clicks arrive as five concurrent requests: they all read before any of
    // them writes. Serialising per repo makes the guard hold. Safe as an
    // in-process lock because the server already assumes single-instance (it
    // reaps orphaned runs on boot on that basis).
    const prev = this.refreshChain.get(id) ?? Promise.resolve();
    const next = prev.then(
      () => this.refreshUnlocked(workspaceId, id),
      () => this.refreshUnlocked(workspaceId, id),
    );
    this.refreshChain.set(
      id,
      next.catch(() => undefined),
    );
    return next;
  }

  private async refreshUnlocked(
    workspaceId: string,
    id: string,
  ): Promise<{ status: 'refreshing'; job_id: string }> {
    const repo = await this.repo.getById(workspaceId, id);
    if (!repo) throw new NotFoundError('Repo not found');

    // Idempotent while work is outstanding. The HTTP call returns in ~10ms —
    // it only queues — so the button re-enables long before git finishes, and a
    // second click used to queue a second clone. Two `git fetch`es in one
    // directory then race on refs/remotes/* and one dies. Callers other than
    // the button (polling, review) can collide the same way, so the guard lives
    // here rather than in the UI.
    const active = await this.repo.activeCloneJobFor(workspaceId, repo.id);
    if (active) return { status: 'refreshing', job_id: active };

    const { id: jobId } = await this.container.jobs.enqueue(workspaceId, CLONE_JOB_KIND, {
      repoId: repo.id,
      owner: repo.owner,
      name: repo.name,
      url: `https://github.com/${repo.fullName}.git`,
      githubTokenId: repo.githubTokenId,
    } satisfies CloneJobPayload);
    // T2.2 — also enqueue an incremental refresh. The two queue positions are
    // independent (p-queue doesn't FIFO across kinds), but `runIncremental` is
    // a no-op when `currentHead === lastIndexedSha`, so ordering is safe: if
    // refresh fires before the new clone settles, it cheaply exits; if after,
    // it picks up the new HEAD.
    try {
      await this.container.jobs.enqueue(workspaceId, REFRESH_JOB_KIND, {
        repoId: repo.id,
        owner: repo.owner,
        name: repo.name,
      });
    } catch {
      // No handler / transient enqueue failure — refresh button is best-effort.
    }
    return { status: 'refreshing', job_id: jobId };
  }

  async remove(workspaceId: string, id: string): Promise<void> {
    const ok = await this.repo.remove(workspaceId, id);
    if (!ok) throw new NotFoundError('Repo not found');
  }
}
