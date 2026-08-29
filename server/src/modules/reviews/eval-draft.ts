/**
 * `GET /findings/:id/eval-draft` (SPEC-03 AC-4/AC-5, docs/plans/09-eval-pipeline.md T11).
 *
 * Builds the pre-filled `EvalCaseDraft` for the `Turn into eval case` action —
 * READ ONLY, persists nothing (REQ-6). Lives in the **reviews** module (not
 * `evals`) because it needs `findingContext`, `pr_files.patch` and the
 * finding's producing agent, all of which are reviews-module-private; the
 * shared diff-synthesis piece both modules need is
 * `modules/_shared/diff-synth.ts::buildAgentCaseDiff` (T5) — this file must
 * import nothing from `modules/evals/**`, in either direction
 * (`onion-architecture` rule 2: no module imports another module).
 */
import type { EvalCaseDraft, EvalExpectedFinding } from '@devdigest/shared';
import type { Db } from '../../db/client.js';
import { ConflictError, NotFoundError } from '../../platform/errors.js';
import { buildAgentCaseDiff } from '../_shared/diff-synth.js';
import { ReviewRepository } from './repository.js';

/**
 * The `name` length cap referenced by AC-4/AC-5/REQ-4 ("`name` = `From
 * finding: <title>` truncated to the cap"). Neither SPEC-03 nor the plan
 * states a concrete number — `eval_cases.name` is an unconstrained `text`
 * column — so this is a local, defensible choice, not a value read from a
 * contract or schema. Change it in one place if the owner sets a different cap.
 */
const NAME_LENGTH_CAP = 120;

function truncate(name: string, cap: number): string {
  return name.length > cap ? name.slice(0, cap) : name;
}

/**
 * Lines of tolerance added on each side of the finding's own range when it is
 * seeded into a draft.
 *
 * Measured, not guessed: four consecutive runs of one seeded case (a field
 * rename cited at `start_line: 19`) had the reviewer cite the SAME issue at
 * `16-19`, `16-22`, `20-20` and `19-19`. `evals/scoring.ts` matches on file
 * equality plus range INTERSECTION and nothing else, and `pass` needs
 * `fn === 0 && fp === 0` — so the `20-20` run scored recall 0 / precision 0
 * off a one-line miss, and the case flipped pass/fail run to run while every
 * run had actually found the bug. A model cites a change at the declaration
 * line, at the hunk header, or one line either side; the window has to absorb
 * that. Deliberately small: widen it far enough to swallow a neighbouring
 * hunk and an unrelated finding starts scoring as a match.
 */
const EXPECTATION_LINE_PADDING = 3;

/** The finding's range widened by `EXPECTATION_LINE_PADDING`, clamped at line 1. */
function paddedRange(startLine: number, endLine: number): { start_line: number; end_line: number } {
  return {
    start_line: Math.max(1, Math.min(startLine, endLine) - EXPECTATION_LINE_PADDING),
    end_line: Math.max(startLine, endLine) + EXPECTATION_LINE_PADDING,
  };
}

/**
 * Build the pre-filled draft for a finding's `Turn into eval case` action.
 * Throws `NotFoundError` (404) for a missing or cross-workspace finding, and
 * `ConflictError` (409) when the draft cannot be built — no stored diff for
 * the finding's file (REQ-3), no producing agent on the review (REQ-3
 * extension), or a finding that is neither accepted nor dismissed (mirrors
 * the client's AC-2 disabled reason; the endpoint has no other action to
 * pre-fill from).
 */
export async function buildEvalDraft(
  repo: ReviewRepository,
  workspaceId: string,
  findingId: string,
): Promise<EvalCaseDraft> {
  const ctx = await repo.findingContext(findingId);
  if (!ctx || ctx.pull.workspaceId !== workspaceId) {
    throw new NotFoundError('Finding not found');
  }
  const { finding, review, pull } = ctx;

  const files = await repo.getPrFiles(pull.id);
  const file = files.find((f) => f.path === finding.file);
  if (!file || !file.patch) {
    throw new ConflictError(`No stored diff is available for ${finding.file}`);
  }

  if (review.agentId == null) {
    throw new ConflictError("This finding's review has no producing agent");
  }

  const name = truncate(`From finding: ${finding.title}`, NAME_LENGTH_CAP);
  const inputDiff = buildAgentCaseDiff(finding.file, file.patch);

  const base = {
    owner_kind: 'agent' as const,
    owner_id: review.agentId,
    name,
    input_diff: inputDiff,
  };

  // SEMANTICS (owner, 2026-08-29, fourth revision — back to SPEC-03 REQ-4/REQ-5).
  // This reverts the `must_not_flag`-for-both-arms flip recorded in
  // server/INSIGHTS.md as "(final)". An eval case now asserts what the agent
  // should DO, not what it should stop doing:
  //
  //   accepted  -> POSITIVE (`must_find`): the finding is real, the agent must
  //                keep finding it. Green when it does.
  //   dismissed -> NEGATIVE (`must_not_flag`): the finding was a false positive,
  //                the agent must stop reporting it. Green when it does not.
  //
  // The dismissed arm is only reachable because `pipeline/case-runner.ts` now
  // feeds the case's own `forbidden_regions` back to the model as a trusted
  // do-not-report list — without that the agent cannot know the finding was
  // rejected and the case can never go green. `seeded_from` remains pure
  // provenance (it drives the editor banner) and never reaches the scorer.
  //
  // Both windows stay padded: `scoring.ts` matches on file equality plus range
  // INTERSECTION and nothing else, so a one-line citation drift would otherwise
  // score a found bug as recall 0 / precision 0 (see EXPECTATION_LINE_PADDING).
  if (finding.acceptedAt != null) {
    return {
      ...base,
      expected_output: [
        {
          // `findings.severity`/`.category` are plain `text` columns, so the row
          // type is `string` - narrowed at the boundary exactly as
          // `helpers.ts::findingRowToDto` does it, not re-validated here.
          severity: finding.severity as EvalExpectedFinding['severity'],
          category: finding.category as EvalExpectedFinding['category'],
          title: finding.title,
          file: finding.file,
          ...paddedRange(finding.startLine, finding.endLine),
        },
      ],
      // A positive case declares no forbidden region — that is the dismissed arm.
      forbidden_regions: [],
      seeded_from: 'accepted',
    };
  }

  if (finding.dismissedAt != null) {
    return {
      ...base,
      expected_output: [],
      // Deliberately NO `title` here. The region is consumed by two readers that
      // both need only the location — `scoring.ts` (file + range intersection)
      // and the suppression line the case runner builds — and a finding `title`
      // is MODEL-generated text from an untrusted diff, which must not be
      // promoted into the trusted half of a prompt.
      forbidden_regions: [{ file: finding.file, ...paddedRange(finding.startLine, finding.endLine) }],
      seeded_from: 'dismissed',
    };
  }

  throw new ConflictError('Finding must be accepted or dismissed before it can become an eval case');
}

/**
 * Route-facing wrapper. `routes.ts` (R5) may not import `repository.ts` (own
 * module's R3) directly — it constructs the repository here instead, the same
 * way `ReviewService`'s constructor does (`new ReviewRepository(container.db)`).
 * `buildEvalDraft` above stays the unit under test, taking a `ReviewRepository`
 * so a hermetic test can pass an object literal (`onion-architecture` §3).
 */
export function evalDraftForFinding(
  db: Db,
  workspaceId: string,
  findingId: string,
): Promise<EvalCaseDraft> {
  return buildEvalDraft(new ReviewRepository(db), workspaceId, findingId);
}
