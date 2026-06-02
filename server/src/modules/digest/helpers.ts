import { SEVERITY_KEYS } from './constants.js';

/** A finding row (subset) used for digest tallies. */
export interface DigestFinding {
  severity: string;
  acceptedAt: Date | null;
  dismissedAt: Date | null;
}

/** Tally findings into severity buckets (unknown severities are ignored). */
export function tallyBySeverity(findings: DigestFinding[]): Record<string, number> {
  const bySeverity: Record<string, number> = { CRITICAL: 0, WARNING: 0, SUGGESTION: 0 };
  for (const f of findings) {
    if ((SEVERITY_KEYS as readonly string[]).includes(f.severity)) {
      bySeverity[f.severity] = (bySeverity[f.severity] ?? 0) + 1;
    }
  }
  return bySeverity;
}

/** Stats summarised for one digest window. */
export interface DigestStats {
  reviewCount: number;
  runCount: number;
  findingsCount: number;
  bySeverity: Record<string, number>;
  accepted: number;
  dismissed: number;
  totalCost: number;
  start: Date;
  end: Date;
}

/** Render the weekly-digest markdown body from window stats. */
export function buildDigestMarkdown(stats: DigestStats): string {
  const { bySeverity, accepted, dismissed } = stats;
  return [
    `# DevDigest — Weekly summary`,
    ``,
    `**Period:** ${stats.start.toISOString().slice(0, 10)} → ${stats.end.toISOString().slice(0, 10)}`,
    ``,
    `- **Reviews:** ${stats.reviewCount}`,
    `- **Agent runs:** ${stats.runCount}`,
    `- **Findings:** ${stats.findingsCount} (🔴 ${bySeverity.CRITICAL} · 🟡 ${bySeverity.WARNING} · 🔵 ${bySeverity.SUGGESTION})`,
    `- **Accepted / Dismissed:** ${accepted} / ${dismissed}`,
    `- **Estimated cost:** $${stats.totalCost.toFixed(2)}`,
    ``,
    accepted + dismissed > 0
      ? `Accept-rate this week: **${Math.round((accepted / (accepted + dismissed)) * 100)}%**.`
      : `No findings were acted on this week.`,
  ].join('\n');
}
