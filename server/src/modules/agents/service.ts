import type { Container } from '../../platform/container.js';
import type {
  Agent,
  AgentSkillLink,
  AgentCardStats,
  AgentVersion,
  AgentContextDocLink,
  CiFailOn,
  ModelInfo,
  Provider,
  ReviewStrategy,
} from '@devdigest/shared';
import { AgentsRepository } from './repository.js';
import { toAgentDto, toAgentVersionDto } from './helpers.js';
import { NotFoundError, ValidationError } from '../../platform/errors.js';

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

  async list(workspaceId: string): Promise<Agent[]> {
    const rows = await this.repo.list(workspaceId);
    return rows.map(toAgentDto);
  }

  async get(workspaceId: string, id: string): Promise<Agent | undefined> {
    const row = await this.repo.getById(workspaceId, id);
    return row ? toAgentDto(row) : undefined;
  }

  /**
   * Rolled-up usage stats for every agent in the workspace (Agents list card
   * footer). Runs + avg cost from `agent_runs`; accept rate over
   * accepted+dismissed findings of the agent's reviews; linked-skill count.
   * `accept_pct` / `avg_cost_usd` are null when there is nothing to average.
   */
  async stats(workspaceId: string): Promise<AgentCardStats[]> {
    const [agents, runStats, acceptance, skillCounts] = await Promise.all([
      this.repo.list(workspaceId),
      this.repo.runStatsByAgent(workspaceId),
      this.repo.acceptanceByAgent(workspaceId),
      this.repo.skillCountByAgent(workspaceId),
    ]);
    return agents.map((a) => {
      const rs = runStats.get(a.id);
      const ac = acceptance.get(a.id);
      const acted = (ac?.accepted ?? 0) + (ac?.dismissed ?? 0);
      return {
        agent_id: a.id,
        runs: rs?.runs ?? 0,
        skill_count: skillCounts.get(a.id) ?? 0,
        accept_pct: acted > 0 ? Math.round(((ac!.accepted) / acted) * 100) : null,
        avg_cost_usd: rs?.avgCostUsd ?? null,
      };
    });
  }

  /** Delete an agent (and its versions/skill-links, via cascade). */
  async delete(workspaceId: string, id: string): Promise<boolean> {
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

  /** Linked skills for an agent as AgentSkillLink[] (ordered). */
  async skillLinks(agentId: string): Promise<AgentSkillLink[]> {
    const links = await this.repo.linkedSkills(agentId);
    return links.map((l) => ({ agent_id: agentId, skill_id: l.skill.id, order: l.order }));
  }

  /**
   * Set / reorder the agent's linked skills. If `skillIds` is provided, replaces
   * the whole set in that order. Returns the resulting ordered links.
   */
  async setSkills(
    workspaceId: string,
    agentId: string,
    skillIds: string[],
  ): Promise<AgentSkillLink[] | undefined> {
    const agent = await this.repo.getById(workspaceId, agentId);
    if (!agent) return undefined;
    await this.repo.setSkills(agentId, skillIds);
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
    const existing = await this.repo.linkedSkills(agentId);
    const resolvedOrder = order ?? existing.length;
    await this.repo.linkSkill(agentId, skillId, resolvedOrder);
    return this.skillLinks(agentId);
  }

  /**
   * Attached context documents for an agent (ordered). 404-guards `agentId`
   * against `workspaceId` via `get()` BEFORE delegating to `ContextDocsService`
   * — `ContextDocsService.agentAttachments`/`setAgentAttachments` intentionally
   * do NOT re-validate workspace ownership themselves (see context-docs
   * service.ts's "ownership boundary" comment). Returns `undefined` when the
   * agent isn't in this workspace (route maps that to 404).
   */
  async contextDocLinks(
    workspaceId: string,
    agentId: string,
  ): Promise<AgentContextDocLink[] | undefined> {
    const agent = await this.repo.getById(workspaceId, agentId);
    if (!agent) return undefined;
    const links = await this.container.contextDocs.agentAttachments(agentId);
    return links.map((l) => ({ owner_id: agentId, path: l.path, order: l.order }));
  }

  /**
   * Replace the agent's full set of attached context-document paths (full
   * replace-and-reorder semantics, mirrors `setSkills`). Same workspace guard
   * as `contextDocLinks` — validated here, before `ContextDocsService` is
   * touched.
   */
  async setContextDocs(
    workspaceId: string,
    agentId: string,
    paths: string[],
  ): Promise<AgentContextDocLink[] | undefined> {
    const agent = await this.repo.getById(workspaceId, agentId);
    if (!agent) return undefined;
    const links = await this.container.contextDocs.setAgentAttachments(agentId, paths);
    return links.map((l) => ({ owner_id: agentId, path: l.path, order: l.order }));
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

  /**
   * Promote an eval batch's frozen system-prompt snapshot onto this agent
   * (Agent Eval Dashboard). Reads the batch via `container.evalRepo` — the
   * ONE cross-module read into `eval`'s data, never a direct import of
   * `eval/repository.js` (R6). Ownership (`batch.agentId === agentId`) is
   * checked BEFORE any mutation (AC-25 — prevents a same-workspace IDOR where
   * agent A's batch overwrites agent B's prompt).
   */
  async promoteFromBatch(workspaceId: string, agentId: string, batchId: string): Promise<Agent> {
    const snapshot = await this.container.evalRepo.getBatchPromptSnapshot(workspaceId, batchId);
    if (!snapshot) throw new NotFoundError('Eval batch not found');
    if (snapshot.agentId !== agentId) {
      throw new ValidationError('Batch does not belong to this agent');
    }
    if (snapshot.systemPromptSnapshot === null) {
      throw new ValidationError('This batch has no stored prompt text and cannot be promoted');
    }

    const row = await this.repo.promoteSystemPrompt(
      workspaceId,
      agentId,
      snapshot.systemPromptSnapshot,
      batchId,
    );
    return toAgentDto(row!);
  }
}
