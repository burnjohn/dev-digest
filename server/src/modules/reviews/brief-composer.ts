/**
 * brief-composer — deterministic live PR Brief assembly (L04). ZERO LLM calls.
 *
 * Pure functions: all inputs are gathered by the caller (run-executor) —
 * intent from `pr_intent`, blast+history from `container.blast.getBlast()`,
 * risks derived mechanically from the run's kept findings.
 */
import type {
  BlastResponse,
  Finding,
  Intent,
  PrBrief,
  Risk,
  Risks,
} from '@devdigest/shared';

/** Cap so the RISK AREAS chip row stays scannable. CRITICAL findings first. */
const MAX_RISKS = 6;

/** How much of a finding's rationale goes into the risk explanation/tooltip. */
const MAX_EXPLANATION_CHARS = 200;

/**
 * Deterministic risk derivation: every CRITICAL/WARNING finding becomes a
 * Risk chip (kind = finding category → drives the chip icon). SUGGESTIONs are
 * not risks. Deduped by title, CRITICAL first, capped at MAX_RISKS.
 */
export function composeRisks(findings: readonly Finding[]): Risks {
  const ordered = [
    ...findings.filter((f) => f.severity === 'CRITICAL'),
    ...findings.filter((f) => f.severity === 'WARNING'),
  ];

  const risks: Risk[] = [];
  const seenTitles = new Set<string>();
  for (const f of ordered) {
    if (risks.length >= MAX_RISKS) break;
    if (seenTitles.has(f.title)) continue;
    seenTitles.add(f.title);
    risks.push({
      kind: f.category,
      title: f.title,
      explanation:
        f.rationale.length > MAX_EXPLANATION_CHARS
          ? `${f.rationale.slice(0, MAX_EXPLANATION_CHARS - 1)}…`
          : f.rationale,
      severity: f.severity === 'CRITICAL' ? 'high' : 'medium',
      file_refs: [`${f.file}:${f.start_line}`],
    });
  }
  return { risks };
}

const EMPTY_INTENT: Intent = { intent: '', in_scope: [], out_of_scope: [] };

/**
 * Compose the full PrBrief from live sources. Blast/history come straight from
 * the blast endpoint's assembly (`BlastResponse`); when the blast is
 * unavailable an empty-but-valid shape is stored so the brief still parses.
 */
export function composePrBrief(input: {
  intent: Intent | undefined;
  blastResponse: BlastResponse;
  findings: readonly Finding[];
}): PrBrief {
  return {
    intent: input.intent ?? EMPTY_INTENT,
    blast:
      input.blastResponse.blast ?? {
        changed_symbols: [],
        downstream: [],
        summary: '',
      },
    risks: composeRisks(input.findings),
    history: input.blastResponse.history,
  };
}
