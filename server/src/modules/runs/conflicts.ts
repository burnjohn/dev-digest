import type { Conflict, ConflictTake } from '@devdigest/shared/contracts/observability';
import { CONFLICT_NOTE_MAX_LEN } from './constants.js';
import { contention, locKey, truncate } from './helpers.js';

/**
 * A5 — conflict detection. A "conflict" is a code location (file:line) on which
 * the participating agents DISAGREE: at least one flagged it and at least one
 * other (that also produced a review in this run) did not, OR they assigned
 * divergent severities. Pure + deterministic; computed from persisted findings.
 */

export interface AgentFindingInput {
  agentId: string;
  agentName: string;
  /** true when this agent produced a review in the run (so silence = "did not flag"). */
  reviewed: boolean;
  findings: {
    file: string;
    start_line: number;
    title: string;
    severity: 'CRITICAL' | 'WARNING' | 'SUGGESTION';
    rationale?: string | null;
  }[];
}

export function computeConflicts(agents: AgentFindingInput[]): Conflict[] {
  if (agents.length < 2) return [];

  // Map location → { title, perAgentFinding }
  type Loc = {
    file: string;
    line: number;
    title: string;
    byAgent: Map<string, { severity: ConflictTake['verdict']; note: string }>;
  };
  const locs = new Map<string, Loc>();

  for (const a of agents) {
    for (const f of a.findings) {
      const key = locKey(f.file, f.start_line);
      let loc = locs.get(key);
      if (!loc) {
        loc = { file: f.file, line: f.start_line, title: f.title, byAgent: new Map() };
        locs.set(key, loc);
      }
      loc.byAgent.set(a.agentId, {
        severity: f.severity,
        note: truncate(f.rationale ?? f.title, CONFLICT_NOTE_MAX_LEN),
      });
    }
  }

  const conflicts: Conflict[] = [];
  for (const loc of locs.values()) {
    const flaggers = loc.byAgent.size;
    const reviewers = agents.filter((a) => a.reviewed).length;
    const severities = new Set([...loc.byAgent.values()].map((v) => v.severity));

    // Disagreement when not every reviewing agent flagged it, OR severities differ.
    const someSilent = flaggers < reviewers;
    const divergentSeverity = severities.size > 1;
    if (!someSilent && !divergentSeverity) continue;

    const takes: ConflictTake[] = agents
      .filter((a) => a.reviewed)
      .map((a) => {
        const hit = loc.byAgent.get(a.agentId);
        return {
          agent_id: a.agentId,
          persona: a.agentName,
          verdict: hit ? hit.severity : ('ignored' as const),
          note: hit ? hit.note : 'did not flag this location',
        };
      });

    conflicts.push({ file: loc.file, line: loc.line, title: loc.title, takes });
  }

  // Most-contended first (more divergent takes → higher up).
  conflicts.sort((a, b) => contention(b) - contention(a));
  return conflicts;
}
