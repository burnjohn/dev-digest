import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import type { ReviewProjection } from '../src/ports.js';
import { projectFindings, projectFindingsByAgent } from '../src/shaping/project.js';
import { MAX_FINDINGS } from '../src/shaping/constants.js';
import { buildGroupedTruncationNote, compareFindings } from '../src/shaping/order.js';
import { FindingsOutputShape, GetFindingsOutput } from '../src/schemas/findings.js';

/**
 * `FindingsResultSchema` below wraps the SAME raw shape both `get_findings`
 * and `run_agent_on_pr` register as their `outputSchema` (2026-08-23
 * remediation, finding 3) — before this pass the test validated against a
 * second, unused pair of schemas that was not what either tool registered.
 */
const FindingsResultSchema = z.object(FindingsOutputShape);

/**
 * T7 — response shaping and the narrow findings schema (§5.6, §5.12).
 * Every test here is over PLAIN DATA: no fetch stub, no port mock, no SDK —
 * `project.ts` and `order.ts` are pure functions, which is REQ-32's own
 * acceptance box for this task.
 */

type FindingRow = ReviewProjection['findings'][number];

function makeFinding(overrides: Partial<FindingRow> = {}): FindingRow {
  return {
    id: overrides.id ?? 'f-default',
    severity: overrides.severity ?? 'WARNING',
    category: overrides.category ?? 'bug',
    title: overrides.title ?? 'default title',
    file: overrides.file ?? 'src/default.ts',
    start_line: overrides.start_line ?? 1,
    end_line: overrides.end_line ?? 2,
    rationale: overrides.rationale ?? 'because reasons',
    suggestion: overrides.suggestion ?? 'do this instead',
    confidence: overrides.confidence ?? 0.75,
    kind: overrides.kind ?? 'finding',
    trifecta_components: overrides.trifecta_components ?? null,
    evidence: overrides.evidence ?? null,
    review_id: overrides.review_id ?? 'review-1',
    accepted_at: overrides.accepted_at ?? null,
    dismissed_at: overrides.dismissed_at ?? null,
  };
}

function makeReview(overrides: Partial<ReviewProjection> = {}): ReviewProjection {
  return {
    run_id: overrides.run_id ?? 'run-1',
    agent_id: overrides.agent_id ?? 'agent-1',
    agent_name: overrides.agent_name ?? 'API Contract Reviewer',
    created_at: overrides.created_at ?? '2026-08-23T10:00:00.000Z',
    verdict: overrides.verdict ?? 'request_changes',
    score: overrides.score ?? 42,
    findings: overrides.findings ?? [makeFinding()],
  };
}

/** Deterministic-ish shuffle (Fisher-Yates over `Math.random`) — used only
 *  to prove ORDER doesn't depend on input order, never to make a test flaky:
 *  every assertion below compares against a fixed expected value. */
function shuffled<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j] as T, copy[i] as T];
  }
  return copy;
}

describe('REQ-17 — concise omits, detailed carries, the five gated fields', () => {
  const review = makeReview({
    findings: [
      makeFinding({ id: 'f1', severity: 'CRITICAL', file: 'a.ts', start_line: 10, end_line: 12, title: 'Leak' }),
    ],
  });

  it('concise carries exactly severity, file, line, title', () => {
    const result = projectFindings([review], 'concise');
    expect(result.findings).toEqual([{ severity: 'CRITICAL', file: 'a.ts', line: 10, title: 'Leak' }]);
    for (const key of ['id', 'rationale', 'suggestion', 'confidence', 'end_line']) {
      expect(result.findings[0]).not.toHaveProperty(key);
    }
  });

  it('detailed adds id, end_line, rationale, suggestion, confidence', () => {
    const result = projectFindings([review], 'detailed');
    expect(result.findings[0]).toMatchObject({
      severity: 'CRITICAL',
      file: 'a.ts',
      line: 10,
      title: 'Leak',
      id: 'f1',
      end_line: 12,
      rationale: 'because reasons',
      suggestion: 'do this instead',
      confidence: 0.75,
    });
  });
});

describe('REQ-18 — total order and the 20-item cap', () => {
  function findingsFixture(n: number): FindingRow[] {
    const severities = ['CRITICAL', 'WARNING', 'SUGGESTION'] as const;
    const rows: FindingRow[] = [];
    for (let i = 0; i < n; i += 1) {
      rows.push(
        makeFinding({
          id: `f${i}`,
          severity: severities[i % 3],
          file: `src/file-${i % 5}.ts`,
          start_line: (i % 7) + 1,
          // Unique title per (file, start_line) combo guarantees the dedupe
          // key in project.ts is unique too, which is what makes the order
          // provably total (order.ts's own doc comment).
          title: `finding-${i}`,
        }),
      );
    }
    return rows;
  }

  it('produces byte-identical output regardless of input shuffle', () => {
    const rows = findingsFixture(57);
    const baseline = projectFindings([makeReview({ findings: rows })], 'concise');

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const permuted = projectFindings([makeReview({ findings: shuffled(rows) })], 'concise');
      expect(JSON.stringify(permuted)).toBe(JSON.stringify(baseline));
    }
  });

  it('is a strict total order: no two distinct findings in the fixture tie', () => {
    const rows = findingsFixture(57);
    const sorted = [...rows].sort(compareFindings);
    for (let i = 1; i < sorted.length; i += 1) {
      expect(compareFindings(sorted[i - 1] as FindingRow, sorted[i] as FindingRow)).toBeLessThan(0);
    }
  });

  it('sorts CRITICAL before WARNING before SUGGESTION, then file, then start_line, then title', () => {
    const rows = [
      makeFinding({ id: '1', severity: 'SUGGESTION', file: 'b.ts', start_line: 1, title: 'z' }),
      makeFinding({ id: '2', severity: 'CRITICAL', file: 'b.ts', start_line: 5, title: 'a' }),
      makeFinding({ id: '3', severity: 'CRITICAL', file: 'a.ts', start_line: 9, title: 'a' }),
      makeFinding({ id: '4', severity: 'WARNING', file: 'a.ts', start_line: 1, title: 'a' }),
      makeFinding({ id: '5', severity: 'CRITICAL', file: 'a.ts', start_line: 9, title: 'b' }),
    ];
    const result = projectFindings([makeReview({ findings: rows })], 'detailed');
    expect(result.findings.map((f) => f.id)).toEqual(['3', '5', '2', '4', '1']);
  });

  it('with 57 findings, caps shown at 20, reports total 57, and the note names severity and file', () => {
    const rows = findingsFixture(57);
    const result = projectFindings([makeReview({ findings: rows })], 'concise');

    expect(result.shown).toBe(20);
    expect(result.shown).toBe(MAX_FINDINGS);
    expect(result.total).toBe(57);
    expect(result.findings).toHaveLength(20);
    expect(result.note).toBeDefined();
    expect(result.note).toContain('severity');
    expect(result.note).toContain('file');
    expect(result.note).toContain('20');
    expect(result.note).toContain('57');
  });

  it('omits note entirely when nothing was truncated', () => {
    const rows = findingsFixture(5);
    const result = projectFindings([makeReview({ findings: rows })], 'concise');
    expect(result.shown).toBe(5);
    expect(result.total).toBe(5);
    expect(result).not.toHaveProperty('note');
  });
});

describe('REQ-19 — no pagination token anywhere in the output', () => {
  it('the result object carries no nextCursor, cursor, page, or offset key, at any depth', () => {
    const rows = Array.from({ length: 25 }, (_, i) =>
      makeFinding({ id: `f${i}`, file: `x${i}.ts`, title: `t${i}` }),
    );
    const result = projectFindings([makeReview({ findings: rows })], 'detailed');
    const serialized = JSON.stringify(result);
    for (const forbidden of ['nextCursor', 'cursor', 'page', 'offset']) {
      expect(serialized.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });
});

describe('REQ-10 — every projection result validates against its outputSchema', () => {
  it('concise output parses against the shared FindingsOutputShape', () => {
    const rows = Array.from({ length: 30 }, (_, i) => makeFinding({ id: `f${i}`, title: `t${i}` }));
    const result = projectFindings([makeReview({ findings: rows })], 'concise');
    expect(() => FindingsResultSchema.parse(result)).not.toThrow();
  });

  it('detailed output parses against the shared FindingsOutputShape', () => {
    const rows = Array.from({ length: 3 }, (_, i) => makeFinding({ id: `f${i}`, title: `t${i}` }));
    const result = projectFindings([makeReview({ findings: rows })], 'detailed');
    expect(() => FindingsResultSchema.parse(result)).not.toThrow();
  });

  it('an empty review list still validates — zero findings is a legal result', () => {
    const result = projectFindings([], 'concise');
    expect(() => FindingsResultSchema.parse(result)).not.toThrow();
    expect(result).toEqual({ verdict: null, score: null, counts: { critical: 0, warning: 0, suggestion: 0 }, shown: 0, total: 0, findings: [] });
  });
});

describe('projectFindings — the severity/file filter (2026-08-23 remediation, finding 2)', () => {
  it('drops findings that fail the severity filter before dedupe and the cap', () => {
    const rows = [
      makeFinding({ id: 'f1', severity: 'CRITICAL', file: 'a.ts', title: 'kept' }),
      makeFinding({ id: 'f2', severity: 'SUGGESTION', file: 'a.ts', title: 'dropped' }),
    ];
    const result = projectFindings([makeReview({ findings: rows })], 'concise', { severity: 'CRITICAL' });
    expect(result.total).toBe(1);
    expect(result.findings.map((f) => f.title)).toEqual(['kept']);
  });

  it('drops findings that fail the file filter, matching exactly not by substring', () => {
    const rows = [
      makeFinding({ id: 'f1', file: 'src/a.ts', title: 'kept' }),
      makeFinding({ id: 'f2', file: 'src/a.ts.bak', title: 'dropped' }),
    ];
    const result = projectFindings([makeReview({ findings: rows })], 'concise', { file: 'src/a.ts' });
    expect(result.total).toBe(1);
    expect(result.findings.map((f) => f.title)).toEqual(['kept']);
  });

  it('applies no filtering at all when the argument is omitted', () => {
    const rows = [
      makeFinding({ id: 'f1', file: 'a.ts', title: 'one' }),
      makeFinding({ id: 'f2', severity: 'CRITICAL', file: 'b.ts', title: 'two' }),
    ];
    const result = projectFindings([makeReview({ findings: rows })], 'concise');
    expect(result.total).toBe(2);
  });
});

describe('REQ-32 — projectFindings is a pure function', () => {
  it('never mutates the reviews or findings passed in', () => {
    const rows = [makeFinding({ id: 'f1' }), makeFinding({ id: 'f2' })];
    const reviews = [makeReview({ findings: rows })];
    const snapshot = JSON.stringify(reviews);

    projectFindings(reviews, 'detailed');

    expect(JSON.stringify(reviews)).toBe(snapshot);
  });

  it('returns the same output for the same input, called twice', () => {
    const rows = [makeFinding({ id: 'f1' }), makeFinding({ id: 'f2', severity: 'CRITICAL' })];
    const reviews = [makeReview({ findings: rows })];

    const first = projectFindings(reviews, 'detailed');
    const second = projectFindings(reviews, 'detailed');

    expect(first).toEqual(second);
  });
});

describe('Do — dropping dismissed findings and deduplicating across runs', () => {
  it('drops a finding whose dismissed_at is set', () => {
    const rows = [
      makeFinding({ id: 'f1', title: 'kept' }),
      makeFinding({ id: 'f2', title: 'gone', dismissed_at: '2026-08-23T00:00:00Z' }),
    ];
    const result = projectFindings([makeReview({ findings: rows })], 'detailed');
    expect(result.findings.map((f) => f.title)).toEqual(['kept']);
    expect(result.total).toBe(1);
  });

  it('collapses the same finding repeated across two runs into one', () => {
    const repeated = makeFinding({ id: 'run1-f1', file: 'x.ts', start_line: 3, title: 'Same issue' });
    const repeatedAgain = makeFinding({ id: 'run2-f1', file: 'x.ts', start_line: 3, title: 'Same issue' });
    const distinct = makeFinding({ id: 'run2-f2', file: 'y.ts', start_line: 1, title: 'Different issue' });

    const runOne = makeReview({ run_id: 'run-1', findings: [repeated] });
    const runTwo = makeReview({ run_id: 'run-2', findings: [repeatedAgain, distinct] });

    const result = projectFindings([runOne, runTwo], 'detailed');
    expect(result.total).toBe(2);
    expect(result.findings.map((f) => f.title).sort()).toEqual(['Different issue', 'Same issue']);
  });

  it('takes verdict and score from the first (most relevant) review', () => {
    const first = makeReview({ verdict: 'approve', score: 95, findings: [] });
    const second = makeReview({ verdict: 'request_changes', score: 10, findings: [] });
    const result = projectFindings([first, second], 'concise');
    expect(result.verdict).toBe('approve');
    expect(result.score).toBe(95);
  });
});

/**
 * Grouping by agent (`projectFindingsByAgent`).
 *
 * The first test is the regression this function was written for: on PR #7,
 * five CRITICAL findings from the API Contract Reviewer were served under the
 * Performance Reviewer's `approve`/100, because the flat projection reads
 * `verdict`/`score` off `reviews[0]` whatever agent produced it.
 */
describe('projectFindingsByAgent — one group per agent', () => {
  const GroupedResultSchema = z.object(GetFindingsOutput);

  function apiContract(): ReviewProjection {
    return makeReview({
      run_id: 'run-api',
      agent_id: 'agent-api',
      agent_name: 'API Contract Reviewer',
      created_at: '2026-08-23T19:08:25.000Z',
      verdict: 'request_changes',
      score: 0,
      findings: [makeFinding({ id: 'api-1', severity: 'CRITICAL', file: 'routes.ts', start_line: 47, title: 'Envelope' })],
    });
  }

  function performance(): ReviewProjection {
    return makeReview({
      run_id: 'run-perf',
      agent_id: 'agent-perf',
      agent_name: 'Performance Reviewer',
      created_at: '2026-08-23T19:13:21.000Z',
      verdict: 'approve',
      score: 100,
      findings: [],
    });
  }

  it('never lets one agent verdict cover another agent findings', () => {
    const result = projectFindingsByAgent([performance(), apiContract()], 'concise');

    const api = result.agents.find((group) => group.agent_name === 'API Contract Reviewer')!;
    const perf = result.agents.find((group) => group.agent_name === 'Performance Reviewer')!;

    expect(api.verdict).toBe('request_changes');
    expect(api.score).toBe(0);
    expect(api.findings).toHaveLength(1);
    expect(perf.verdict).toBe('approve');
    expect(perf.score).toBe(100);
    expect(perf.findings).toHaveLength(0);
  });

  it('omits the top-level verdict and score when two agents disagree', () => {
    const result = projectFindingsByAgent([performance(), apiContract()], 'concise');
    expect(result).not.toHaveProperty('verdict');
    expect(result).not.toHaveProperty('score');
  });

  it('keeps a top-level verdict and score when only one agent reviewed', () => {
    const result = projectFindingsByAgent([apiContract()], 'concise');
    expect(result.verdict).toBe('request_changes');
    expect(result.score).toBe(0);
  });

  it('keeps the latest review per agent, whichever order the reviews arrive in', () => {
    const older = makeReview({
      run_id: 'run-old',
      created_at: '2026-08-23T10:00:00.000Z',
      verdict: 'approve',
      score: 100,
      findings: [],
    });
    const newer = makeReview({
      run_id: 'run-new',
      created_at: '2026-08-23T19:00:00.000Z',
      verdict: 'request_changes',
      score: 20,
      findings: [makeFinding({ id: 'new-1' })],
    });

    for (const order of [[newer, older], [older, newer]]) {
      const result = projectFindingsByAgent(order, 'concise');
      expect(result.agents).toHaveLength(1);
      expect(result.agents[0]!.verdict).toBe('request_changes');
      expect(result.agents[0]!.total).toBe(1);
    }
  });

  it('reports a finding both agents flagged once per agent, not once overall', () => {
    const shared = { file: 'x.ts', start_line: 3, title: 'Same issue' };
    const first = makeReview({
      agent_id: 'agent-a',
      agent_name: 'A',
      findings: [makeFinding({ id: 'a-1', ...shared })],
    });
    const second = makeReview({
      agent_id: 'agent-b',
      agent_name: 'B',
      findings: [makeFinding({ id: 'b-1', ...shared })],
    });

    const result = projectFindingsByAgent([first, second], 'concise');
    expect(result.agents).toHaveLength(2);
    expect(result.total).toBe(2);
    expect(result.agents.every((group) => group.findings.length === 1)).toBe(true);
  });

  it('still collapses a finding repeated inside one agent review', () => {
    const review = makeReview({
      findings: [
        makeFinding({ id: 'dup-1', file: 'x.ts', start_line: 3, title: 'Same issue' }),
        makeFinding({ id: 'dup-2', file: 'x.ts', start_line: 3, title: 'Same issue' }),
      ],
    });
    const result = projectFindingsByAgent([review], 'concise');
    expect(result.total).toBe(1);
  });

  it('narrows to the selected agent and drops every other group', () => {
    const result = projectFindingsByAgent([performance(), apiContract()], 'concise', {}, {
      agentId: 'agent-api',
      name: 'API Contract Reviewer',
    });

    expect(result.agents).toHaveLength(1);
    expect(result.agents[0]!.agent_id).toBe('agent-api');
    expect(result.agents[0]!.reviewed).toBe(true);
  });

  it('marks a selected agent that never reviewed this pull as reviewed:false, not as zero findings', () => {
    const result = projectFindingsByAgent([apiContract()], 'concise', {}, {
      agentId: 'agent-general',
      name: 'General Reviewer',
    });

    expect(result.agents).toHaveLength(1);
    expect(result.agents[0]).toMatchObject({
      agent_id: 'agent-general',
      agent_name: 'General Reviewer',
      reviewed: false,
      findings: [],
      total: 0,
    });
  });

  it('spends the cap severity-first, so a noisy agent cannot bury a quiet one', () => {
    const noisy = makeReview({
      agent_id: 'agent-noisy',
      agent_name: 'Noisy',
      findings: Array.from({ length: MAX_FINDINGS + 5 }, (_unused, i) =>
        makeFinding({ id: `noisy-${i}`, severity: 'SUGGESTION', file: 'noisy.ts', start_line: i + 1, title: `n${i}` }),
      ),
    });
    const quiet = makeReview({
      agent_id: 'agent-quiet',
      agent_name: 'Quiet',
      findings: [makeFinding({ id: 'quiet-1', severity: 'CRITICAL', file: 'quiet.ts', start_line: 9, title: 'real bug' })],
    });

    const result = projectFindingsByAgent([noisy, quiet], 'concise');
    const quietGroup = result.agents.find((group) => group.agent_name === 'Quiet')!;

    expect(result.shown).toBe(MAX_FINDINGS);
    expect(result.total).toBe(MAX_FINDINGS + 6);
    expect(quietGroup.findings).toHaveLength(1);
    // Verbatim, not `toContain`: the flat note starts with the same words, so a
    // substring check cannot tell the two builders apart — and the half it would
    // miss (the `agent=` lever) is the only reason the grouped builder exists.
    expect(result.note).toBe(buildGroupedTruncationNote(MAX_FINDINGS, MAX_FINDINGS + 6));
    expect(result.note).toContain('across all agents');
  });

  it('keeps a group whose findings were all cut, so its verdict is still visible', () => {
    const noisy = makeReview({
      agent_id: 'agent-noisy',
      agent_name: 'Noisy',
      verdict: 'request_changes',
      findings: Array.from({ length: MAX_FINDINGS }, (_unused, i) =>
        makeFinding({ id: `noisy-${i}`, severity: 'CRITICAL', file: 'noisy.ts', start_line: i + 1, title: `n${i}` }),
      ),
    });
    const quiet = makeReview({
      agent_id: 'agent-quiet',
      agent_name: 'Quiet',
      verdict: 'comment',
      findings: [makeFinding({ id: 'quiet-1', severity: 'SUGGESTION', file: 'quiet.ts', start_line: 9, title: 'nit' })],
    });

    const result = projectFindingsByAgent([noisy, quiet], 'concise');
    const quietGroup = result.agents.find((group) => group.agent_name === 'Quiet')!;

    expect(quietGroup.findings).toHaveLength(0);
    expect(quietGroup.total).toBe(1);
    expect(quietGroup.verdict).toBe('comment');
    // counts are PRE-cap on purpose: a truncated answer still has to say how
    // much work remains, so the cut group reports its finding even though it
    // shows none of them.
    expect(quietGroup.counts).toEqual({ critical: 0, warning: 0, suggestion: 1 });
    expect(result.counts).toEqual({ critical: MAX_FINDINGS, warning: 0, suggestion: 1 });
  });

  it('orders identically however the reviews and findings are shuffled', () => {
    const reviews = [
      apiContract(),
      performance(),
      makeReview({ agent_id: 'agent-c', agent_name: 'C', findings: [makeFinding({ id: 'c-1' })] }),
    ];
    // One FIXED baseline against ten permutations, mirroring the flat test
    // above: comparing two shuffles would let the two draws be the same
    // permutation and pass whatever the function does with input order.
    const baseline = JSON.stringify(projectFindingsByAgent(reviews, 'detailed'));
    for (let attempt = 0; attempt < 10; attempt += 1) {
      expect(JSON.stringify(projectFindingsByAgent(shuffled(reviews), 'detailed'))).toBe(baseline);
    }
  });

  /** `makeReview` defaults every field with `??`, which silently swallows a
   *  null override — so the one shape these two tests are about cannot be
   *  built through it. */
  function unattributed(finding: FindingRow): ReviewProjection {
    return {
      run_id: null,
      agent_id: null,
      agent_name: null,
      created_at: '2026-08-23T10:00:00.000Z',
      verdict: 'request_changes',
      score: 42,
      findings: [finding],
    };
  }

  it('keeps two unattributed reviews in separate groups instead of collapsing them', () => {
    // Both ids null is the one case the bucket fallback exists for: keying on
    // the interpolation of a null put every such review in one "run:null"
    // bucket and dropped all but the newest.
    const first = unattributed(makeFinding({ id: 'u-1', file: 'a.ts', start_line: 1, title: 'first' }));
    const second = unattributed(makeFinding({ id: 'u-2', file: 'b.ts', start_line: 2, title: 'second' }));

    const result = projectFindingsByAgent([first, second], 'concise');

    expect(result.agents).toHaveLength(2);
    expect(result.total).toBe(2);
    expect(result.agents.every((group) => group.agent_id === null)).toBe(true);
  });

  it('is repeatable for unattributed groups, which can only be ordered by position', () => {
    const twin = (id: string, file: string) =>
      unattributed(makeFinding({ id, file, start_line: 1, title: 'same severity' }));
    const reviews = [twin('t-1', 'a.ts'), twin('t-2', 'b.ts')];

    // Two reviews with no agent_id and no run_id are indistinguishable except
    // by where they sit in the array, so the order-INDEPENDENCE asserted for
    // attributed groups above is unreachable here — there is nothing to order
    // them by. What IS guaranteed: the same input always yields the same body,
    // and input order decides, rather than Map iteration accident.
    const first = JSON.stringify(projectFindingsByAgent(reviews, 'concise'));
    const second = JSON.stringify(projectFindingsByAgent(reviews, 'concise'));
    expect(second).toBe(first);
    expect(projectFindingsByAgent(reviews, 'concise').agents.map((g) => g.findings[0]!.file)).toEqual([
      'a.ts',
      'b.ts',
    ]);
  });

  it('validates against the shape get_findings actually registers', () => {
    for (const format of ['concise', 'detailed'] as const) {
      const grouped =
        format === 'detailed'
          ? projectFindingsByAgent([apiContract(), performance()], 'detailed')
          : projectFindingsByAgent([apiContract(), performance()], 'concise');
      expect(() => GroupedResultSchema.parse(grouped)).not.toThrow();
    }
    expect(() => GroupedResultSchema.parse(projectFindingsByAgent([], 'concise'))).not.toThrow();
  });

  it('gates the detailed fields on response_format, and leaks no domain field either way', () => {
    // `GroupedResultSchema.parse` cannot carry this: every field is optional, so
    // `{}` passes; zod STRIPS an unknown key rather than rejecting it; and the
    // findings union resolves to the concise member first, so the detailed half
    // would assert nothing. Only explicit key checks pin REQ-17.
    const concise = projectFindingsByAgent([apiContract()], 'concise');
    const detailed = projectFindingsByAgent([apiContract()], 'detailed');

    const conciseFinding = concise.agents[0]!.findings[0]!;
    for (const gated of ['id', 'end_line', 'rationale', 'suggestion', 'confidence']) {
      expect(conciseFinding).not.toHaveProperty(gated);
    }

    const detailedFinding = detailed.agents[0]!.findings[0]!;
    expect(detailedFinding).toMatchObject({
      id: 'api-1',
      end_line: 2,
      rationale: 'because reasons',
      suggestion: 'do this instead',
      confidence: 0.75,
    });

    // The group itself is model-facing too: no run id, no internal sort key.
    for (const domainField of ['run_id', 'review_id', 'created_at', 'agentKey', 'capped']) {
      expect(concise.agents[0]!).not.toHaveProperty(domainField);
    }
  });

  it('does not mutate the reviews it was given', () => {
    const reviews = [apiContract(), performance()];
    const snapshot = JSON.stringify(reviews);
    projectFindingsByAgent(reviews, 'detailed');
    expect(JSON.stringify(reviews)).toBe(snapshot);
  });
});
