/**
 * Global test setup for the mcp package.
 *
 * vi.mock() hoisting means the actual mock registration is done in each test
 * file (Vitest hoists vi.mock calls to the top of the file). This setup file
 * provides shared typed helpers and a global beforeEach to clear all mocks.
 */

import { vi, beforeEach } from 'vitest';
import type { ApiResult, RunSummary } from '../src/api-client.js';
import type {
  Agent,
  PrMeta,
  ReviewRecord,
  Convention,
  PrBrief,
  ReviewRunResponse,
} from '@devdigest/shared';

// Re-export typed mock-return helpers so individual test files can use them
// without repeating the type annotations.

export function makeOk<T>(data: T): ApiResult<T> {
  return { ok: true, data };
}

export function makeErr(
  code: string,
  message: string,
): ApiResult<never> {
  return { ok: false, code, message };
}

// Fixture factories ──────────────────────────────────────────────────────────

export function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
    name: 'Test Agent',
    description: 'A test agent',
    provider: 'openai',
    model: 'gpt-4',
    system_prompt: 'You are a code reviewer.',
    enabled: true,
    version: 1,
    strategy: 'single-pass',
    ci_fail_on: 'critical',
    repo_intel: true,
    ...overrides,
  };
}

export function makePrMeta(overrides: Partial<PrMeta> = {}): PrMeta {
  return {
    id: 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb',
    number: 1,
    title: 'Test PR',
    author: 'alice',
    branch: 'feature/test',
    base: 'main',
    head_sha: 'abc123',
    additions: 10,
    deletions: 5,
    files_count: 2,
    status: 'open',
    ...overrides,
  };
}

export function makeRunSummary(overrides: Partial<RunSummary> = {}): RunSummary {
  return {
    run_id: 'cccccccc-cccc-4ccc-cccc-cccccccccccc',
    agent_id: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
    agent_name: 'Test Agent',
    provider: 'openai',
    model: 'gpt-4',
    status: 'running',
    error: null,
    duration_ms: null,
    tokens_in: null,
    tokens_out: null,
    findings_count: null,
    grounding: null,
    ran_at: null,
    score: null,
    blockers: null,
    cost_usd: null,
    findings_breakdown: null,
    ...overrides,
  };
}

export function makeReviewRecord(overrides: Partial<ReviewRecord> = {}): ReviewRecord {
  return {
    id: 'dddddddd-dddd-4ddd-dddd-dddddddddddd',
    pr_id: 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb',
    agent_id: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
    run_id: 'cccccccc-cccc-4ccc-cccc-cccccccccccc',
    agent_name: 'Test Agent',
    kind: 'review',
    verdict: 'approve',
    summary: 'Looks good.',
    score: 85,
    model: 'gpt-4',
    grounding: null,
    created_at: '2026-06-30T00:00:00.000Z',
    findings: [],
    ...overrides,
  };
}

export function makeFinding(
  severity: 'CRITICAL' | 'WARNING' | 'SUGGESTION' = 'WARNING',
  idSuffix = '1',
) {
  return {
    id: `finding-${idSuffix}`,
    review_id: 'dddddddd-dddd-4ddd-dddd-dddddddddddd',
    severity,
    category: 'bug' as const,
    title: `${severity} finding ${idSuffix}`,
    file: 'src/foo.ts',
    start_line: 1,
    end_line: 5,
    rationale: 'This is a rationale.',
    confidence: 0.9,
    accepted_at: null,
    dismissed_at: null,
  };
}

export function makeConvention(
  status: Convention['status'] = 'accepted',
  overrides: Partial<Convention> = {},
): Convention {
  return {
    id: 'eeeeeeee-eeee-4eee-eeee-eeeeeeeeeeee',
    workspace_id: 'ws-1',
    repo_id: 'repo-1',
    rule: 'Use consistent naming.',
    category: 'style',
    status,
    accepted: status === 'accepted' || status === 'verified',
    created_at: '2026-06-30T00:00:00.000Z',
    ...overrides,
  };
}

export function makePrBrief(): PrBrief {
  return {
    intent: {
      intent: 'Add caching layer',
      in_scope: ['src/cache.ts'],
      out_of_scope: ['src/db.ts'],
    },
    blast: {
      summary: 'Affects cache consumers.',
      changed_symbols: [
        { name: 'getCache', file: 'src/cache.ts', kind: 'function' },
        { name: 'setCache', file: 'src/cache.ts', kind: 'function' },
      ],
      downstream: [
        {
          symbol: 'useCache',
          callers: [
            { name: 'ComponentA', file: 'src/a.ts', line: 10 },
            { name: 'ComponentB', file: 'src/b.ts', line: 20 },
          ],
          endpoints_affected: ['/api/data'],
          crons_affected: [],
        },
        {
          symbol: 'fetchWithCache',
          callers: [
            { name: 'ServiceX', file: 'src/x.ts', line: 5 },
          ],
          endpoints_affected: [],
          crons_affected: ['nightly-sync'],
        },
      ],
    },
    risks: { risks: [] },
    history: { history: [] },
  };
}

export function makeReviewRunResponse(runId: string): ReviewRunResponse {
  return {
    pr_id: 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb',
    runs: [
      {
        run_id: runId,
        agent_id: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
        agent_name: 'Test Agent',
      },
    ],
    reviews: [],
  };
}

// ── CallToolResult text extractor ───────────────────────────────────────────
// CallToolResult.content is a union of TextContent | ImageContent | ...
// In tests we always produce text content via jsonResult/errorResult.
// This helper narrows the union for TypeScript without casting at every callsite.

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export function getResultText(result: CallToolResult, index = 0): string {
  const block = result.content[index];
  if (!block || block.type !== 'text') {
    throw new Error(`Expected text content at index ${index}, got ${block?.type ?? 'undefined'}`);
  }
  return block.text;
}

// Global beforeEach: clear all mocks so each test starts fresh.
beforeEach(() => {
  vi.clearAllMocks();
});
