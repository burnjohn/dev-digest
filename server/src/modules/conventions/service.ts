import type { Container } from '../../platform/container.js';
import type { ConventionCandidate, ConventionScan } from '@devdigest/shared';
import { resolveFeatureModel } from '../settings/feature-models.js';
import { ValidationError } from '../../platform/errors.js';
import { ConventionsRepository, type UpdateConvention } from './repository.js';
import { toConventionDto } from './helpers.js';
import { readSamples, runExtractionModel, selectConfigFiles, verifyEvidence } from './extract.js';
import { SAMPLE_FILE_COUNT } from './constants.js';

/**
 * Conventions service: scan a cloned repo for house-rule candidates via a
 * cheap model, evidence-check them against disk, and let the user accept /
 * reject / edit each one. See specs/03-conventions.md.
 */
export class ConventionsService {
  private repo: ConventionsRepository;

  constructor(private container: Container) {
    this.repo = new ConventionsRepository(container.db);
  }

  /**
   * Run one extraction pass: config files (no model) + top-ranked source
   * files → cheap-model candidates → disk-verified evidence → persisted.
   * Synchronous — bounded to ~12 files + a handful of configs, not a full
   * repo walk, so no job-queue plumbing.
   */
  async extract(workspaceId: string, repoId: string): Promise<ConventionScan> {
    const clonePath = await this.repo.getClonePath(workspaceId, repoId);
    if (!clonePath) {
      throw new ValidationError('Repo has not been cloned yet — wait for it to finish indexing');
    }

    const configPaths = selectConfigFiles(clonePath);
    const samplePaths = await this.container.repoIntel.getConventionSamples(repoId, SAMPLE_FILE_COUNT);
    const [configFiles, sampleFiles] = await Promise.all([
      readSamples(clonePath, configPaths),
      readSamples(clonePath, samplePaths),
    ]);

    const { provider, model } = await resolveFeatureModel(this.container, workspaceId, 'conventions');
    const llm = await this.container.llm(provider);
    const modelResult = await runExtractionModel(llm, model, configFiles, sampleFiles);
    const { kept } = await verifyEvidence(clonePath, modelResult.raw);

    await this.repo.deletePending(workspaceId, repoId);
    await this.repo.insertMany(workspaceId, repoId, kept);
    await this.repo.upsertScanState(repoId, configFiles.length + sampleFiles.length);

    return this.list(workspaceId, repoId);
  }

  /** Current candidates for a repo — no LLM call. Never-scanned repos get an empty scan. */
  async list(workspaceId: string, repoId: string): Promise<ConventionScan> {
    const [rows, scanState] = await Promise.all([
      this.repo.listByRepo(workspaceId, repoId),
      this.repo.getScanState(repoId),
    ]);
    return {
      sampled_files: scanState?.sampledFiles ?? 0,
      scanned_at: scanState?.updatedAt.toISOString() ?? null,
      candidates: rows.map(toConventionDto),
    };
  }

  /** Accept/reject toggle and/or rule/category edit. `undefined` when not in this workspace. */
  async update(
    workspaceId: string,
    id: string,
    patch: UpdateConvention,
  ): Promise<ConventionCandidate | undefined> {
    const row = await this.repo.update(workspaceId, id, patch);
    return row ? toConventionDto(row) : undefined;
  }
}
