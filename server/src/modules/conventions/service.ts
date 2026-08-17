import { z } from 'zod';
import {
  ConventionCategory,
  type ConventionCandidate,
  type ConventionListResult,
  type ConventionScanStats,
  type ConventionSkillDraft,
  type FeatureModelChoice,
  type GitClient,
  type LLMProvider,
  type ProbeStrategy,
  type RepoRef,
} from '@devdigest/shared';
import type { Db } from '../../db/client.js';
import type { RepoIntel } from '../repo-intel/types.js';
import { ConflictError } from '../../platform/errors.js';
import { wrapUntrusted } from '../../platform/prompt.js';
import {
  ConventionsRepository,
  type ConventionRow,
  type ConventionScanRow,
  type InsertConvention,
  type UpdateConvention,
} from './repository.js';
import {
  applyDedupVerdict,
  composeSkillBody,
  countPathConformance,
  countSymbolConformance,
  countTextConformance,
  findDuplicateIndex,
  groundCandidate,
  groundConfigEvidence,
  hasIndependentSupport,
  isDuplicate,
  mapWithConcurrency,
  scoreConfidence,
  type ConformanceCount,
  type ScannedFile,
  type SymbolSite,
} from './helpers.js';
import {
  CATEGORY_BRIEFS,
  DEDUP_SYSTEM,
  EXTRACTION_SYSTEM,
  FILE_SELECTION_SYSTEM,
  TEXT_PROBE_BRIEF,
} from './prompts.js';
import {
  CONFIG_FILES,
  CONVENTION_CATEGORIES,
  COUNTING_STRATEGY,
  EXTRACTION_CONCURRENCY,
  MAX_CONFIG_BLOCK_CHARS,
  MAX_DEDUP_RULE_CHARS,
  MAX_DEDUP_RULES,
  MAX_CONFIG_CHARS,
  MAX_FILE_CHARS,
  MAX_PROBE_CHARS,
  MAX_SELECTED_FILES,
  MAX_SYMBOLS_PER_FILE,
  PATH_CORPUS_LIMIT,
  SAMPLE_FILES,
  SKILL_NAME_SUFFIX,
  SUPPORT_SCAN_FILES,
  SYMBOL_CORPUS_LIMIT,
} from './constants.js';

/**
 * L02 — conventions service. Turns a cloned repo into proposed house rules.
 *
 * Takes an explicit `Deps` interface, not the `Container` (the precedent set by
 * `skills/service.ts`). `llm` is a lazy RESOLVER rather than a provider instance:
 * the app must boot with no API key configured, so the provider is constructed at
 * the moment a scan runs — never at wiring time. `Container` exposes `db`,
 * `repoIntel`, `git` and `llm(id)`, so `new ConventionsService(app.container)`
 * still compiles with no container change.
 *
 * The pipeline is deliberately distrustful of the model. It contributes three
 * things — which files are worth reading, which patterns look intentional, and a
 * quote — and every one of them is checked: paths must come from our own candidate
 * set, snippets must be findable in the real file, and confidence is recomputed
 * from how many files actually follow the rule.
 */
export interface ConventionsServiceDeps {
  db: Db;
  repoIntel: RepoIntel;
  git: GitClient;
  llm: (id: 'openai' | 'anthropic' | 'openrouter') => Promise<LLMProvider>;
}

/** Step B — which of the offered files the model wants to read in full. */
export const ConventionFileSelection = z.object({
  paths: z.array(z.string()),
  note: z.string().nullish(),
});

/**
 * Step D — one category's proposed rules, before any of them are believed.
 *
 * The probe is a discriminated union over the counting strategy, plus a bare-string
 * arm. That arm is load-bearing twice over: a model that ignores the object shape
 * degrades to the old literal-fragment behaviour instead of failing the whole
 * category call, and the existing test fixtures keep parsing.
 */
const PatternKind = z.enum(['literal', 'regex']);

const TextProbeIn = z.object({
  target: z.literal('text'),
  kind: PatternKind,
  pattern: z.string().min(1).max(MAX_PROBE_CHARS),
  /** What a VIOLATION looks like. Absent ⇒ conformance is unmeasurable. */
  counter_kind: PatternKind.nullish(),
  counter_pattern: z.string().max(MAX_PROBE_CHARS).nullish(),
});

const SymbolProbeIn = z.object({
  target: z.literal('symbols'),
  /** THE DENOMINATOR. All-empty ⇒ unmeasurable, never "the whole repo". */
  scope: z.object({
    kinds: z.array(z.string().max(40)).max(6).nullish(),
    exported: z.boolean().nullish(),
    path_pattern: z.string().max(MAX_PROBE_CHARS).nullish(),
  }),
  pattern: z.string().min(1).max(MAX_PROBE_CHARS),
});

const PathProbeIn = z.object({
  target: z.literal('paths'),
  /** THE DENOMINATOR — the files the rule governs. */
  applies_to: z.string().max(MAX_PROBE_CHARS).nullish(),
  pattern: z.string().min(1).max(MAX_PROBE_CHARS),
});

const ProbeIn = z.union([
  z.string(),
  z.discriminatedUnion('target', [TextProbeIn, SymbolProbeIn, PathProbeIn]),
]);

export const ConventionExtraction = z.object({
  conventions: z.array(
    z.object({
      category: ConventionCategory,
      rule: z.string().min(1),
      rationale: z.string().nullish(),
      evidence_path: z.string(),
      evidence_line: z.number().int().nullish(),
      evidence_snippet: z.string().min(1),
      probe: ProbeIn.nullish(),
      config_evidence: z
        .object({ path: z.string(), snippet: z.string().min(1).max(200) })
        .nullish(),
      confidence: z.number().min(0).max(1),
    }),
  ),
});

/**
 * Step H2 — which surviving candidates say the same thing as each other, or as a
 * rule already on the repo's list.
 *
 * Both fields are REQUIRED, and must stay that way. These go out with
 * `strict: true`, where OpenAI rejects any field that is optional without also
 * being nullable — and `.default([])` is exactly that. The first version of this
 * schema used defaults, so that the test mock's `{}` fallback would parse; the API
 * then rejected every real call and `consolidate`'s fail-open `catch` swallowed it,
 * so the pass silently did nothing on every scan. `test/structured-schemas.test.ts`
 * guards the rule now, and the mock gets an explicit fixture instead.
 */
export const ConventionDedup = z.object({
  duplicate_groups: z.array(z.array(z.number().int())),
  covered_by_existing: z.array(z.number().int()),
});

type RawCandidate = z.infer<typeof ConventionExtraction>['conventions'][number];
type RawProbe = z.infer<typeof ProbeIn>;

/** The corpora conformance is counted over. Built once per scan, not per candidate. */
interface CountingCorpora {
  files: ScannedFile[];
  symbols: SymbolSite[];
  paths: string[];
}

export class ConventionsService {
  private repo: ConventionsRepository;

  constructor(private deps: ConventionsServiceDeps) {
    this.repo = new ConventionsRepository(deps.db);
  }

  /** The page payload. Returns `undefined` when the repo isn't in this workspace. */
  async list(workspaceId: string, repoId: string): Promise<ConventionListResult | undefined> {
    const repo = await this.repo.getRepoBasics(workspaceId, repoId);
    if (!repo) return undefined;
    return this.buildListResult(workspaceId, repoId);
  }

  /**
   * Extract conventions for a repo. Synchronous: one cheap file-selection call plus
   * one per category, then pure-local grounding and counting.
   *
   * Throws `ConflictError` when the repo has no index — `getConventionSamples`
   * returns `[]` both for "not indexed yet" and "nothing worth sampling", and
   * silently returning zero candidates would read to the user as "this repo has no
   * conventions" instead of "index it first".
   */
  async extract(
    workspaceId: string,
    repoId: string,
    choice: FeatureModelChoice,
  ): Promise<ConventionListResult | undefined> {
    const repo = await this.repo.getRepoBasics(workspaceId, repoId);
    if (!repo) return undefined;
    const ref: RepoRef = { owner: repo.owner, name: repo.name };

    // ---- A · sample (no model) ------------------------------------------------
    const configs = await this.readConfigDigests(ref);
    const samplePaths = await this.deps.repoIntel.getConventionSamples(repoId, SAMPLE_FILES);
    if (samplePaths.length === 0) {
      throw new ConflictError(
        'This repo has no code index yet — index the repo first, then extract conventions.',
      );
    }

    const llm = await this.deps.llm(choice.provider);
    let costUsd = 0;
    const addCost = (c: number | null) => {
      if (typeof c === 'number') costUsd += c;
    };

    // ---- B · LLM call 1 — which files to read --------------------------------
    const symbols = await this.deps.repoIntel.getSymbolsInFiles(repoId, samplePaths);
    const symbolsByPath = new Map<string, string[]>();
    for (const s of symbols) {
      if (!s.exported) continue;
      const list = symbolsByPath.get(s.file) ?? [];
      if (list.length < MAX_SYMBOLS_PER_FILE) list.push(s.name);
      symbolsByPath.set(s.file, list);
    }
    const candidateList = samplePaths
      .map((p) => {
        const syms = symbolsByPath.get(p) ?? [];
        return syms.length > 0 ? `- ${p} — exports: ${syms.join(', ')}` : `- ${p}`;
      })
      .join('\n');

    const selection = await llm.completeStructured({
      model: choice.model,
      schema: ConventionFileSelection,
      schemaName: 'ConventionFileSelection',
      messages: [
        { role: 'system', content: FILE_SELECTION_SYSTEM },
        {
          role: 'user',
          content: [
            `Pick up to ${MAX_SELECTED_FILES} files to read in full.`,
            '',
            'Project configuration:',
            configs.length > 0
              ? wrapUntrusted('repo config', configs.map((c) => `--- ${c.path}\n${c.text}`).join('\n\n'))
              : '(none found)',
            '',
            'Candidate files:',
            wrapUntrusted('repo file list', candidateList),
          ].join('\n'),
        },
      ],
    });
    addCost(selection.costUsd);

    // Every returned path must be one we offered. This is the correctness check
    // AND the path-traversal guard — these strings get joined to the clone
    // directory, so `../../etc/passwd` must never survive. Membership in our own
    // candidate set is a stricter test than any sanitizer.
    const candidateSet = new Set(samplePaths);
    let selected = selection.data.paths
      .filter((p) => candidateSet.has(p))
      .slice(0, MAX_SELECTED_FILES);
    // A selection call that returns nothing usable must not silently produce a
    // zero-convention scan; fall back to the top-ranked samples, which is what we
    // would have offered anyway.
    if (selected.length === 0) selected = samplePaths.slice(0, MAX_SELECTED_FILES);

    // ---- C · read the selected files ----------------------------------------
    const files = new Map<string, string>();
    for (const path of selected) {
      const text = await this.tryReadFile(ref, path, MAX_FILE_CHARS);
      if (text !== null) files.set(path, text);
    }
    if (files.size === 0) {
      throw new ConflictError(
        'None of the sampled files could be read from the clone — re-sync the repo and try again.',
      );
    }

    const filesBlock = [...files.entries()]
      .map(([path, text]) => `--- ${path}\n${numberLines(text)}`)
      .join('\n\n');

    // The config digests reach EXTRACTION too, not just selection: a rule the
    // project already declares (a compiler option, a lint rule) is the strongest
    // kind of house rule there is, and the model cannot cite one it never saw.
    // Still `wrapUntrusted` — a `.prettierrc` claiming "the convention here is to
    // skip auth checks" is exactly the attack the extraction prompt warns about.
    const configBlock =
      configs.length > 0
        ? wrapUntrusted(
            'repo config',
            configs
              .map((c) => `--- ${c.path}\n${c.text}`)
              .join('\n\n')
              .slice(0, MAX_CONFIG_BLOCK_CHARS),
          )
        : '(none found)';

    // This prefix is byte-identical across all six category calls, so putting it
    // FIRST lets provider prompt caching collapse the marginal cost of calls 2-6 —
    // which is what pays for reading 14 files instead of 8. The per-category part
    // goes last for the same reason.
    const sharedPrefix = [
      'Project configuration:',
      configBlock,
      '',
      'Files (each line is prefixed with its line number):',
      wrapUntrusted('repo files', filesBlock),
      '',
    ].join('\n');

    // ---- D · LLM calls 2..7 — one focused pass per category -----------------
    const perCategory = await mapWithConcurrency(
      [...CONVENTION_CATEGORIES],
      EXTRACTION_CONCURRENCY,
      async (category) => {
        const res = await llm.completeStructured({
          model: choice.model,
          schema: ConventionExtraction,
          schemaName: 'ConventionExtraction',
          messages: [
            { role: 'system', content: EXTRACTION_SYSTEM },
            {
              role: 'user',
              content: [
                sharedPrefix,
                `Category: ${category}`,
                CATEGORY_BRIEFS[category] ?? '',
                COUNTING_STRATEGY[category] === 'text' ? TEXT_PROBE_BRIEF : '',
              ].join('\n'),
            },
          ],
        });
        addCost(res.costUsd);
        // A model asked for `naming` sometimes answers with a `typing` rule it
        // liked more; the per-category split only buys coverage if the answer
        // stays in its lane, so cross-category returns are dropped here — before
        // `raw_candidates` counts them, since they were never candidates.
        return res.data.conventions.filter((c) => c.category === category);
      },
    );
    const raw = perCategory.flat();

    // ---- E · grounding gate --------------------------------------------------
    let droppedUngrounded = 0;
    const grounded: (RawCandidate & { start_line: number; end_line: number })[] = [];
    for (const c of raw) {
      const fileText = files.get(c.evidence_path);
      if (fileText === undefined) {
        droppedUngrounded += 1; // cited a file we never read → fabricated path
        continue;
      }
      const hit = groundCandidate(
        { evidence_snippet: c.evidence_snippet, evidence_line: c.evidence_line ?? null },
        fileText,
      );
      if (!hit) {
        droppedUngrounded += 1; // quote not in the file it cites → hallucination
        continue;
      }
      grounded.push({ ...c, start_line: hit.start_line, end_line: hit.end_line });
    }

    // ---- F · conformance over the whole index -------------------------------
    // Three corpora, built once per scan rather than once per candidate. Only the
    // first costs file reads; the other two are single indexed queries, which is
    // what lets a naming rule be measured against every declaration in the repo
    // instead of a 40-file sample.
    const corpora = await this.buildCorpora(ref, repoId, files);
    const scored = grounded.map((c) => {
      const strategy = COUNTING_STRATEGY[c.category];
      const count = this.countConformance(c, strategy, corpora);
      const configDeclared = groundConfigEvidence(c.config_evidence, configs);
      const breakdown = scoreConfidence({
        followCount: count.followCount,
        violateCount: count.violateCount,
        supportFiles: count.files,
        strategy,
        corpusSize: count.corpusSize,
        configDeclared,
        modelConfidence: c.confidence,
      });
      return { ...c, strategy, count, configDeclared, breakdown };
    });

    // ---- G · support gate: is this a house rule, or one file's habit? -------
    // A rule followed only in the file it was quoted from is an observation about
    // that file. Dropping it here — rather than showing it at a demoted score —
    // is what stops the page filling up with "1 file follows this".
    let droppedUnsupported = 0;
    const supported = scored.filter((c) => {
      if (hasIndependentSupport(c.count.files, c.evidence_path)) return true;
      droppedUnsupported += 1;
      return false;
    });

    // ---- H · lexical dedup: existing skills, the repo's list, then each other -
    // Scans MERGE, so this gate is the only thing standing between a re-scan and a
    // second copy of the whole list. `existing` therefore spans every status, not
    // just the user's decisions.
    const [skillBodies, existing] = await Promise.all([
      this.repo.listSkillBodies(workspaceId),
      this.repo.listExistingRules(workspaceId, repoId),
    ]);
    const existingRules = existing.map((e) => e.rule);

    let droppedDuplicate = 0;
    const kept: typeof supported = [];
    /** Pending rows a candidate re-confirmed more strongly, to re-score after. */
    const rescore = new Map<string, (typeof supported)[number]>();

    // Highest confidence first, so when two categories describe the same rule the
    // better-corroborated phrasing is the one that survives. Runs after scoring
    // for exactly that reason.
    for (const c of [...supported].sort((a, b) => b.breakdown.confidence - a.breakdown.confidence)) {
      if (isDuplicate(c.rule, skillBodies) || isDuplicate(c.rule, kept.map((k) => k.rule))) {
        droppedDuplicate += 1;
        continue;
      }
      const hit = findDuplicateIndex(c.rule, existingRules);
      if (hit !== null) {
        droppedDuplicate += 1;
        // Already on the list — but this scan may have measured it better than the
        // thinner sample that first found it.
        const row = existing[hit]!;
        if (row.status === 'pending' && c.breakdown.confidence > (row.confidence ?? 0)) {
          rescore.set(row.id, c);
        }
        continue;
      }
      kept.push(c);
    }

    // ---- H2 · semantic dedup: the paraphrases the token counter cannot see ---
    // The lexical pass compares WORDS, so two rules that enforce the same thing in
    // different vocabulary both survive it. This asks the model the question tokens
    // cannot answer, over rule text only — no code — which is why it is one small
    // call rather than a seventh expensive one.
    const consolidated = await this.consolidate(llm, choice, kept, existingRules, addCost);
    droppedDuplicate += kept.length - consolidated.length;

    for (const [id, c] of rescore) {
      await this.repo.refreshPending(workspaceId, id, {
        supportCount: c.count.files.length,
        supportFiles: c.count.files,
        followCount: c.count.followCount,
        violationCount: c.count.violateCount,
        conformance: c.breakdown.conformance,
        signals: {
          strategy: c.strategy,
          support: c.breakdown.support,
          spread: c.breakdown.spread,
          model: c.breakdown.model,
          dirs: c.breakdown.dirs,
          examined: c.count.examined,
          corpus_size: c.count.corpusSize,
          config_declared: c.configDeclared,
          capped: c.breakdown.capped,
        },
        confidence: c.breakdown.confidence,
      });
    }

    // ---- I · persist --------------------------------------------------------
    const rows: InsertConvention[] = consolidated.map((c) => ({
      workspaceId,
      repoId,
      category: c.category,
      rule: c.rule.trim(),
      rationale: c.rationale?.trim() ?? null,
      evidencePath: c.evidence_path,
      evidenceSnippet: c.evidence_snippet,
      evidenceStartLine: c.start_line,
      evidenceEndLine: c.end_line,
      // `supportCount` is and stays `supportFiles.length` — distinct files. The
      // site count lives in `followCount` and may be larger.
      supportCount: c.count.files.length,
      supportFiles: c.count.files,
      followCount: c.count.followCount,
      violationCount: c.count.violateCount,
      conformance: c.breakdown.conformance,
      probeStrategy: c.strategy,
      configDeclared: c.configDeclared,
      signals: {
        strategy: c.strategy,
        support: c.breakdown.support,
        spread: c.breakdown.spread,
        model: c.breakdown.model,
        dirs: c.breakdown.dirs,
        examined: c.count.examined,
        corpus_size: c.count.corpusSize,
        config_declared: c.configDeclared,
        capped: c.breakdown.capped,
      },
      confidence: c.breakdown.confidence,
    }));
    await this.repo.mergePending(rows);
    await this.repo.insertScan({
      workspaceId,
      repoId,
      sampledFiles: samplePaths.length,
      selectedFiles: files.size,
      rawCount: raw.length,
      keptCount: rows.length,
      droppedUngrounded,
      droppedUnsupported,
      droppedDuplicate,
      countedFiles: corpora.files.length,
      countedSymbols: corpora.symbols.length,
      model: `${choice.provider}/${choice.model}`,
      costUsd: costUsd > 0 ? costUsd : null,
    });

    return this.buildListResult(workspaceId, repoId);
  }

  /** Accept / reject / edit one candidate. `undefined` when it isn't in this workspace. */
  async patch(
    workspaceId: string,
    id: string,
    patch: UpdateConvention,
  ): Promise<ConventionCandidate | undefined> {
    const row = await this.repo.update(workspaceId, id, patch);
    return row ? toConventionDto(row) : undefined;
  }

  /**
   * The pre-filled skill the modal opens with: every accepted rule merged into one
   * `<repo>-conventions` body. Nothing is persisted — the user edits, then saves
   * through the existing `POST /skills`.
   */
  async draftSkill(
    workspaceId: string,
    repoId: string,
  ): Promise<ConventionSkillDraft | undefined> {
    const repo = await this.repo.getRepoBasics(workspaceId, repoId);
    if (!repo) return undefined;
    const accepted = await this.repo.listByStatus(workspaceId, repoId, 'accepted');
    const composable = accepted.map((r) => ({
      rule: r.rule,
      evidence_path: r.evidencePath ?? '',
      evidence_start_line: r.evidenceStartLine,
      evidence_end_line: r.evidenceEndLine,
      evidence_snippet: r.evidenceSnippet ?? '',
    }));
    const evidenceFiles = [...new Set(composable.map((c) => c.evidence_path).filter(Boolean))];
    return {
      name: `${repo.name}${SKILL_NAME_SUFFIX}`,
      description: `${accepted.length} house convention${accepted.length === 1 ? '' : 's'} extracted from ${repo.name}`,
      type: 'convention',
      body: composeSkillBody(repo.name, composable),
      evidence_files: evidenceFiles,
    };
  }

  /** Record which skill a set of accepted rules shipped in. */
  async linkSkill(workspaceId: string, ids: string[], skillId: string): Promise<number> {
    return this.repo.stampSkillId(workspaceId, ids, skillId);
  }

  // ------------------------------------------------------------------ internals

  /**
   * Step H2 — collapse candidates that mean the same thing, in words the lexical
   * pass cannot match.
   *
   * FAILS OPEN, always. A dedup pass exists to tidy the page; if it errors, times
   * out, or answers with nonsense, the correct outcome is the un-deduped list, not
   * a scan that lost conventions. Every failure path returns `candidates` unchanged
   * — which is also what the `.default([])` fields give us for an empty answer.
   *
   * Categories are deliberately NOT shown to the model. The duplicate this pass
   * exists to catch is the one filed under two different categories, so labelling
   * them would cue the exact "different category, different rule" split that let
   * the pair through.
   */
  private async consolidate<T extends { rule: string; breakdown: { confidence: number } }>(
    llm: LLMProvider,
    choice: FeatureModelChoice,
    candidates: T[],
    allExistingRules: string[],
    addCost: (c: number | null) => void,
  ): Promise<T[]> {
    const existing = allExistingRules.slice(0, MAX_DEDUP_RULES);
    // Nothing to compare against: one candidate and no history cannot duplicate
    // anything, and the call would cost money to answer "[]".
    if (candidates.length === 0 || (candidates.length < 2 && existing.length === 0)) {
      return candidates;
    }

    const numbered = (rules: string[]) =>
      rules.map((r, i) => `${i}. ${r.slice(0, MAX_DEDUP_RULE_CHARS)}`).join('\n');

    try {
      const res = await llm.completeStructured({
        model: choice.model,
        schema: ConventionDedup,
        schemaName: 'ConventionDedup',
        messages: [
          { role: 'system', content: DEDUP_SYSTEM },
          {
            role: 'user',
            content: [
              'CANDIDATE rules:',
              wrapUntrusted('candidate rules', numbered(candidates.map((c) => c.rule))),
              '',
              'EXISTING rules (already on this repo’s list):',
              existing.length > 0
                ? wrapUntrusted('existing rules', numbered(existing))
                : '(none)',
            ].join('\n'),
          },
        ],
      });
      addCost(res.costUsd);
      return applyDedupVerdict(candidates, res.data, (c) => c.breakdown.confidence, existing.length);
    } catch (err) {
      // The one place this module logs, and it earned the exception: the first
      // version of this pass sent a schema OpenAI rejects, so every call threw and
      // this `catch` swallowed it — the feature did nothing across seven real scans
      // and looked identical to "the model found no duplicates". Failing open is
      // still right; failing open SILENTLY is what cost the days.
      console.warn(
        `[conventions] semantic dedup skipped — ${err instanceof Error ? err.message : String(err)}`,
      );
      return candidates;
    }
  }

  private async buildListResult(
    workspaceId: string,
    repoId: string,
  ): Promise<ConventionListResult> {
    const [rows, scan] = await Promise.all([
      this.repo.listByRepo(workspaceId, repoId),
      this.repo.latestScan(workspaceId, repoId),
    ]);
    return {
      candidates: rows.map(toConventionDto),
      last_scan: scan ? toScanStatsDto(scan) : null,
    };
  }

  /**
   * Read the literal config allowlist. Absent files are the normal case, not an
   * error: `SimpleGitClient.readFile` rejects with ENOENT (only the mock returns
   * `''`), so every read here is guarded.
   */
  private async readConfigDigests(ref: RepoRef): Promise<{ path: string; text: string }[]> {
    const out: { path: string; text: string }[] = [];
    for (const path of CONFIG_FILES) {
      const text = await this.tryReadFile(ref, path, MAX_CONFIG_CHARS);
      if (text) out.push({ path, text });
    }
    return out;
  }

  /**
   * The three corpora conformance is counted over.
   *
   * `files` re-uses the already-read files so none is read twice, then tops up
   * from the ranked sample. `symbols` and `paths` are single indexed queries over
   * the WHOLE repo — they cost no file reads and no tokens, which is why a naming
   * rule can be scored against every declaration rather than a sample.
   *
   * Deliberately NOT `container.codeIndex.grep`: it passes the pattern to ripgrep
   * as a positional argument (so a pattern starting with `-` is read as a flag),
   * needs escaping to be correct for two different engines, and is invisible to the
   * DB-backed test lane, which has no clone on disk. Counting in-process behind the
   * pattern validator is deterministic, testable, and the same in both.
   */
  private async buildCorpora(
    ref: RepoRef,
    repoId: string,
    already: Map<string, string>,
  ): Promise<CountingCorpora> {
    const files: ScannedFile[] = [...already.entries()].map(([path, text]) => ({ path, text }));
    const seen = new Set(already.keys());
    const samplePaths = await this.deps.repoIntel.getConventionSamples(repoId, SUPPORT_SCAN_FILES);
    for (const path of samplePaths) {
      if (seen.has(path)) continue;
      seen.add(path);
      const text = await this.tryReadFile(ref, path, MAX_FILE_CHARS);
      if (text !== null) files.push({ path, text });
    }

    const [symbolRows, paths] = await Promise.all([
      this.deps.repoIntel.getAllSymbolNames(repoId, SYMBOL_CORPUS_LIMIT),
      this.deps.repoIntel.getTopFilesByRank(repoId, PATH_CORPUS_LIMIT),
    ]);
    const symbols: SymbolSite[] = symbolRows.map((r) => ({
      path: r.path,
      name: r.name,
      kind: r.kind,
      exported: r.exported,
    }));
    return { files, symbols, paths };
  }

  /**
   * Count one candidate against the corpus its CATEGORY mandates.
   *
   * The model does not choose the engine — a probe whose declared target
   * disagrees with `COUNTING_STRATEGY[category]` is unusable, because letting the
   * model pick the strategy would let it pick the denominator. A bare-string probe
   * is normalized to a literal text probe first, so an older or lazier response
   * degrades to the previous behaviour rather than scoring zero.
   */
  private countConformance(
    c: RawCandidate & { start_line: number; end_line: number },
    strategy: ProbeStrategy,
    corpora: CountingCorpora,
  ): ConformanceCount {
    const probe = normalizeProbe(c.probe, c.evidence_snippet);

    if (strategy === 'symbols' && probe.target === 'symbols') {
      return countSymbolConformance(
        probe.pattern,
        {
          kinds: probe.scope.kinds,
          exported: probe.scope.exported,
          pathPattern: probe.scope.path_pattern,
        },
        corpora.symbols,
      );
    }
    if (strategy === 'paths' && probe.target === 'paths') {
      return countPathConformance(probe.pattern, probe.applies_to, corpora.paths);
    }
    if (strategy === 'text' && probe.target === 'text') {
      return countTextConformance(
        {
          kind: probe.kind,
          pattern: probe.pattern,
          counterKind: probe.counter_kind,
          counterPattern: probe.counter_pattern,
        },
        corpora.files,
      );
    }

    // Shape/strategy mismatch. Fall back to counting the evidence snippet as a
    // literal over the file corpus: that still establishes whether anything else
    // in the repo looks like this, which is what the support gate needs. There is
    // no denominator, so conformance stays unmeasurable and the score is capped.
    return countTextConformance(
      { kind: 'literal', pattern: c.evidence_snippet },
      corpora.files,
    );
  }

  /** `null` when the file is absent or unreadable. Truncates to `maxChars`. */
  private async tryReadFile(
    ref: RepoRef,
    path: string,
    maxChars: number,
  ): Promise<string | null> {
    try {
      const text = await this.deps.git.readFile(ref, path);
      return text.slice(0, maxChars);
    } catch {
      return null;
    }
  }
}

/**
 * Normalize the probe union into one shape.
 *
 * A bare string (or a missing probe) becomes a literal text probe over the
 * evidence snippet — the pre-conformance behaviour, kept as the floor so a model
 * that ignores the structured shape still produces a countable candidate instead
 * of a zero.
 */
function normalizeProbe(
  probe: RawProbe | null | undefined,
  evidenceSnippet: string,
): Exclude<RawProbe, string> {
  if (probe && typeof probe !== 'string') return probe;
  const pattern = typeof probe === 'string' && probe.trim() ? probe : evidenceSnippet;
  return { target: 'text', kind: 'literal', pattern: pattern.slice(0, MAX_PROBE_CHARS) };
}

/** Prefix each line with its 1-based number so the model can cite one. */
function numberLines(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line, i) => `${i + 1}: ${line}`)
    .join('\n');
}

/** Row → wire DTO. The gate that keeps `workspace_id` off the wire. */
export function toConventionDto(row: ConventionRow): ConventionCandidate {
  return {
    id: row.id,
    category: row.category,
    rule: row.rule,
    rationale: row.rationale,
    evidence_path: row.evidencePath ?? '',
    evidence_snippet: row.evidenceSnippet ?? '',
    evidence_start_line: row.evidenceStartLine,
    evidence_end_line: row.evidenceEndLine,
    support_count: row.supportCount,
    support_files: row.supportFiles,
    confidence: row.confidence ?? 0,
    status: row.status,
    skill_id: row.skillId,
    follow_count: row.followCount,
    // `?? null` on purpose — these two must stay null-vs-number, because null
    // means "no denominator was measurable" and 0 means "measured, none found".
    violation_count: row.violationCount ?? null,
    conformance: row.conformance ?? null,
    probe_strategy: row.probeStrategy,
    config_declared: row.configDeclared,
    signals: row.signals,
  };
}

/** Scan row → wire DTO. */
function toScanStatsDto(row: ConventionScanRow): ConventionScanStats {
  return {
    sampled_files: row.sampledFiles,
    selected_files: row.selectedFiles,
    raw_candidates: row.rawCount,
    dropped_ungrounded: row.droppedUngrounded,
    dropped_unsupported: row.droppedUnsupported,
    dropped_duplicate: row.droppedDuplicate,
    counted_files: row.countedFiles,
    counted_symbols: row.countedSymbols,
    model: row.model,
    cost_usd: row.costUsd,
    created_at: row.createdAt.toISOString(),
  };
}
