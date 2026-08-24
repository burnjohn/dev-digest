/**
 * REQ-18's TOTAL order for findings: `CRITICAL -> WARNING -> SUGGESTION`,
 * then `file` asc, then `start_line` asc, then `title` asc.
 *
 * Not decorative — `server/INSIGHTS.md` (2026-08-17) records a real bug where
 * a non-total order (`ORDER BY confidence DESC, created_at ASC` with every
 * row sharing one `created_at`) let ties fall back to Postgres heap order,
 * which reshuffled between two identical reads. The lesson transfers even
 * though this file has no database: `project.ts` (this task) collapses
 * duplicate findings BEFORE calling `compareFindings`, using the exact same
 * three fields (`file`, `start_line`, `title`) as this comparator's tail —
 * so by construction no two rows reaching `sort()` can tie on all four keys,
 * and the order this function produces is provably total, not just usually
 * total.
 */

/** The minimal shape `compareFindings` needs — deliberately independent of
 *  any wire or port type, so this ring stays a pure function over plain
 *  data (REQ-32; §5.12.2 — `shaping/**` may not import `@devdigest/shared`
 *  as a value, and does not need to for this). */
export interface Orderable {
  severity: 'CRITICAL' | 'WARNING' | 'SUGGESTION';
  file: string;
  start_line: number;
  title: string;
}

const SEVERITY_RANK: Record<Orderable['severity'], number> = {
  CRITICAL: 0,
  WARNING: 1,
  SUGGESTION: 2,
};

/** Plain code-unit comparison — never `localeCompare`, whose collation can
 *  vary by ICU build/locale and would silently break "byte-identical on
 *  every run" (REQ-18). */
function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export function compareFindings(a: Orderable, b: Orderable): number {
  const bySeverity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
  if (bySeverity !== 0) return bySeverity;

  const byFile = compareStrings(a.file, b.file);
  if (byFile !== 0) return byFile;

  const byLine = a.start_line - b.start_line;
  if (byLine !== 0) return byLine;

  return compareStrings(a.title, b.title);
}

/**
 * REQ-18's truncation `note` — teaches instead of just informing (principles
 * 3 + 4, §5.6): it names the two flat arguments (`severity`, `file`) that
 * exist on the tool, so the next call is a narrower one rather than a blind
 * repeat. `shown` and `total` are substituted in; the rest of the sentence
 * is fixed.
 */
export function buildTruncationNote(shown: number, total: number): string {
  return `Showing ${shown} of ${total} findings, CRITICAL first. Narrow with severity='CRITICAL' or file='src/x.ts'.`;
}

/** `compareFindings` plus the agent that reported the finding, for the ONE
 *  place findings from different agents are ordered against each other: the
 *  global cut that enforces the 20-finding cap across groups.
 *
 *  Without the extra key the order is not total. Two agents reviewing the
 *  same diff routinely flag the same line with the same title — identical on
 *  all four of `compareFindings`'s keys — and `Array.prototype.sort` gives no
 *  guarantee for ties, so which agent's finding survived the cut could differ
 *  between runs on the same input. Agent ids are unique, so appending one
 *  restores exactly the totality this file exists to guarantee. */
export function compareFindingsAcrossAgents(
  a: Orderable & { agentKey: string },
  b: Orderable & { agentKey: string },
): number {
  const byFinding = compareFindings(a, b);
  if (byFinding !== 0) return byFinding;
  return compareStrings(a.agentKey, b.agentKey);
}

/** The minimal shape `compareAgentGroups` needs — same independence from any
 *  wire or port type as `Orderable` above.
 *
 *  `agentKey` is the caller's own per-group unique key (`shaping/project.ts`
 *  builds it), NOT `agent_id`. That distinction is the whole reason this
 *  interface does not simply take the group: `agent_id` is nullable, so two
 *  unattributed reviews would collapse onto the same tail key and the order
 *  would stop being total exactly where it is hardest to notice. */
export interface OrderableGroup {
  counts: { critical: number; warning: number; suggestion: number };
  agent_name: string | null;
  agentKey: string;
}

/**
 * Orders the per-agent groups: most severe agent first, so the agent that
 * blocks the merge is read first.
 *
 * Ordering them at all is not cosmetic. Without it the groups come out in
 * whatever order the API returned the reviews, which makes the same input
 * produce a different response body run to run — the exact property this
 * file exists to guarantee for findings. `agentKey` is unique per group, so
 * it makes the order total; `agent_name` sorts before it only so the result
 * reads alphabetically for a human, and a null name sorts last rather than
 * throwing the comparison.
 */
export function compareAgentGroups(a: OrderableGroup, b: OrderableGroup): number {
  const byCritical = b.counts.critical - a.counts.critical;
  if (byCritical !== 0) return byCritical;

  const byWarning = b.counts.warning - a.counts.warning;
  if (byWarning !== 0) return byWarning;

  const bySuggestion = b.counts.suggestion - a.counts.suggestion;
  if (bySuggestion !== 0) return bySuggestion;

  const byName = compareStrings(a.agent_name ?? '￿', b.agent_name ?? '￿');
  if (byName !== 0) return byName;

  return compareStrings(a.agentKey, b.agentKey);
}

/** `buildTruncationNote`'s grouped counterpart — same sentence, plus the
 *  `agent` lever, which only `get_findings` has. `run_agent_on_pr` keeps the
 *  original note: it has already spent a run on one agent, so telling it to
 *  narrow by agent would be advice it cannot act on. */
export function buildGroupedTruncationNote(shown: number, total: number): string {
  return `Showing ${shown} of ${total} findings across all agents, CRITICAL first. Narrow with agent='Security Reviewer', severity='CRITICAL' or file='src/x.ts'.`;
}
