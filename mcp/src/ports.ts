import type {
  Agent,
  ConventionCandidate,
  PullLookupResult,
  Repo,
  ReviewRecord,
} from '@devdigest/shared';

/**
 * Ports (ring M0) — the one place `mcp/` names what it needs from DevDigest's
 * API, defined innermost so every other ring depends on the interface rather
 * than the transport. Same shape as `server/src/vendor/shared/adapters.ts`'s
 * "ALL external calls go behind these interfaces" rule, one layer up: there
 * `Container`'s adapters implement a port defined in R0; here `ApiClient`
 * (ring M3, `api/client.ts`) implements `ApiPort` defined here in M0.
 *
 * Every return type here is a narrow PROJECTION of the wire contract, never
 * the wire contract itself — `@devdigest/shared`'s `Agent`/`ReviewRecord`/
 * `ConventionCandidate` carry fields (`system_prompt`, `output_schema`,
 * `accepted_at`, `evidence_snippet`, …) that exist for the web UI and that no
 * tool result may echo back to a model (§5.3, §5.6 principle 3). `Pick<...>`
 * against the real contract keeps the projection honest — it can only narrow,
 * never invent a field the server does not actually send.
 */

/** `list_agents` (REQ-11): id, name, model, enabled — nothing else. */
export type AgentSummary = Pick<Agent, 'id' | 'name' | 'model' | 'enabled'>;

/**
 * `GET /repos` rows, narrowed to the two fields `get_conventions`'s
 * repo-only resolution needs (T9's authorized `ApiPort` expansion — see
 * that task's report, "Notes for the integrator"): matching a model-authored
 * `repo` ("owner/name") against `full_name`, then using `id` as the
 * `repoId` `ApiPort.listConventions` expects. `lookupPull` cannot serve this
 * because it requires a PR `number` that `get_conventions` never receives.
 * `GET /repos` is a pure DB read (`routes.ts` → `service.list` → `repo.list`,
 * no GitHub call), unlike `GET /repos/:id/pulls`, which §5.2 already
 * rejected as a resolution source for exactly that reason.
 */
export type RepoSummary = Pick<Repo, 'id' | 'full_name'>;

/**
 * One row of `GET /pulls/:id/runs/active` — the server's own "source of
 * truth" for in-flight runs (`run.repo.ts::activeRunsForPull`'s doc comment).
 * This is what D-H's idempotency check reads: a `(pull_id, agent_id)` match
 * against this list is an ATTACH, not a new `startReview` call (§5.5).
 */
export interface ActiveRun {
  run_id: string;
  agent_id: string | null;
  agent_name: string | null;
  ran_at: string | null;
}

/** `agent_runs.status` — the only four values the column ever holds. */
export type RunPhase = 'running' | 'done' | 'failed' | 'cancelled';

/**
 * One row of `GET /pulls/:id/runs` — enough to drive the wait loop (§5.4):
 * find the started `run_id`, watch `status` flip out of `running`, and
 * surface `error` verbatim when it lands on `failed` (§5.7's "run failed"
 * entry).
 */
export interface RunStatus {
  run_id: string;
  agent_id: string | null;
  status: RunPhase;
  error: string | null;
}

/**
 * One persisted review (`GET /pulls/:id/reviews`), narrowed to what
 * `shaping/**` (T7) needs to build `{verdict, score, counts, findings[]}`.
 * `findings` stays the full `ReviewRecord['findings']` shape — shaping, not
 * this port, is where the concise/detailed projection happens (§5.6).
 * `agent_name` rides along because `get_findings` groups its answer by agent
 * and a group labelled by a bare uuid is unreadable; resolving the name a
 * second way (a `listAgents` call) would cost a request the read path does
 * not otherwise need. `created_at` is what makes "the latest run of that
 * agent" a stated rule rather than an unwritten reliance on the order the
 * API happens to return rows in. Neither field reaches the model: they feed
 * grouping, and the output schema never carries a timestamp.
 */
export type ReviewProjection = Pick<
  ReviewRecord,
  'run_id' | 'agent_id' | 'agent_name' | 'verdict' | 'score' | 'created_at' | 'findings'
>;

/**
 * One row of `GET /repos/:id/conventions`, narrowed to `get_conventions`'s
 * own promise (§5.13.5): "one line per convention with its status" — the
 * rule text and where it stands, nothing about how it was extracted.
 */
export type ConventionProjection = Pick<ConventionCandidate, 'rule' | 'status'>;

/**
 * The single seam between the application ring (M2) and the network. M2
 * units depend on THIS interface, never on `ApiClient` — the concrete
 * implementation is constructed exactly once, in `server.ts` (M5, REQ-32).
 */
export interface ApiPort {
  /** `GET /lookup/pull?repo=<owner/name>&number=<n>` (REQ-23). */
  lookupPull(repo: string, number: number): Promise<PullLookupResult>;
  /** `GET /agents`. */
  listAgents(): Promise<AgentSummary[]>;
  /** `GET /repos` — the repo-only resolution source for `get_conventions`
   *  (T9's authorized expansion). A pure DB read; never `GET /repos/:id/pulls`. */
  listRepos(): Promise<RepoSummary[]>;
  /** `GET /pulls/:id/runs/active` — the in-flight-only idempotency check. */
  listActiveRuns(pullId: string): Promise<ActiveRun[]>;
  /** `POST /pulls/:id/review {agentId}`. */
  startReview(pullId: string, agentId: string): Promise<{ runId: string }>;
  /** `GET /pulls/:id/runs` — the poll target while waiting on a run. */
  listRuns(pullId: string): Promise<RunStatus[]>;
  /** `GET /pulls/:id/reviews`. */
  listReviews(pullId: string): Promise<ReviewProjection[]>;
  /** `GET /repos/:id/conventions`. */
  listConventions(repoId: string): Promise<ConventionProjection[]>;
}
