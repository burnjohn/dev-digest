import type { Container } from '../../platform/container.js';
import type { SkillRow, EvalCaseRow } from '../../db/rows.js';
import type { AgentRow } from '../../db/rows.js';
import { reviewPullRequest } from '@devdigest/reviewer-core';
import type { Provider } from '@devdigest/shared';
import { NotFoundError, ValidationError } from '../../platform/errors.js';
import { parseUnifiedDiff } from '../../adapters/git/diff-parser.js';
import * as t from '../../db/schema.js';
import { SkillEvalRepository } from './eval-repository.js';
import { casePassed, judgePractices, patternMatch } from './eval-scoring.js';

type SkillEvalBatchRow = typeof t.skillEvalBatches.$inferSelect;
type EvalRunInsert = typeof t.evalRuns.$inferInsert;

/**
 * Minimal structured logger (pino-compatible) — kept LOCAL to this module
 * rather than imported from `eval/run-orchestrator.js`'s identically-shaped
 * `Logger` type, per module import isolation (R6): a module may import only
 * its own files, `@devdigest/shared`, `platform/container`, `db/schema`, and
 * `_shared/` — never another module's internals, even type-only. See
 * `server/insights.md`'s 2026-07-06 entry on redeclaring identically-shaped
 * local types instead of cross-module importing.
 */
export type Logger = {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
  debug: (obj: unknown, msg?: string) => void;
};

/** Concurrency cap for case-runs within one batch — mirrors
 *  `eval/run-orchestrator.ts`'s `CONCURRENCY` constant (2/min rate limit is
 *  enforced at the route). Redeclared locally per R6 (see `Logger` above). */
const CONCURRENCY = 3;

/** Fingerprint identity persisted on the batch row (AC-17) — never derived
 *  from the skill body alone. */
interface SnapshotIdentity {
  skillBody: string;
  skillVersion: number;
  hostAgentModel: string;
  hostAgentId: string;
}

/** Outcome of running a single case, kept in-memory until the batch is sealed. */
interface CaseRunOutcome {
  caseId: string;
  status: 'passed' | 'failed_grounding' | 'failed_judge' | 'error';
  groundingMissing: string[];
  judgeScore: number | null;
  judgeEvidence: { practice: string; passed: boolean; evidence: string }[] | null;
  costUsd: number | null;
  reachedJudging: boolean;
  groundingRequirementMet: boolean;
}

/**
 * SkillEvalOrchestrator — runs a batch of skill-eval cases through a HOST
 * AGENT's live `reviewPullRequest()` pipeline, with the skill-under-test's
 * body appended to whatever skills the host agent already has linked
 * (marginal contribution — AC-13, never isolation). Scores each case with the
 * two-tier `patternMatch()` → `judgePractices()` methodology from
 * `eval-scoring.ts`. Mirrors `eval/run-orchestrator.ts`'s `startBatch()`/
 * `executeBatch()` split (see `server/insights.md`'s 2026-07-06 Decision entry
 * on the 202-Accepted fire-and-forget pattern) but is otherwise fully
 * independent — sibling, not a subclass or a shared base.
 */
export class SkillEvalOrchestrator {
  private repo: SkillEvalRepository;

  constructor(private container: Container) {
    this.repo = new SkillEvalRepository(container.db);
  }

  /**
   * Resolve the run target (skill + host agent + kind + target cases +
   * marginal-contribution skill bodies) and insert the batch row,
   * synchronously — fast enough to answer within a normal request (AC-19's
   * 202 flow). The actual case fan-out is kicked off separately via
   * `executeBatch()`, detached from the request/response cycle.
   *
   * Batch kind: `caseIds` omitted or equal to the full case set → 'full'; a
   * strict, non-empty subset → 'calibration' (AC-11, AC-14). `caseIds` is
   * deduped via `Set` before classification — unknown/foreign case ids are
   * silently dropped by the `allCases.filter()` below; if that leaves ZERO
   * resolved target cases, this throws — no zero-run batch may be inserted.
   */
  async startBatch(
    workspaceId: string,
    skillId: string,
    hostAgentId: string,
    caseIds?: string[],
  ): Promise<{
    batch: SkillEvalBatchRow;
    skill: SkillRow;
    hostAgent: AgentRow;
    skillBodies: string[];
    targetCases: EvalCaseRow[];
  }> {
    const skill = await this.container.skillsRepo.getById(workspaceId, skillId);
    if (!skill) throw new NotFoundError('Skill not found');

    const hostAgent = await this.container.agentsRepo.getById(workspaceId, hostAgentId);
    if (!hostAgent) throw new NotFoundError('Host agent not found');

    const allCases = await this.repo.listCases(workspaceId, skillId);

    const dedupedCaseIds = caseIds ? Array.from(new Set(caseIds)) : undefined;

    const targetCases = dedupedCaseIds
      ? allCases.filter((c) => dedupedCaseIds.includes(c.id))
      : allCases;

    if (targetCases.length === 0) {
      throw new ValidationError(
        dedupedCaseIds
          ? 'No valid case ids resolved for this skill (unknown ids or none belong to this skill)'
          : 'Skill has no eval cases to run',
      );
    }

    // Classify by the RESOLVED target set, not the raw request: a run that
    // covers every real case is 'full' even if the request also carried
    // unknown/foreign ids (which are silently dropped by the filter above).
    // A strict subset of the skill's own cases is 'calibration'.
    const isFullSet = targetCases.length === allCases.length;
    const kind: 'full' | 'calibration' = isFullSet ? 'full' : 'calibration';

    // ---- Marginal contribution (AC-13): the host agent's OWN currently
    // linked+enabled skills, PLUS the skill-under-test appended ALONGSIDE
    // them — never replacing them. Zero other linked skills is NOT an error;
    // the run proceeds with only the skill-under-test attached.
    const linkedSkills = await this.container.agentsRepo.linkedSkills(hostAgentId);
    const hostSkillBodies = linkedSkills.filter((l) => l.skill.enabled).map((l) => l.skill.body);
    const skillBodies = [...hostSkillBodies, skill.body];

    // ---- Snapshot identity (AC-17): never from skill body alone — two
    // batches differ in identity if EITHER the skill version changes OR the
    // host agent changes (even with the same skill version).
    const snapshotIdentity: SnapshotIdentity = {
      skillBody: skill.body,
      skillVersion: skill.version,
      hostAgentModel: hostAgent.model,
      hostAgentId: hostAgent.id,
    };

    // ---- Insert the batch row up front. `status: null` until every case-run
    // completes and the aggregate is sealed below — never leave this readable
    // as a finished batch before it actually is.
    const batch = await this.repo.insertBatch({
      workspaceId,
      skillId,
      hostAgentId,
      kind,
      status: null,
      snapshotIdentity,
      model: hostAgent.model,
    });

    return { batch, skill, hostAgent, skillBodies, targetCases };
  }

  /**
   * Fan out the case runs for a batch already inserted by `startBatch()` and
   * seal its aggregate metrics. Intended to be called DETACHED from the
   * request/response cycle (AC-19) — callers must pass a logger that survives
   * past the response (a `req.log.child({...})` taken BEFORE responding) and
   * must not await this from within the route handler.
   */
  async executeBatch(
    batch: SkillEvalBatchRow,
    skill: SkillRow,
    hostAgent: AgentRow,
    skillBodies: string[],
    targetCases: EvalCaseRow[],
    log?: Logger,
  ): Promise<{ status: 'clean' | 'degraded' }> {
    const outcomes: CaseRunOutcome[] = [];
    let anyError = false;

    await this.runWithConcurrencyCap(targetCases, CONCURRENCY, async (caseRow) => {
      const outcome = await this.runOneCase(hostAgent, skillBodies, caseRow, batch.id).catch(
        async (err: unknown) => {
          log?.error({ err, caseId: caseRow.id, batchId: batch.id }, 'skill-eval: unexpected case-run failure');
          // `runOneCase` itself never throws (its own try/catch always
          // resolves with a CaseRunOutcome) — reaching here means the failure
          // happened BEFORE/AROUND its own persistence, so no eval_runs row
          // exists for this case yet. Persist one now so the batch's degraded
          // cause is still visible in the UI drill-down, not just in logs.
          await this.repo
            .insertRun({
              caseId: caseRow.id,
              skillBatchId: batch.id,
              actualOutput: null,
              pass: null,
              recall: null,
              precision: null,
              citationAccuracy: null,
              durationMs: 0,
              costUsd: null,
              matchedCount: null,
              expectedCount: null,
              errorMessage: formatErrorMessage(err),
            } satisfies EvalRunInsert)
            .catch(() => undefined);

          return {
            caseId: caseRow.id,
            status: 'error' as const,
            groundingMissing: [],
            judgeScore: null,
            judgeEvidence: null,
            costUsd: null,
            reachedJudging: false,
            groundingRequirementMet: false,
          } satisfies CaseRunOutcome;
        },
      );
      if (outcome.status === 'error') anyError = true;
      outcomes.push(outcome);
    });

    // ---- Aggregate ONLY from non-error cases (AC-16/25/26).
    const nonErrored = outcomes.filter((o) => o.status !== 'error');

    const judgedOutcomes = nonErrored.filter((o) => o.reachedJudging);
    const judgeScore =
      judgedOutcomes.length > 0
        ? judgedOutcomes.reduce((sum, o) => sum + (o.judgeScore ?? 0), 0) / judgedOutcomes.length
        : null;

    const groundingPassRate =
      nonErrored.length > 0
        ? nonErrored.filter((o) => o.groundingRequirementMet).length / nonErrored.length
        : null;

    const casesPassing = outcomes.filter((o) => o.status === 'passed').length;
    const casesTotal = outcomes.length;

    const costUsd = nonErrored.some((o) => o.costUsd !== null)
      ? nonErrored.reduce((sum, o) => sum + (o.costUsd ?? 0), 0)
      : null;

    // Seal EVERY batch — full AND calibration — with a real clean/degraded
    // status. The client polls `status != null` as the completion signal
    // (mirrors eval/run-orchestrator.ts's identical fix, see
    // server/insights.md 2026-07-06 Decision entry).
    const status: 'clean' | 'degraded' = anyError ? 'degraded' : 'clean';

    await this.repo.updateBatchAggregate(batch.id, {
      judgeScore,
      groundingPassRate,
      casesPassing,
      casesTotal,
      costUsd,
      status,
    });

    return { status };
  }

  /**
   * Convenience wrapper for callers that want the OLD synchronous
   * start+run+seal behavior in one call (e.g. tests) — awaits the full
   * fan-out before returning. Routes must NOT use this (AC-19) — use
   * `startBatch()` + detached `executeBatch()` instead.
   */
  async runBatch(workspaceId: string, skillId: string, hostAgentId: string, caseIds?: string[]) {
    const { batch, skill, hostAgent, skillBodies, targetCases } = await this.startBatch(
      workspaceId,
      skillId,
      hostAgentId,
      caseIds,
    );
    const { status } = await this.executeBatch(batch, skill, hostAgent, skillBodies, targetCases);
    return { batchId: batch.id, kind: batch.kind, status };
  }

  /**
   * Run one case's review + score it with the two-tier methodology; never
   * throws — runtime failures are captured as an 'error' outcome so the rest
   * of the batch proceeds (AC-15).
   */
  private async runOneCase(
    hostAgent: AgentRow,
    skillBodies: string[],
    caseRow: EvalCaseRow,
    batchId: string,
  ): Promise<CaseRunOutcome> {
    const start = Date.now();
    const expected = expectedOutputFromJson(caseRow.expectedOutput);

    try {
      const llm = await this.container.llm(hostAgent.provider as Provider);
      const diff = parseUnifiedDiff(caseRow.inputDiff ?? '');

      const outcome = await reviewPullRequest({
        systemPrompt: hostAgent.systemPrompt,
        model: hostAgent.model,
        diff,
        llm,
        strategy: hostAgent.strategy,
        skills: skillBodies,
        sessionId: `skill-eval:${batchId}:${caseRow.id}`,
      });

      // ---- Output-text extraction for scoring (flagged risk, per Step 5's
      // spec): `ReviewOutcome` (reviewer-core/src/review/run.ts) has no
      // single flat "output text" field — only a structured `review.findings:
      // Finding[]`. Build the text deterministically from each finding's
      // `title` + `rationale` + `file:start_line` (snake_case wire fields,
      // per server/insights.md's 2026-07-05 Finding-vs-FindingRow naming
      // Quirk entry), joined with newlines. This is the ALREADY-GROUNDED
      // output (groundFindings() already ran inside reviewPullRequest()) —
      // patternMatch()/judgePractices() score this text, never the raw pre-
      // grounding model output.
      const outputText = outcome.review.findings
        .map((f) => `${f.title} — ${f.rationale} (${f.file}:${f.start_line})`)
        .join('\n');

      const hasGrounding = expected.grounding.length > 0;
      const groundingResult = patternMatch(outputText, expected.grounding);

      let durationMs = Date.now() - start;

      if (!groundingResult.passed) {
        // AC-21: grounding failure skips the judge entirely (no LLM call).
        // Persist the fine-grained skill-eval outcome envelope into
        // actualOutput (AC-30) so a read-back can tell failed_grounding from
        // failed_judge — eval_runs.pass is a plain boolean with no such
        // discriminator. `findings` is kept alongside for a potential raw-
        // output view; the DTO mappers only read the scoring fields.
        await this.repo.insertRun({
          caseId: caseRow.id,
          skillBatchId: batchId,
          actualOutput: {
            status: 'failed_grounding',
            grounding_missing: groundingResult.missing,
            judge_score: null,
            judge_evidence: null,
            findings: outcome.review.findings,
          },
          pass: false,
          recall: null,
          precision: null,
          citationAccuracy: null,
          durationMs,
          costUsd: outcome.costUsd,
          matchedCount: null,
          expectedCount: null,
        } satisfies EvalRunInsert);

        return {
          caseId: caseRow.id,
          status: 'failed_grounding',
          groundingMissing: groundingResult.missing,
          judgeScore: null,
          judgeEvidence: null,
          costUsd: outcome.costUsd,
          reachedJudging: false,
          groundingRequirementMet: false,
        };
      }

      const hasPractices = expected.practices.length > 0;
      const judgeResult = hasPractices
        ? await judgePractices(this.container, hostAgent.provider as Provider, hostAgent.model, outputText, expected.practices)
        : null;

      durationMs = Date.now() - start;

      const passed = casePassed(groundingResult, hasGrounding, judgeResult, hasPractices, expected.threshold);
      const status: 'passed' | 'failed_judge' = passed ? 'passed' : 'failed_judge';

      // AC-33 — cost attributable per case = review call cost + judge call
      // cost. `judgePractices()` now returns its own `costUsd` (null → 0), so
      // when the judge fired its token cost is added here instead of dropped.
      // Stays null only when neither the review nor the judge reported any
      // cost (e.g. a mock provider), so the batch aggregate can still tell
      // "no cost data" from "genuinely zero".
      const judgeCost = judgeResult?.costUsd ?? 0;
      const costUsd =
        outcome.costUsd === null && judgeCost === 0 ? null : (outcome.costUsd ?? 0) + judgeCost;

      await this.repo.insertRun({
        caseId: caseRow.id,
        skillBatchId: batchId,
        // Fine-grained outcome envelope for read-back (AC-30) — carries the
        // exact status + judge signal that eval_runs.pass (a plain boolean)
        // cannot. `findings` kept alongside for a potential raw-output view.
        actualOutput: {
          status,
          grounding_missing: [],
          judge_score: judgeResult?.score ?? null,
          judge_evidence: judgeResult?.results ?? null,
          findings: outcome.review.findings,
        },
        pass: passed,
        recall: null,
        precision: null,
        citationAccuracy: null,
        durationMs,
        costUsd,
        matchedCount: null,
        expectedCount: null,
      } satisfies EvalRunInsert);

      return {
        caseId: caseRow.id,
        status,
        groundingMissing: [],
        judgeScore: judgeResult?.score ?? null,
        judgeEvidence: judgeResult?.results ?? null,
        costUsd,
        reachedJudging: hasPractices,
        groundingRequirementMet: true,
      };
    } catch (err) {
      // Per-case runtime failure (provider error/timeout) — distinct from a
      // deterministic scored failure (AC-15). Record it and let the batch
      // continue; the batch itself is marked 'degraded' by the caller.
      const durationMs = Date.now() - start;
      await this.repo
        .insertRun({
          caseId: caseRow.id,
          skillBatchId: batchId,
          actualOutput: null,
          pass: null,
          recall: null,
          precision: null,
          citationAccuracy: null,
          durationMs,
          costUsd: null,
          matchedCount: null,
          expectedCount: null,
          errorMessage: formatErrorMessage(err),
        } satisfies EvalRunInsert)
        .catch(() => undefined);

      return {
        caseId: caseRow.id,
        status: 'error',
        groundingMissing: [],
        judgeScore: null,
        judgeEvidence: null,
        costUsd: null,
        reachedJudging: false,
        groundingRequirementMet: false,
      };
    }
  }

  /** Bounded-concurrency map over `items`, awaiting all before returning
   *  (the orchestrator must resolve only once every case-run has settled, so
   *  the batch aggregate is computed from complete data). Redeclared locally
   *  per R6 — see the `Logger` type's doc comment above. */
  private async runWithConcurrencyCap<T>(
    items: T[],
    concurrency: number,
    fn: (item: T) => Promise<void>,
  ): Promise<void> {
    let head = 0;
    const workers: Promise<void>[] = [];
    const runNext = async (): Promise<void> => {
      while (head < items.length) {
        const item = items[head++]!;
        await fn(item);
      }
    };
    const workerCount = Math.min(concurrency, items.length);
    for (let i = 0; i < workerCount; i++) workers.push(runNext());
    await Promise.all(workers);
  }
}

/** `eval_cases.expected_output` is untyped JSONB — parse defensively to the
 *  skill-eval `{practices, grounding, threshold}` shape (AC-10 — threshold
 *  defaults to 0.6 when absent). */
function expectedOutputFromJson(raw: unknown): { practices: string[]; grounding: string[]; threshold: number } {
  const obj = (raw ?? {}) as { practices?: unknown; grounding?: unknown; threshold?: unknown };
  return {
    practices: Array.isArray(obj.practices) ? (obj.practices as string[]) : [],
    grounding: Array.isArray(obj.grounding) ? (obj.grounding as string[]) : [],
    threshold: typeof obj.threshold === 'number' ? obj.threshold : 0.6,
  };
}

/** Cap on the persisted `error_message` string — mirrors `eval/helpers.ts`'s
 *  `formatErrorMessage` in spirit; redeclared locally per R6 rather than
 *  cross-module imported. */
function formatErrorMessage(err: unknown): string {
  const message = err instanceof Error ? err.message || err.name : typeof err === 'string' ? err : (() => {
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  })();
  return message.slice(0, 2000);
}
