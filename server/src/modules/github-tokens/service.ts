import type {
  GitHubToken,
  GitHubTokenInput,
  GitHubTokenPatch,
  GitHubTokenTestInput,
  GitHubTokenTestResult,
} from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { ExternalServiceError, NotFoundError, ValidationError } from '../../platform/errors.js';
import { OctokitGitHubClient } from '../../adapters/github/octokit.js';
import { GitHubTokenRepository, type GitHubTokenRow } from './repository.js';
import { tokenSecretKey } from './resolver.js';

export class GitHubTokenService {
  private repo: GitHubTokenRepository;

  constructor(private container: Container) {
    this.repo = new GitHubTokenRepository(container.db);
  }

  /**
   * A client for a RAW token value — used only to validate a PAT before it is
   * persisted. In tests, `container.overriddenGithub` resolves to the injected
   * MockGitHubClient so this never makes a real network call; otherwise a real
   * Octokit client is built straight from the raw value (there is no token id
   * yet — the row may not even exist, e.g. for POST /github-tokens/test).
   */
  private clientFor(token: string) {
    return this.container.overriddenGithub ?? new OctokitGitHubClient(token);
  }

  private async toDto(row: GitHubTokenRow, repoCount: number): Promise<GitHubToken> {
    const value = await this.container.secrets.get(tokenSecretKey(row.id));
    return {
      id: row.id,
      workspace_id: row.workspaceId,
      label: row.label,
      github_login: row.githubLogin ?? null,
      configured: !!value,
      repo_count: repoCount,
      created_at: row.createdAt.toISOString(),
      last_validated_at: row.lastValidatedAt?.toISOString() ?? null,
    };
  }

  async list(workspaceId: string): Promise<GitHubToken[]> {
    const rows = await this.repo.list(workspaceId);
    return Promise.all(rows.map((r) => this.toDto(r, r.repoCount)));
  }

  /**
   * Validate FIRST, persist second: a rejected PAT must leave no row and no
   * secret behind. If writing the secret fails after the row exists, the row
   * is removed so a token can never be listed as configured without a value.
   */
  async create(workspaceId: string, input: GitHubTokenInput): Promise<GitHubToken> {
    if (!this.container.secrets.set) {
      throw new ValidationError('Secrets backend is read-only');
    }
    if (await this.repo.findByLabel(workspaceId, input.label)) {
      throw new ValidationError(`A token labelled "${input.label}" already exists`);
    }
    const login = await this.validate(input.token);

    const row = await this.repo.insert({ workspaceId, label: input.label });
    try {
      await this.writeSecret(row.id, input.token);
    } catch (err) {
      // The row must not survive a failed secret write — but the cleanup
      // itself must never mask WHY the write failed. Best-effort only: if
      // cleanup also fails, the original secret-write error still reaches the
      // caller (a stray row is the lesser problem — see `configured` in toDto,
      // which requires the secret to resolve, so it never shows as usable).
      await this.repo.remove(workspaceId, row.id).catch(() => undefined);
      throw err;
    }
    const updated = await this.repo.updateMeta(workspaceId, row.id, {
      githubLogin: login,
      lastValidatedAt: new Date(),
    });
    this.container.invalidateSecretCaches();
    // Brand new id — no repo could reference it yet (assignment is Task 8).
    return this.toDto(updated ?? row, 0);
  }

  async patch(workspaceId: string, id: string, input: GitHubTokenPatch): Promise<GitHubToken> {
    const existing = await this.repo.getById(workspaceId, id);
    if (!existing) throw new NotFoundError('Token not found');
    if (input.label && input.label !== existing.label) {
      const clash = await this.repo.findByLabel(workspaceId, input.label);
      if (clash) throw new ValidationError(`A token labelled "${input.label}" already exists`);
    }

    let login = existing.githubLogin;
    if (input.token) {
      if (!this.container.secrets.set) throw new ValidationError('Secrets backend is read-only');
      login = await this.validate(input.token);
      await this.writeSecret(id, input.token);
    }
    const updated = await this.repo.updateMeta(workspaceId, id, {
      ...(input.label ? { label: input.label } : {}),
      githubLogin: login,
      ...(input.token ? { lastValidatedAt: new Date() } : {}),
    });
    this.container.invalidateSecretCaches();
    const repoCount = await this.repo.repoCountFor(id);
    return this.toDto(updated ?? existing, repoCount);
  }

  /**
   * Deletion always succeeds once the row existed. The FK nulls
   * `repos.github_token_id`, leaving those repos in the broken state —
   * deliberately, so nothing silently re-authenticates with a different token.
   *
   * SecretsProvider has no delete(), so the value is tombstoned with an empty
   * string, which `resolveGitHubToken` (and `LocalSecretsProvider.get`) treats
   * as absent.
   */
  async remove(workspaceId: string, id: string): Promise<{ deleted: string; orphaned: number }> {
    const { deleted, orphaned } = await this.repo.remove(workspaceId, id);
    if (!deleted) throw new NotFoundError('Token not found');
    if (this.container.secrets.set) await this.container.secrets.set(tokenSecretKey(id), '');
    this.container.invalidateSecretCaches();
    return { deleted: id, orphaned };
  }

  /** Ephemeral validation — nothing is persisted. */
  async test(input: GitHubTokenTestInput): Promise<GitHubTokenTestResult> {
    try {
      const login = await this.validate(input.token);
      if (input.full_name) await this.probeAccess(input.token, input.full_name);
      return {
        ok: true,
        login,
        message: input.full_name
          ? `Connected as @${login} — can read ${input.full_name}`
          : `Connected as @${login}`,
      };
    } catch (err) {
      return { ok: false, login: null, message: (err as Error).message };
    }
  }

  /** GET /user — proves the PAT authenticates at all. */
  private async validate(token: string): Promise<string> {
    try {
      return await this.clientFor(token).currentLogin();
    } catch {
      throw new ValidationError('GitHub rejected that token');
    }
  }

  /**
   * Persist a token value. Like `validate()`, this is deliberately defensive:
   * SecretsProvider is pluggable, so a future backend's thrown error is not
   * trusted to keep the raw token value out of its message — only a generic
   * message ever reaches the caller. Kept distinguishable from `validate()`'s
   * "GitHub rejected that token" so a caller (and `create`'s cleanup path)
   * can still tell a rejected PAT apart from a secrets-backend fault.
   */
  private async writeSecret(id: string, token: string): Promise<void> {
    // Called through the provider, NOT as a detached `const set = ...`: a class
    // -based backend (LocalSecretsProvider) loses `this` that way and every
    // write fails with "Failed to store the token value".
    if (!this.container.secrets.set) throw new ValidationError('Secrets backend is read-only');
    try {
      await this.container.secrets.set(tokenSecretKey(id), token);
    } catch {
      throw new ExternalServiceError('Failed to store the token value');
    }
  }

  /**
   * Prove the token can READ a specific repo. GitHubClient has no getRepo, and
   * listPullRequests is the capability DevDigest actually needs — a repo the
   * token cannot see errors here.
   */
  async probeAccess(token: string, fullName: string): Promise<void> {
    const [owner, name] = fullName.split('/');
    if (!owner || !name) throw new ValidationError(`"${fullName}" is not owner/name`);
    try {
      await this.clientFor(token).listPullRequests({ owner, name });
    } catch {
      throw new ValidationError(`That token cannot read ${fullName}`);
    }
  }
}
