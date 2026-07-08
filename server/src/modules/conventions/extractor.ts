import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import { z } from 'zod';
import type { Container } from '../../platform/container.js';
import type { InsertConvention } from './repository.js';

const CHEAP_MODEL = 'claude-haiku-4-5-20251001';
const MAX_LINES_PER_FILE = 150;
const CONFIG_GLOBS = [
  '.eslintrc*',
  'eslint.config.*',
  'tsconfig.json',
  'tsconfig.*.json',
  '.prettierrc*',
  'prettier.config.*',
  'biome.json',
  '.editorconfig',
];

const CandidateSchema = z.object({
  conventions: z.array(
    z.object({
      category: z.string().min(1).max(80),
      rule: z.string().min(5).max(300),
      evidence: z.object({
        file: z.string().min(1),
        line: z.number().int().positive(),
        line_end: z.number().int().positive().optional(),
      }),
      confidence: z.number().min(0).max(1),
    }),
  ),
});

const EXTRACTION_SYSTEM = `You are a code convention detector. Analyse the provided source files and config files
and return the recurring patterns / house rules that a developer MUST follow in this codebase.

Output ONLY patterns that appear in the provided evidence — do not invent rules.
Each rule must cite the EXACT file + line number where it was observed.

Categories to consider: async-patterns, error-handling, typing, imports, naming, testing,
architecture, security, formatting.`;

export interface ExtractionResult {
  candidates: InsertConvention[];
  scannedFileCount: number;
  candidateCount: number;
  verifiedCount: number;
}

export class ConventionExtractor {
  constructor(private container: Container) {}

  async extract(params: {
    workspaceId: string;
    repoId: string;
    scanId: string;
    repoRoot: string;
    commitSha: string;
    githubOwner: string;
    githubName: string;
  }): Promise<ExtractionResult> {
    const { workspaceId, repoId, scanId, repoRoot, commitSha, githubOwner, githubName } = params;

    // ---- Step A: code-only sampling -----------------------------------------
    const samplePaths = await this.container.repoIntel.getConventionSamples(repoId, 12);
    const configPaths = await this.findConfigs(repoRoot);
    const allPaths = [...new Set([...configPaths, ...samplePaths])];

    const fileContents = await this.readFiles(repoRoot, allPaths);
    const combinedInput = fileContents
      .map(({ path, content }) => `=== ${path} ===\n${content}`)
      .join('\n\n');

    // ---- Step B: cheap model call -------------------------------------------
    const llm = await this.container.llm('anthropic');
    const result = await llm.completeStructured({
      model: CHEAP_MODEL,
      messages: [
        { role: 'system', content: EXTRACTION_SYSTEM },
        { role: 'user', content: combinedInput },
      ],
      schema: CandidateSchema,
      schemaName: 'ConventionExtractionResult',
    });

    // ---- Step C: evidence verification --------------------------------------
    const verified: InsertConvention[] = [];

    for (const candidate of result.data.conventions) {
      const v = await this.verifyEvidence(repoRoot, candidate.evidence.file, candidate.evidence.line);
      if (!v) continue; // rejected: path traversal / missing line / pattern mismatch

      const lineEnd = candidate.evidence.line_end ?? candidate.evidence.line;
      const lineRange =
        lineEnd > candidate.evidence.line
          ? `L${candidate.evidence.line}-L${lineEnd}`
          : `L${candidate.evidence.line}`;

      const evidenceUrl = `https://github.com/${githubOwner}/${githubName}/blob/${commitSha}/${candidate.evidence.file}#${lineRange}`;
      const dedupKey = buildDedupKey(candidate.category, candidate.rule, candidate.evidence.file);

      verified.push({
        workspaceId,
        repoId,
        scanId,
        category: candidate.category,
        rule: candidate.rule,
        evidencePath: candidate.evidence.file,
        evidenceSnippet: v.lineContent,
        evidenceLine: candidate.evidence.line,
        evidenceLineEnd: candidate.evidence.line_end ?? null,
        evidenceUrl,
        modelConfidence: candidate.confidence,
        verifiedConfidence: v.confidence,
        dedupKey,
      });
    }

    return {
      candidates: verified,
      scannedFileCount: allPaths.length,
      candidateCount: result.data.conventions.length,
      verifiedCount: verified.length,
    };
  }

  /**
   * Verifies the cited evidence line.
   * 1. Resolves path within repoRoot — rejects path traversal attempts.
   * 2. Reads the file and checks the line exists.
   * Returns null if any check fails (caller rejects the candidate).
   */
  private async verifyEvidence(
    repoRoot: string,
    file: string,
    line: number,
  ): Promise<{ lineContent: string; confidence: number } | null> {
    // Guard: resolve + check still inside repoRoot
    const abs = resolve(repoRoot, file);
    if (!abs.startsWith(repoRoot + '/') && abs !== repoRoot) return null;

    let content: string;
    try {
      content = await readFile(abs, 'utf-8');
    } catch {
      return null;
    }

    const lines = content.split('\n');
    const lineContent = lines[line - 1]; // lines are 1-indexed
    if (lineContent === undefined) return null;
    if (lineContent.trim() === '') return null;

    return { lineContent: lineContent.trim(), confidence: 0.85 };
  }

  private async findConfigs(repoRoot: string): Promise<string[]> {
    const { glob } = await import('glob');
    const found: string[] = [];
    for (const pattern of CONFIG_GLOBS) {
      const matches = await glob(pattern, { cwd: repoRoot, absolute: false });
      found.push(...matches);
    }
    return found.slice(0, 8);
  }

  private async readFiles(
    repoRoot: string,
    paths: string[],
  ): Promise<{ path: string; content: string }[]> {
    const results: { path: string; content: string }[] = [];
    for (const p of paths) {
      const abs = resolve(repoRoot, p);
      if (!abs.startsWith(repoRoot)) continue; // traversal guard
      try {
        const raw = await readFile(abs, 'utf-8');
        const lines = raw.split('\n').slice(0, MAX_LINES_PER_FILE);
        results.push({ path: p, content: lines.join('\n') });
      } catch {
        // skip unreadable files
      }
    }
    return results;
  }
}

export function buildDedupKey(category: string, rule: string, evidenceFile: string): string {
  const normalised = `${category.toLowerCase()}|${rule.toLowerCase().replace(/\s+/g, ' ').trim()}|${evidenceFile}`;
  return createHash('sha256').update(normalised).digest('hex').slice(0, 32);
}

/** Returns true if the candidate file path is safely within repoRoot. */
export function isSafeEvidencePath(repoRoot: string, file: string): boolean {
  const abs = resolve(repoRoot, file);
  return abs.startsWith(repoRoot + '/') || abs === repoRoot;
}
