import type { Finding, Review, Severity } from '@devdigest/shared';

/** ANSI helpers. Disabled (identity) when color is off (piped output / --no-color). */
type Paint = (s: string) => string;
const code = (n: string): Paint => (s) => `\x1b[${n}m${s}\x1b[0m`;
const identity: Paint = (s) => s;

interface Palette {
  dim: Paint;
  bold: Paint;
  red: Paint;
  yellow: Paint;
  blue: Paint;
  green: Paint;
  underline: Paint;
}
function palette(color: boolean): Palette {
  if (!color) {
    return { dim: identity, bold: identity, red: identity, yellow: identity, blue: identity, green: identity, underline: identity };
  }
  return {
    dim: code('2'),
    bold: code('1'),
    red: code('31'),
    yellow: code('33'),
    blue: code('34'),
    green: code('32'),
    underline: code('4'),
  };
}

/** Severity → glyph + colorizer + sort rank (blockers first). */
const SEV_META: Record<Severity, { glyph: string; rank: number; paint: keyof Palette }> = {
  CRITICAL: { glyph: '✖', rank: 3, paint: 'red' },
  WARNING: { glyph: '▲', rank: 2, paint: 'yellow' },
  SUGGESTION: { glyph: '•', rank: 1, paint: 'blue' },
};

export interface RenderOptions {
  mode: string;
  /** Emit ANSI color. Callers pass `process.stdout.isTTY`. */
  color?: boolean;
}

/** One finding block: "✖ CRITICAL  file:line — title" + indented rationale/suggestion. */
function renderFinding(f: Finding, p: Palette): string {
  const meta = SEV_META[f.severity];
  const paint = p[meta.paint];
  const loc = f.start_line === f.end_line ? `${f.file}:${f.start_line}` : `${f.file}:${f.start_line}-${f.end_line}`;
  const head = `${paint(meta.glyph)} ${paint(p.bold(f.severity))}  ${p.underline(loc)} ${p.dim('—')} ${f.title}`;
  const lines = [head, `    ${p.dim(f.rationale.trim())}`];
  if (f.suggestion) lines.push(`    ${p.green('→')} ${f.suggestion.trim()}`);
  return lines.join('\n');
}

/**
 * Render a grounded Review as a terminal report. Pure (no I/O, no process) so it
 * is fully unit-testable. Empty findings → an explicit "no issues" state (never
 * a blank screen). Findings are ordered blockers-first, then by confidence.
 */
export function renderReview(review: Review, opts: RenderOptions): string {
  const p = palette(opts.color ?? false);
  const findings = [...review.findings].sort(
    (a, b) => SEV_META[b.severity].rank - SEV_META[a.severity].rank || b.confidence - a.confidence,
  );

  const counts: Record<Severity, number> = { CRITICAL: 0, WARNING: 0, SUGGESTION: 0 };
  for (const f of review.findings) counts[f.severity]++;

  const header = p.bold(`DevDigest review — ${opts.mode} tree`);
  if (findings.length === 0) {
    return [
      header,
      p.green('✔ No issues found in the working tree.'),
      p.dim(`  score ${review.score}/100`),
      '',
    ].join('\n');
  }

  const body = findings.map((f) => renderFinding(f, p)).join('\n\n');
  const summary =
    `${p.red(`${counts.CRITICAL} critical`)} · ` +
    `${p.yellow(`${counts.WARNING} warning`)} · ` +
    `${p.blue(`${counts.SUGGESTION} suggestion`)} · ` +
    p.dim(`score ${review.score}/100`);

  return [header, '', body, '', p.dim('─'.repeat(48)), summary, ''].join('\n');
}
