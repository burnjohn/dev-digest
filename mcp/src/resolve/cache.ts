/**
 * `owner/name → repo_id` cache (ring M2, REQ-26) — the ONE thing this
 * package memoizes. Repos are added rarely and their ids never change once
 * assigned, so a short TTL trades a vanishingly rare staleness window for
 * skipping a lookup a caller already paid for once (§5.2).
 *
 * Two things this cache MUST NOT do, both load-bearing (§5.2):
 *   - never cache a NEGATIVE result — "you have not imported that repo yet"
 *     must become true the instant the user imports it, or the tool teaches
 *     the model a lie;
 *   - never cache a PR-LEVEL lookup — a PR's title/status/head move
 *     underneath the caller, and a stale `pull_id` would silently address
 *     the wrong review.
 * `resolver.ts` is the only writer, and it only ever calls `set` after a
 * SUCCESSFUL repo-level resolution — this file has no method that could hold
 * a negative or PR-scoped entry even if a future caller tried to misuse it.
 */

/** REQ-32's explicit `Deps` — a plain object literal in every test, no cast,
 *  no global stub. */
export interface RepoCacheDeps {
  /** How long a resolved `owner/name → repo_id` mapping stays valid, in ms. */
  ttlMs: number;
}

interface CacheEntry {
  repoId: string;
  expiresAt: number;
}

export class RepoCache {
  private readonly entries = new Map<string, CacheEntry>();

  constructor(private readonly deps: RepoCacheDeps) {}

  /** Returns the cached `repo_id` for `key` if it exists and has not expired
   *  as of `now`; otherwise `undefined`. A caller supplies `now` (never reads
   *  the clock itself) so this stays a pure function of its inputs. */
  get(key: string, now: number): string | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= now) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.repoId;
  }

  /** Records `key → repoId`, valid until `now + ttlMs`. Overwrites any
   *  existing entry for `key` (a repo's id cannot change, so this is only
   *  ever a same-value overwrite in practice — never a downgrade). */
  set(key: string, repoId: string, now: number): void {
    this.entries.set(key, { repoId, expiresAt: now + this.deps.ttlMs });
  }
}
