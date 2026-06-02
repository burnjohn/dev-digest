import type { Container } from '../../platform/container.js';
import type {
  CiExport,
  CiExportInput,
  CiFile,
  CiInstallation,
  CiRun,
  CiTarget,
} from '@devdigest/shared/contracts/eval-ci';
import { and, eq } from 'drizzle-orm';
import * as t from '../../db/schema.js';
import { NotFoundError } from '../../platform/errors.js';
import { AgentsRepository } from '../agents/repository.js';
import {
  OctokitCiActionsClient,
  type CiActionsClient,
  type WorkflowRunSummary,
} from './actions-client.js';
import { CI_RUN_SOURCE, EXPORT_PR_TITLE, WORKFLOW_PATH } from './constants.js';
import { mapConclusion, slugify, splitRepo } from './helpers.js';

/**
 * A4 — Export-to-CI + CI Runs (§7 L06).
 *
 * Export: generate the workflow + agent/skill artifacts, optionally open a PR in
 * the target repo via the Octokit GitHubClient (PAT), and persist a
 * `ci_installations` row.
 *
 * Ingestion (local-first): poll our `devdigest-review.yml` workflow runs through
 * the Actions API (`CiActionsClient`, PAT `Actions: Read`), read each run's
 * `devdigest-result.json` artifact, and upsert `ci_runs`. No webhooks.
 */
export class CiService {
  private agents: AgentsRepository;

  constructor(
    private container: Container,
    /** Injectable for tests (mock Actions API); may be late-bound and return
     *  undefined, in which case the real Octokit client is used. */
    private actionsClientFactory?: () => Promise<CiActionsClient | undefined>,
  ) {
    this.agents = new AgentsRepository(container.db);
  }

  // ---- Export -------------------------------------------------------------

  async export(workspaceId: string, agentId: string, input: CiExportInput): Promise<CiExport> {
    const agent = await this.agents.getById(workspaceId, agentId);
    if (!agent) throw new NotFoundError('Agent not found');
    const skillIds = await this.agents.skillIdsForAgent(agentId);
    const skills = await this.agents.linkedSkills(agentId);

    const files = this.generateFiles(input, {
      name: agent.name,
      slug: slugify(agent.name),
      provider: agent.provider,
      model: agent.model,
      systemPrompt: agent.systemPrompt,
      skills: skills.map((l) => ({ name: l.skill.name, body: l.skill.body })),
    });

    let prUrl: string | null = null;
    if (input.action === 'open_pr') {
      const { owner, name } = splitRepo(input.repo);
      const github = await this.container.github();
      const res = await github.openPullRequest(
        { owner, name },
        {
          title: EXPORT_PR_TITLE,
          head: `devdigest/ci-${input.target}`,
          base: input.base,
          body: this.prBody(agent.name, input.target, files),
        },
      );
      prUrl = res.url;
    }

    const [row] = await this.container.db
      .insert(t.ciInstallations)
      .values({ agentId, repo: input.repo, targetType: input.target })
      .returning();

    return {
      installation: this.installationToDto(row!),
      files,
      pr_url: prUrl,
    };
  }

  async listInstallations(workspaceId: string): Promise<CiInstallation[]> {
    // installations join through agents for workspace scoping
    const rows = await this.container.db
      .select({ ci: t.ciInstallations })
      .from(t.ciInstallations)
      .innerJoin(t.agents, eq(t.agents.id, t.ciInstallations.agentId))
      .where(eq(t.agents.workspaceId, workspaceId));
    return rows.map((r) => this.installationToDto(r.ci));
  }

  // ---- CI Runs (ingestion + read) ----------------------------------------

  /**
   * Ingest CI runs for every installation in the workspace (or a single repo).
   * Polls the Actions API, reads artifacts, and upserts `ci_runs`. Returns the
   * full, freshly-read list of runs for the workspace.
   */
  async listRuns(
    workspaceId: string,
    opts: { ingest?: boolean } = {},
  ): Promise<CiRun[]> {
    if (opts.ingest !== false) {
      await this.ingest(workspaceId).catch(() => undefined); // resilient: never block reads
    }
    const rows = await this.container.db
      .select({ run: t.ciRuns })
      .from(t.ciRuns)
      .leftJoin(t.ciInstallations, eq(t.ciInstallations.id, t.ciRuns.ciInstallationId))
      .leftJoin(t.agents, eq(t.agents.id, t.ciInstallations.agentId))
      .where(eq(t.agents.workspaceId, workspaceId));
    return rows
      .map((r) => this.runToDto(r.run))
      .sort((a, b) => (b.ran_at ?? '').localeCompare(a.ran_at ?? ''));
  }

  /** Poll Actions for each installation and upsert ci_runs (idempotent by github_url). */
  async ingest(workspaceId: string): Promise<number> {
    const installations = await this.container.db
      .select({ ci: t.ciInstallations })
      .from(t.ciInstallations)
      .innerJoin(t.agents, eq(t.agents.id, t.ciInstallations.agentId))
      .where(eq(t.agents.workspaceId, workspaceId));

    if (installations.length === 0) return 0;
    const client = await this.resolveActionsClient();

    let upserted = 0;
    for (const { ci } of installations) {
      const { owner, name } = splitRepo(ci.repo);
      const runs = await client.listWorkflowRuns({ owner, name });
      for (const run of runs) {
        const artifact =
          run.conclusion === 'success' || run.conclusion === 'failure'
            ? await client.getResultArtifact({ owner, name }, run.id)
            : null;
        await this.upsertRun(ci.id, run, artifact);
        upserted += 1;
      }
    }
    return upserted;
  }

  private async upsertRun(
    installationId: string,
    run: WorkflowRunSummary,
    artifact: Awaited<ReturnType<CiActionsClient['getResultArtifact']>>,
  ): Promise<void> {
    const status = mapConclusion(run.conclusion, artifact?.findings_count ?? null);
    const values = {
      ciInstallationId: installationId,
      prNumber: artifact?.pr_number ?? run.pr_number ?? null,
      ranAt: run.created_at ? new Date(run.created_at) : null,
      status,
      findingsCount: artifact?.findings_count ?? null,
      costUsd: artifact?.cost_usd ?? null,
      githubUrl: run.html_url,
      source: CI_RUN_SOURCE,
    };

    // idempotent on github_url (one row per Actions run)
    if (run.html_url) {
      const [existing] = await this.container.db
        .select()
        .from(t.ciRuns)
        .where(eq(t.ciRuns.githubUrl, run.html_url));
      if (existing) {
        await this.container.db
          .update(t.ciRuns)
          .set(values)
          .where(eq(t.ciRuns.id, existing.id));
        return;
      }
    }
    await this.container.db.insert(t.ciRuns).values(values);
  }

  // ---- File generation ----------------------------------------------------

  private generateFiles(
    input: CiExportInput,
    agent: {
      name: string;
      slug: string;
      provider: string;
      model: string;
      systemPrompt: string;
      skills: { name: string; body: string }[];
    },
  ): CiFile[] {
    const files: CiFile[] = [];

    files.push({
      path: WORKFLOW_PATH,
      contents: this.workflowYaml(input, agent.slug),
      editable: true,
    });

    files.push({
      path: `.devdigest/agents/${agent.slug}.yaml`,
      contents: this.agentYaml(agent),
      editable: true,
    });

    for (const s of agent.skills) {
      files.push({
        path: `.devdigest/skills/${slugify(s.name)}.md`,
        contents: `# ${s.name}\n\n${s.body}\n`,
        editable: true,
      });
    }

    files.push({
      path: '.devdigest/memory.jsonl',
      contents: '',
      editable: true,
    });

    return files;
  }

  private workflowYaml(input: CiExportInput, slug: string): string {
    if (input.target !== 'gha') {
      // non-GHA targets get a CLI-style stub; GHA is the supported path.
      return [
        '# DevDigest CI (generic) — runs the devdigest CLI on each PR',
        'steps:',
        '  - run: npx devdigest review --pr "$PR_NUMBER" --agent ' + slug,
        '',
      ].join('\n');
    }
    const types = input.triggers.map((x) => x).join(', ');
    const post =
      input.post_as === 'github_review'
        ? '          post: github-review'
        : input.post_as === 'pr_comment'
          ? '          post: pr-comment'
          : '          post: none';
    return [
      'name: DevDigest Review',
      'on:',
      '  pull_request:',
      `    types: [${types}]`,
      '',
      'jobs:',
      '  review:',
      '    runs-on: ubuntu-latest',
      '    steps:',
      '      - uses: actions/checkout@v4',
      '      - uses: devdigest/review-action@v1',
      '        with:',
      `          agent: ${slug}`,
      '          openai-key: ${{ secrets.OPENAI_API_KEY }}',
      post,
      '        env:',
      '          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}',
      '',
    ].join('\n');
  }

  private agentYaml(agent: {
    name: string;
    provider: string;
    model: string;
    systemPrompt: string;
    skills: { name: string }[];
  }): string {
    return [
      `name: ${agent.name}`,
      `provider: ${agent.provider}`,
      `model: ${agent.model}`,
      'system_prompt: |',
      ...agent.systemPrompt.split('\n').map((l) => `  ${l}`),
      'skills:',
      ...agent.skills.map((s) => `  - ${slugify(s.name)}`),
      '',
    ].join('\n');
  }

  private prBody(agentName: string, target: CiTarget, files: CiFile[]): string {
    const list = files.map((f) => `- \`${f.path}\``).join('\n');
    return [
      `This PR wires up **DevDigest** to review pull requests automatically using the **${agentName}** agent (${target}).`,
      '',
      '**Files added:**',
      list,
      '',
      'Add `OPENAI_API_KEY` to the repo Actions secrets before the workflow runs. `GITHUB_TOKEN` is auto-provided.',
      '',
      '_Opened via DevDigest Export-to-CI._',
    ].join('\n');
  }

  // ---- DTOs / clients -----------------------------------------------------

  private async resolveActionsClient(): Promise<CiActionsClient> {
    if (this.actionsClientFactory) {
      // Factory may be late-bound (returns undefined when no override is set);
      // fall through to the real client in that case.
      const override = await this.actionsClientFactory();
      if (override) return override;
    }
    const token = await this.container.secrets.get('GITHUB_TOKEN');
    if (!token) throw new NotFoundError('GITHUB_TOKEN is not configured for Actions ingestion');
    return new OctokitCiActionsClient(token);
  }

  private installationToDto(row: typeof t.ciInstallations.$inferSelect): CiInstallation {
    return {
      id: row.id,
      agent_id: row.agentId,
      repo: row.repo,
      target_type: row.targetType as CiTarget,
      installed_at: row.installedAt.toISOString(),
    };
  }

  private runToDto(row: typeof t.ciRuns.$inferSelect): CiRun {
    return {
      id: row.id,
      ci_installation_id: row.ciInstallationId,
      pr_number: row.prNumber,
      ran_at: row.ranAt?.toISOString() ?? null,
      status: row.status,
      findings_count: row.findingsCount,
      cost_usd: row.costUsd,
      github_url: row.githubUrl,
      source: row.source,
      duration_s: null,
    };
  }
}
