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

/** Same discipline as `formatCandidates`' cap in `resolve/messages.ts`: name
 *  a few, then say how many were not named. A workspace with a dozen agents
 *  should not spend a dozen agent names on one summary line. */
const MAX_AGENTS_NAMED = 5;

function label(group: Group): string {
  return group.agent_name ?? group.agent_id ?? 'an unattributed review';
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
export function summarizeGroupedFindings(result: GroupedResult): string {
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
      `${label(only)} — verdict: ${verdict}. Showing ${result.shown} of ${result.total} findings.`,
      result.note,
    );
  }

  const named = groups.slice(0, MAX_AGENTS_NAMED).map((group) => `${label(group)} (${group.verdict ?? 'no verdict'})`);
  const remaining = groups.length - named.length;
  const roster = remaining > 0 ? `${named.join(', ')}, and ${remaining} more` : named.join(', ');

  return withNote(
    `${groups.length} agents reviewed this pull request: ${roster}. ` +
      `Showing ${result.shown} of ${result.total} findings, most severe first.`,
    result.note,
  );
}
