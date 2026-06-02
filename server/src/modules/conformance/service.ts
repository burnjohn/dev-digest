import type { Container } from '../../platform/container.js';
import type { Conformance, Provider, UnifiedDiff } from '@devdigest/shared';
import { Conformance as ConformanceSchema } from '@devdigest/shared';
import type {
  ConformanceInput,
  ConformanceReport,
} from '@devdigest/shared/contracts/eval-ci';
import { and, desc, eq } from 'drizzle-orm';
import * as t from '../../db/schema.js';
import { assemblePrompt } from '../../platform/prompt.js';
import { parseUnifiedDiff } from '../../adapters/git/diff-parser.js';
import { NotFoundError, AppError } from '../../platform/errors.js';
import { ReviewRepository, type PullRow } from '../reviews/repository.js';
import { AgentsRepository } from '../agents/repository.js';
import { DEFAULT_PROVIDER, SPEC_CHUNK_LIMIT, SPEC_SOURCE } from './constants.js';
import { defaultModel, specTitle } from './helpers.js';

/**
 * A4 — PRD ↔ PR Conformance (dogfooding, §7 L06). Pull the Project-Context spec
 * chunks (code_chunks source='spec') for the PR's repo + the PR diff, ask the
 * model to classify each spec requirement as implemented / missing /
 * out_of_scope (scope creep), compute completeness_pct, and persist a
 * `conformance_checks` row. Returns the 3-column `Conformance` report.
 */
export class ConformanceService {
  private reviews: ReviewRepository;
  private agents: AgentsRepository;

  constructor(private container: Container) {
    this.reviews = new ReviewRepository(container.db);
    this.agents = new AgentsRepository(container.db);
  }

  async run(workspaceId: string, prId: string, input: ConformanceInput): Promise<ConformanceReport> {
    const pull = await this.reviews.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    const repo = await this.reviews.getRepo(pull.repoId);
    if (!repo) throw new NotFoundError('Repo not found');

    const spec = await this.loadSpec(workspaceId, pull.repoId, input.spec ?? undefined);
    if (!spec) {
      throw new AppError(
        'no_spec',
        'No Project Context spec found to compare against. Add a spec under .devdigest/specs and re-index.',
        400,
      );
    }

    const diff = await this.loadDiff(workspaceId, pull, repo);
    const provider = (input.provider as Provider) ?? DEFAULT_PROVIDER;
    const llm = await this.container.llm(provider);

    const { messages } = assemblePrompt({
      system:
        'You check whether a pull request CONFORMS to a product spec (PRD). For each requirement in the spec, classify it as: "implemented" (the diff fulfils it — cite the evidence file), "missing" (the spec requires it but the diff does not implement it — say where it was expected), or "out_of_scope" (the diff adds something not tied to any requirement — scope creep). Return spec_id, spec_title, the items, and completeness_pct = round(100 * implemented / (implemented + missing)).',
      specs: [spec.content],
      diff: diff.raw,
      task: `Spec: ${spec.path}. Compare PR #${pull.number} "${pull.title}" against the spec requirements.`,
    });

    const res = await llm.completeStructured<Conformance>({
      model: input.model ?? defaultModel(provider),
      schema: ConformanceSchema,
      schemaName: 'Conformance',
      messages,
      maxRetries: 2,
    });

    const report = this.normalize(res.data, spec.path);

    const [row] = await this.container.db
      .insert(t.conformanceChecks)
      .values({
        prId: pull.id,
        specId: report.spec_id,
        completenessPct: report.completeness_pct,
        items: report.items,
      })
      .returning();

    return { id: row!.id, pr_id: pull.id, report };
  }

  /** Latest persisted conformance report for a PR (optionally a specific spec). */
  async latest(
    workspaceId: string,
    prId: string,
    specId?: string,
  ): Promise<ConformanceReport | null> {
    const pull = await this.reviews.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    const conds = [eq(t.conformanceChecks.prId, prId)];
    if (specId) conds.push(eq(t.conformanceChecks.specId, specId));
    const [row] = await this.container.db
      .select()
      .from(t.conformanceChecks)
      .where(and(...conds))
      .orderBy(desc(t.conformanceChecks.id))
      .limit(1);
    if (!row) return null;
    return {
      id: row.id,
      pr_id: prId,
      report: {
        spec_id: row.specId,
        spec_title: row.specId,
        items: (row.items as Conformance['items']) ?? [],
        completeness_pct: row.completenessPct ?? 0,
      },
    };
  }

  // ---- helpers ------------------------------------------------------------

  /** Recompute completeness_pct deterministically + stamp the spec id/title. */
  private normalize(report: Conformance, specPath: string): Conformance {
    const implemented = report.items.filter((i) => i.status === 'implemented').length;
    const missing = report.items.filter((i) => i.status === 'missing').length;
    const denom = implemented + missing;
    const pct = denom > 0 ? Math.round((100 * implemented) / denom) : 0;
    return {
      spec_id: report.spec_id || specPath,
      spec_title: report.spec_title || specTitle(specPath),
      items: report.items,
      completeness_pct: pct,
    };
  }

  private async loadSpec(
    _workspaceId: string,
    repoId: string,
    specPath?: string,
  ): Promise<{ path: string; content: string } | null> {
    const conds = [eq(t.codeChunks.repoId, repoId), eq(t.codeChunks.source, SPEC_SOURCE)];
    if (specPath) conds.push(eq(t.codeChunks.path, specPath));
    const rows = await this.container.db
      .select({ path: t.codeChunks.path, content: t.codeChunks.content })
      .from(t.codeChunks)
      .where(and(...conds))
      .limit(SPEC_CHUNK_LIMIT);
    if (rows.length === 0) return null;
    // Group chunks by path; pick the requested spec or the first one, concat its chunks.
    const path = specPath ?? rows[0]!.path;
    const content = rows
      .filter((r) => r.path === path)
      .map((r) => r.content)
      .join('\n\n');
    return { path, content };
  }

  /** Same diff resolution strategy as the reviewer (git diff → pr_files fallback). */
  private async loadDiff(
    _workspaceId: string,
    pull: PullRow,
    repo: typeof t.repos.$inferSelect,
  ): Promise<UnifiedDiff> {
    try {
      const diff = await this.container.git.diff(
        { owner: repo.owner, name: repo.name },
        pull.base,
        pull.headSha,
      );
      if (diff.files.length > 0) return diff;
    } catch {
      /* fall through */
    }
    const files = await this.reviews.getPrFiles(pull.id);
    const parts: string[] = [];
    for (const f of files) {
      if (!f.patch) continue;
      parts.push(`diff --git a/${f.path} b/${f.path}`);
      parts.push(`--- a/${f.path}`);
      parts.push(`+++ b/${f.path}`);
      parts.push(f.patch);
    }
    return parseUnifiedDiff(parts.join('\n'));
  }

}
