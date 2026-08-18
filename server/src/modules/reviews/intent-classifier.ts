import { readFile } from 'node:fs/promises';
import { resolve as resolvePath, sep } from 'node:path';
import type { Container } from '../../platform/container.js';
import type { GitHubClient, Intent, UnifiedDiff } from '@devdigest/shared';
import { resolveFeatureModel } from '../settings/feature-models.js';
import type { ReviewRepository, PullRow } from './repository.js';
import {
  ClassificationModelOutput,
  buildClassificationPrompt,
  buildDiffShape,
  extractIssueRefs,
  extractSpecPaths,
  extractUrls,
  type ResolvedReference,
} from './intent-signals.js';

/** Max chars read from a resolved in-repo spec file — this is a classification
 *  signal, not a document viewer (mirrors conventions' MAX_FILE_CHARS intent). */
const MAX_SPEC_CHARS = 4000;
/** Reprompt-on-schema-failure budget for the classification call. */
const CLASSIFICATION_MAX_RETRIES = 2;
const SCHEMA_NAME = 'IntentClassification';
/** Below this, an explicit body is treated as "too thin to classify from". */
const THIN_BODY_CHARS = 20;

export interface ClassificationStats {
  provider: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number | null;
}

export interface ClassificationResult {
  intent: Intent;
  stats: ClassificationStats;
  /** Prompt sections used, for the Live Log / server log — never logged with
   *  secrets or diff content. */
  signalsUsed: string[];
}

/**
 * PR Intent Layer — classifies a PR's intent/scope with a cheap model BEFORE
 * the main review, from title/body/linked references/file-list+hunk-headers
 * (never diff line content). Cached in `pr_intent`; callers decide whether to
 * reuse the cache or force a fresh classification (see `classify`'s `force`).
 *
 * All I/O (LLM call, clone reads, ticket fetch, GitHub issue lookup, DB
 * upsert) lives here — this is application/service layer, not reviewer-core.
 */
export class IntentClassifier {
  private repo: ReviewRepository;

  constructor(private container: Container) {
    this.repo = container.reviewRepo;
  }

  /** Cached intent for a PR, or `undefined` if it has never been classified. */
  getCached(prId: string): Promise<Intent | undefined> {
    return this.repo.getIntent(prId);
  }

  /**
   * Run a fresh classification and persist it (overwrites any cached intent,
   * preserving nothing — this IS the "force" path; callers that want the
   * cache-first behaviour check `getCached` themselves first).
   */
  async classify(
    workspaceId: string,
    pull: PullRow,
    repoRow: { owner: string; name: string; clonePath: string | null },
    diff: UnifiedDiff,
  ): Promise<ClassificationResult> {
    const title = pull.title ?? '';
    const body = pull.body?.trim() ?? '';
    const thin = body.length < THIN_BODY_CHARS;

    const signalsUsed: string[] = [];
    const resolvedReferences: ResolvedReference[] = [];

    if (!thin) {
      signalsUsed.push('title', 'body');

      const specPaths = extractSpecPaths(`${title}\n${body}`);
      for (const path of specPaths) {
        const content = await this.readClonedSpec(repoRow.clonePath, path);
        if (content) {
          resolvedReferences.push({ label: path, content });
          signalsUsed.push(`resolved:${path}`);
        }
      }

      const urls = extractUrls(`${title}\n${body}`);
      for (const url of urls) {
        const fetched = await this.container.ticketFetcher.resolve(url);
        if (fetched && fetched.content.trim().length > 0) {
          resolvedReferences.push({ label: url, content: fetched.content });
          signalsUsed.push(`resolved:${url}`);
        }
      }

      const issueRefs = extractIssueRefs(`${title}\n${body}`);
      for (const num of issueRefs) {
        const issue = await this.fetchIssue(repoRow, num);
        if (issue) {
          resolvedReferences.push({
            label: `#${num}`,
            content: `${issue.title}\n\n${issue.body ?? ''}`,
          });
          signalsUsed.push(`linked_issue:#${num}`);
        }
      }
    }

    let fallback: { branch: string; commitMessages: string[] } | undefined;
    if (thin) {
      const commits = await this.repo.getPrCommits(pull.id);
      fallback = { branch: pull.branch, commitMessages: commits.map((c) => c.message) };
      signalsUsed.push('branch_name');
      if (commits.length > 0) signalsUsed.push('commit_messages');
      signalsUsed.push('file_list', 'diff_shape');
    }

    const diffShape = buildDiffShape(diff);
    const messages = buildClassificationPrompt({
      title,
      body: thin ? null : body,
      resolvedReferences,
      diffShape,
      ...(fallback ? { fallback } : {}),
    });

    const { provider, model } = await resolveFeatureModel(this.container, workspaceId, 'review_intent');
    const llm = await this.container.llm(provider);
    const res = await llm.completeStructured({
      model,
      schema: ClassificationModelOutput,
      schemaName: SCHEMA_NAME,
      messages,
      maxRetries: CLASSIFICATION_MAX_RETRIES,
    });

    // Confidence is OURS to set, from which signals were actually available —
    // never the model's self-report (see reviewer-core/INSIGHTS.md).
    const resolvedRefCount = resolvedReferences.length;
    const confidence: Intent['confidence'] = thin ? 'low' : resolvedRefCount > 0 ? 'high' : 'medium';

    const intent: Intent = {
      intent: res.data.intent,
      in_scope: res.data.in_scope,
      out_of_scope: res.data.out_of_scope,
      confidence,
      signals_used: signalsUsed,
      // Never set here — folded in later from grounded review findings.
      risk_areas: [],
      head_sha: pull.headSha,
    };

    await this.repo.upsertIntent(pull.id, intent);

    return {
      intent,
      stats: { provider, model, tokensIn: res.tokensIn, tokensOut: res.tokensOut, costUsd: res.costUsd },
      signalsUsed,
    };
  }

  /** Best-effort read of an in-repo spec path referenced in the PR text. Never throws. */
  private async readClonedSpec(clonePath: string | null, path: string): Promise<string | null> {
    if (!clonePath) return null;
    const root = resolvePath(clonePath);
    const abs = resolvePath(root, path);
    if (abs !== root && !abs.startsWith(root + sep)) return null; // path escapes the clone
    const raw = await readFile(abs, 'utf8').catch(() => null);
    return raw ? raw.slice(0, MAX_SPEC_CHARS) : null;
  }

  /** Best-effort GitHub issue lookup for an in-repo `#N` reference. Never throws. */
  private async fetchIssue(
    repoRow: { owner: string; name: string },
    number: number,
  ): Promise<{ title: string; body: string | null } | null> {
    let gh: GitHubClient;
    try {
      gh = await this.container.github();
    } catch {
      return null;
    }
    try {
      const issue = await gh.getIssue({ owner: repoRow.owner, name: repoRow.name }, number);
      return { title: issue.title, body: issue.body ?? null };
    } catch {
      return null;
    }
  }
}
