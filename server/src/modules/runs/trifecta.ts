import type { Container } from '../../platform/container.js';
import type {
  Finding,
  RunEventKind,
  RunLogLine,
  TrifectaComponent,
  TrifectaEvidence,
  UnifiedDiff,
} from '@devdigest/shared';
import { eq } from 'drizzle-orm';
import * as t from '../../db/schema.js';
import { buildRunTrace, emptyPromptAssembly } from '../../platform/trace-builder.js';
import {
  SNIPPET_MAX_LEN,
  TRIFECTA_AGENT_NAME,
  TRIFECTA_LEG_ORDER,
  TRIFECTA_PATTERNS,
} from './constants.js';
import { collectAddedLines } from './helpers.js';

/**
 * A5 — Lethal-Trifecta detector. A BUILT-IN agent/detector (not an LLM agent):
 * it scans a PR's added diff lines for the three trifecta legs —
 *   1. private_data_access  (secrets / tokens / private API access)
 *   2. untrusted_input      (request/webhook/callback-derived input)
 *   3. exfil_path           (outbound network sink)
 * When all three appear in the SAME file it emits a `lethal_trifecta` finding
 * (a full-file kind → grounding-exempt beyond "file is in the diff", §8).
 *
 * It writes its OWN agent_runs row + ONE run_traces document (via the shared
 * trace builder) and streams events on the runBus, exactly like a real agent —
 * so the Trace drawer and Per-agent Stats treat it uniformly. It does NOT touch
 * A2's reviewer.
 */

interface LegMatch {
  component: TrifectaComponent;
  file: string;
  line: number;
  snippet: string;
}

export interface TrifectaScanResult {
  findings: Finding[];
  matchesByFile: Map<string, LegMatch[]>;
}

/** Pure scan: walk added (`+`) lines per file, tag trifecta legs. */
export function scanTrifecta(diff: UnifiedDiff): TrifectaScanResult {
  const matchesByFile = new Map<string, LegMatch[]>();

  for (const file of diff.files) {
    // Use parsed hunks when present; else fall back to raw added lines.
    const lines = collectAddedLines(diff, file.path);
    for (const { line, text } of lines) {
      for (const p of TRIFECTA_PATTERNS) {
        if (p.re.test(text)) {
          const arr = matchesByFile.get(file.path) ?? [];
          arr.push({ component: p.component, file: file.path, line, snippet: text.trim().slice(0, SNIPPET_MAX_LEN) });
          matchesByFile.set(file.path, arr);
        }
      }
    }
  }

  const findings: Finding[] = [];
  let idx = 0;
  for (const [file, matches] of matchesByFile) {
    const present = new Set(matches.map((m) => m.component));
    if (present.size < 3) continue; // need all three legs in one file
    const components = [...present] as TrifectaComponent[];
    const evidence: TrifectaEvidence[] = TRIFECTA_LEG_ORDER
      .map((c) => matches.find((m) => m.component === c))
      .filter((m): m is LegMatch => !!m)
      .map((m) => ({ component: m.component, file: m.file, line: m.line }));
    const firstLine = evidence.reduce((min, e) => Math.min(min, e.line), Number.MAX_SAFE_INTEGER);
    findings.push({
      id: `trifecta-${idx++}`,
      severity: 'CRITICAL',
      category: 'security',
      title: 'Lethal trifecta: private data + untrusted input + exfil path',
      file,
      start_line: Number.isFinite(firstLine) ? firstLine : 1,
      end_line: Number.isFinite(firstLine) ? firstLine : 1,
      rationale:
        'All three legs of the lethal trifecta appear in this file: access to private data, ' +
        'an untrusted input source, and an outbound exfiltration path. Combined, an attacker ' +
        'can steer private data to an attacker-controlled destination.',
      suggestion:
        'Break at least one leg: gate the outbound call to an allowlist, drop the secret from ' +
        'the request path, or treat the external input as data (never as a destination).',
      confidence: 0.7,
      kind: 'lethal_trifecta',
      trifecta_components: components,
      evidence,
    });
  }

  return { findings, matchesByFile };
}

export class TrifectaDetector {
  constructor(private container: Container) {}

  /**
   * Run the detector against a PR diff. Persists an `agent_runs` row + ONE
   * `run_traces` doc and (optionally) a `reviews`+`findings` set, streaming on
   * the runBus. Returns the created runId and the findings.
   */
  async run(
    workspaceId: string,
    opts: { prId: string; prNumber?: number; diff: UnifiedDiff },
  ): Promise<{ runId: string; findings: Finding[] }> {
    const start = Date.now();
    const log: RunLogLine[] = [];

    // Create the agent_runs row up-front (so SSE can subscribe).
    const [runRow] = await this.container.db
      .insert(t.agentRuns)
      .values({
        workspaceId,
        agentId: null,
        prId: opts.prId,
        provider: 'builtin',
        model: 'lethal-trifecta',
        status: 'running',
        source: 'local',
      })
      .returning({ id: t.agentRuns.id });
    const runId = runRow!.id;

    const record = (kind: RunEventKind, msg: string, data?: unknown) => {
      const e = this.container.runBus.publish(runId, kind, msg, data);
      log.push({ t: e.t, kind, msg });
    };

    record('info', 'Lethal-Trifecta detector scanning added diff lines');
    record('tool', `scan: ${opts.diff.files.length} changed file(s)`);
    const { findings, matchesByFile } = scanTrifecta(opts.diff);
    for (const [file, matches] of matchesByFile) {
      const legs = new Set(matches.map((m) => m.component));
      record('info', `${file}: legs found → ${[...legs].join(', ')}`);
    }
    record('result', `Detected ${findings.length} lethal-trifecta finding(s)`);

    const durationMs = Date.now() - start;
    const grounding = `${findings.length}/${findings.length} passed`;

    // Persist a review + findings so the multi-agent column & PR findings show it.
    if (findings.length > 0) {
      const [review] = await this.container.db
        .insert(t.reviews)
        .values({
          workspaceId,
          prId: opts.prId,
          agentId: null,
          kind: 'review',
          verdict: 'request_changes',
          summary: `Lethal trifecta detected in ${findings.length} file(s).`,
          score: 20,
          model: 'lethal-trifecta',
        })
        .returning();
      await this.container.db.insert(t.findings).values(
        findings.map((f) => ({
          reviewId: review!.id,
          file: f.file,
          startLine: f.start_line,
          endLine: f.end_line,
          severity: f.severity,
          category: f.category,
          title: f.title,
          rationale: f.rationale,
          suggestion: f.suggestion ?? null,
          confidence: f.confidence,
          kind: 'lethal_trifecta',
          trifectaComponents: f.trifecta_components ?? null,
        })),
      );
    }

    await this.container.db
      .update(t.agentRuns)
      .set({
        status: 'done',
        durationMs,
        tokensIn: 0,
        tokensOut: 0,
        costUsd: 0,
        findingsCount: findings.length,
        grounding,
      })
      .where(eq(t.agentRuns.id, runId));

    const trace = buildRunTrace({
      config: {
        agent: TRIFECTA_AGENT_NAME,
        version: '1',
        provider: 'builtin',
        model: 'lethal-trifecta',
        pr: opts.prNumber ?? null,
        source: 'local',
      },
      stats: {
        duration_ms: durationMs,
        tokens_in: 0,
        tokens_out: 0,
        cost_usd: 0,
        findings: findings.length,
        grounding,
      },
      promptAssembly: emptyPromptAssembly(
        'Built-in deterministic detector — no LLM call. Scans added diff lines for the three trifecta legs.',
        `Scan PR diff (${opts.diff.files.length} files) for the lethal trifecta.`,
      ),
      toolCalls: [
        {
          tool: 'scan_trifecta',
          args: `${opts.diff.files.length} files`,
          meta: 'static-analysis',
          ms: durationMs,
        },
      ],
      rawOutput: JSON.stringify(findings, null, 2),
      memoryPulled: [],
      specsRead: [],
      log,
    });
    await this.container.db
      .insert(t.runTraces)
      .values({ runId, trace })
      .onConflictDoUpdate({ target: t.runTraces.runId, set: { trace } });

    record('info', 'Run complete; trace persisted');
    this.container.runBus.complete(runId);

    return { runId, findings };
  }
}
