import * as t from './schema.js';

/**
 * Shared row types inferred from the Drizzle schema.
 *
 * They live here — next to the schema — rather than inside a module's
 * `repository.ts`, so cross-cutting consumers (ci, eval, performance,
 * conformance, compose, hooks, runs, reviews) can reference a row shape
 * WITHOUT importing another module's data layer. Each owning repository
 * re-exports its row from here to keep its public type API unchanged.
 */
export type AgentRow = typeof t.agents.$inferSelect;
export type AgentVersionRow = typeof t.agentVersions.$inferSelect;
export type FindingRow = typeof t.findings.$inferSelect;
export type PullRow = typeof t.pullRequests.$inferSelect;
export type AgentRunRow = typeof t.agentRuns.$inferSelect;
export type SkillRow = typeof t.skills.$inferSelect;
export type SkillVersionRow = typeof t.skillVersions.$inferSelect;
export type ConventionRow = typeof t.conventions.$inferSelect;
