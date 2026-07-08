import type {
  OnboardingTour,
  OnboardingTourSection,
  OnboardingTourSectionKind,
  OnboardingTourEntry,
  OnboardingTourRunMetadata,
} from '@devdigest/shared';
import type { OnboardingRow } from './repository.js';
import {
  LLM_INPUT_TOP_N_FILES,
  LLM_INPUT_MAX_ENDPOINTS,
  LLM_INPUT_MAX_ROUTES_PER_FILE,
  LLM_INPUT_MAX_BYTES,
} from './constants.js';

// ---------------------------------------------------------------------------
// toOnboardingTourDto
// ---------------------------------------------------------------------------

/**
 * Maps a persisted DB row (or `null` = never generated) + assembled sections
 * into the `OnboardingTour` API/contract shape.
 */
export function toOnboardingTourDto(
  repoId: string,
  row: OnboardingRow | null,
  sections: OnboardingTourSection[],
  run: OnboardingTourRunMetadata,
): OnboardingTour {
  return {
    repo_id: repoId,
    generated_at: row ? row.generatedAt.toISOString() : null,
    run,
    sections,
  };
}

// ---------------------------------------------------------------------------
// buildLlmInput — the BOUNDED fact bundle sent to the LLM.
// ---------------------------------------------------------------------------

export interface RouteFact {
  filePath: string;
  endpoints: string[];
  crons: string[];
}

export interface RankedFileInput {
  path: string;
  /** One-line summary/role, if known (e.g. from critical-path chain context). */
  summary?: string;
}

export interface StackFacts {
  /** Raw excerpt (e.g. package.json dependencies + scripts, as a compact string). */
  packageJson?: string;
  envExampleExcerpt?: string;
  dockerComposeExcerpt?: string;
  readmeExcerpt?: string;
}

export interface BuildLlmInputParams {
  rankedFiles: RankedFileInput[];
  routeFacts: RouteFact[];
  criticalPaths: string[][];
  stack: StackFacts;
}

/**
 * Assembles the bounded fact bundle passed to `completeStructured`. Enforces
 * every cap from constants.ts:
 *  - top-N ranked files (LLM_INPUT_TOP_N_FILES)
 *  - route facts deduped, capped per-file (LLM_INPUT_MAX_ROUTES_PER_FILE)
 *    BEFORE the global cap (LLM_INPUT_MAX_ENDPOINTS)
 *  - critical-path chains as-is (already capped internally by getCriticalPaths)
 *  - stack/script facts + any lite README excerpt as-is
 *  - a final LLM_INPUT_MAX_BYTES ceiling — truncates whole sections in
 *    priority order (routes first, then critical-path chains, then per-file
 *    summaries) — NEVER mid-entry.
 *
 * Never includes full file contents — only paths, one-line facts, and
 * aggregate counts.
 */
export function buildLlmInput(params: BuildLlmInputParams): string {
  const topFiles = params.rankedFiles.slice(0, LLM_INPUT_TOP_N_FILES);

  // Route facts: cap each file's contribution, dedupe, then cap globally.
  const perFileCapped: { filePath: string; endpoints: string[] }[] = [];
  const seenEndpoints = new Set<string>();
  let endpointBudget = LLM_INPUT_MAX_ENDPOINTS;
  for (const fact of params.routeFacts) {
    if (endpointBudget <= 0) break;
    const deduped: string[] = [];
    for (const ep of fact.endpoints) {
      if (seenEndpoints.has(ep)) continue;
      seenEndpoints.add(ep);
      deduped.push(ep);
      if (deduped.length >= LLM_INPUT_MAX_ROUTES_PER_FILE) break;
    }
    const capped = deduped.slice(0, endpointBudget);
    if (capped.length > 0) {
      perFileCapped.push({ filePath: fact.filePath, endpoints: capped });
      endpointBudget -= capped.length;
    }
  }

  const buildSections = (opts: {
    includeRoutes: boolean;
    includeCriticalPaths: boolean;
    includeFileSummaries: boolean;
  }): string => {
    const lines: string[] = [];

    lines.push('=== STACK FACTS ===');
    if (params.stack.packageJson) lines.push(`package.json: ${params.stack.packageJson}`);
    if (params.stack.envExampleExcerpt) {
      lines.push(`.env.example: ${params.stack.envExampleExcerpt}`);
    }
    if (params.stack.dockerComposeExcerpt) {
      lines.push(`docker-compose: ${params.stack.dockerComposeExcerpt}`);
    }
    if (params.stack.readmeExcerpt) {
      lines.push(`<untrusted>README excerpt:\n${params.stack.readmeExcerpt}\n</untrusted>`);
    }

    if (opts.includeRoutes && perFileCapped.length > 0) {
      lines.push('\n=== ROUTES/ENDPOINTS (repo-wide, capped) ===');
      for (const f of perFileCapped) {
        lines.push(`${f.filePath}: ${f.endpoints.join(', ')}`);
      }
    }

    if (opts.includeCriticalPaths && params.criticalPaths.length > 0) {
      lines.push('\n=== CRITICAL PATH CHAINS ===');
      for (const chain of params.criticalPaths) {
        lines.push(chain.join(' -> '));
      }
    }

    if (opts.includeFileSummaries && topFiles.length > 0) {
      lines.push('\n=== TOP-RANKED FILES (reading path candidates, rank-descending) ===');
      for (const f of topFiles) {
        lines.push(f.summary ? `${f.path}: ${f.summary}` : f.path);
      }
    }

    return lines.join('\n');
  };

  // Try full bundle first; if over budget, drop lowest-priority sections in
  // order (routes -> critical paths -> file summaries), never mid-entry.
  let result = buildSections({
    includeRoutes: true,
    includeCriticalPaths: true,
    includeFileSummaries: true,
  });
  if (byteLength(result) > LLM_INPUT_MAX_BYTES) {
    result = buildSections({
      includeRoutes: false,
      includeCriticalPaths: true,
      includeFileSummaries: true,
    });
  }
  if (byteLength(result) > LLM_INPUT_MAX_BYTES) {
    result = buildSections({
      includeRoutes: false,
      includeCriticalPaths: false,
      includeFileSummaries: true,
    });
  }
  if (byteLength(result) > LLM_INPUT_MAX_BYTES) {
    // Last resort: hard-truncate at a whole-line boundary (never mid-entry).
    result = truncateToByteBudgetAtLineBoundary(result, LLM_INPUT_MAX_BYTES);
  }

  return result;
}

function byteLength(s: string): number {
  return Buffer.byteLength(s, 'utf8');
}

function truncateToByteBudgetAtLineBoundary(s: string, maxBytes: number): string {
  const lines = s.split('\n');
  const kept: string[] = [];
  let total = 0;
  for (const line of lines) {
    const lineBytes = Buffer.byteLength(line + '\n', 'utf8');
    if (total + lineBytes > maxBytes) break;
    kept.push(line);
    total += lineBytes;
  }
  return kept.join('\n');
}

// ---------------------------------------------------------------------------
// appendDiagramColors
// ---------------------------------------------------------------------------

/** Node-kind category keywords for the deterministic mermaid color overlay. */
const CATEGORY_KEYWORDS: { category: string; classDef: string; pattern: RegExp }[] = [
  {
    category: 'datastore',
    classDef: 'classDef datastore fill:#2b2140,stroke:#a78bfa,color:#e9e4ff;',
    pattern: /\b(db|database|postgres|redis|store|cache)\b/i,
  },
  {
    category: 'middleware',
    classDef: 'classDef middleware fill:#20303f,stroke:#38bdf8,color:#dff3ff;',
    pattern: /\b(middleware|auth|gateway|proxy|queue)\b/i,
  },
  {
    category: 'app',
    classDef: 'classDef app fill:#1f2e22,stroke:#4ade80,color:#e6ffed;',
    pattern: /.*/,
  },
];

/**
 * Deterministically appends a `classDef`/`style` block to the LLM-returned
 * mermaid string, keyed by node-kind (application code / middleware /
 * datastore — Blast-Graph-style category convention). Returns `null`
 * unchanged if `diagram` is null (never synthesizes a diagram the LLM didn't
 * produce). In practice this only fires for the `architecture` section per
 * the edited prompt's single-section diagram rule.
 */
export function appendDiagramColors(
  diagram: string | null,
  _sectionKind: OnboardingTourSectionKind,
): string | null {
  if (diagram === null) return null;

  // Extract node ids declared in the diagram (simple flowchart node syntax:
  // `ID[...]`, `ID(...)`, `ID{...}`, `ID["..."]`).
  const nodeIdPattern = /\b([A-Za-z_][A-Za-z0-9_]*)(?=[[({])/g;
  const ids = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = nodeIdPattern.exec(diagram)) !== null) {
    const id = match[1];
    if (id) ids.add(id);
  }

  if (ids.size === 0) return diagram;

  const assignments = new Map<string, string[]>(); // classDef name -> node ids
  for (const id of ids) {
    // Look at the node's label text (best-effort) to classify by keyword;
    // fall back to the id itself when no bracketed label is present.
    const labelMatch = new RegExp(`${id}\\[["']?([^\\]"']*)["']?\\]`).exec(diagram);
    const label = labelMatch?.[1] ?? id;
    const category = CATEGORY_KEYWORDS.find((c) => c.pattern.test(label)) ?? CATEGORY_KEYWORDS[2];
    if (!category) continue;
    const key = category.category;
    const arr = assignments.get(key) ?? [];
    arr.push(id);
    assignments.set(key, arr);
  }

  const classDefLines: string[] = [];
  const classLines: string[] = [];
  for (const cat of CATEGORY_KEYWORDS) {
    const idsForCat = assignments.get(cat.category);
    if (!idsForCat || idsForCat.length === 0) continue;
    classDefLines.push(cat.classDef);
    classLines.push(`class ${idsForCat.join(',')} ${cat.category};`);
  }

  if (classDefLines.length === 0) return diagram;

  return [diagram, ...classDefLines, ...classLines].join('\n');
}

// ---------------------------------------------------------------------------
// mapGithubLink
// ---------------------------------------------------------------------------

export interface RepoBasicsForLink {
  owner: string;
  name: string;
}

/**
 * Builds a GitHub blob URL exactly like `BlastLink`-consuming client code
 * does: `https://github.com/{owner}/{repo}/blob/{sha}/{path}`. Returns `null`
 * when `repoBasics` or `sha` is unavailable (AC-9).
 */
export function mapGithubLink(
  repoBasics: RepoBasicsForLink | null,
  sha: string | null,
  path: string,
): string | null {
  if (!repoBasics || !sha) return null;
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  return `https://github.com/${repoBasics.owner}/${repoBasics.name}/blob/${sha}/${encodedPath}`;
}

// ---------------------------------------------------------------------------
// attachRankOrder — AC-7 mechanism.
// ---------------------------------------------------------------------------

/**
 * Takes the SERVER-computed `getTopFilesByRank` result (already
 * rank-DESCENDING) as the master order, looks up each entry's rationale from
 * the LLM's response by path, and emits the final `OnboardingTourEntry[]` in
 * the SERVER's order. The LLM's own array order is DISCARDED — only its
 * per-path rationale TEXT is consumed. If the LLM omitted a rationale for a
 * ranked path, falls back to a deterministic placeholder rather than
 * dropping/reordering the entry.
 *
 * `rank` is the 1-based position in `rankedPaths` (descending importance);
 * pass `null` ranks (lite mode, no import graph) via `rankIsNull: true`.
 */
export function attachRankOrder(
  rankedPaths: string[],
  llmRationaleByPath: Map<string, string>,
  opts: {
    mapGithubLinkFor: (path: string) => string | null;
    rankIsNull?: boolean;
  },
): OnboardingTourEntry[] {
  return rankedPaths.map((path, idx) => {
    const rationale =
      llmRationaleByPath.get(path) ??
      `Central to the codebase — ranked #${idx + 1} by import-graph importance.`;
    return {
      path,
      rationale,
      rank: opts.rankIsNull ? null : idx + 1,
      github_link: opts.mapGithubLinkFor(path),
    };
  });
}
