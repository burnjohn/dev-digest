import { and, desc, eq, ne } from 'drizzle-orm';
import type {
  BlastRadius,
  Intent,
  PrBrief,
  PrHistory,
  PrHistoryItem,
  Provider,
  Risks,
  UnifiedDiff,
} from '@devdigest/shared';
import { Risks as RisksSchema } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import * as t from '../../db/schema.js';
import { NotFoundError } from '../../platform/errors.js';
import { assemblePrompt } from '../../platform/prompt.js';
import { parseUnifiedDiff } from '../../adapters/git/diff-parser.js';
import { BlastService } from '../blast/service.js';
import {
  MAX_HISTORY_ITEMS,
  RISK_MAX_RETRIES,
  RISK_MODEL,
  RISK_PROVIDER,
  RISK_SYSTEM_PROMPT,
  SPEC_CHUNK_LIMIT,
} from './constants.js';
import { heuristicRisks, stubIntent } from './helpers.js';

/**
 * A3 — PR Brief service (L05, §7).
 *
 * `PrBrief` = Intent + Blast + Risks + History.
 *   - Intent : reuses A2's persisted `pr_intent` (falls back to a stub if none).
 *   - Blast  : delegates to A3's BlastService.
 *   - Risks  : structured LLM call (schema = `Risks`) over the diff + specs,
 *              with graceful degradation (heuristic risks) when no LLM key.
 *   - History: prior MERGED PRs whose changed files overlap this PR's files.
 *
 * The composed brief is persisted into `pr_brief.json` (one doc per PR).
 */
export class BriefService {
  private blast: BlastService;
  constructor(private container: Container) {
    this.blast = new BlastService(container);
  }

  async forPull(workspaceId: string, prId: string): Promise<PrBrief> {
    const db = this.container.db;
    const [pull] = await db
      .select()
      .from(t.pullRequests)
      .where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.id, prId)));
    if (!pull) throw new NotFoundError('Pull request not found');
    const [repo] = await db.select().from(t.repos).where(eq(t.repos.id, pull.repoId));
    if (!repo) throw new NotFoundError('Repo not found');

    const intent = (await this.getIntent(prId)) ?? stubIntent(pull.title);
    const blast = await this.blast.forPull(workspaceId, prId);
    const diff = await this.loadDiff(prId, repo, pull.base, pull.headSha);
    const specs = await this.collectSpecs(pull.repoId);
    const risks = await this.deriveRisks(diff, specs, intent);
    const history = await this.deriveHistory(workspaceId, repo.id, prId, pull.number);

    const brief: PrBrief = { intent, blast, risks, history };
    await db
      .insert(t.prBrief)
      .values({ prId, json: brief })
      .onConflictDoUpdate({ target: t.prBrief.prId, set: { json: brief } });
    return brief;
  }

  /** Return a persisted brief without recomputing, if present. */
  async getCached(workspaceId: string, prId: string): Promise<PrBrief | undefined> {
    const [pull] = await this.container.db
      .select({ id: t.pullRequests.id })
      .from(t.pullRequests)
      .where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.id, prId)));
    if (!pull) throw new NotFoundError('Pull request not found');
    const [row] = await this.container.db
      .select({ json: t.prBrief.json })
      .from(t.prBrief)
      .where(eq(t.prBrief.prId, prId));
    return row?.json as PrBrief | undefined;
  }

  // ---- Intent --------------------------------------------------------------
  private async getIntent(prId: string): Promise<Intent | undefined> {
    const [row] = await this.container.db
      .select()
      .from(t.prIntent)
      .where(eq(t.prIntent.prId, prId));
    if (!row) return undefined;
    return { intent: row.intent, in_scope: row.inScope, out_of_scope: row.outOfScope };
  }

  // ---- Risks ---------------------------------------------------------------
  private async deriveRisks(diff: UnifiedDiff, specs: string[], intent: Intent): Promise<Risks> {
    if (!diff.raw.trim()) return { risks: [] };
    try {
      const provider: Provider = RISK_PROVIDER;
      const llm = await this.container.llm(provider);
      const { messages } = assemblePrompt({
        system: RISK_SYSTEM_PROMPT,
        specs,
        diff: diff.raw,
        task: `PR intent: ${intent.intent}\nIn scope: ${intent.in_scope.join(', ') || '(none stated)'}`,
      });
      const res = await llm.completeStructured<Risks>({
        model: RISK_MODEL,
        schema: RisksSchema,
        schemaName: 'Risks',
        messages,
        maxRetries: RISK_MAX_RETRIES,
      });
      return res.data;
    } catch {
      // Graceful degradation: cheap heuristic risk scan (no LLM key / failure).
      return heuristicRisks(diff);
    }
  }

  // ---- History -------------------------------------------------------------
  /**
   * Prior MERGED PRs in the same repo whose changed files overlap this PR's
   * changed files. Sourced from persisted `pull_requests`/`pr_files` (no extra
   * GitHub round-trips); newest first, capped at 5.
   */
  private async deriveHistory(
    workspaceId: string,
    repoId: string,
    prId: string,
    _number: number,
  ): Promise<PrHistory> {
    const db = this.container.db;
    const ourFiles = new Set(
      (await db.select({ path: t.prFiles.path }).from(t.prFiles).where(eq(t.prFiles.prId, prId))).map(
        (r) => r.path,
      ),
    );
    if (ourFiles.size === 0) return { history: [] };

    const others = await db
      .select()
      .from(t.pullRequests)
      .where(
        and(
          eq(t.pullRequests.workspaceId, workspaceId),
          eq(t.pullRequests.repoId, repoId),
          ne(t.pullRequests.id, prId),
        ),
      )
      .orderBy(desc(t.pullRequests.updatedAt));

    const items: PrHistoryItem[] = [];
    for (const pr of others) {
      const files = (
        await db.select({ path: t.prFiles.path }).from(t.prFiles).where(eq(t.prFiles.prId, pr.id))
      ).map((r) => r.path);
      const overlap = files.filter((f) => ourFiles.has(f));
      if (overlap.length === 0) continue;
      items.push({
        pr_number: pr.number,
        title: pr.title,
        merged_at: (pr.updatedAt ?? pr.openedAt ?? new Date()).toISOString(),
        author: pr.author,
        files_overlap: overlap,
        notes: `Touches ${overlap.length} of the same file(s).`,
      });
      if (items.length >= MAX_HISTORY_ITEMS) break;
    }
    return { history: items };
  }

  // ---- shared helpers ------------------------------------------------------
  private async loadDiff(
    prId: string,
    repo: typeof t.repos.$inferSelect,
    base: string,
    head: string,
  ): Promise<UnifiedDiff> {
    try {
      const diff = await this.container.git.diff({ owner: repo.owner, name: repo.name }, base, head);
      if (diff.files.length > 0) return diff;
    } catch {
      /* fall through */
    }
    const files = await this.container.db
      .select()
      .from(t.prFiles)
      .where(eq(t.prFiles.prId, prId));
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

  private async collectSpecs(repoId: string): Promise<string[]> {
    try {
      const rows = await this.container.db
        .select({ content: t.codeChunks.content })
        .from(t.codeChunks)
        .where(and(eq(t.codeChunks.repoId, repoId), eq(t.codeChunks.source, 'spec')))
        .limit(SPEC_CHUNK_LIMIT);
      return rows.map((r) => r.content);
    } catch {
      return [];
    }
  }
}
