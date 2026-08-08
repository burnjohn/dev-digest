import { z } from 'zod';
import type { ConventionCandidate, PromoteResult } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { findRepoByWorkspaceId } from '../pulls/repository.js';
import { SkillsService } from '../skills/service.js';
import { ConventionsRepository } from './repository.js';
import { toDto } from './helpers.js';

const CONFIG_FILES = [
  '.eslintrc.json',
  '.eslintrc.js',
  'eslint.config.js',
  'eslint.config.mjs',
  'tsconfig.json',
  '.prettierrc',
  '.prettierrc.json',
  'biome.json',
];

const RawCandidate = z.object({
  category: z.string(),
  rule: z.string(),
  evidence_path: z.string(),
  evidence_snippet: z.string(),
  confidence: z.number().min(0).max(1),
});

const ExtractionResult = z.object({
  candidates: z.array(RawCandidate),
});

export class ConventionsService {
  private repo: ConventionsRepository;
  private skills: SkillsService;

  constructor(private readonly container: Container) {
    this.repo = new ConventionsRepository(container.db);
    this.skills = new SkillsService(container);
  }

  async extract(workspaceId: string, repoId: string): Promise<ConventionCandidate[]> {
    const repoRow = await findRepoByWorkspaceId(this.container.db, workspaceId, repoId);
    if (!repoRow) throw new Error('repo_not_found');
    const repoRef = { owner: repoRow.owner, name: repoRow.name };
    // Collect file contents: config files first, then top-ranked source files
    const fileContents = new Map<string, string>();

    for (const path of CONFIG_FILES) {
      try {
        const content = await this.container.git.readFile(repoRef, path);
        fileContents.set(path, content);
      } catch {
        // file doesn't exist in clone — skip
      }
    }

    const sampledPaths = await this.container.repoIntel.getConventionSamples(repoId, 12);
    for (const path of sampledPaths) {
      if (fileContents.size >= 15) break;
      try {
        const content = await this.container.git.readFile(repoRef, path);
        fileContents.set(path, content.slice(0, 3000)); // cap per file
      } catch {
        // skip unreadable files
      }
    }

    if (fileContents.size === 0) return [];

    const filesBlock = [...fileContents.entries()]
      .map(([path, content]) => `### ${path}\n\`\`\`\n${content}\n\`\`\``)
      .join('\n\n');

    const llm = await this.container.llm('openrouter');

    const result = await llm.completeStructured({
      model: 'deepseek/deepseek-v4-flash',
      schemaName: 'convention_candidates',
      schema: ExtractionResult,
      messages: [
        {
          role: 'user',
          content: `You are a code convention extractor. Analyze the following repository files and extract coding conventions actually used in this codebase.

For each convention, provide:
- category: short label (e.g. "Naming", "Imports", "Error handling", "Formatting")
- rule: one clear directive sentence describing the convention
- evidence_path: exact file path from the provided files where this convention is visible
- evidence_snippet: a short code excerpt (max 3 lines) from that file that proves the convention
- confidence: 0.0–1.0 based on how clearly the evidence demonstrates the convention

Only extract conventions you can directly cite from the provided files. Return 5–15 candidates.

${filesBlock}`,
        },
      ],
      maxTokens: 2000,
    });

    type RawC = z.infer<typeof RawCandidate>;
    // Evidence validation: drop candidates whose snippet is not in the file we fetched
    const validated = result.data.candidates.filter((c: RawC) => {
      const fileContent = fileContents.get(c.evidence_path);
      if (!fileContent) return false;
      return fileContent.includes(c.evidence_snippet.trim().split('\n')[0]?.trim() ?? '');
    });

    await this.repo.deleteByRepo(workspaceId, repoId);
    await this.repo.insertBatch(
      validated.map((c: RawC) => ({
        workspaceId,
        repoId,
        category: c.category,
        rule: c.rule,
        evidencePath: c.evidence_path,
        evidenceSnippet: c.evidence_snippet,
        confidence: c.confidence,
      })),
    );

    const rows = await this.repo.listByRepo(workspaceId, repoId);
    return rows.map(toDto);
  }

  async list(workspaceId: string, repoId: string): Promise<ConventionCandidate[]> {
    const rows = await this.repo.listByRepo(workspaceId, repoId);
    return rows.map(toDto);
  }

  async accept(workspaceId: string, id: string): Promise<ConventionCandidate> {
    const row = await this.repo.update(id, { accepted: true });
    if (!row) throw new Error('not_found');
    void workspaceId;
    return toDto(row);
  }

  async reject(workspaceId: string, id: string): Promise<ConventionCandidate> {
    const row = await this.repo.update(id, { accepted: false });
    if (!row) throw new Error('not_found');
    void workspaceId;
    return toDto(row);
  }

  async update(
    workspaceId: string,
    id: string,
    patch: { rule?: string; category?: string },
  ): Promise<ConventionCandidate> {
    const row = await this.repo.update(id, patch);
    if (!row) throw new Error('not_found');
    void workspaceId;
    return toDto(row);
  }

  async promote(workspaceId: string, repoId: string, repoUrl: string, nameOverride?: string, descriptionOverride?: string): Promise<PromoteResult> {
    const all = await this.list(workspaceId, repoId);
    const accepted = all.filter((c) => c.accepted);
    if (accepted.length === 0) throw new Error('no_accepted_candidates');

    // Group by category
    const byCategory = new Map<string, typeof accepted>();
    for (const c of accepted) {
      const cat = c.category ?? 'General';
      if (!byCategory.has(cat)) byCategory.set(cat, []);
      byCategory.get(cat)!.push(c);
    }

    const sections = [...byCategory.entries()]
      .map(([cat, candidates]) => {
        const rules = candidates
          .map((c) => {
            const fileUrl = `${repoUrl}/blob/main/${c.evidence_path}`;
            return `### ${c.rule}\n[Evidence: \`${c.evidence_path}\`](${fileUrl})\n\`\`\`\n${c.evidence_snippet}\n\`\`\``;
          })
          .join('\n\n');
        return `## ${cat}\n\n${rules}`;
      })
      .join('\n\n');

    const body = `# Repo Conventions\n\nAuto-extracted from repository source files.\n\n${sections}`;

    const skill = await this.skills.create(workspaceId, {
      name: nameOverride ?? 'repo-conventions',
      description: descriptionOverride ?? 'Coding conventions extracted from this repository.',
      type: 'convention',
      source: 'extracted',
      body,
      enabled: true,
    });

    return { skill_id: skill.id };
  }
}
