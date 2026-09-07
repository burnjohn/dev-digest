import type {
  Skill,
  SkillImportPreview,
  SkillListStats,
  SkillPreview,
  SkillStats,
  SkillType,
  SkillVersion,
  SkillWithStats,
} from '@devdigest/shared';
import type { Tokenizer } from '../../adapters/tokenizer/index.js';
import { ValidationError } from '../../platform/errors.js';
// THE one project-context renderer, shared with the run executor/adhoc
// service — never re-implement this formatting here (specs/09-project-
// context-folder.md AC-13/D1: a preview that formats differently is lying
// about what a run actually injects).
import { renderProjectContextBlock } from '../_shared/project-context-render.js';
import { SkillsRepository, type SkillRow } from './repository.js';
import { MAX_BODY_BYTES, MAX_UPLOAD_BYTES, MAX_URL_REDIRECTS, URL_FETCH_TIMEOUT_MS } from './constants.js';
import {
  assertPublicHttpUrl,
  isBodyChange,
  parseSkillMarkdown,
  parseSkillUpload,
  renderSkillBlock,
  toSkillDto,
} from './helpers.js';

/**
 * Skills application service — CRUD, version bump, preview, import parse, stats.
 *
 * A skill is a named, reusable markdown block of reviewer instructions that any
 * number of agents can link, order and toggle. It has no code, no tools and no
 * execution: it is text that gets concatenated into the prompt.
 *
 * TWO GATES, ONE RULE. A body reaches a prompt iff `skills.enabled` (the
 * workspace/vetting gate this service owns) AND `agent_skills.enabled` (the
 * per-agent gate the agents module owns) are both true. Neither implies the
 * other, and a skill switched off here disappears from every agent's prompt
 * while staying checked on each agent.
 *
 * Dependencies arrive by constructor injection — the same `Tokenizer` the run
 * executor uses to fill `run_skills.tokens`, so the editor's live counter, the
 * Preview tab and the Stats tab can never disagree about the same skill.
 */

export interface CreateSkillInput {
  name: string;
  description: string;
  type: SkillType;
  source?: Skill['source'];
  body: string;
  enabled?: boolean;
  /** File:line citations — set by the Conventions extractor, left unset otherwise. */
  evidenceFiles?: string[];
}

export interface UpdateSkillInput {
  name?: string;
  description?: string;
  type?: SkillType;
  body?: string;
  enabled?: boolean;
}

/**
 * specs/09-project-context-folder.md — the narrow port `preview()` needs to
 * render a skill's own attached documents (AC-13/D1). Declared locally
 * (`no-cross-module`) — `container.projectContextService` satisfies this
 * structurally; wired at the composition root (`platform/container.ts`,
 * `modules/skills/routes.ts`), never imported directly.
 */
export interface ProjectContextLookup {
  resolveSkillDocuments(
    skillId: string,
  ): Promise<{ documents: { path: string; content: string }[] }>;
}

/**
 * specs/15-skill-eval-cases.md AC-43 — declared HERE, by the consumer, not
 * imported from `modules/eval/*` (`no-cross-module`), mirroring
 * `modules/agents/service.ts`'s `EvalCleanup`. `container.evalRepo`
 * satisfies this structurally; wired at `modules/skills/routes.ts`. Optional
 * so every pre-existing two/three-argument `new SkillsService(...)` in tests
 * keeps compiling.
 */
export interface EvalCleanup {
  deleteForOwner(workspaceId: string, ownerKind: 'skill' | 'agent', ownerId: string): Promise<void>;
}

export class SkillsService {
  constructor(
    private repo: SkillsRepository,
    private tokenizer: Tokenizer,
    private projectContext: ProjectContextLookup,
    private evalCleanup?: EvalCleanup,
  ) {}

  /**
   * The rail: every workspace skill plus its footer stats. The stats come from
   * grouped queries over the whole id set, NOT one request per card — a rail of
   * 40 skills costs the same number of round trips as a rail of 2.
   */
  async list(workspaceId: string): Promise<SkillWithStats[]> {
    const rows = await this.repo.list(workspaceId);
    const stats = await this.repo.listStats(
      workspaceId,
      rows.map((r) => r.id),
    );
    return rows.map((row) => ({
      ...toSkillDto(row),
      stats: toListStatsDto(stats.get(row.id)),
    }));
  }

  async get(workspaceId: string, id: string): Promise<Skill | undefined> {
    const row = await this.repo.getById(workspaceId, id);
    return row ? toSkillDto(row) : undefined;
  }

  async create(workspaceId: string, input: CreateSkillInput): Promise<Skill> {
    this.assertBodyFits(input.body);
    await this.assertNameFree(workspaceId, input.name);
    const row = await this.repo.insert({
      workspaceId,
      name: input.name,
      description: input.description,
      type: input.type,
      source: input.source ?? 'manual',
      body: input.body,
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      ...(input.evidenceFiles !== undefined ? { evidenceFiles: input.evidenceFiles } : {}),
    });
    return toSkillDto(row);
  }

  /**
   * Update a skill. The version bump rule, in one place:
   *
   *   body changed  → archive the PREVIOUS body at the CURRENT version, then
   *                   `skills.version += 1`
   *   anything else → no version, no archive
   *
   * So a rename or a description edit leaves the `v5` chip alone, and
   * "saving a changed body creates a new immutable version" stays honest.
   */
  async update(
    workspaceId: string,
    id: string,
    patch: UpdateSkillInput,
  ): Promise<Skill | undefined> {
    const existing = await this.repo.getById(workspaceId, id);
    if (!existing) return undefined;
    if (patch.body !== undefined) this.assertBodyFits(patch.body);
    if (patch.name !== undefined && patch.name !== existing.name) {
      await this.assertNameFree(workspaceId, patch.name);
    }

    const row = await this.repo.update(workspaceId, id, patch, {
      bumpVersion: isBodyChange(existing, patch),
    });
    return row ? toSkillDto(row) : undefined;
  }

  /**
   * Delete a skill; `agent_skills` and `run_skills` cascade with it at the
   * DB level. specs/15-skill-eval-cases.md AC-43 — its eval cases (and their
   * runs) are deleted FIRST, application-side: `eval_cases.owner_id` is
   * polymorphic with no FK to `skills`, so nothing cascades at the database
   * level for that table (the SPEC-12 D18 problem, second instance).
   */
  async delete(workspaceId: string, id: string): Promise<boolean> {
    await this.evalCleanup?.deleteForOwner(workspaceId, 'skill', id);
    return this.repo.deleteById(workspaceId, id);
  }

  /**
   * Archived bodies, newest first. Workspace-scoped: returns undefined when the
   * skill isn't in this workspace (the route maps that to 404) so history can't
   * be read across tenants.
   */
  async listVersions(workspaceId: string, id: string): Promise<SkillVersion[] | undefined> {
    const skill = await this.repo.getById(workspaceId, id);
    if (!skill) return undefined;
    const rows = await this.repo.listVersions(id);
    return rows.map((row) => ({
      skill_id: row.skillId,
      version: row.version,
      body: row.body,
      created_at: row.createdAt.toISOString(),
    }));
  }

  async getVersion(
    workspaceId: string,
    id: string,
    version: number,
  ): Promise<SkillVersion | undefined> {
    const skill = await this.repo.getById(workspaceId, id);
    if (!skill) return undefined;
    const row = await this.repo.getVersion(id, version);
    if (!row) return undefined;
    return {
      skill_id: row.skillId,
      version: row.version,
      body: row.body,
      created_at: row.createdAt.toISOString(),
    };
  }

  /**
   * Restore an archived body as the new current one. This does NOT rewrite
   * history — it goes through the same `update` path a manual copy-paste
   * would (see `VersionsTab`'s original v1 note): the current body is
   * archived at its own version, `skills.version` bumps, and the restored
   * body becomes current. History stays append-only; "restore" is really
   * "update, with the old body as the source."
   *
   * `getVersion` only ever finds a PREVIOUS body (the current one is never
   * archived until superseded — see `skill_versions`'s own comment), so
   * restoring the already-current version naturally 404s instead of needing
   * a special case.
   */
  async restoreVersion(workspaceId: string, id: string, version: number): Promise<Skill | undefined> {
    const skill = await this.repo.getById(workspaceId, id);
    if (!skill) return undefined;
    const target = await this.repo.getVersion(id, version);
    if (!target) return undefined;
    return this.update(workspaceId, id, { body: target.body });
  }

  /**
   * The Preview tab: EXACTLY the block the run executor will inject, plus its
   * real token cost. `renderSkillBlock` is the one shared renderer — if this
   * ever stops calling it, the tab starts lying about what the model receives.
   */
  async preview(workspaceId: string, id: string): Promise<SkillPreview | undefined> {
    const row = await this.repo.getById(workspaceId, id);
    if (!row) return undefined;
    const block = renderSkillBlock(toRenderable(row));
    // AC-13/D1 — the skill's own attached documents, rendered by the SAME
    // renderer + heading a run actually emits (`## Project context`). Null
    // when the skill has nothing attached, matching the run's own
    // omit-when-empty contract for that section.
    const { documents } = await this.projectContext.resolveSkillDocuments(id);
    const projectContextBlock = renderProjectContextBlock(documents);
    return {
      block,
      tokens: this.tokenizer.count(block),
      project_context_block: projectContextBlock,
      project_context_tokens: projectContextBlock ? this.tokenizer.count(projectContextBlock) : 0,
    };
  }

  /** Stats tab payload. Every `null` here means UNMEASURED and renders as "—". */
  async stats(workspaceId: string, id: string): Promise<SkillStats | undefined> {
    const row = await this.repo.getById(workspaceId, id);
    if (!row) return undefined;
    const s = await this.repo.statsFor(workspaceId, id);
    return {
      used_by: s.usedBy,
      agents: s.agents,
      pull_pct: s.pullPct,
      accept_pct: s.acceptPct,
      findings_30d: s.findings,
      by_category: s.byCategory,
      avg_tokens: s.avgTokens,
    };
  }

  /**
   * Live counter for the body editor. Deliberately the same tokenizer as
   * `preview` and as `run_skills.tokens` — a `chars / 4` estimate here would
   * make the editor and the Stats tab quote different numbers for one skill.
   */
  countTokens(body: string): { tokens: number } {
    this.assertBodyFits(body);
    return { tokens: this.tokenizer.count(body) };
  }

  /**
   * PARSE ONLY — nothing is persisted. The client shows this preview and only
   * then calls `POST /skills` with the confirmed fields (applying
   * `IMPORT_DEFAULTS` for `type` / `source` / `enabled`), which is the whole
   * "save after confirmation" requirement expressed as two endpoints.
   *
   * `collides_with` is the one field that needs the workspace: it is why this
   * lives on the service and not in the pure parser.
   */
  async parseImport(
    workspaceId: string,
    filename: string,
    contentB64: string,
  ): Promise<SkillImportPreview> {
    const bytes = decodeBase64(contentB64);
    const parsed = parseSkillUpload(filename, bytes);
    const collision = await this.repo.getByName(workspaceId, parsed.name);
    return {
      name: parsed.name,
      description: parsed.description,
      body: parsed.body,
      source_path: parsed.source_path,
      ignored_entries: parsed.ignored_entries,
      candidates: parsed.candidates ?? null,
      collides_with: collision ? collision.name : null,
    };
  }

  /**
   * Parse-only, same contract as `parseImport`: fetch a URL server-side,
   * parse it as a `SKILL.md`, and return a preview. NOTHING is persisted —
   * the client confirms via `POST /skills`, same as the file-upload path.
   */
  async parseImportFromUrl(workspaceId: string, url: string): Promise<SkillImportPreview> {
    const target = assertPublicHttpUrl(url);
    const text = await this.fetchSkillText(target);
    const parsed = parseSkillMarkdown(text, { filename: target.pathname });
    const collision = await this.repo.getByName(workspaceId, parsed.name);
    return {
      name: parsed.name,
      description: parsed.description,
      body: parsed.body,
      source_path: null,
      ignored_entries: 0,
      candidates: null,
      collides_with: collision ? collision.name : null,
    };
  }

  private async fetchSkillText(url: URL): Promise<string> {
    const controller = new AbortController();
    // Covers the whole operation (connect through body read), not just the
    // initial fetch() — a slow-drip body must not be able to hold the
    // request open past this window regardless of MAX_UPLOAD_BYTES.
    const timeout = setTimeout(() => controller.abort(), URL_FETCH_TIMEOUT_MS);
    try {
      // `redirect: 'manual'` + re-validating each hop's target ourselves:
      // a host that passes assertPublicHttpUrl on its own URL could still
      // 302 to an internal target (e.g. 169.254.169.254), and 'follow'
      // would have walked straight past the SSRF guard.
      let current = url;
      let res = await fetch(current, { signal: controller.signal, redirect: 'manual' });
      for (let hop = 0; res.status >= 300 && res.status < 400; hop++) {
        const location = res.headers.get('location');
        if (!location) break;
        if (hop >= MAX_URL_REDIRECTS) {
          throw new ValidationError(`Too many redirects fetching ${url.href}`, { field: 'url' });
        }
        current = assertPublicHttpUrl(new URL(location, current).href);
        res = await fetch(current, { signal: controller.signal, redirect: 'manual' });
      }
      if (!res.ok) {
        throw new ValidationError(`${current.href} returned ${res.status}`, { field: 'url' });
      }
      // Enforce the same size cap as a file upload — a slow-drip response body
      // must not be read past MAX_UPLOAD_BYTES regardless of Content-Length.
      const reader = res.body?.getReader();
      if (!reader) return await res.text();
      const chunks: Uint8Array[] = [];
      let total = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_UPLOAD_BYTES) {
          await reader.cancel();
          throw new ValidationError(`Response is larger than ${MAX_UPLOAD_BYTES} bytes`, {
            field: 'url',
          });
        }
        chunks.push(value);
      }
      return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8');
    } catch (e) {
      if (e instanceof ValidationError) throw e;
      throw new ValidationError(
        e instanceof Error && e.name === 'AbortError'
          ? `Timed out fetching ${url.href}`
          : `Could not fetch ${url.href}`,
        { field: 'url' },
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private assertBodyFits(body: string): void {
    if (Buffer.byteLength(body, 'utf8') > MAX_BODY_BYTES) {
      throw new ValidationError(
        `Skill body is larger than ${MAX_BODY_BYTES} bytes; a skill is prompt text, not a file`,
        { field: 'body' },
      );
    }
  }

  /**
   * Names are slugs, unique per workspace. Checking here turns a collision into
   * an inline field error the editor can show next to the input; the unique
   * index (translated in the repository) is what closes the race behind it.
   */
  private async assertNameFree(workspaceId: string, name: string): Promise<void> {
    const existing = await this.repo.getByName(workspaceId, name);
    if (existing) {
      throw new ValidationError(`A skill named "${name}" already exists in this workspace`, {
        field: 'name',
        name,
      });
    }
  }
}

/** A missing stats entry is a skill with no links and no runs — zero agents,
 *  and `null` (not 0) for both rates, so the rail footer collapses instead of
 *  printing a misleading "0% pull". */
function toListStatsDto(row: {
  usedBy: number;
  pullPct: number | null;
  acceptPct: number | null;
} | undefined): SkillListStats {
  return {
    used_by: row?.usedBy ?? 0,
    pull_pct: row?.pullPct ?? null,
    accept_pct: row?.acceptPct ?? null,
  };
}

function toRenderable(row: SkillRow): { name: string; type: SkillType; body: string } {
  return { name: row.name, type: row.type, body: row.body };
}

/** Base64 in, bytes out. Import takes a JSON body rather than multipart so the
 *  route stays zod-validated like every other route in this server. */
function decodeBase64(contentB64: string): Uint8Array {
  const buf = Buffer.from(contentB64, 'base64');
  if (buf.byteLength === 0) {
    throw new ValidationError('Upload is empty or not valid base64', { field: 'content_b64' });
  }
  if (buf.byteLength > MAX_UPLOAD_BYTES) {
    throw new ValidationError(`Upload is larger than ${MAX_UPLOAD_BYTES} bytes`, {
      field: 'content_b64',
    });
  }
  return new Uint8Array(buf);
}
