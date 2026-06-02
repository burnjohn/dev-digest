import type { Finding } from '@devdigest/shared';
import { METRIC_ROUND_DP } from './constants.js';

/** Round a metric to the configured precision. */
export function round(n: number): number {
  const f = 10 ** METRIC_ROUND_DP;
  return Math.round(n * f) / f;
}

/** Normalize a finding file path for comparison (strip a/ b/ ./ prefixes, lowercase). */
export function normPath(p: string): string {
  return p.replace(/^[ab]\//, '').replace(/^\.\//, '').toLowerCase();
}

/** Parse the expected_output (array of partial findings, or { findings: [...] }) into a list. */
export function expectedFindings(expected: unknown): Partial<Finding>[] {
  if (Array.isArray(expected)) return expected as Partial<Finding>[];
  if (expected && typeof expected === 'object') {
    const obj = expected as { findings?: unknown };
    if (Array.isArray(obj.findings)) return obj.findings as Partial<Finding>[];
  }
  return [];
}
