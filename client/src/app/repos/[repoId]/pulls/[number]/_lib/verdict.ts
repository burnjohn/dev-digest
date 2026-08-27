/* Verdict vocabulary for the PR detail route — shared by the two surfaces that
   render one: `PrBriefCard`'s band (the PR's headline, derived) and
   `VerdictBanner` inside a run accordion (that run's own).

   Promoted here on 2026-08-26, when the band started needing `VERDICT_META`
   too. A colocated `_components/<Name>/constants.ts` is that component's own,
   so the second consumer is what turns it into route-level shared code
   (`frontend-ui-architecture`) rather than a cross-folder import. */

import type { IconName } from "@devdigest/ui";
import type { FindingRecord, ReviewRecord, RunSummary, Verdict } from "@devdigest/shared";

/** Per-verdict visual meta. `labelKey` resolves under the `verdict` namespace. */
export const VERDICT_META: Record<
  Verdict,
  { c: string; bg: string; icon: IconName; labelKey: string }
> = {
  request_changes: {
    c: "var(--crit)",
    bg: "var(--crit-bg)",
    icon: "XCircle",
    labelKey: "requestChanges",
  },
  approve: { c: "var(--ok)", bg: "var(--ok-bg)", icon: "CheckCircle", labelKey: "approve" },
  comment: { c: "var(--info)", bg: "var(--info-bg)", icon: "MessageSquare", labelKey: "comment" },
};

/**
 * The band's headline, DERIVED — never `ReviewRecord.verdict`.
 *
 * `reviewer-core/src/output/to-review.ts` computes the GitHub review event from
 * severities plus the agent's `ci_fail_on` and says why in so many words: the
 * model's self-reported `verdict` "drifts and surprises". `RunHistory`'s
 * `outcomeOf` colours its timeline the same way. This function is that same
 * rule for the Overview band, which matters because the headline sits inches
 * from the findings badge — a model that says "approve" over two blockers would
 * be visibly contradicting the count beside it.
 */
export function deriveVerdict(blockers: number, findingsCount: number): Verdict {
  if (blockers > 0) return "request_changes";
  if (findingsCount > 0) return "comment";
  return "approve";
}

/** Findings that still count: dismissing one removes it from both numbers. */
export function liveFindings(findings: FindingRecord[]): FindingRecord[] {
  return findings.filter((f) => !f.dismissed_at);
}

/**
 * How many findings trip the gate.
 *
 * `RunSummary.blockers` is the real answer — persisted at completion by
 * `countBlockers(findings, agent.ci_fail_on)`, so it respects an agent
 * configured to fail on `warning` rather than `critical`. It is null on failed
 * or cancelled runs and on rows that predate the column, and the run row can be
 * missing entirely (a `ReviewRecord` with no `run_id`). The fallback is the
 * non-dismissed CRITICAL count, which is what `ReviewRunAccordion` computes
 * inline today — so the two surfaces cannot disagree.
 */
export function blockerCount(run: RunSummary | null, findings: FindingRecord[]): number {
  if (run?.blockers != null) return run.blockers;
  return liveFindings(findings).filter((f) => f.severity === "CRITICAL").length;
}

/**
 * The run row belonging to a review. `ReviewRecord.run_id === RunSummary.run_id`
 * is the same join `FindingsTab`'s `findingsByRun` memo already relies on.
 * Returns null rather than guessing when the review carries no `run_id`.
 */
export function runForReview(
  review: ReviewRecord | null,
  runs: RunSummary[] | undefined,
): RunSummary | null {
  if (!review?.run_id || !runs) return null;
  return runs.find((r) => r.run_id === review.run_id) ?? null;
}

/* --- The PR-wide layer ---------------------------------------------------

   Everything above is a PER-RUN primitive and stays that way: `VerdictBanner`
   renders one run's verdict inside a run accordion and needs exactly those.
   What follows is the band's PR-wide answer, built ON TOP of them rather than
   beside them — a second severity rule would be free to drift from the first.

   Why this exists: the band used to render `reviews[0]`, i.e. whichever agent
   happened to finish LAST, as if it were the PR's headline. On a PR reviewed by
   three agents that meant a rejecting run was invisible whenever another agent
   completed after it, and the headline was not even stable across refreshes —
   agents fan out concurrently, `reviews.created_at` is `defaultNow()`, and the
   ordering has no secondary key. */

/** The band's numbers, computed across every agent that reviewed this PR. */
export interface PrAggregate {
  /** Non-dismissed findings, summed over the counted reviews. */
  findingsCount: number;
  /** Gate-tripping findings, summed over the counted runs. */
  blockers: number;
  /** Derived from the two counts above — never a model's self-reported verdict. */
  verdict: Verdict;
  /** Mean of the counted scores, rounded. Null when no counted run has one. */
  score: number | null;
  /** Sums over the counted runs. Null — not 0 — when no counted run reports the field. */
  costUsd: number | null;
  tokensIn: number | null;
  tokensOut: number | null;
  /** How many reviews the numbers above cover. */
  runCount: number;
}

/** Newest wins, ties broken on `id` so the result never depends on input order. */
function isNewer(a: ReviewRecord, b: ReviewRecord): boolean {
  if (a.created_at !== b.created_at) return a.created_at > b.created_at;
  return a.id > b.id;
}

/**
 * One review per agent — the newest — so re-running a single agent REPLACES its
 * old numbers instead of adding a second set to the totals. Same
 * newest-wins shape the server's Smart Diff dedup already uses
 * (`server/src/modules/reviews/smart-diff/classify.ts`).
 *
 * Rows are grouped on `agent_id`, which is nullable in the contract; the
 * fallbacks are `agent_name` and then the review's own `id`, so an
 * unidentifiable review becomes its own group rather than collapsing together
 * with every other agent-less row.
 *
 * The two shape guards are not defensive noise. `api.get` is a cast with no
 * runtime parse, so a drifted payload arrives as a resolved query and only
 * fails when something reads it (client/INSIGHTS.md 2026-08-25). Skipping a
 * malformed row here means the band degrades — to the other agents' numbers, or
 * all the way to the never-reviewed rendering — instead of throwing.
 */
export function latestReviewPerAgent(reviews: ReviewRecord[] | undefined): ReviewRecord[] {
  if (!Array.isArray(reviews)) return [];
  const byAgent = new Map<string, ReviewRecord>();
  for (const review of reviews) {
    // `kind: 'summary'` rows are not an agent's verdict and carry no gate.
    if (!review || review.kind !== "review" || !Array.isArray(review.findings)) continue;
    const key = review.agent_id ?? review.agent_name ?? review.id;
    const held = byAgent.get(key);
    if (!held || isNewer(review, held)) byAgent.set(key, review);
  }
  /* Sorted, not in Map insertion order, so the result does not depend on the
     order the caller passed. That matters beyond tidiness: `aggregatePr` sums
     `cost_usd` floats over this list, and float addition is not associative —
     an unsorted list makes the total differ in its last bits between two calls
     with the same data. Newest first, `id` breaking ties, matching the order
     the server now returns reviews in (`review.repo.ts` `reviewsForPull`). */
  return [...byAgent.values()].sort((a, b) => (isNewer(a, b) ? -1 : 1));
}

/**
 * The whole band, in one value. Null means no agent has reviewed this PR yet —
 * the band then renders the brief alone, with no verdict row, no ring and no
 * cost strip.
 *
 * Counts SUM: each run gates independently, so a PR with two blockers from one
 * agent and two from another has four. Score AVERAGES (owner decision,
 * 2026-08-26) over the runs that report one. Cost and tokens sum, and stay null
 * when nothing reports them — `cost_usd` is null for unknown-price models, and
 * "$0.00" would be a different claim than "not known".
 */
export function aggregatePr(
  reviews: ReviewRecord[] | undefined,
  runs: RunSummary[] | undefined,
): PrAggregate | null {
  const counted = latestReviewPerAgent(reviews);
  if (counted.length === 0) return null;

  let findingsCount = 0;
  let blockers = 0;
  let scoreSum = 0;
  let scored = 0;
  let costUsd: number | null = null;
  let tokensIn: number | null = null;
  let tokensOut: number | null = null;

  for (const review of counted) {
    const run = runForReview(review, runs);
    findingsCount += liveFindings(review.findings).length;
    blockers += blockerCount(run, review.findings);
    // The run row's score is the denormalized copy of the review's own; fall
    // back to the review's rather than dropping the run out of the mean.
    const score = run?.score ?? review.score;
    if (score != null) {
      scoreSum += score;
      scored += 1;
    }
    if (run?.cost_usd != null) costUsd = (costUsd ?? 0) + run.cost_usd;
    if (run?.tokens_in != null) tokensIn = (tokensIn ?? 0) + run.tokens_in;
    if (run?.tokens_out != null) tokensOut = (tokensOut ?? 0) + run.tokens_out;
  }

  return {
    findingsCount,
    blockers,
    verdict: deriveVerdict(blockers, findingsCount),
    score: scored > 0 ? Math.round(scoreSum / scored) : null,
    costUsd,
    tokensIn,
    tokensOut,
    runCount: counted.length,
  };
}
