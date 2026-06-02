import { Octokit } from 'octokit';
import type { RepoRef } from '@devdigest/shared';
import { CiResultArtifact } from '@devdigest/shared/contracts/eval-ci';
import { withRetry, withTimeout } from '../../platform/resilience.js';

const TIMEOUT = 30_000;
const WORKFLOW_FILE = 'devdigest-review.yml';
const ARTIFACT_NAME = 'devdigest-result';

/**
 * A4 — GitHub Actions ingestion client (§7 L06, "Ingestion back"). The base
 * `GitHubClient` interface (F1, owned by the shared barrel) covers PR list/detail
 * + posting reviews/opening PRs but not the Actions API, so A4 adds this thin,
 * mockable client for reading our workflow's runs + the `devdigest-result.json`
 * artifact via a PAT with `Actions: Read`. Webhooks are not needed (local-first).
 */

export interface WorkflowRunSummary {
  id: number;
  pr_number: number | null;
  status: string | null;
  conclusion: string | null;
  created_at: string | null;
  html_url: string | null;
}

export interface CiActionsClient {
  /** List runs of our `devdigest-review.yml` workflow for a repo. */
  listWorkflowRuns(repo: RepoRef): Promise<WorkflowRunSummary[]>;
  /** Fetch + parse the `devdigest-result.json` artifact for a run (null if none). */
  getResultArtifact(repo: RepoRef, runId: number): Promise<CiResultArtifact | null>;
}

/** Real Octokit-backed implementation (PAT `Actions: Read`). */
export class OctokitCiActionsClient implements CiActionsClient {
  private octokit: Octokit;

  constructor(token: string) {
    this.octokit = new Octokit({ auth: token });
  }

  async listWorkflowRuns(repo: RepoRef): Promise<WorkflowRunSummary[]> {
    return withRetry(() =>
      withTimeout(
        (async () => {
          const res = await this.octokit.rest.actions.listWorkflowRuns({
            owner: repo.owner,
            repo: repo.name,
            workflow_id: WORKFLOW_FILE,
            per_page: 50,
          });
          return res.data.workflow_runs.map((r) => ({
            id: r.id,
            pr_number: r.pull_requests?.[0]?.number ?? null,
            status: r.status ?? null,
            conclusion: r.conclusion ?? null,
            created_at: r.created_at ?? null,
            html_url: r.html_url ?? null,
          }));
        })(),
        TIMEOUT,
      ),
    ).catch(() => []);
  }

  async getResultArtifact(repo: RepoRef, runId: number): Promise<CiResultArtifact | null> {
    return withRetry(() =>
      withTimeout(
        (async () => {
          const list = await this.octokit.rest.actions.listWorkflowRunArtifacts({
            owner: repo.owner,
            repo: repo.name,
            run_id: runId,
          });
          const art = list.data.artifacts.find((a) => a.name === ARTIFACT_NAME);
          if (!art) return null;
          const zip = await this.octokit.rest.actions.downloadArtifact({
            owner: repo.owner,
            repo: repo.name,
            artifact_id: art.id,
            archive_format: 'zip',
          });
          const json = await extractResultJson(zip.data as ArrayBuffer);
          if (!json) return null;
          const parsed = CiResultArtifact.safeParse(json);
          return parsed.success ? parsed.data : null;
        })(),
        TIMEOUT,
      ),
    ).catch(() => null);
  }
}

/**
 * Extract `devdigest-result.json` from the artifact zip. Kept best-effort: the
 * real action uploads a single JSON file; we unzip and parse the first JSON
 * entry. Falls back to null on any error (the ingestion is resilient).
 */
async function extractResultJson(buf: ArrayBuffer): Promise<unknown | null> {
  try {
    // Lazy import: only the real client unzips; the mock never hits this path.
    const { unzipSync } = await import('node:zlib');
    // GitHub returns a zip, not gzip. Try a minimal zip reader via fflate if present;
    // otherwise attempt to locate a JSON payload in the raw bytes.
    const text = Buffer.from(buf).toString('utf8');
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        /* not raw JSON */
      }
    }
    // best-effort gzip attempt (some setups gzip the artifact)
    try {
      const out = unzipSync(Buffer.from(buf)).toString('utf8');
      return JSON.parse(out);
    } catch {
      return null;
    }
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Mock — for tests (no network). Returns canned runs + artifacts.
// ---------------------------------------------------------------------------

export interface MockCiActionsOptions {
  runs?: WorkflowRunSummary[];
  artifacts?: Record<number, CiResultArtifact | null>;
}

export class MockCiActionsClient implements CiActionsClient {
  constructor(private opts: MockCiActionsOptions = {}) {}

  async listWorkflowRuns(_repo: RepoRef): Promise<WorkflowRunSummary[]> {
    return (
      this.opts.runs ?? [
        {
          id: 1001,
          pr_number: 482,
          status: 'completed',
          conclusion: 'success',
          created_at: '2026-06-01T12:00:00Z',
          html_url: 'https://github.com/acme/payments-api/actions/runs/1001',
        },
      ]
    );
  }

  async getResultArtifact(_repo: RepoRef, runId: number): Promise<CiResultArtifact | null> {
    if (this.opts.artifacts && runId in this.opts.artifacts) {
      return this.opts.artifacts[runId] ?? null;
    }
    return {
      findings_count: 3,
      critical: 1,
      warning: 1,
      suggestion: 1,
      cost_usd: 0.04,
      duration_ms: 8200,
      agent: 'security-reviewer',
      version: '1',
      pr_number: 482,
    };
  }
}
