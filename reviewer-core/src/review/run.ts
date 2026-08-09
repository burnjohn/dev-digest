import type {
  Finding,
  LLMProvider,
  PromptAssembly,
  Review,
  RunEventKind,
  StructuredResult,
  UnifiedDiff,
} from '@devdigest/shared';
import { Review as ReviewSchema } from '@devdigest/shared';
import { groundFindings } from '../grounding.js';
import { assemblePrompt } from '../prompt.js';
import { buildAdjudicationMessages, dedupeFindings } from './adjudicate.js';
import {
  DEFAULT_MAX_PROMPT_TOKENS,
  DEFAULT_MIN_DIFF_TOKENS,
  estimateTokens,
  planReviewChunks,
} from './chunks.js';
import { excludeGenerated } from './exclude-generated.js';
import { reviewModelPlan } from './model-policy.js';
import { reduceReviews, scoreFromFindings } from './reduce.js';

/** @deprecated Review sizing is token-aware; the old line threshold is ignored. */
export const DEFAULT_MAP_THRESHOLD_LINES = 400;
export const DEFAULT_REVIEW_MAX_RETRIES = 2;
const DEFAULT_MAP_CONCURRENCY = 3;

/** @deprecated Retained only so older API/DB callers remain source-compatible. */
export type ReviewStrategy = 'auto' | 'single-pass' | 'map-reduce';
export type ReviewMode = 'single-pass' | 'map-reduce';

export interface ReviewEvent {
  kind: RunEventKind;
  msg: string;
  data?: unknown;
}

export interface ReviewInput {
  systemPrompt: string;
  model: string;
  diff: UnifiedDiff;
  llm: LLMProvider;
  /** @deprecated Execution is always planned automatically. */
  strategy?: ReviewStrategy;
  excludeGenerated?: RegExp[] | false;
  skills?: string[];
  memory?: string[];
  specs?: string[];
  callers?: string;
  repoMap?: string;
  prDescription?: string;
  task?: string;
  maxRetries?: number;
  /** @deprecated Execution is token-aware; this value is ignored. */
  mapThresholdLines?: number;
  /** Total estimated input budget for one mapper call. */
  maxPromptTokens?: number;
  /** Minimum space the planner must leave for diff content. */
  minDiffTokens?: number;
  sessionId?: string;
  onEvent?: (e: ReviewEvent) => void;
  checkCancelled?: () => void;
  signal?: AbortSignal;
}

export interface ReviewOutcome {
  review: Review;
  grounding: string;
  dropped: { finding: Finding; reason: string }[];
  mode: ReviewMode;
  assembly: PromptAssembly;
  /** Every attempted stage/model call, including failed fallback attempts. */
  chunks: { label: string; stage: 'map' | 'adjudicate'; model: string }[];
  tokensIn: number;
  tokensOut: number;
  costUsd: number | null;
  raw: string;
}

const SINGLE_SCOPE =
  'CURRENT REVIEW SCOPE — the complete focused pull-request diff. Review only the supplied diff.';
const CHUNK_SCOPE =
  'CURRENT REVIEW SCOPE — one chunk of a larger pull request. Review only this chunk; other chunks are reviewed separately.';

function throwIfCancelled(input: ReviewInput): void {
  input.checkCancelled?.();
  if (!input.signal?.aborted) return;
  if (input.signal.reason instanceof Error) throw input.signal.reason;
  throw new Error('Review cancelled');
}

function verdictFromFindings(findings: readonly Finding[]): Review['verdict'] {
  if (findings.some((finding) => finding.severity === 'CRITICAL')) return 'request_changes';
  return findings.length > 0 ? 'comment' : 'approve';
}

function promptTokenEstimate(messages: readonly { content: string }[]): number {
  return estimateTokens(messages.map((message) => message.content).join('\n'));
}

function constrainToCandidates(findings: Finding[], candidates: Finding[]): Finding[] {
  const candidatesById = new Map<string, Finding[]>();
  for (const candidate of candidates) {
    const matches = candidatesById.get(candidate.id) ?? [];
    matches.push(candidate);
    candidatesById.set(candidate.id, matches);
  }
  return findings.flatMap((finding) => {
    const matches = candidatesById.get(finding.id) ?? [];
    const exact = matches.find(
      (candidate) =>
        candidate.file === finding.file &&
        candidate.start_line === finding.start_line &&
        candidate.end_line === finding.end_line,
    );
    const candidate = exact ?? (matches.length === 1 ? matches[0] : undefined);
    if (!candidate) return [];
    return [
      {
        ...finding,
        file: candidate.file,
        start_line: candidate.start_line,
        end_line: candidate.end_line,
      },
    ];
  });
}

async function mapBounded<T, R>(
  items: readonly T[],
  concurrency: number,
  controller: AbortController,
  mapper: (item: T, index: number, signal: AbortSignal) => Promise<R>,
  callerSignal?: AbortSignal,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  const signal = callerSignal
    ? AbortSignal.any([callerSignal, controller.signal])
    : controller.signal;
  let nextIndex = 0;
  let failure: { error: unknown } | undefined;

  const worker = async () => {
    while (!failure) {
      const index = nextIndex++;
      const item = items[index];
      if (item === undefined) return;
      try {
        results[index] = await mapper(item, index, signal);
      } catch (error) {
        if (!failure) {
          failure = { error };
          controller.abort(error);
        }
        return;
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );
  if (failure) throw failure.error;
  return results;
}

export async function reviewPullRequest(input: ReviewInput): Promise<ReviewOutcome> {
  const maxRetries = input.maxRetries ?? DEFAULT_REVIEW_MAX_RETRIES;
  const emit = (kind: RunEventKind, msg: string, data?: unknown) =>
    input.onEvent?.({ kind, msg, data });

  const filtered =
    input.excludeGenerated === false
      ? { diff: input.diff, excluded: [] as string[] }
      : excludeGenerated(input.diff, input.excludeGenerated);
  if (filtered.excluded.length > 0) {
    emit(
      'info',
      `Skipped ${filtered.excluded.length} generated file(s): ${filtered.excluded.join(', ')}`,
    );
  }
  input = { ...input, diff: filtered.diff };

  const promptParts = {
    system: input.systemPrompt,
    skills: input.skills,
    memory: input.memory,
    specs: input.specs,
    callers: input.callers,
    repoMap: input.repoMap,
    prDescription: input.prDescription,
    task: input.task,
  };
  const emptyPrompt = assemblePrompt({
    ...promptParts,
    diff: '',
    stageInstruction: CHUNK_SCOPE,
  });
  const chunks = planReviewChunks({
    diff: input.diff,
    promptOverheadTokens: promptTokenEstimate(emptyPrompt.messages),
    maxPromptTokens: input.maxPromptTokens ?? DEFAULT_MAX_PROMPT_TOKENS,
    minDiffTokens: input.minDiffTokens ?? DEFAULT_MIN_DIFF_TOKENS,
  });
  const mode: ReviewMode = chunks.length === 1 ? 'single-pass' : 'map-reduce';
  emit(
    'info',
    chunks.length === 1
      ? `Reviewing ${input.diff.files.length} changed file(s) in one automatic chunk`
      : `Token budget planned ${chunks.length} review chunks`,
  );

  const policy = reviewModelPlan(input.llm.id, input.model);
  const mapController = new AbortController();
  const mapResults = await mapBounded(
    chunks,
    DEFAULT_MAP_CONCURRENCY,
    mapController,
    async (chunk, _index, signal) => {
      const chunkInput = { ...input, signal };
      const prompt = assemblePrompt({
        ...promptParts,
        diff: chunk.diffText,
        stageInstruction: chunks.length === 1 ? SINGLE_SCOPE : CHUNK_SCOPE,
      });
      let mapped: StructuredResult<Review> | undefined;
      const attempted: string[] = [];
      const calls: ReviewOutcome['chunks'] = [];
      const raws: string[] = [];

      for (const model of policy.mappers) {
        throwIfCancelled(chunkInput);
        attempted.push(model);
        calls.push({ label: chunk.label, stage: 'map', model });
        emit('tool', `map: reviewing ${chunk.label} with ${model}`, {
          file: chunk.label,
          stage: 'map',
          model,
        });
        try {
          mapped = await input.llm.completeStructured<Review>({
            model,
            schema: ReviewSchema,
            schemaName: 'ReviewMap',
            messages: prompt.messages,
            maxTokens: policy.mapMaxTokens,
            timeoutMs: policy.mapTimeoutMs,
            maxRetries,
            ...(input.sessionId ? { sessionId: input.sessionId } : {}),
            signal,
          });
          break;
        } catch (error) {
          throwIfCancelled(chunkInput);
          const message = error instanceof Error ? error.message : String(error);
          raws.push(`[map ${chunk.label} ${model} failed: ${message}]`);
          emit('info', `map fallback after ${model} failed for ${chunk.label}: ${message}`);
        }
      }

      if (!mapped) {
        throw new Error(
          `Review chunk "${chunk.label}" failed on all mapper models: ${attempted.join(', ')}`,
        );
      }
      raws.push(mapped.raw);

      // Never let an unsupported mapper location reach the adjudicator.
      const ground = groundFindings(mapped.data.findings, input.diff);
      for (const dropped of ground.dropped) {
        emit('info', `grounding dropped "${dropped.finding.title}": ${dropped.reason}`);
      }
      emit(
        'result',
        `${chunk.label}: ${ground.kept.length} grounded candidate finding(s) via ${mapped.model}`,
      );
      return {
        assembly: prompt.assembly,
        calls,
        raws,
        review: { ...mapped.data, findings: ground.kept },
        dropped: ground.dropped,
        tokensIn: mapped.tokensIn,
        tokensOut: mapped.tokensOut,
        costUsd: mapped.costUsd,
      };
    },
    input.signal,
  );

  throwIfCancelled(input);
  const calls: ReviewOutcome['chunks'] = mapResults.flatMap((result) => result.calls);
  const raws = mapResults.flatMap((result) => result.raws);
  const groundedPartials = mapResults.map((result) => result.review);
  const mapDropped = mapResults.flatMap((result) => result.dropped);
  const assembly: PromptAssembly | undefined = mapResults[0]?.assembly;
  let tokensIn = mapResults.reduce((total, result) => total + result.tokensIn, 0);
  let tokensOut = mapResults.reduce((total, result) => total + result.tokensOut, 0);
  let costUsd: number | null = mapResults.reduce<number | null>(
    (total, result) =>
      total == null || result.costUsd == null ? null : total + result.costUsd,
    0,
  );

  const account = (result: StructuredResult<Review>) => {
    tokensIn += result.tokensIn;
    tokensOut += result.tokensOut;
    costUsd = costUsd == null || result.costUsd == null ? null : costUsd + result.costUsd;
    raws.push(result.raw);
  };

  const mappedReview = reduceReviews(groundedPartials);
  const candidates = dedupeFindings(mappedReview.findings);
  let reviewed: Review;

  if (candidates.length === 0) {
    reviewed = {
      verdict: 'approve',
      summary: 'No grounded findings across reviewed chunks.',
      score: 100,
      findings: [],
    };
    emit('result', 'No grounded mapper candidates; adjudication skipped');
  } else if (policy.adjudicators.length === 0) {
    reviewed = { ...mappedReview, findings: candidates };
  } else {
    const messages = buildAdjudicationMessages({ candidates, diff: input.diff });
    let adjudicated: StructuredResult<Review> | undefined;
    for (const model of policy.adjudicators) {
      throwIfCancelled(input);
      calls.push({ label: 'final candidates', stage: 'adjudicate', model });
      emit('tool', `adjudicate: reviewing grounded candidates with ${model}`, {
        stage: 'adjudicate',
        model,
      });
      try {
        adjudicated = await input.llm.completeStructured<Review>({
          model,
          schema: ReviewSchema,
          schemaName: 'ReviewAdjudication',
          messages,
          maxTokens: policy.adjudicateMaxTokens,
          timeoutMs: policy.adjudicateTimeoutMs,
          maxRetries,
          ...(input.sessionId ? { sessionId: input.sessionId } : {}),
          ...(input.signal ? { signal: input.signal } : {}),
        });
        break;
      } catch (error) {
        throwIfCancelled(input);
        const message = error instanceof Error ? error.message : String(error);
        raws.push(`[adjudicate ${model} failed: ${message}]`);
        emit('info', `adjudication fallback after ${model} failed: ${message}`);
      }
    }
    if (adjudicated) {
      account(adjudicated);
      reviewed = {
        ...adjudicated.data,
        findings: constrainToCandidates(adjudicated.data.findings, candidates),
      };
    } else {
      reviewed = { ...mappedReview, findings: candidates };
      emit(
        'info',
        'Adjudication exhausted all fallback models; returning grounded mapper findings in degraded mode',
      );
    }
  }

  const finalGround = groundFindings(dedupeFindings(reviewed.findings), input.diff);
  const dropped = [...mapDropped, ...finalGround.dropped];
  const grounding = `${finalGround.kept.length}/${finalGround.kept.length + dropped.length} passed`;
  for (const item of finalGround.dropped) {
    emit('info', `grounding dropped "${item.finding.title}": ${item.reason}`);
  }
  emit('result', `Citation grounding: ${grounding}`);

  const finalFindings = finalGround.kept;
  return {
    review: {
      ...reviewed,
      verdict: verdictFromFindings(finalFindings),
      findings: finalFindings,
      score: scoreFromFindings(finalFindings),
    },
    grounding,
    dropped,
    mode,
    assembly: assembly ?? emptyPrompt.assembly,
    chunks: calls,
    tokensIn,
    tokensOut,
    costUsd,
    raw: raws.join('\n---\n'),
  };
}
