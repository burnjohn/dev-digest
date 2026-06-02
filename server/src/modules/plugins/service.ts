import type { Container } from '../../platform/container.js';
import type {
  InstalledPlugin,
  PluginAgent,
  PluginBundle,
  PluginConvention,
  PluginEvalCase,
  PluginImportResult,
  PluginSkill,
} from '@devdigest/shared';
import { ValidationError } from '../../platform/errors.js';
import { PluginsRepository } from './repository.js';
import {
  DEFAULT_BUNDLE_NAME,
  DEFAULT_BUNDLE_VERSION,
  IMPORT_SOURCE,
  PLUGIN_FORMAT,
} from './constants.js';
import { toInstalledDto } from './helpers.js';

/**
 * A6 — plugins service. EXPORT bundles the workspace's agents (+ their linked
 * skills, by name), skills, eval cases and conventions into one round-trippable
 * `.devdigest-plugin/v1` JSON document. IMPORT recreates them (merge mode: skips
 * items whose name already exists) and persists an `installed_plugins` row.
 *
 * The bundle carries config by NAME (no DB ids) so a round-trip into a fresh
 * workspace restores agent→skill links faithfully.
 */
export class PluginsService {
  private repo: PluginsRepository;

  constructor(private container: Container) {
    this.repo = new PluginsRepository(container.db);
  }

  // ===========================================================================
  // Export
  // ===========================================================================

  async export(
    workspaceId: string,
    opts: { name?: string; description?: string; agentIds?: string[] } = {},
  ): Promise<PluginBundle> {
    const allAgents =
      opts.agentIds && opts.agentIds.length > 0
        ? (
            await Promise.all(opts.agentIds.map((id) => this.repo.agentById(workspaceId, id)))
          ).filter((a): a is NonNullable<typeof a> => !!a)
        : await this.repo.agents(workspaceId);

    const allSkills = await this.repo.skills(workspaceId);
    const skillsById = new Map(allSkills.map((s) => [s.id, s]));

    // Determine which skills to export: every skill linked to an exported agent
    // plus all workspace skills (a plugin is the whole skills lab by default).
    const exportSkills: PluginSkill[] = allSkills.map((s) => ({
      name: s.name,
      description: s.description,
      type: s.type,
      source: s.source,
      body: s.body,
      enabled: s.enabled,
      evidence_files: s.evidenceFiles ?? null,
    }));

    const agents: PluginAgent[] = [];
    for (const a of allAgents) {
      const skillIds = await this.repo.agentSkillIds(a.id);
      const skillNames = skillIds
        .map((id) => skillsById.get(id)?.name)
        .filter((n): n is string => !!n);
      agents.push({
        name: a.name,
        description: a.description,
        provider: a.provider,
        model: a.model,
        system_prompt: a.systemPrompt,
        output_schema: a.outputSchema ?? null,
        enabled: a.enabled,
        skills: skillNames,
      });
    }

    const agentNamesById = new Map(allAgents.map((a) => [a.id, a.name]));
    const skillNamesById = new Map(allSkills.map((s) => [s.id, s.name]));
    const cases = await this.repo.evalCases(workspaceId);
    const evalCases: PluginEvalCase[] = cases
      .map((c): PluginEvalCase | null => {
        const ownerRef =
          c.ownerKind === 'agent'
            ? agentNamesById.get(c.ownerId)
            : skillNamesById.get(c.ownerId);
        if (!ownerRef) return null; // owner not in this export
        return {
          name: c.name,
          owner_kind: c.ownerKind,
          owner_ref: ownerRef,
          input_diff: c.inputDiff ?? null,
          input_files: c.inputFiles ?? null,
          input_meta: c.inputMeta ?? null,
          expected_output: c.expectedOutput ?? null,
          notes: c.notes ?? null,
        };
      })
      .filter((c): c is PluginEvalCase => c !== null);

    const convs = await this.repo.conventions(workspaceId);
    const conventions: PluginConvention[] = convs.map((c) => ({
      rule: c.rule,
      evidence_path: c.evidencePath ?? null,
      evidence_snippet: c.evidenceSnippet ?? null,
      confidence: c.confidence ?? null,
      accepted: c.accepted,
    }));

    return {
      manifest: {
        name: opts.name ?? DEFAULT_BUNDLE_NAME,
        version: DEFAULT_BUNDLE_VERSION,
        format: PLUGIN_FORMAT,
        exported_at: new Date().toISOString(),
        description: opts.description ?? null,
        counts: {
          agents: agents.length,
          skills: exportSkills.length,
          eval_cases: evalCases.length,
          conventions: conventions.length,
        },
      },
      agents,
      skills: exportSkills,
      eval_cases: evalCases,
      conventions,
    };
  }

  // ===========================================================================
  // Import (merge mode)
  // ===========================================================================

  async import(
    workspaceId: string,
    bundle: PluginBundle,
    _mode: 'merge' | 'replace' = 'merge',
  ): Promise<PluginImportResult> {
    if (bundle.manifest.format !== PLUGIN_FORMAT) {
      throw new ValidationError(`Unsupported plugin format: ${bundle.manifest.format}`);
    }

    let createdSkills = 0;
    let createdAgents = 0;
    let createdCases = 0;
    let createdConventions = 0;

    // 1) Skills first — agents reference them by name.
    const skillIdByName = new Map<string, string>();
    for (const s of bundle.skills) {
      const existing = await this.repo.findSkillByName(workspaceId, s.name);
      if (existing) {
        skillIdByName.set(s.name, existing.id);
        continue;
      }
      const row = await this.repo.insertSkill({
        workspaceId,
        name: s.name,
        description: s.description,
        type: s.type,
        source: s.source,
        body: s.body,
        enabled: s.enabled,
        version: 1,
        evidenceFiles: s.evidence_files ?? null,
      });
      skillIdByName.set(s.name, row.id);
      createdSkills += 1;
    }

    // 2) Agents + their skill links.
    const agentIdByName = new Map<string, string>();
    for (const a of bundle.agents) {
      let agentId: string;
      const existing = await this.repo.findAgentByName(workspaceId, a.name);
      if (existing) {
        agentId = existing.id;
      } else {
        const row = await this.repo.insertAgent({
          workspaceId,
          name: a.name,
          description: a.description,
          provider: a.provider,
          model: a.model,
          systemPrompt: a.system_prompt,
          outputSchema: (a.output_schema as object | null) ?? null,
          enabled: a.enabled,
          version: 1,
        });
        agentId = row.id;
        createdAgents += 1;
      }
      agentIdByName.set(a.name, agentId);
      // (Re)establish skill links by name.
      let order = 0;
      for (const skillName of a.skills) {
        const skillId = skillIdByName.get(skillName);
        if (!skillId) continue;
        await this.repo.linkAgentSkill(agentId, skillId, order++);
      }
    }

    // 3) Eval cases (owner resolved by name → id).
    for (const c of bundle.eval_cases) {
      const ownerId =
        c.owner_kind === 'agent'
          ? agentIdByName.get(c.owner_ref)
          : skillIdByName.get(c.owner_ref);
      if (!ownerId) continue; // owner not imported
      await this.repo.insertEvalCase({
        workspaceId,
        ownerKind: c.owner_kind,
        ownerId,
        name: c.name,
        inputDiff: c.input_diff ?? null,
        inputFiles: (c.input_files as object | null) ?? null,
        inputMeta: (c.input_meta as object | null) ?? null,
        expectedOutput: (c.expected_output as object | null) ?? null,
        notes: c.notes ?? null,
      });
      createdCases += 1;
    }

    // 4) Conventions (repo-less; workspace-level house rules).
    for (const c of bundle.conventions) {
      await this.repo.insertConvention({
        workspaceId,
        repoId: null,
        rule: c.rule,
        evidencePath: c.evidence_path ?? null,
        evidenceSnippet: c.evidence_snippet ?? null,
        confidence: c.confidence ?? null,
        accepted: c.accepted,
      });
      createdConventions += 1;
    }

    const installedRow = await this.repo.recordInstall({
      workspaceId,
      name: bundle.manifest.name,
      version: bundle.manifest.version,
      source: IMPORT_SOURCE,
    });

    return {
      installed: toInstalledDto(installedRow),
      created: {
        agents: createdAgents,
        skills: createdSkills,
        eval_cases: createdCases,
        conventions: createdConventions,
      },
    };
  }

  async listInstalled(workspaceId: string): Promise<InstalledPlugin[]> {
    const rows = await this.repo.listInstalled(workspaceId);
    return rows.map((r) => toInstalledDto(r));
  }
}
