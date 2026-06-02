import type { UnifiedDiff } from '@devdigest/shared';
import type { Conflict } from '@devdigest/shared/contracts/observability';

/**
 * A5 — runs module pure helpers (extracted from service/curator/conflicts/trifecta).
 * All functions here are pure + deterministic (no I/O, no container access).
 */

// ---- General formatting ----------------------------------------------------

/** Truncate `s` to `n` chars, appending an ellipsis when shortened. */
export function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

// ---- Conflict scoring (conflicts.ts) ---------------------------------------

/** Bucket key for a contended location (file + line). */
export function locKey(file: string, line: number): string {
  return `${file}:${line}`;
}

/** Contention score for ordering conflicts (more-divergent takes rank higher). */
export function contention(c: Conflict): number {
  const flagged = c.takes.filter((t) => t.verdict !== 'ignored').length;
  const ignored = c.takes.length - flagged;
  return Math.min(flagged, ignored) * 10 + flagged;
}

// ---- Cost / latency aggregation (service.ts) -------------------------------

/** Sum a list of optional costs; null when ANY entry is null (cost unknown). */
export function sumCostsOrNull(costs: (number | null | undefined)[]): number | null {
  return costs.some((c) => c == null) ? null : costs.reduce<number>((n, c) => n + (c ?? 0), 0);
}

/** Arithmetic mean of a non-empty number list, else null. */
export function average(values: number[]): number | null {
  return values.length > 0 ? values.reduce((n, v) => n + v, 0) / values.length : null;
}

/** Rounded mean (e.g. average latency ms), else null. */
export function averageRounded(values: number[]): number | null {
  const avg = average(values);
  return avg == null ? null : Math.round(avg);
}

// ---- Memory curator math (curator.ts) --------------------------------------

/** Cosine similarity of two embedding vectors (0 when either is zero-length). */
export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Rank a memory row for "keep the strongest": confidence first, then recency. */
export function rank(m: { confidence: number | null; createdAt: Date }): number {
  return (m.confidence ?? 0) * 1e13 + m.createdAt.getTime();
}

/** Coerce an unknown `sources` value to a provenance array. */
export function asSources(s: unknown): { pr?: number | null; context?: string }[] {
  if (Array.isArray(s)) return s as { pr?: number | null; context?: string }[];
  return [];
}

/** De-duplicate provenance sources by (pr, context). */
export function dedupeSources(
  sources: { pr?: number | null; context?: string }[],
): { pr?: number | null; context?: string }[] {
  const seen = new Set<string>();
  const out: { pr?: number | null; context?: string }[] = [];
  for (const s of sources) {
    const key = `${s.pr ?? ''}|${s.context ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

// ---- Diff scanning (trifecta.ts) -------------------------------------------

/** Walk a unified diff's added (`+`) lines for one file, tracking new-file line numbers. */
export function collectAddedLines(diff: UnifiedDiff, path: string): { line: number; text: string }[] {
  const out: { line: number; text: string }[] = [];
  const lines = diff.raw.split('\n');
  let capture = false;
  let newLineNo = 0;
  for (const raw of lines) {
    if (raw.startsWith('diff --git')) {
      capture = raw.includes(`b/${path}`) || raw.includes(` ${path}`);
      continue;
    }
    if (!capture) continue;
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (hunk) {
      newLineNo = parseInt(hunk[1]!, 10);
      continue;
    }
    if (raw.startsWith('+++') || raw.startsWith('---')) continue;
    if (raw.startsWith('+')) {
      out.push({ line: newLineNo, text: raw.slice(1) });
      newLineNo++;
    } else if (raw.startsWith('-')) {
      /* removed line: does not advance new-file counter */
    } else {
      newLineNo++;
    }
  }
  return out;
}
