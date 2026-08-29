import { describe, it, expect } from 'vitest';
import {
  EvalExpectationKind,
  EvalExpectedFinding,
  EvalForbiddenRegion,
  EvalCaseSource,
  EvalCaseRecord,
  EvalCaseDraft,
  EvalCaseWrite,
  EvalCaseRunResult,
  EvalAblationOutput,
  EvalAblationWithoutArm,
  EvalBatchRecord,
  EvalBatchDetail,
  EvalBatchComparison,
  EvalPromptDiffLine,
  EvalOwnerDashboard,
  EvalTrendSeriesPoint,
} from '@devdigest/shared';

/**
 * SPEC-03 eval-batch contract tests — parse a representative fixture per shape
 * and prove a `null` metric survives (AC-25), plus the without-arm's two
 * unavailable variants and the metrics object all parse through one union
 * (AC-64/AC-65).
 */
describe('eval-batch contracts', () => {
  it('EvalExpectationKind + EvalExpectedFinding + EvalForbiddenRegion parse', () => {
    expect(EvalExpectationKind.parse('must_find')).toBe('must_find');
    expect(EvalExpectationKind.parse('must_not_flag')).toBe('must_not_flag');

    const finding = EvalExpectedFinding.parse({
      severity: 'CRITICAL',
      category: 'security',
      title: 'Hardcoded secret',
      start_line: 12,
      end_line: 12,
      file: 'src/config.ts',
    });
    expect(finding.file).toBe('src/config.ts');

    // file omitted — legal for a skill-owned case (AC-55); server fills it in.
    const skillFinding = EvalExpectedFinding.parse({
      severity: 'WARNING',
      category: 'style',
      title: 'Missing null check',
      start_line: 1,
      end_line: 3,
    });
    expect(skillFinding.file).toBeUndefined();

    const region = EvalForbiddenRegion.parse({
      file: 'src/config.ts',
      start_line: 12,
      end_line: 12,
    });
    expect(region.file).toBe('src/config.ts');
  });

  it('EvalCaseSource discriminates new_file vs modified_file', () => {
    const newFile = EvalCaseSource.parse({
      kind: 'new_file',
      filename: 'snippet.ts',
      after: 'export const x = 1;',
    });
    expect(newFile.kind).toBe('new_file');

    const modified = EvalCaseSource.parse({
      kind: 'modified_file',
      filename: 'snippet.ts',
      before: 'export const x = 1;',
      after: 'export const x = 2;',
    });
    expect(modified.kind).toBe('modified_file');
  });

  it('EvalCaseRecord parses a representative agent-owned case, notes survives null', () => {
    const record = EvalCaseRecord.parse({
      id: 'case-1',
      owner_kind: 'agent',
      owner_id: 'agent-1',
      name: 'stripe-key-leak',
      expectation_kind: 'must_find',
      input_diff: '--- a/x\n+++ b/x\n@@ -1 +1 @@\n-old\n+new\n',
      input_files: null,
      input_meta: null,
      expected_output: [
        {
          severity: 'CRITICAL',
          category: 'security',
          title: 'Hardcoded secret',
          start_line: 1,
          end_line: 1,
          file: 'x',
        },
      ],
      forbidden_regions: null,
      filename: null,
      notes: null,
    });
    expect(record.expectation_kind).toBe('must_find');
    expect(record.input_files).toBeNull();
  });

  it('EvalCaseRecord parses a must_not_flag case with an empty expected_output', () => {
    const record = EvalCaseRecord.parse({
      id: 'case-2',
      owner_kind: 'skill',
      owner_id: 'skill-1',
      name: 'clean-refactor-no-flags',
      expectation_kind: 'must_not_flag',
      input_diff: '--- a/snippet.ts\n+++ b/snippet.ts\n@@ -0,0 +1,3 @@\n+line1\n+line2\n+line3\n',
      input_files: {
        kind: 'new_file',
        filename: 'snippet.ts',
        after: 'line1\nline2\nline3',
      },
      input_meta: null,
      expected_output: [],
      forbidden_regions: null,
      filename: 'snippet.ts',
      notes: null,
    });
    expect(record.expected_output).toHaveLength(0);
  });

  it('EvalCaseDraft parses a finding-seeded draft', () => {
    const draft = EvalCaseDraft.parse({
      owner_kind: 'agent',
      owner_id: 'agent-1',
      name: 'From finding: Hardcoded secret',
      input_diff: '--- a/x\n+++ b/x\n@@ -1 +1 @@\n-old\n+new\n',
      expected_output: [
        {
          severity: 'CRITICAL',
          category: 'security',
          title: 'Hardcoded secret',
          start_line: 1,
          end_line: 1,
          file: 'x',
        },
      ],
      forbidden_regions: null,
    });
    expect(draft.name).toContain('From finding');
  });

  it('EvalCaseWrite parses a minimal skill-owned write payload', () => {
    const write = EvalCaseWrite.parse({
      owner_kind: 'skill',
      owner_id: 'skill-1',
      name: 'ssrf-webhook',
      input_files: { kind: 'new_file', filename: 'snippet.ts', after: 'x' },
      expected_output: [],
      forbidden_regions: null,
    });
    expect(write.name).toBe('ssrf-webhook');
  });

  it('EvalAblationOutput: with arm, metrics without arm, and both unavailable variants all parse', () => {
    const withMetrics = EvalAblationOutput.parse({
      with: { recall: 0.5, precision: null, citation_accuracy: 1, findings: [] },
      without: { recall: null, findings: [] },
    });
    expect(withMetrics.without).toEqual({ recall: null, findings: [] });

    const notRun = EvalAblationWithoutArm.parse({ unavailable: 'not_run' });
    expect(notRun).toEqual({ unavailable: 'not_run' });

    const errored = EvalAblationWithoutArm.parse({ unavailable: 'errored', reason: 'x' });
    expect(errored).toEqual({ unavailable: 'errored', reason: 'x' });

    const full = EvalAblationOutput.parse({
      with: { recall: 1, precision: 1, citation_accuracy: 1, findings: [] },
      without: { unavailable: 'errored', reason: 'x' },
    });
    expect(full.without).toEqual({ unavailable: 'errored', reason: 'x' });
  });

  it('EvalCaseRunResult parses with every metric field null', () => {
    const result = EvalCaseRunResult.parse({
      run_id: 'run-1',
      case_id: 'case-1',
      ran_at: '2026-08-28T00:00:00.000Z',
      pass: null,
      recall: null,
      precision: null,
      citation_accuracy: null,
      actual_output: { findings: [] },
      ablation: null,
      duration_ms: null,
      cost_usd: null,
    });
    expect(result.recall).toBeNull();
    expect(result.ablation).toBeNull();
  });

  it('EvalBatchRecord + EvalBatchDetail parse with null metrics', () => {
    const batch = EvalBatchRecord.parse({
      id: 'batch-1',
      owner_kind: 'agent',
      owner_id: 'agent-1',
      owner_version: 3,
      runner_agent_id: null,
      runner_agent_version: null,
      started_at: '2026-08-28T00:00:00.000Z',
      finished_at: null,
      status: 'running',
      recall: null,
      precision: null,
      citation_accuracy: null,
      cases_passed: 0,
      cases_total: 5,
      cost_usd: null,
    });
    expect(batch.status).toBe('running');

    const detail = EvalBatchDetail.parse({
      ...batch,
      cases: [
        {
          case_id: 'case-1',
          case_name: 'stripe-key-leak',
          errored: false,
          pass: null,
          recall: null,
          precision: null,
          citation_accuracy: null,
          skill_lift: null,
        },
      ],
    });
    expect(detail.cases).toHaveLength(1);
  });

  it('EvalBatchComparison + EvalPromptDiffLine parse', () => {
    const older = EvalBatchRecord.parse({
      id: 'batch-1',
      owner_kind: 'agent',
      owner_id: 'agent-1',
      owner_version: 2,
      runner_agent_id: null,
      runner_agent_version: null,
      started_at: '2026-08-27T00:00:00.000Z',
      finished_at: '2026-08-27T00:05:00.000Z',
      status: 'succeeded',
      recall: 0.8,
      precision: 0.9,
      citation_accuracy: 0.95,
      cases_passed: 17,
      cases_total: 20,
      cost_usd: 0.23,
    });
    const newer = EvalBatchRecord.parse({ ...older, id: 'batch-2', owner_version: 3 });

    const comparison = EvalBatchComparison.parse({
      older,
      newer,
      recall: { old: 0.8, new: 0.82, delta: 0.02 },
      precision: { old: 0.9, new: 0.88, delta: -0.02 },
      citation_accuracy: { old: 0.95, new: 0.95, delta: 0 },
      cost_usd: { old: 0.23, new: 0.21, delta: -0.02 },
      same_version: false,
      prompt_diff: [
        { op: 'same', text: 'You are a reviewer.' },
        { op: 'add', text: 'Flag unused imports as suggestions.' },
      ],
    });
    expect(comparison.prompt_diff).toHaveLength(2);
    EvalPromptDiffLine.parse(comparison.prompt_diff![0]);
  });

  it('EvalOwnerDashboard + EvalTrendSeriesPoint parse with null alert/latest_batch', () => {
    const point = EvalTrendSeriesPoint.parse({
      metric: 'recall',
      batch_id: 'batch-1',
      finished_at: '2026-08-27T00:05:00.000Z',
      value: null,
    });
    expect(point.value).toBeNull();

    const dashboard = EvalOwnerDashboard.parse({
      owner_kind: 'agent',
      owner_id: 'agent-1',
      cases_total: 0,
      latest_batch: null,
      delta: { recall: null, precision: null, citation_accuracy: null },
      trend: [point],
      recent_batches: [],
      alert: null,
    });
    expect(dashboard.latest_batch).toBeNull();
    expect(dashboard.alert).toBeNull();
  });
});
