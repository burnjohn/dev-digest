import type {
  ConciseGroupedFindingsResultShape,
  DetailedGroupedFindingsResultShape,
} from '../schemas/findings.js';

/**
 * The one-line `text` that rides alongside `get_findings`'s grouped
 * `structuredContent` (ring M2).
 *
 * It lives here rather than in `tools/get-findings.ts` for the reason the
 * 2026-08-23 remediation moved the severity/file narrowing out of that file:
 * turning a projection into a sentence is shaping, and `tools/**` sequences
 * calls rather than deciding what the answer says.
 */

type GroupedResult = ConciseGroupedFindingsResultShape | DetailedGroupedFindingsResultShape;
type Group = GroupedResult['agents'][number];

/** Mirrors `shaping/project.ts`'s `GroupBy` — re-declared rather than imported
 *  because `shaping/**` files do not reach sideways into each other for a
 *  two-member string union, and because this file's use of it is narrower:
 *  it only decides what a group is CALLED in the sentence. */
export type SummaryGrouping = 'agent' | 'run';

/** Same discipline as `formatCandidates`' cap in `resolve/messages.ts`: name
 *  a few, then say how many were not named. A workspace with a dozen agents
 *  should not spend a dozen agent names on one summary line. */
const MAX_AGENTS_NAMED = 5;

/**
 * Under `all_runs` several groups carry the SAME agent name, so the name alone
 * stops identifying anything — a roster reading "Security Reviewer, Security
 * Reviewer, Security Reviewer" tells a reader nothing and invites them to
 * assume it is a bug. The run marker is a short `run_id` prefix, not the whole
 * uuid: enough to tell three groups apart and to quote back in a follow-up,
 * without spending 36 characters per group on a token budget this file already
 * caps agent names against.
 */
const RUN_MARKER_LENGTH = 8;

function label(group: Group, grouping: SummaryGrouping = 'agent'): string {
  const name = group.agent_name ?? group.agent_id ?? 'an unattributed review';
  if (grouping !== 'run') return name;
  const marker = group.run_id === null ? 'run unrecorded' : `run ${group.run_id.slice(0, RUN_MARKER_LENGTH)}`;
  return `${name} (${marker})`;
}

function withNote(sentence: string, note: string | undefined): string {
  return note === undefined ? sentence : `${sentence} ${note}`;
}

/**
 * Three branches, and the first two exist to keep a reader from reaching for
 * `run_agent_on_pr` when it is not warranted: "nothing is stored" and "this
 * agent found nothing" read identically in a bare findings count, and only
 * one of them is a reason to spend a run.
 */
export function summarizeGroupedFindings(
  result: GroupedResult,
  grouping: SummaryGrouping = 'agent',
): string {
  const groups = result.agents;

  if (groups.length === 0) {
    return 'No agent has reviewed this pull request yet — nothing is stored. Start a review with `run_agent_on_pr`.';
  }

  const only = groups[0];
  if (groups.length === 1 && only !== undefined && !only.reviewed) {
    return (
      `${label(only)} has not reviewed this pull request — no stored result. If a run is still ` +
      'in flight, call `get_findings` again in a minute; otherwise start one with `run_agent_on_pr`.'
    );
  }

  if (groups.length === 1 && only !== undefined) {
    const verdict = only.verdict ?? 'no verdict yet';
    return withNote(
      `${label(only, grouping)} — verdict: ${verdict}. Showing ${result.shown} of ${result.total} findings.`,
      result.note,
    );
  }

  const named = groups
    .slice(0, MAX_AGENTS_NAMED)
    .map((group) => `${label(group, grouping)} (${group.verdict ?? 'no verdict'})`);
  const remaining = groups.length - named.length;
  const roster = remaining > 0 ? `${named.join(', ')}, and ${remaining} more` : named.join(', ');

  // "N agents reviewed" is false under `all_runs`, where N groups are N RUNS
  // and may all belong to one agent. Saying "agents" there would overstate the
  // review coverage of the PR — the same class of error as borrowing a verdict
  // from the wrong agent, one level up.
  const subject = grouping === 'run' ? 'runs are stored for this pull request' : 'agents reviewed this pull request';

  return withNote(
    `${groups.length} ${subject}: ${roster}. ` +
      `Showing ${result.shown} of ${result.total} findings, most severe first.`,
    result.note,
  );
}
