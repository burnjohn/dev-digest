import { and, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

export interface OnboardingRow {
  repoId: string;
  json: unknown;
  generatedAt: Date;
  mode: 'full' | 'lite';
  indexStatus: 'full' | 'partial' | 'degraded' | 'failed';
  degraded: boolean;
  degradedReason: string | null;
  llmCostCents: number | null;
}

export interface UpsertTourData {
  json: unknown;
  generatedAt: Date;
  mode: 'full' | 'lite';
  indexStatus: 'full' | 'partial' | 'degraded' | 'failed';
  degraded: boolean;
  degradedReason: string | null;
  llmCostCents: number | null;
}

export interface OnboardingRepoBasics {
  owner: string;
  name: string;
  defaultBranch: string;
  clonePath: string | null;
  workspaceId: string;
}

/**
 * OnboardingRepository — the `onboarding` table has NO `workspace_id` column
 * of its own (§4). Every query — reads AND writes — joins through `repos` and
 * filters `repos.workspace_id = $workspaceId` MECHANICALLY inside the query
 * itself, mirroring `BlastRepository.getPr` / `pull.repo.ts`'s `getBrief`.
 */
export class OnboardingRepository {
  constructor(private db: Db) {}

  /**
   * SELECT onboarding.* FROM onboarding INNER JOIN repos ON onboarding.repo_id
   * = repos.id WHERE onboarding.repo_id = $repoId AND repos.workspace_id =
   * $workspaceId. Returns `null` when no tour has ever been generated OR the
   * repo is cross-workspace (the two cases are indistinguishable at this
   * layer by design — the service decides how to respond to "no row").
   */
  async getTour(workspaceId: string, repoId: string): Promise<OnboardingRow | null> {
    const rows = await this.db
      .select({
        repoId: t.onboarding.repoId,
        json: t.onboarding.json,
        generatedAt: t.onboarding.generatedAt,
        mode: t.onboarding.mode,
        indexStatus: t.onboarding.indexStatus,
        degraded: t.onboarding.degraded,
        degradedReason: t.onboarding.degradedReason,
        llmCostCents: t.onboarding.llmCostCents,
      })
      .from(t.onboarding)
      .innerJoin(t.repos, eq(t.onboarding.repoId, t.repos.id))
      .where(and(eq(t.onboarding.repoId, repoId), eq(t.repos.workspaceId, workspaceId)))
      .limit(1);

    return rows[0] ?? null;
  }

  /**
   * Upserts the tour row. The workspace check is IN THE WRITE PATH ITSELF —
   * not a precondition the caller must remember to satisfy: a transaction
   * first re-validates `EXISTS(SELECT 1 FROM repos WHERE id=$repoId AND
   * workspace_id=$workspaceId)`; only when that holds does the
   * `INSERT ... ON CONFLICT (repo_id) DO UPDATE` run. If the repo does not
   * belong to the workspace, the write affects zero rows and this method
   * returns `null` — the DB query is what enforces ownership, not caller
   * discipline (R1/AP-3).
   */
  async upsertTour(
    workspaceId: string,
    repoId: string,
    data: UpsertTourData,
  ): Promise<OnboardingRow | null> {
    return this.db.transaction(async (tx) => {
      // Drizzle query-builder EXISTS check — avoids the postgres-js vs
      // node-postgres `execute()` return-shape trap (server/insights.md
      // 2026-07-03) entirely by staying on the typed query builder.
      const owns = await tx
        .select({ id: t.repos.id })
        .from(t.repos)
        .where(and(eq(t.repos.id, repoId), eq(t.repos.workspaceId, workspaceId)))
        .limit(1);
      if (owns.length === 0) return null;

      const rows = await tx
        .insert(t.onboarding)
        .values({
          repoId,
          json: data.json,
          generatedAt: data.generatedAt,
          mode: data.mode,
          indexStatus: data.indexStatus,
          degraded: data.degraded,
          degradedReason: data.degradedReason,
          llmCostCents: data.llmCostCents,
        })
        .onConflictDoUpdate({
          target: t.onboarding.repoId,
          set: {
            json: data.json,
            generatedAt: data.generatedAt,
            mode: data.mode,
            indexStatus: data.indexStatus,
            degraded: data.degraded,
            degradedReason: data.degradedReason,
            llmCostCents: data.llmCostCents,
          },
        })
        .returning({
          repoId: t.onboarding.repoId,
          json: t.onboarding.json,
          generatedAt: t.onboarding.generatedAt,
          mode: t.onboarding.mode,
          indexStatus: t.onboarding.indexStatus,
          degraded: t.onboarding.degraded,
          degradedReason: t.onboarding.degradedReason,
          llmCostCents: t.onboarding.llmCostCents,
        });

      return rows[0] ?? null;
    });
  }

  /**
   * Repo basics needed by the service for the early friendly-404 UX
   * short-circuit AND for GitHub blob link construction. Mirrors
   * `BlastRepository.getRepoBasics` / `RepoIntelRepository.getRepoBasics`.
   * This is an OPTIMIZATION, NOT the security boundary — `upsertTour`'s own
   * `EXISTS` check is the boundary regardless of what this method returns.
   */
  async getRepoBasics(repoId: string): Promise<OnboardingRepoBasics | null> {
    const rows = await this.db
      .select({
        owner: t.repos.owner,
        name: t.repos.name,
        defaultBranch: t.repos.defaultBranch,
        clonePath: t.repos.clonePath,
        workspaceId: t.repos.workspaceId,
      })
      .from(t.repos)
      .where(eq(t.repos.id, repoId))
      .limit(1);

    return rows[0] ?? null;
  }
}
