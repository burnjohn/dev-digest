import { eq } from 'drizzle-orm';
import type { Convention, ConventionScan, ConventionSkillInput, Skill } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import * as t from '../../db/schema.js';
import { NotFoundError, AppError } from '../../platform/errors.js';
import { ConventionsRepository } from './repository.js';
import { ConventionExtractor } from './extractor.js';
import type { ConventionRow, ConventionScanRow } from './repository.js';

function toScanDto(row: ConventionScanRow): ConventionScan {
  return {
    id: row.id,
    workspace_id: row.workspaceId,
    repo_id: row.repoId,
    commit_sha: row.commitSha,
    status: row.status as ConventionScan['status'],
    scanned_file_count: row.scannedFileCount ?? null,
    candidate_count: row.candidateCount ?? null,
    verified_count: row.verifiedCount ?? null,
    created_at: row.createdAt.toISOString(),
  };
}

function toDto(row: ConventionRow): Convention {
  return {
    id: row.id,
    workspace_id: row.workspaceId,
    repo_id: row.repoId ?? null,
    scan_id: row.scanId ?? null,
    category: row.category ?? null,
    rule: row.rule,
    edited_rule: row.editedRule ?? null,
    evidence_path: row.evidencePath ?? null,
    evidence_snippet: row.evidenceSnippet ?? null,
    evidence_line: row.evidenceLine ?? null,
    evidence_line_end: row.evidenceLineEnd ?? null,
    evidence_url: row.evidenceUrl ?? null,
    model_confidence: row.modelConfidence ?? null,
    verified_confidence: row.verifiedConfidence ?? null,
    confidence: row.confidence ?? null,
    status: row.status as Convention['status'],
    accepted: row.accepted,
    dedup_key: row.dedupKey ?? null,
    created_at: row.createdAt.toISOString(),
  };
}

export class ConventionsService {
  private repo: ConventionsRepository;
  private extractor: ConventionExtractor;

  constructor(private container: Container) {
    this.repo = new ConventionsRepository(container.db);
    this.extractor = new ConventionExtractor(container);
  }

  async listScans(workspaceId: string, repoId: string): Promise<ConventionScan[]> {
    const rows = await this.repo.listScans(workspaceId, repoId);
    return rows.map(toScanDto);
  }

  async list(workspaceId: string, repoId: string): Promise<Convention[]> {
    const rows = await this.repo.list(workspaceId, repoId);
    return rows.map(toDto);
  }

  /**
   * Kick off a background convention extraction for a repo.
   * Returns the scan record immediately (status='running'); the caller polls.
   */
  async extract(workspaceId: string, repoId: string, log: { info: (msg: string, ctx?: unknown) => void; error: (msg: string, ctx?: unknown) => void }): Promise<ConventionScan> {
    const [repoRow] = await this.container.db
      .select()
      .from(t.repos)
      .where(eq(t.repos.id, repoId));
    if (!repoRow) throw new NotFoundError(`Repo ${repoId}`);

    // Resolve the clone path (where the repo is checked out on disk).
    // Fall back gracefully — clonePath may be null on repos not yet cloned.
    const repoRoot = repoRow.clonePath;
    if (!repoRoot) {
      throw new AppError(
        'repo_not_cloned',
        `Repo ${repoId} has no local clone — run a review first to trigger cloning.`,
        409,
      );
    }

    // Use the last indexed SHA from repo-intel state; fall back to 'HEAD' if not yet indexed.
    // SHA-pinning ensures evidence URLs remain stable for the lifetime of this scan.
    const indexState = await this.container.repoIntel.getIndexState(repoId);
    const commitSha = indexState.lastIndexedSha ?? 'HEAD';

    const scan = await this.repo.insertScan({ workspaceId, repoId, commitSha });

    // Fire-and-forget — same pattern as POST /repos/:id/review-all.
    // The log must be captured before the async work starts (Fastify recycles req.log).
    setImmediate(() => {
      this.runExtraction(scan.id, {
        workspaceId,
        repoId,
        repoRoot,
        commitSha,
        githubOwner: repoRow.owner,
        githubName: repoRow.name,
      }, log).catch((err) => {
        log.error('convention extraction failed', { scanId: scan.id, err });
      });
    });

    return toScanDto(scan);
  }

  private async runExtraction(
    scanId: string,
    params: {
      workspaceId: string;
      repoId: string;
      repoRoot: string;
      commitSha: string;
      githubOwner: string;
      githubName: string;
    },
    log: { info: (msg: string, ctx?: unknown) => void; error: (msg: string, ctx?: unknown) => void },
  ): Promise<void> {
    try {
      const result = await this.extractor.extract({ ...params, scanId });

      if (result.candidates.length > 0) {
        await this.repo.upsertBatch(result.candidates);
      }

      await this.repo.updateScan(params.workspaceId, scanId, {
        status: 'done',
        scannedFileCount: result.scannedFileCount,
        candidateCount: result.candidateCount,
        verifiedCount: result.verifiedCount,
      });

      log.info('convention extraction done', {
        scanId,
        scanned: result.scannedFileCount,
        candidates: result.candidateCount,
        verified: result.verifiedCount,
      });
    } catch (err) {
      await this.repo.updateScan(params.workspaceId, scanId, { status: 'failed' });
      throw err;
    }
  }

  async patch(
    workspaceId: string,
    id: string,
    action: 'accept' | 'reject' | 'edit' | 'undo',
    editedRule?: string,
  ): Promise<Convention> {
    const existing = await this.repo.getById(workspaceId, id);
    if (!existing) throw new NotFoundError(`Convention ${id}`);

    const statusMap = {
      accept: 'accepted',
      reject: 'rejected_user',
      edit: 'edited',
      undo: 'pending',
    } as const;

    const row = await this.repo.updateStatus(workspaceId, id, {
      status: statusMap[action],
      ...(action === 'undo' ? { editedRule: undefined } : {}),
      ...(action === 'edit' && editedRule ? { editedRule } : {}),
    });
    if (!row) throw new NotFoundError(`Convention ${id}`);
    return toDto(row);
  }

  /**
   * Create one or more Skills from the currently accepted conventions in a repo.
   * Rejected conventions are never included. Links conventions → skills via
   * convention_skill_links.
   */
  async createSkills(
    workspaceId: string,
    repoId: string,
    input: ConventionSkillInput,
  ): Promise<Skill[]> {
    const accepted = await this.repo.listAccepted(workspaceId, repoId);
    if (accepted.length === 0) {
      throw new AppError('no_accepted_conventions', 'No accepted conventions to create skills from.', 422);
    }

    const { SkillsRepository } = await import('../skills/repository.js');
    const skillsRepo = new SkillsRepository(this.container.db);
    const { toSkillDto } = await import('../skills/helpers.js');

    if (input.mode === 'merge') {
      const body = buildSkillBody(input.name, accepted.map(r => ({
        category: r.category ?? 'General',
        rule: r.editedRule ?? r.rule,
        evidenceSnippet: r.evidenceSnippet ?? '',
        evidencePath: r.evidencePath ?? '',
        evidenceLine: r.evidenceLine ?? null,
      })));
      const skillRow = await skillsRepo.insert({
        workspaceId,
        name: input.name,
        description: input.description,
        type: input.type,
        source: 'extracted',
        body,
      });
      await this.repo.insertSkillLinks(accepted.map(c => ({ conventionId: c.id, skillId: skillRow.id })));
      return [toSkillDto(skillRow)];
    }

    // grouped mode: one skill per requested group (filter accepted by category)
    const skills: Skill[] = [];
    for (const group of input.groups) {
      const grouped = accepted.filter(c => (c.category ?? '') === group.category);
      if (grouped.length === 0) continue;
      const body = buildSkillBody(group.name, grouped.map(r => ({
        category: r.category ?? group.category,
        rule: r.editedRule ?? r.rule,
        evidenceSnippet: r.evidenceSnippet ?? '',
        evidencePath: r.evidencePath ?? '',
        evidenceLine: r.evidenceLine ?? null,
      })));
      const skillRow = await skillsRepo.insert({
        workspaceId,
        name: group.name,
        description: group.description,
        type: group.type,
        source: 'extracted',
        body,
      });
      await this.repo.insertSkillLinks(grouped.map(c => ({ conventionId: c.id, skillId: skillRow.id })));
      skills.push(toSkillDto(skillRow));
    }
    if (skills.length === 0) {
      throw new AppError('no_matching_conventions', 'No accepted conventions matched the requested categories.', 422);
    }
    return skills;
  }
}

function groupBy<T>(arr: T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of arr) {
    const k = key(item);
    const existing = map.get(k);
    if (existing) existing.push(item);
    else map.set(k, [item]);
  }
  return map;
}

function buildSkillBody(
  skillName: string,
  entries: { category: string; rule: string; evidenceSnippet: string; evidencePath: string; evidenceLine: number | null }[],
): string {
  const byCategory = groupBy(entries, (e) => e.category);
  const sections: string[] = [`# ${skillName}\n\nFlag changes that violate any rule below and cite the offending \`file:line\`.\n`];

  for (const [category, items] of byCategory) {
    sections.push(`## ${category}`);
    for (const item of items) {
      sections.push(`**Rule:** ${item.rule}`);
      if (item.evidenceSnippet && item.evidencePath) {
        const loc = item.evidenceLine ? `${item.evidencePath}:${item.evidenceLine}` : item.evidencePath;
        sections.push(`Detected in \`${loc}\`:\n\`\`\`\n${item.evidenceSnippet}\n\`\`\``);
      }
      sections.push('');
    }
  }
  return sections.join('\n');
}
