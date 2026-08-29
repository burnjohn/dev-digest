import type { Agent, AgentVersion, CiFailOn, Provider, ReviewStrategy } from '@devdigest/shared';
import { AgentVersionConfig } from '@devdigest/shared';
import type { AgentRow, AgentVersionRow } from './repository.js';

/**
 * Pure helpers for the agents module — DB row ⇄ DTO mapping and the
 * config-version-bump rule. No I/O; behaviour-identical to the previous inline
 * implementations.
 */

/**
 * Map a persisted agent row to the public `Agent` DTO.
 *
 * `skillCount` is denormalized from `agent_skills` and only the list query
 * computes it (via a join) — single-agent reads pass nothing and get 0, which is
 * why the contract defaults it. Don't fetch links here: this helper is pure.
 */
export function toAgentDto(row: AgentRow, skillCount = 0): Agent {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    provider: row.provider as Provider,
    model: row.model,
    system_prompt: row.systemPrompt,
    output_schema: row.outputSchema ?? null,
    enabled: row.enabled,
    version: row.version,
    strategy: row.strategy as ReviewStrategy,
    ci_fail_on: row.ciFailOn as CiFailOn,
    repo_intel: row.repoIntel,
    skill_count: skillCount,
  };
}

/**
 * Map a persisted `agent_versions` row to the public `AgentVersion` DTO. The
 * stored `config_json` is untyped jsonb (a snapshot from an older config shape
 * could drift), so it is parsed through `AgentVersionConfig` — a malformed
 * snapshot throws here rather than leaking an unvalidated blob to the client.
 */
export function toAgentVersionDto(row: AgentVersionRow): AgentVersion {
  return {
    agent_id: row.agentId,
    version: row.version,
    config: AgentVersionConfig.parse(row.configJson),
    created_at: row.createdAt.toISOString(),
  };
}

/** Fields whose change bumps the agent's config version (anything but `enabled`). */
export interface ConfigChangePatch {
  name?: string;
  description?: string;
  provider?: Provider;
  model?: string;
  systemPrompt?: string;
  outputSchema?: unknown;
  strategy?: ReviewStrategy;
  ciFailOn?: CiFailOn;
  repoIntel?: boolean;
}

/**
 * True when a patch changes config (vs. just toggling `enabled`) relative to the
 * existing row — a config change bumps the version and snapshots agent_versions.
 */
export function isConfigChange(
  existing: Pick<
    AgentRow,
    | 'name'
    | 'description'
    | 'provider'
    | 'model'
    | 'systemPrompt'
    | 'strategy'
    | 'ciFailOn'
    | 'repoIntel'
  >,
  patch: ConfigChangePatch,
): boolean {
  return (
    (patch.name !== undefined && patch.name !== existing.name) ||
    (patch.description !== undefined && patch.description !== existing.description) ||
    (patch.provider !== undefined && patch.provider !== existing.provider) ||
    (patch.model !== undefined && patch.model !== existing.model) ||
    (patch.systemPrompt !== undefined && patch.systemPrompt !== existing.systemPrompt) ||
    (patch.strategy !== undefined && patch.strategy !== existing.strategy) ||
    (patch.ciFailOn !== undefined && patch.ciFailOn !== existing.ciFailOn) ||
    (patch.repoIntel !== undefined && patch.repoIntel !== existing.repoIntel) ||
    patch.outputSchema !== undefined
  );
}

/**
 * True when replaying `snapshot` onto `existing` would actually change the
 * agent — the no-op predicate for `POST /agents/:id/restore`.
 *
 * Deliberately NOT `isConfigChange`. That one is a *patch* predicate: it reads
 * `outputSchema !== undefined` as a change, because a save that mentions the
 * field at all is assumed to be setting it. A restore always carries every
 * field, so `isConfigChange` would report "changed" for every restore and the
 * "restoring the current config is a no-op" guarantee would never hold.
 *
 * `currentSkillIds` must be the agent's links in link order: the snapshot's
 * `skills` array is part of the agent's effective prompt (see `setSkills`), so
 * two configs identical in every scalar but differing in their link set are NOT
 * the same version. `isConfigChange` cannot see links at all.
 *
 * `output_schema` is opaque jsonb, so it is compared by serialization. Key order
 * is stable here because both sides originate from the same writer: the snapshot
 * was serialized from the row it is being compared against. A false "changed"
 * would only cost one redundant version, never a wrong write.
 */
export function isRestoreChange(
  existing: Pick<
    AgentRow,
    'provider' | 'model' | 'systemPrompt' | 'outputSchema' | 'strategy' | 'ciFailOn' | 'repoIntel'
  >,
  snapshot: AgentVersionConfig,
  currentSkillIds: string[],
): boolean {
  return (
    snapshot.provider !== existing.provider ||
    snapshot.model !== existing.model ||
    snapshot.system_prompt !== existing.systemPrompt ||
    snapshot.strategy !== existing.strategy ||
    snapshot.ci_fail_on !== existing.ciFailOn ||
    snapshot.repo_intel !== existing.repoIntel ||
    JSON.stringify(snapshot.output_schema ?? null) !== JSON.stringify(existing.outputSchema ?? null) ||
    snapshot.skills.length !== currentSkillIds.length ||
    snapshot.skills.some((id, i) => id !== currentSkillIds[i])
  );
}
