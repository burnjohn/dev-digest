import type { Container } from '../../platform/container.js';
import type { ConventionCandidate, RepoRef } from '@devdigest/shared';
import { assemblePrompt } from '../../platform/prompt.js';
import { AppError, NotFoundError } from '../../platform/errors.js';
import * as schema from '../../db/schema.js';
import { and, eq } from 'drizzle-orm';
import { ConventionsRepository } from './repository.js';
import { SkillsService } from '../skills/service.js';
import { groundEvidence, toCandidate, conventionSkillBody, type GroundedItem } from './helpers.js';
import {
  Extraction,
  EXTRACTOR_SYSTEM,
  EXTRACTION_SCHEMA_NAME,
  MAX_SAMPLE_FILES,
  MAX_FILE_BYTES,
  SAMPLE_GREP_PATTERN,
  EXTRACTION_TEMPERATURE,
  EXTRACTION_MAX_RETRIES,
  DEFAULT_MODEL,
  ACCEPTED_SKILL_NAME_MAX_LEN,
} from './constants.js';

/**
 * A1 — conventions extractor (§7 L02).
 *
 * Flow: scan the cloned repo via CodeIndex (symbols) + GitClient (read sample
 * files) → assemble an UNTRUSTED prompt (repo code is data, never instructions)
 * → LLM structured call → ConventionCandidate[] each carrying evidence_path +
 * evidence_snippet + confidence. Accepting a candidate creates a `convention`
 * Skill (source='extracted', type='convention').
 *
 * All external work routes through container adapters (CodeIndex / GitClient /
 * LLMProvider). No process.env, no direct SDK construction.
 *
 * Schemas/prompt/tunables live in constants.ts; grounding + DTO mapping in
 * helpers.ts.
 */

interface RepoRow {
  id: string;
  owner: string;
  name: string;
  clonePath: string | null;
}

export class ConventionsService {
  private repo: ConventionsRepository;
  private skills: SkillsService;

  constructor(private container: Container) {
    this.repo = new ConventionsRepository(container.db);
    this.skills = new SkillsService(container);
  }

  async list(workspaceId: string, repoId: string): Promise<ConventionCandidate[]> {
    const rows = await this.repo.listForRepo(workspaceId, repoId);
    return rows.map(toCandidate);
  }

  private async loadRepo(workspaceId: string, repoId: string): Promise<RepoRow> {
    const [row] = await this.container.db
      .select({
        id: schema.repos.id,
        owner: schema.repos.owner,
        name: schema.repos.name,
        clonePath: schema.repos.clonePath,
      })
      .from(schema.repos)
      .where(and(eq(schema.repos.workspaceId, workspaceId), eq(schema.repos.id, repoId)));
    if (!row) throw new NotFoundError('Repo not found');
    return row;
  }

  /**
   * Sample up to `maxFiles` source files from the repo (via symbols, falling
   * back to a grep for common extensions) and read them through the GitClient.
   */
  private async sampleFiles(
    ref: RepoRef,
    maxFiles = MAX_SAMPLE_FILES,
  ): Promise<{ path: string; content: string }[]> {
    const paths = new Set<string>();
    try {
      const symbols = await this.container.codeIndex.symbols(ref);
      for (const s of symbols) {
        paths.add(s.path);
        if (paths.size >= maxFiles) break;
      }
    } catch {
      /* index may be unavailable; fall through to grep */
    }
    if (paths.size < maxFiles) {
      try {
        const matches = await this.container.codeIndex.grep(ref, SAMPLE_GREP_PATTERN);
        for (const m of matches) {
          paths.add(m.path);
          if (paths.size >= maxFiles) break;
        }
      } catch {
        /* ignore */
      }
    }
    const out: { path: string; content: string }[] = [];
    for (const p of paths) {
      const content = await this.container.git.readFile(ref, p).catch(() => '');
      if (content.trim()) out.push({ path: p, content: content.slice(0, MAX_FILE_BYTES) });
    }
    return out;
  }

  /** Scan + LLM structured extraction → persist fresh candidates. */
  async extract(
    workspaceId: string,
    repoId: string,
    opts: { provider?: 'openai' | 'anthropic'; model?: string } = {},
  ): Promise<ConventionCandidate[]> {
    const repoRow = await this.loadRepo(workspaceId, repoId);
    if (!repoRow.clonePath) {
      throw new AppError('repo_not_cloned', 'Repo is not cloned yet — clone it first', 409);
    }
    const ref: RepoRef = { owner: repoRow.owner, name: repoRow.name };

    const files = await this.sampleFiles(ref);
    if (files.length === 0) {
      // nothing to analyze → clear stale candidates, return empty
      await this.repo.replaceForRepo(workspaceId, repoId, []);
      return [];
    }

    // Assemble an UNTRUSTED prompt: the sampled code is data, not instructions.
    const codeBlob = files
      .map((f) => `FILE: ${f.path}\n${f.content}`)
      .join('\n\n---\n\n');
    const { messages } = assemblePrompt({
      system: EXTRACTOR_SYSTEM,
      task: `Extract the conventions followed in repo ${repoRow.owner}/${repoRow.name} from the sampled files below.`,
      diff: codeBlob, // wrapped as <untrusted> inside assemblePrompt
    });

    const provider = opts.provider ?? 'openai';
    const llm = await this.container.llm(provider);
    const model = opts.model ?? (await this.defaultModel(provider));

    const result = await llm.completeStructured<Extraction>({
      model,
      schema: Extraction,
      schemaName: EXTRACTION_SCHEMA_NAME,
      messages,
      temperature: EXTRACTION_TEMPERATURE,
      maxRetries: EXTRACTION_MAX_RETRIES,
    });

    // Ground each candidate's evidence against the sampled files.
    const byPath = new Map(files.map((f) => [f.path, f.content] as const));
    const grounded = result.data.conventions
      .map((c) => groundEvidence(c, byPath))
      .filter((c): c is GroundedItem => c !== null);

    const rows = await this.repo.replaceForRepo(
      workspaceId,
      repoId,
      grounded.map((c) => ({
        workspaceId,
        repoId,
        rule: c.rule,
        evidencePath: c.evidence_path,
        evidenceSnippet: c.evidence_snippet,
        confidence: c.confidence,
      })),
    );
    return rows.map(toCandidate);
  }

  private async defaultModel(provider: 'openai' | 'anthropic'): Promise<string> {
    try {
      const llm = await this.container.llm(provider);
      const models = await llm.listModels();
      return models[0]?.id ?? DEFAULT_MODEL[provider];
    } catch {
      return DEFAULT_MODEL[provider];
    }
  }

  /** Accept a candidate → mark accepted AND create an extracted convention Skill. */
  async accept(workspaceId: string, conventionId: string): Promise<{ skillId: string }> {
    const row = await this.repo.getById(workspaceId, conventionId);
    if (!row) throw new NotFoundError('Convention not found');
    await this.repo.markAccepted(workspaceId, conventionId);

    const skill = await this.skills.create(workspaceId, {
      name: row.rule.slice(0, ACCEPTED_SKILL_NAME_MAX_LEN),
      description: row.rule,
      type: 'convention',
      source: 'extracted',
      body: conventionSkillBody(row.rule, row.evidencePath, row.evidenceSnippet),
      enabled: true,
      evidenceFiles: row.evidencePath ? [row.evidencePath] : null,
    });
    return { skillId: skill.id };
  }
}
