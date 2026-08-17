/**
 * Canonical Drizzle schema — EVERY table in the schema.
 *
 * Tenancy rule: every domain table carries `workspace_id` (FK→workspaces)
 * and, where relevant, `created_by` (FK→users). All queries scope by
 * workspace_id via the base-repository guard.
 *
 * This is the COMPLETE schema. Feature agents A1–A6 do NOT run parallel
 * migrations against these tables — they only extend with their own new
 * columns/tables via their own migrations.
 *
 * The tables are organized into domain files under `./schema/`; this barrel
 * re-exports them so every consumer keeps importing from `db/schema` unchanged.
 */
export * from './schema/core';
export * from './schema/repos';
export * from './schema/pulls';
export * from './schema/reviews';
export * from './schema/skills';
export * from './schema/agents';
export * from './schema/knowledge';
export * from './schema/context';
export * from './schema/eval';
export * from './schema/ci';
export * from './schema/runs';
export * from './schema/ops';
export * from './schema/repo-intel';

import { users, workspaces, workspaceMembers, settings } from './schema/core';
import { repos } from './schema/repos';
import { pullRequests, prFiles, prCommits } from './schema/pulls';
import { reviews, findings, prIntent, prBrief } from './schema/reviews';
import { skills, skillVersions } from './schema/skills';
import { agents, agentVersions, agentSkills } from './schema/agents';
import { memory, conventions, conventionScans } from './schema/knowledge';
import { codeChunks, symbols, references, onboarding } from './schema/context';
import { evalCases, evalRuns, conformanceChecks, composedReviews } from './schema/eval';
import { ciInstallations, ciRuns } from './schema/ci';
import { agentRuns, runTraces, multiAgentRuns } from './schema/runs';
import { jobs, installedPlugins, digests } from './schema/ops';
import {
  repoIndexState,
  fileEdges,
  fileFacts,
  fileRank,
  repoMapCache,
} from './schema/repo-intel';

/** Convenience: the full schema object for drizzle() client typing. */
export const schema = {
  users,
  workspaces,
  workspaceMembers,
  settings,
  repos,
  pullRequests,
  prFiles,
  prCommits,
  reviews,
  findings,
  prIntent,
  prBrief,
  skills,
  skillVersions,
  agents,
  agentVersions,
  agentSkills,
  conventions,
  conventionScans,
  memory,
  codeChunks,
  symbols,
  references,
  onboarding,
  evalCases,
  evalRuns,
  conformanceChecks,
  composedReviews,
  ciInstallations,
  ciRuns,
  agentRuns,
  runTraces,
  multiAgentRuns,
  jobs,
  installedPlugins,
  digests,
  // repo-intel: T2 = index state + graph + facts; T3 = rank + map.
  repoIndexState,
  fileEdges,
  fileFacts,
  fileRank,
  repoMapCache,
};
