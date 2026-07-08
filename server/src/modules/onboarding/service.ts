import type { Container } from '../../platform/container.js';
import { NotFoundError, AppError } from '../../platform/errors.js';
import type {
  OnboardingTour,
  OnboardingTourSection,
  OnboardingTourSectionKind,
  OnboardingTourRunMetadata,
  OnboardingTourEntry,
} from '@devdigest/shared';
import { loadPromptTemplate, renderTemplate } from '../../platform/prompts.js';
import { resolveFeatureModel } from '../settings/feature-models.js';
import { OnboardingRepository, type OnboardingRepoBasics } from './repository.js';
import {
  buildLlmInput,
  toOnboardingTourDto,
  appendDiagramColors,
  mapGithubLink,
  attachRankOrder,
  type RouteFact,
} from './helpers.js';
import {
  ONBOARDING_SECTION_KINDS,
  ONBOARDING_PROMPT_LANGUAGE,
  ONBOARDING_SYSTEM_PROMPT_PATH,
  OnboardingNarrativeResult,
  type OnboardingNarrativeSection,
} from './constants.js';

/** Minimal structured-logger shape — mirrors `reviews/run-executor.ts`'s
 * `Logger` type without a cross-module import (module isolation rule). */
export type Logger = {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
  debug: (obj: unknown, msg?: string) => void;
};

const SECTION_TITLES: Record<(typeof ONBOARDING_SECTION_KINDS)[number], string> = {
  architecture: 'Architecture overview',
  critical_paths: 'Critical paths',
  how_to_run: 'How to run locally',
  reading_path: 'Guided reading path',
  first_tasks: 'First tasks',
};

/** Confined-path repo-relative read, mirroring `conventions/extractor.ts`'s
 * `resolve(repoRoot, path).startsWith(repoRoot)` guard pattern. Never throws
 * — a missing/unreadable file degrades that one fact silently (best-effort). */
async function safeReadRepoFile(
  container: Container,
  repoRef: { owner: string; name: string },
  relativePath: string,
): Promise<string | null> {
  try {
    const content = await container.git.readFile(repoRef, relativePath);
    return content || null;
  } catch {
    return null;
  }
}

export class OnboardingService {
  private _repo: OnboardingRepository | null = null;

  constructor(private container: Container) {}

  private get repo(): OnboardingRepository {
    if (!this._repo) {
      this._repo = new OnboardingRepository(this.container.db);
    }
    return this._repo;
  }

  /**
   * Never throws for "not yet generated" — that is a valid well-formed
   * response (spec §7). Only a missing/cross-workspace REPO throws
   * `NotFoundError`.
   */
  async getTour(workspaceId: string, repoId: string): Promise<OnboardingTour> {
    const repoBasics = await this.repo.getRepoBasics(repoId);
    if (!repoBasics || repoBasics.workspaceId !== workspaceId) {
      throw new NotFoundError('Repo not found');
    }

    const row = await this.repo.getTour(workspaceId, repoId);
    if (!row) {
      // "Never generated" — well-formed empty response, not an error. Reflect
      // a fresh getIndexState so the UI can still show a degraded/lite badge
      // and CTA pre-generation.
      const indexState = await this.container.repoIntel.getIndexState(repoId);
      const run: OnboardingTourRunMetadata = {
        status: indexState.status,
        degraded: !!indexState.degraded,
        reason: indexState.degradedReason ?? null,
        mode: indexState.status === 'full' || indexState.status === 'partial' ? 'full' : 'lite',
        llm_cost_cents: null,
      };
      return toOnboardingTourDto(repoId, null, emptySkeletonSections('not enough data'), run);
    }

    const sections = (row.json as { sections?: OnboardingTourSection[] } | null)?.sections ?? [];
    const run: OnboardingTourRunMetadata = {
      status: row.indexStatus,
      degraded: row.degraded,
      reason: row.degradedReason,
      mode: row.mode,
      llm_cost_cents: row.llmCostCents,
    };
    return toOnboardingTourDto(repoId, row, sections, run);
  }

  /**
   * The single orchestration method — the heart of the feature. Exactly one
   * `completeStructured` call per invocation (or zero, in the AC-12
   * no-data-fallback branch).
   */
  async generateTour(workspaceId: string, repoId: string, logger?: Logger): Promise<OnboardingTour> {
    const log = logger ?? noopLogger;

    // a. Resolve repo basics — UX early exit. The write path's own EXISTS
    // guard (repository.ts) is the actual security boundary and fires again
    // regardless of this check.
    const repoBasics = await this.repo.getRepoBasics(repoId);
    if (!repoBasics || repoBasics.workspaceId !== workspaceId) {
      throw new NotFoundError('Repo not found');
    }

    // b. Decide full vs lite mode.
    const indexState = await this.container.repoIntel.getIndexState(repoId);
    const hasClone = !!repoBasics.clonePath;
    const canAttemptFull = hasClone && indexState.status !== 'failed';

    let mode: 'full' | 'lite' = canAttemptFull ? 'full' : 'lite';
    let rankedPaths: string[] = [];
    let criticalPaths: string[][] = [];
    let routeFacts: RouteFact[] = [];
    let packageJson: string | null = null;
    let envExampleExcerpt: string | null = null;
    let dockerComposeExcerpt: string | null = null;
    let readmeExcerpt: string | null = null;
    let sha: string | null = null;

    if (mode === 'full') {
      const repoRef = { owner: repoBasics.owner, name: repoBasics.name };
      sha = indexState.lastIndexedSha || null;

      // c. Full-mode facts — every external read is best-effort; one failing
      // source degrades that fact silently, never aborts the whole generation.
      try {
        rankedPaths = await this.container.repoIntel.getTopFilesByRank(repoId, 20);
      } catch {
        rankedPaths = [];
      }
      try {
        criticalPaths = await this.container.repoIntel.getCriticalPaths(repoId);
      } catch {
        criticalPaths = [];
      }
      try {
        const allFacts = await this.container.repoIntel.getAllFileFacts(repoId);
        routeFacts = allFacts.map((f) => ({
          filePath: f.filePath,
          endpoints: f.endpoints,
          crons: f.crons,
        }));
      } catch {
        routeFacts = [];
      }

      packageJson = await safeReadRepoFile(this.container, repoRef, 'package.json');
      envExampleExcerpt = await safeReadRepoFile(this.container, repoRef, '.env.example');
      dockerComposeExcerpt =
        (await safeReadRepoFile(this.container, repoRef, 'docker-compose.yml')) ??
        (await safeReadRepoFile(this.container, repoRef, 'docker-compose.yaml'));

      // Total inability to gather ANY usable full-mode fact falls through to
      // lite mode as a best-effort downgrade (still tries GitHub next).
      if (
        rankedPaths.length === 0 &&
        criticalPaths.length === 0 &&
        routeFacts.length === 0 &&
        !packageJson
      ) {
        mode = 'lite';
      }
    }

    let liteUsable = false;
    if (mode === 'lite') {
      // d. Lite-mode facts via GitHub Trees/Contents — explicitly NOT
      // rank-ordered (no import graph available).
      try {
        const github = await this.container.github();
        const repoRef = { owner: repoBasics.owner, name: repoBasics.name };
        const tree = await github.getRepoTree(repoRef, repoBasics.defaultBranch);
        packageJson = await github.getFileContents(repoRef, 'package.json', repoBasics.defaultBranch);
        readmeExcerpt = await github.getFileContents(repoRef, 'README.md', repoBasics.defaultBranch);

        // Reading-path heuristic: declared entry points + top-level dirs.
        const topLevelDirs = new Set<string>();
        for (const entry of tree) {
          const firstSeg = entry.path.split('/')[0];
          if (firstSeg && entry.path.includes('/')) topLevelDirs.add(firstSeg);
        }
        rankedPaths = tree
          .filter((e) => e.type === 'blob' && !e.path.includes('/'))
          .map((e) => e.path)
          .concat(Array.from(topLevelDirs))
          .slice(0, 20);

        liteUsable = tree.length > 0 || !!packageJson || !!readmeExcerpt;
      } catch {
        liteUsable = false;
      }
    }

    // e. No-data fallback (AC-12): skeleton, ZERO LLM calls.
    if (mode === 'lite' && !liteUsable) {
      const run: OnboardingTourRunMetadata = {
        status: 'failed',
        degraded: true,
        reason: 'no_data',
        mode: 'lite',
        llm_cost_cents: null,
      };
      const sections = emptySkeletonSections('not enough data');
      log.info(
        { repoId, mode: 'lite', indexStatus: 'failed', llmCalls: 0 },
        'onboarding: no-data fallback — zero LLM calls',
      );
      const persisted = await this.repo.upsertTour(workspaceId, repoId, {
        json: { sections },
        generatedAt: new Date(),
        mode: 'lite',
        indexStatus: 'failed',
        degraded: true,
        degradedReason: 'no_data',
        llmCostCents: null,
      });
      return toOnboardingTourDto(repoId, persisted, sections, run);
    }

    // f. Build the bounded fact bundle + resolve model + the ONE completeStructured call.
    const input = buildLlmInput({
      rankedFiles: rankedPaths.map((p) => ({ path: p })),
      routeFacts,
      criticalPaths,
      stack: {
        ...(packageJson ? { packageJson } : {}),
        ...(envExampleExcerpt ? { envExampleExcerpt } : {}),
        ...(dockerComposeExcerpt ? { dockerComposeExcerpt } : {}),
        ...(readmeExcerpt ? { readmeExcerpt } : {}),
      },
    });

    const { provider, model } = await resolveFeatureModel(this.container, workspaceId, 'onboarding');
    const llm = await this.container.llm(provider);

    const template = await loadPromptTemplate(ONBOARDING_SYSTEM_PROMPT_PATH);
    const systemPrompt = renderTemplate(template, {
      sections: ONBOARDING_SECTION_KINDS.join('\n'),
      language: ONBOARDING_PROMPT_LANGUAGE,
    });

    let result;
    try {
      result = await llm.completeStructured({
        model,
        schema: OnboardingNarrativeResult,
        schemaName: 'OnboardingNarrativeResult',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: input },
        ],
      });
    } catch (err) {
      // k. Hard failure AFTER a previously-persisted tour exists: never
      // overwrite the persisted row.
      log.error({ repoId, err: (err as Error).message }, 'onboarding: generation failed');
      throw new AppError('onboarding_generation_failed', 'Onboarding tour generation failed', 502);
    }

    // g. Post-process: appendDiagramColors (architecture only in practice),
    // mapGithubLink per entry, attachRankOrder using the SERVER's rank order.
    const rationaleByPathBySection = new Map<string, Map<string, string>>();
    const narrativeBySection = new Map<string, OnboardingNarrativeSection>();
    for (const sec of result.data.sections) {
      narrativeBySection.set(sec.kind, sec);
      const rMap = new Map<string, string>();
      for (const entry of sec.entries ?? []) rMap.set(entry.path, entry.rationale);
      rationaleByPathBySection.set(sec.kind, rMap);
    }

    const repoBasicsForLink = { owner: repoBasics.owner, name: repoBasics.name };
    const linkFor = (path: string): string | null => mapGithubLink(repoBasicsForLink, sha, path);

    const sections: OnboardingTourSection[] = ONBOARDING_SECTION_KINDS.map((kind) => {
      const narrative = narrativeBySection.get(kind);
      const title = narrative?.title ?? SECTION_TITLES[kind];
      const body = narrative?.body ?? '';
      const rawDiagram = kind === 'architecture' ? (narrative?.diagram ?? null) : null;
      const diagram = appendDiagramColors(rawDiagram, kind);

      let entries: OnboardingTourEntry[] = [];
      if (kind === 'reading_path') {
        const rationaleMap = rationaleByPathBySection.get(kind) ?? new Map();
        entries = attachRankOrder(rankedPaths, rationaleMap, {
          mapGithubLinkFor: linkFor,
          rankIsNull: mode === 'lite',
        });
      } else if (kind === 'critical_paths') {
        const rationaleMap = rationaleByPathBySection.get(kind) ?? new Map();
        const seen = new Set<string>();
        for (const chain of criticalPaths) {
          for (const p of chain) {
            if (seen.has(p)) continue;
            seen.add(p);
          }
        }
        const paths = seen.size > 0 ? Array.from(seen) : rankedPaths;
        entries = paths.map((p, idx) => ({
          path: p,
          rationale:
            rationaleMap.get(p) ?? `Part of a critical dependency chain (position ${idx + 1}).`,
          rank: mode === 'lite' ? null : idx + 1,
          github_link: linkFor(p),
        }));
      } else if (kind === 'how_to_run') {
        // Run steps are the LLM's per-entry shell commands (grounded in the
        // package.json/docker-compose facts). path = the command; not a file, so
        // no rank and no GitHub blob link.
        entries = (narrative?.entries ?? []).map((e) => ({
          path: e.path,
          rationale: e.rationale,
          rank: null,
          github_link: null,
        }));
      }

      const tasks = narrative?.tasks ?? [];
      const links = (narrative?.links ?? []).map((l) => ({
        label: l.label,
        path: l.path,
        github_url: linkFor(l.path),
      }));

      return { kind, title, body, diagram, entries, tasks, links };
    });

    // h. Cost.
    const llmCostCents = result.costUsd != null ? Math.round(result.costUsd * 100) : null;

    // i. Log exactly one structured line.
    log.info(
      {
        repoId,
        llm_cost_cents: llmCostCents,
        mode,
        indexStatus: indexState.status,
        llmCalls: 1,
      },
      'onboarding: generation complete',
    );

    // j. Persist + return.
    const finalIndexStatus = mode === 'lite' ? (indexState.status === 'failed' ? 'degraded' : indexState.status) : indexState.status;
    const finalDegraded = mode === 'lite' || !!indexState.degraded;
    const finalDegradedReason = indexState.degradedReason ?? null;

    const persisted = await this.repo.upsertTour(workspaceId, repoId, {
      json: { sections },
      generatedAt: new Date(),
      mode,
      indexStatus: finalIndexStatus,
      degraded: finalDegraded,
      degradedReason: finalDegradedReason,
      llmCostCents,
    });

    const run: OnboardingTourRunMetadata = {
      status: finalIndexStatus,
      degraded: finalDegraded,
      reason: finalDegradedReason,
      mode,
      llm_cost_cents: llmCostCents,
    };

    return toOnboardingTourDto(repoId, persisted, sections, run);
  }
}

const noopLogger: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

/** Deterministic skeleton — 5 section headers, empty bodies, honest notice. */
function emptySkeletonSections(notice: string): OnboardingTourSection[] {
  return ONBOARDING_SECTION_KINDS.map((kind) => ({
    kind: kind as OnboardingTourSectionKind,
    title: SECTION_TITLES[kind],
    body: notice,
    diagram: null,
    entries: [],
    tasks: [],
    links: [],
  }));
}
