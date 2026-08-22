import { eq } from "drizzle-orm";
import { stat } from "node:fs/promises";
import type { Container } from "../../platform/container.js";
import type { ConventionCandidate, Skill } from "@devdigest/shared";
import * as t from "../../db/schema.js";
import { NotFoundError, ValidationError } from "../../platform/errors.js";
import { ConventionsRepository } from "./repository.js";
import { extractConventions } from "./extractor.js";
import { SkillsService } from "../skills/service.js";
import { resolveFeatureModel } from "../settings/feature-models.js";
import type { ConventionRow } from "./repository.js";

function toDto(row: ConventionRow): ConventionCandidate {
  return {
    id: row.id,
    rule: row.rule,
    evidence_path: row.evidencePath ?? "",
    evidence_snippet: row.evidenceSnippet ?? "",
    confidence: row.confidence ?? 0,
    accepted: row.accepted,
  };
}

export class ConventionsService {
  private repo: ConventionsRepository;
  private skills: SkillsService;

  constructor(private container: Container) {
    this.repo = new ConventionsRepository(container.db);
    this.skills = new SkillsService(container);
  }

  async list(
    workspaceId: string,
    repoId: string,
  ): Promise<ConventionCandidate[]> {
    const rows = await this.repo.listByRepo(workspaceId, repoId);
    return rows.map(toDto);
  }

  async extract(
    workspaceId: string,
    repoId: string,
  ): Promise<ConventionCandidate[]> {
    const [repoRow] = await this.container.db
      .select()
      .from(t.repos)
      .where(eq(t.repos.id, repoId));

    if (!repoRow) throw new NotFoundError("Repository not found");
    if (!repoRow.clonePath)
      throw new ValidationError("Repository not cloned — clone it first");

    // clonePath is a stored absolute path; it can go stale if the repo was
    // moved on disk. Verify the directory actually exists so we fail loudly
    // here instead of silently returning [] when every file read misses.
    const cloneDirOk = await stat(repoRow.clonePath)
      .then((s) => s.isDirectory())
      .catch(() => false);
    if (!cloneDirOk)
      throw new ValidationError(
        "Clone directory is missing — refresh the repository to re-clone it, then scan again",
      );

    const samplePaths = await this.container.repoIntel.getConventionSamples(
      repoId,
      12,
    );

    // Provider + model are selected per-workspace in Settings (feature_models),
    // falling back to the registry default for the 'conventions' feature. Never
    // hardcode the model here — respect the workspace's configured choice.
    const { provider, model } = await resolveFeatureModel(
      this.container,
      workspaceId,
      "conventions",
    );
    const llm = await this.container.llm(provider);

    const candidates = await extractConventions({
      clonePath: repoRow.clonePath,
      samplePaths,
      repoName: repoRow.name,
      llm,
      model,
    });

    const rows = await this.repo.replaceAll(workspaceId, repoId, candidates);
    return rows.map(toDto);
  }

  async accept(
    workspaceId: string,
    id: string,
  ): Promise<ConventionCandidate | undefined> {
    const row = await this.repo.accept(workspaceId, id);
    return row ? toDto(row) : undefined;
  }

  async reject(workspaceId: string, id: string): Promise<boolean> {
    return this.repo.reject(workspaceId, id);
  }

  async updateRule(
    workspaceId: string,
    id: string,
    rule: string,
  ): Promise<ConventionCandidate | undefined> {
    const row = await this.repo.updateRule(workspaceId, id, rule);
    return row ? toDto(row) : undefined;
  }

  /**
   * Створює скіл з усіх accepted конвенцій.
   */
  async createSkillFromAccepted(
    workspaceId: string,
    repoId: string,
    skillName: string,
    skillDescription: string,
  ): Promise<Skill> {
    const [repoRow] = await this.container.db
      .select()
      .from(t.repos)
      .where(eq(t.repos.id, repoId));

    const accepted = await this.repo.listAccepted(workspaceId, repoId);
    if (accepted.length === 0)
      throw new ValidationError("No accepted conventions to create skill from");

    const repoName = repoRow?.name ?? "repo";

    const sections = accepted.map((c) => {
      const snippetBlock = c.evidenceSnippet
        ? `\nDetected in \`${c.evidencePath}\`:\n\`\`\`\n${c.evidenceSnippet}\n\`\`\``
        : "";
      return `## ${c.rule}${snippetBlock}`;
    });

    const body = [
      `# ${skillName}`,
      "",
      `House conventions for \`${repoName}\`. Flag changes that violate any rule below and cite the offending \`file:line\`.`,
      "",
      ...sections,
    ].join("\n\n");

    return this.skills.create(workspaceId, {
      name: skillName,
      description: skillDescription,
      type: "convention",
      source: "extracted",
      body,
      enabled: true,
    });
  }
}
