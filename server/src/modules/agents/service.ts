import type { Container } from '../../platform/container.js';
import type {
  Agent,
  AgentSkillLink,
  AgentVersion,
  CiFailOn,
  ModelInfo,
  Provider,
  ReviewStrategy,
} from '@devdigest/shared';
import { AgentsRepository } from './repository.js';
import { toAgentDto, toAgentVersionDto } from './helpers.js';
import { ValidationError } from '../../platform/errors.js';

/**
 * A2 — agents service. Business logic for the Agents tab + Agent Editor.
 * Provider/model selection uses the LLM adapter's dynamic model list.
 *
 * An Agent = provider + model + system_prompt + linked skills + output_schema +
 * enabled. Config changes are versioned via `agent_versions` (repository).
 */

// Re-exported for backwards compatibility; implementation lives in ./helpers.
export { toAgentDto } from './helpers.js';

export interface CreateAgentInput {
  name: string;
  description?: string;
  provider: Provider;
  model: string;
  system_prompt: string;
  output_schema?: unknown;
  strategy?: ReviewStrategy;
  ci_fail_on?: CiFailOn;
  repo_intel?: boolean;
  enabled?: boolean;
}

export interface UpdateAgentInput {
  name?: string;
  description?: string;
  provider?: Provider;
  model?: string;
  system_prompt?: string;
  output_schema?: unknown;
  strategy?: ReviewStrategy;
  ci_fail_on?: CiFailOn;
  repo_intel?: boolean;
  enabled?: boolean;
}

export class AgentsService {
  private repo: AgentsRepository;

  constructor(private container: Container) {
    this.repo = new AgentsRepository(container.db);
  }

  /** Agents for the list screen — each carrying its linked-skill count. */
  async list(workspaceId: string): Promise<Agent[]> {
    const rows = await this.repo.listWithSkillCounts(workspaceId);
    return rows.map((r) => toAgentDto(r.agent, r.skillCount));
  }

  async get(workspaceId: string, id: string): Promise<Agent | undefined> {
    const row = await this.repo.getById(workspaceId, id);
    return row ? toAgentDto(row) : undefined;
  }

  /**
   * Delete an agent (and its versions/skill-links, via cascade, plus its
   * eval_cases/eval_run_batches — REQ-41, done in the repository so this stays
   * R2). `deletedCases` powers the delete route's optional response field.
   */
  async delete(
    workspaceId: string,
    id: string,
  ): Promise<{ deleted: boolean; deletedCases: number }> {
    return this.repo.deleteById(workspaceId, id);
  }

  async create(workspaceId: string, input: CreateAgentInput, userId?: string): Promise<Agent> {
    const row = await this.repo.insert({
      workspaceId,
      name: input.name,
      description: input.description,
      provider: input.provider,
      model: input.model,
      systemPrompt: input.system_prompt,
      outputSchema: input.output_schema,
      ...(input.strategy !== undefined ? { strategy: input.strategy } : {}),
      ...(input.ci_fail_on !== undefined ? { ciFailOn: input.ci_fail_on } : {}),
      ...(input.repo_intel !== undefined ? { repoIntel: input.repo_intel } : {}),
      enabled: input.enabled,
      createdBy: userId ?? null,
    });
    return toAgentDto(row);
  }

  async update(
    workspaceId: string,
    id: string,
    patch: UpdateAgentInput,
  ): Promise<Agent | undefined> {
    const row = await this.repo.update(workspaceId, id, {
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.provider !== undefined ? { provider: patch.provider } : {}),
      ...(patch.model !== undefined ? { model: patch.model } : {}),
      ...(patch.system_prompt !== undefined ? { systemPrompt: patch.system_prompt } : {}),
      ...(patch.output_schema !== undefined ? { outputSchema: patch.output_schema } : {}),
      ...(patch.strategy !== undefined ? { strategy: patch.strategy } : {}),
      ...(patch.ci_fail_on !== undefined ? { ciFailOn: patch.ci_fail_on } : {}),
      ...(patch.repo_intel !== undefined ? { repoIntel: patch.repo_intel } : {}),
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
    });
    return row ? toAgentDto(row) : undefined;
  }

  /**
   * Config history for an agent, newest version first. Workspace-scoped: returns
   * undefined when the agent isn't in this workspace (the route maps that to 404)
   * so version snapshots can't be read across tenants.
   */
  async listVersions(workspaceId: string, agentId: string): Promise<AgentVersion[] | undefined> {
    const agent = await this.repo.getById(workspaceId, agentId);
    if (!agent) return undefined;
    const rows = await this.repo.listVersions(agentId);
    return rows.map(toAgentVersionDto);
  }

  /**
   * A single config snapshot for an agent. Returns undefined when the agent isn't
   * in this workspace OR that version was never recorded (route → 404).
   */
  async getVersion(
    workspaceId: string,
    agentId: string,
    version: number,
  ): Promise<AgentVersion | undefined> {
    const agent = await this.repo.getById(workspaceId, agentId);
    if (!agent) return undefined;
    const row = await this.repo.getVersion(agentId, version);
    return row ? toAgentVersionDto(row) : undefined;
  }

  /**
   * Replay an old config version as a NEW version — the compare modal's
   * `Promote vN`. Symmetric with `SkillsService.restoreVersion`.
   *
   * Returns a discriminated result rather than `undefined` so the route can tell
   * a missing agent from a missing version. That leaks nothing across tenants: a
   * foreign agent id fails at the repository's locked SELECT, before any version
   * is read, so it always answers `agent_not_found`.
   *
   * Deliberately does NOT re-run `assertSkillsInWorkspace` over the snapshot's
   * skill ids. They were gated when they were first linked, and the snapshot is
   * immutable, so the only way one can now be invalid is that the skill was
   * deleted since — which the FK catches inside the transaction. Re-validating
   * here would also mean refusing a user their own prior config, the same
   * judgement `SkillsRepository.restoreVersion` makes about `MAX_SKILL_BODY_CHARS`.
   */
  async restoreVersion(
    workspaceId: string,
    id: string,
    version: number,
  ): Promise<
    { ok: true; agent: Agent } | { ok: false; reason: 'agent_not_found' | 'version_not_found' }
  > {
    const result = await this.repo.restoreVersion(workspaceId, id, version);
    if (!result.ok) return result;
    // Re-read through the list query's shape so `skill_count` is honest: a
    // restore can change the link set, and `toAgentDto(row)` alone would report 0.
    const skillCount = (await this.repo.skillIdsForAgent(id)).length;
    return { ok: true, agent: toAgentDto(result.row, skillCount) };
  }

  /** Linked skills for an agent as AgentSkillLink[] (ordered). */
  async skillLinks(agentId: string): Promise<AgentSkillLink[]> {
    const links = await this.repo.linkedSkills(agentId);
    return links.map((l) => ({ agent_id: agentId, skill_id: l.skill.id, order: l.order }));
  }

  /**
   * Reject any skill id that does not belong to this workspace.
   *
   * Checking the AGENT's workspace is not enough: `agent_skills` has an FK to
   * `skills` but no workspace column, so a foreign uuid would link cleanly and
   * then be injected verbatim into this tenant's review prompts. Also catches
   * ids that simply don't exist, which would otherwise surface as an opaque FK
   * violation (500) instead of a 422 naming the bad ids.
   */
  private async assertSkillsInWorkspace(workspaceId: string, skillIds: string[]): Promise<void> {
    if (skillIds.length === 0) return;
    const unique = [...new Set(skillIds)];
    const found = await this.repo.skillIdsInWorkspace(workspaceId, unique);
    if (found.length === unique.length) return;
    const known = new Set(found);
    throw new ValidationError('Unknown skill id(s) for this workspace', {
      skill_ids: unique.filter((id) => !known.has(id)),
    });
  }

  /**
   * Set / reorder the agent's linked skills. If `skillIds` is provided, replaces
   * the whole set in that order. Returns the resulting ordered links.
   *
   * Changing the set changes the agent's effective prompt, so the repository
   * bumps the agent version and snapshots it — reproducibility depends on it.
   */
  async setSkills(
    workspaceId: string,
    agentId: string,
    skillIds: string[],
  ): Promise<AgentSkillLink[] | undefined> {
    const agent = await this.repo.getById(workspaceId, agentId);
    if (!agent) return undefined;
    await this.assertSkillsInWorkspace(workspaceId, skillIds);
    const version = await this.repo.setSkills(workspaceId, agentId, skillIds);
    if (version === undefined) return undefined;
    return this.skillLinks(agentId);
  }

  /** Link a single skill (append or set order) — additive to existing links. */
  async linkSkill(
    workspaceId: string,
    agentId: string,
    skillId: string,
    order?: number,
  ): Promise<AgentSkillLink[] | undefined> {
    const agent = await this.repo.getById(workspaceId, agentId);
    if (!agent) return undefined;
    await this.assertSkillsInWorkspace(workspaceId, [skillId]);
    // max(order) + 1, not links.length — see AgentsRepository.nextLinkOrder.
    const resolvedOrder = order ?? (await this.repo.nextLinkOrder(agentId));
    await this.repo.linkSkill(agentId, skillId, resolvedOrder);
    return this.skillLinks(agentId);
  }

  /**
   * Dynamic model list from the provider adapter's /models. Degrades gracefully
   * to [] if the provider key is not configured (the editor still renders).
   */
  async listModels(provider: Provider): Promise<ModelInfo[]> {
    try {
      const llm = await this.container.llm(provider);
      return await llm.listModels();
    } catch {
      return [];
    }
  }
}
