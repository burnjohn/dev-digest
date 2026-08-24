import type { BlastRadiusResponse, FeatureModelChoice, LLMProvider } from '@devdigest/shared';
import type { Db } from '../../db/client.js';
import type { RepoIntel } from '../repo-intel/types.js';
import { BlastRepository } from './repository.js';
import { buildBlastResponse, buildFileImpact, buildPriorPrs, distinctReverseFiles } from './helpers.js';
import { narrateBlastRadius } from './explain.js';
import type { ChangedFileFactsRow } from './types.js';

/**
 * `blast` service — "what else could this diff touch?" (docs/plans/06-blast-radius.md).
 *
 * `BlastServiceDeps` is explicit rather than the whole `Container` — it is
 * structurally satisfied by `Container` with no call-site or container
 * change (`server/INSIGHTS.md`, 2026-08-15). This is the shape the stripped
 * historical `blast/routes.ts` got wrong (`new BlastService(container)`,
 * `git show 15fa391^:server/src/modules/blast/routes.ts`) — do not restore
 * that pattern.
 *
 * `llm` (T9, D3) is a LAZY resolver — `(id) => Promise<LLMProvider>` — never a
 * resolved client, matching `Container.llm(id)` exactly so booting with no
 * keys configured still works (server/INSIGHTS.md, 2026-08-15).
 */
export interface BlastServiceDeps {
  db: Db;
  repoIntel: RepoIntel;
  llm: (id: 'openai' | 'anthropic' | 'openrouter') => Promise<LLMProvider>;
}

export class BlastService {
  private repo: BlastRepository;

  constructor(private deps: BlastServiceDeps) {
    this.repo = new BlastRepository(deps.db);
  }

  /**
   * `undefined` => the PR does not exist (or is not in this workspace) — the
   * route maps that to 404. `repoIntel.getBlastRadius` / `getIndexState` are
   * D4's sanctioned seam (`container.repoIntel`); this module re-implements
   * none of that logic (REQ-2) and never edits `modules/repo-intel/**`.
   *
   * `narrationModel` (T9, D3) is OPTIONAL and comes from the ROUTE, never
   * resolved here — `blast/routes.ts` only resolves it when
   * `BLAST_EXPLAIN_ENABLED` is on, so leaving it `undefined` is what makes
   * REQ-20 structural: no model, no `deps.llm` call, `narrative` stays
   * `null`. When present, the already-built response is narrated by
   * `explain.ts` and a failure there (rejection, timeout, unparsable or
   * ungrounded reply) can only ever fall back to `null` — never throw, never
   * fail the request (asserted in `blast-explain.test.ts`).
   */
  async getBlastRadius(
    workspaceId: string,
    prId: string,
    narrationModel?: FeatureModelChoice,
  ): Promise<BlastRadiusResponse | undefined> {
    const pr = await this.repo.getPr(workspaceId, prId);
    if (!pr) return undefined;

    const changedFiles = await this.repo.getChangedFiles(pr.id); // REQ-4

    const [blastResult, indexState, changedFileFacts, importsAvailable, otherPrs] =
      await Promise.all([
        this.deps.repoIntel.getBlastRadius(pr.repoId, changedFiles),
        this.deps.repoIntel.getIndexState(pr.repoId),
        this.repo.getFileFactsForFiles(pr.repoId, changedFiles), // REQ-5 / gap G1
        this.repo.hasFileEdges(pr.repoId), // REQ-9 coverage.imports_available
        this.repo.getOtherPrsOfRepo(pr.repoId, pr.id), // REQ-10 — scope for the two reads below
      ]);

    // REQ-9: the bounded (depth<=2) reverse-import walk. TWO sequential
    // `getReverseEdges` calls, never a third and never a recursive query —
    // level 2's frontier depends on level 1's deduped result, so this can't
    // join the Promise.all above. `distinctReverseFiles` (pure, in
    // helpers.ts) dedups each level and excludes files already reached.
    const changedSet = new Set(changedFiles);
    const level1Edges = await this.repo.getReverseEdges(pr.repoId, changedFiles);
    const level1Files = distinctReverseFiles(level1Edges, changedSet);
    const level2Edges = await this.repo.getReverseEdges(pr.repoId, level1Files);
    const level2Files = distinctReverseFiles(
      level2Edges,
      new Set([...changedSet, ...level1Files]),
    );

    const impactFiles = [...level1Files, ...level2Files];
    const impactFacts: ChangedFileFactsRow[] = await this.repo.getFileFactsForFiles(
      pr.repoId,
      impactFiles,
    );
    const factsByImpactFile = new Map(impactFacts.map((f) => [f.filePath, f]));
    const fileImpact = buildFileImpact(level1Files, level2Files, factsByImpactFile);

    // REQ-10: other PRs of this repo whose cached `pr_files` overlap the
    // changed files. `otherPrIds` scopes both reads — `pr_files` has no
    // `repo_id` column of its own (repository.ts's header comment).
    const otherPrIds = otherPrs.map((p) => p.id);
    const [priorPrsAvailable, overlapRows] = await Promise.all([
      this.repo.hasCachedPrFilesFor(otherPrIds),
      this.repo.getPrFileOverlap(otherPrIds, changedFiles),
    ]);
    const priorPrs = buildPriorPrs(otherPrs, overlapRows);

    const response = buildBlastResponse({
      blastResult,
      indexState,
      changedFiles,
      changedFileFacts,
      fileImpact,
      importsAvailable,
      priorPrs,
      priorPrsAvailable,
    });

    // REQ-19/REQ-20 (T9, D3): `buildBlastResponse` always returns
    // `narrative: null` — narration is layered on here, AFTER the response is
    // fully computed, only when the route handed in a resolved model.
    // `narrateBlastRadius` never throws (it fails to `null` internally and
    // logs), but this call is deliberately not awaited inside a try/catch of
    // its own — one degradation path is enough, and duplicating it here would
    // just be trusting the same guarantee twice.
    if (!narrationModel) return response;
    const narrative = await narrateBlastRadius(
      { llm: this.deps.llm },
      {
        status: response.status,
        totals: response.totals,
        symbols: response.symbols,
        file_impact: response.file_impact,
      },
      narrationModel,
    );
    return { ...response, narrative };
  }
}
