import type { ActiveRun } from '../ports.js';

/**
 * D-H's idempotency decision (§5.5, ring M2) — pure, no I/O. The key is
 * `(pull_id, agent_id)`, and `pullId` is already implicit in `activeRuns`
 * (the caller fetched it via `ApiPort.listActiveRuns(pullId)`), so this
 * function only has to look at `agentId`.
 *
 * There is no `reuse` branch. `activeRuns` is `GET /pulls/:id/runs/active`'s
 * result, which the server filters to `status = 'running'` — a `done`,
 * `failed` or `cancelled` run for this agent can never appear in it, so
 * "a finished run is never reused" (§5.5) falls out of the INPUT shape
 * rather than being a rule this function has to enforce on its own.
 */
export type RunAction = 'attach' | 'start';

/** Attach when a run for THIS agent is already `running`; start otherwise.
 *  Matches §5.12.3's own signature: `(activeRuns, agentId) => 'attach' | 'start'`. */
export function decideRunAction(activeRuns: readonly ActiveRun[], agentId: string): RunAction {
  return activeRuns.some((run) => run.agent_id === agentId) ? 'attach' : 'start';
}

/**
 * The specific in-flight run `decideRunAction` said to attach to. Kept as a
 * second, separate lookup — rather than folding `run_id` into
 * `decideRunAction`'s return value — so that function's signature stays the
 * exact two-value union §5.12.3 documents, with no third field smuggled in.
 */
export function findActiveRun(activeRuns: readonly ActiveRun[], agentId: string): ActiveRun | undefined {
  return activeRuns.find((run) => run.agent_id === agentId);
}
