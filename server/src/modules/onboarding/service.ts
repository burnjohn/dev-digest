import { and, eq, sql } from 'drizzle-orm';
import { join } from 'node:path';
import { readdir, stat } from 'node:fs/promises';
import type { Onboarding, OnboardingSection } from '@devdigest/shared';
import { Onboarding as OnboardingSchema } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import * as t from '../../db/schema.js';
import { NotFoundError } from '../../platform/errors.js';
import { assemblePrompt } from '../../platform/prompt.js';
import {
  KEYWORD_SCAN_LIMIT,
  ONBOARDING_MAX_RETRIES,
  ONBOARDING_MODEL,
  ONBOARDING_PROVIDER,
  RETRIEVE_TOP_K,
  SECTION_PLAN,
  SECTION_SYSTEM_PROMPT,
  TREE_IGNORE_DIRS,
  TREE_MAX_DEPTH,
  TREE_MAX_ENTRIES,
  TREE_MAX_FILE_BYTES,
} from './constants.js';
import { queryTokens, scoreChunks, skeletonSection } from './helpers.js';

/**
 * A3 — Onboarding generator (L05, §7).
 *
 * RAG over the repo (`code_chunks`, source=code|spec) + a shallow file tree →
 * a 5-section `Onboarding` tour, persisted to the `onboarding` table (one doc
 * per repo). Sections: Overview · Architecture · Key Modules · Getting Started ·
 * Conventions & Gotchas. Each section is a structured LLM write grounded in
 * retrieved context; degrades to a deterministic skeleton if no LLM key.
 */

const SectionWrite = OnboardingSchema.shape.sections.element;

export class OnboardingService {
  constructor(private container: Container) {}

  async get(repoId: string): Promise<Onboarding | undefined> {
    const [row] = await this.container.db
      .select({ json: t.onboarding.json })
      .from(t.onboarding)
      .where(eq(t.onboarding.repoId, repoId));
    return row?.json as Onboarding | undefined;
  }

  async generate(workspaceId: string, repoId: string): Promise<Onboarding> {
    const [repo] = await this.container.db
      .select()
      .from(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.id, repoId)));
    if (!repo) throw new NotFoundError('Repo not found');

    const tree = repo.clonePath ? await this.fileTree(repo.clonePath) : [];
    const sections: OnboardingSection[] = [];
    for (const plan of SECTION_PLAN) {
      const context = await this.retrieve(workspaceId, repoId, plan.query);
      const section = await this.writeSection(repo.fullName, plan, context, tree);
      sections.push(section);
    }

    const onboarding: Onboarding = { sections };
    await this.container.db
      .insert(t.onboarding)
      .values({ repoId, json: onboarding, generatedAt: new Date() })
      .onConflictDoUpdate({
        target: t.onboarding.repoId,
        set: { json: onboarding, generatedAt: new Date() },
      });
    return onboarding;
  }

  /**
   * RAG retrieval: pgvector cosine top-k over `code_chunks` for this repo when
   * an embedder is configured; otherwise a keyword fallback over chunk content.
   * Returns plain strings (chunk bodies) for the prompt.
   */
  private async retrieve(workspaceId: string, repoId: string, query: string): Promise<string[]> {
    const embedder = await this.tryEmbedder();
    if (embedder) {
      try {
        const [vec] = await embedder.embed([query]);
        if (vec) {
          const literal = `[${vec.join(',')}]`;
          const rows = await this.container.db
            .select({ content: t.codeChunks.content })
            .from(t.codeChunks)
            .where(and(eq(t.codeChunks.repoId, repoId), sql`${t.codeChunks.embedding} IS NOT NULL`))
            .orderBy(sql`${t.codeChunks.embedding} <=> ${literal}::vector`)
            .limit(RETRIEVE_TOP_K);
          if (rows.length > 0) return rows.map((r) => r.content);
        }
      } catch {
        /* fall through to keyword */
      }
    }
    // keyword fallback: any chunk mentioning a query token (cheap ILIKE OR)
    const tokens = queryTokens(query);
    const rows = await this.container.db
      .select({ content: t.codeChunks.content })
      .from(t.codeChunks)
      .where(eq(t.codeChunks.repoId, repoId))
      .limit(KEYWORD_SCAN_LIMIT);
    return scoreChunks(rows, tokens, RETRIEVE_TOP_K);
  }

  private async writeSection(
    repoName: string,
    plan: { kind: string; title: string; query: string },
    context: string[],
    tree: string[],
  ): Promise<OnboardingSection> {
    try {
      const llm = await this.container.llm(ONBOARDING_PROVIDER);
      const treeBlock = tree.length ? `Repo file tree (truncated):\n${tree.join('\n')}` : '';
      const { messages } = assemblePrompt({
        system: SECTION_SYSTEM_PROMPT,
        specs: context,
        diff: treeBlock || '(no file tree available)',
        task: `Repo: ${repoName}. Write the "${plan.title}" section (kind="${plan.kind}"). Focus: ${plan.query}.`,
      });
      const res = await llm.completeStructured<OnboardingSection>({
        model: ONBOARDING_MODEL,
        schema: SectionWrite,
        schemaName: 'OnboardingSection',
        messages,
        maxRetries: ONBOARDING_MAX_RETRIES,
      });
      // force the canonical kind/title so the 5-section contract is stable
      return { ...res.data, kind: plan.kind, title: plan.title };
    } catch {
      return skeletonSection(plan, context, tree);
    }
  }

  private async tryEmbedder() {
    try {
      return await this.container.embedder();
    } catch {
      return null;
    }
  }

  /** Shallow file tree (2 levels) for grounding links — best effort. */
  private async fileTree(root: string): Promise<string[]> {
    const out: string[] = [];
    const walk = async (dir: string, depth: number, prefix: string) => {
      if (depth > TREE_MAX_DEPTH || out.length > TREE_MAX_ENTRIES) return;
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (TREE_IGNORE_DIRS.has(e.name)) continue;
        const rel = prefix ? `${prefix}/${e.name}` : e.name;
        if (e.isDirectory()) {
          out.push(`${rel}/`);
          await walk(join(dir, e.name), depth + 1, rel);
        } else if (e.isFile()) {
          const s = await stat(join(dir, e.name)).catch(() => null);
          if (s && s.size < TREE_MAX_FILE_BYTES) out.push(rel);
        }
      }
    };
    await walk(root, 0, '');
    return out.slice(0, TREE_MAX_ENTRIES);
  }
}
