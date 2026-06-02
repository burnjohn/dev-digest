import type { Container } from '../../platform/container.js';
import type { Skill, SkillType, SkillSource, CommunitySkill } from '@devdigest/shared';
import { wrapUntrusted } from '../../platform/prompt.js';
import { AppError } from '../../platform/errors.js';
import { withTimeout } from '../../platform/resilience.js';
import { SkillsRepository } from './repository.js';
import { COMMUNITY_SKILLS } from './community-fixture.js';
import { toDto, inferType, firstLine, nameFromUrl } from './helpers.js';
import {
  DEFAULT_IMPORT_SOURCE,
  URL_IMPORT_SOURCE,
  DEFAULT_SKILL_NAME,
  URL_FETCH_TIMEOUT_MS,
  URL_FETCH_ACCEPT,
} from './constants.js';

/**
 * A1 — skills service. Create/update/toggle skills, version them, import from a
 * file body or URL, and search a curated community catalog.
 *
 * §11 prompt-injection hardening: imported / community skill bodies are
 * UNTRUSTED. We wrap them in delimiters so when assembled into a prompt they are
 * treated as data, and we DISABLE community-sourced skills on import — they must
 * be explicitly vetted + enabled by the user before an agent can use them.
 *
 * Pure helpers (toDto / inferType / firstLine / nameFromUrl) live in helpers.ts;
 * literals (patterns, defaults, fetch config) live in constants.ts.
 */

export class SkillsService {
  private repo: SkillsRepository;

  constructor(private container: Container) {
    this.repo = new SkillsRepository(container.db);
  }

  async list(workspaceId: string): Promise<Skill[]> {
    const rows = await this.repo.list(workspaceId);
    return rows.map(toDto);
  }

  async get(workspaceId: string, id: string): Promise<Skill | undefined> {
    const row = await this.repo.getById(workspaceId, id);
    return row ? toDto(row) : undefined;
  }

  async create(
    workspaceId: string,
    input: {
      name: string;
      description?: string;
      type?: SkillType;
      source?: SkillSource;
      body: string;
      enabled?: boolean;
      evidenceFiles?: string[] | null;
    },
  ): Promise<Skill> {
    const source = input.source ?? 'manual';
    const row = await this.repo.insert({
      workspaceId,
      name: input.name,
      description: input.description ?? firstLine(input.body, input.name),
      type: input.type ?? inferType(input.name, input.body),
      source,
      body: input.body,
      // Community skills are NOT auto-enabled (§11 vetting gate).
      enabled: input.enabled ?? source !== 'community',
      evidenceFiles: input.evidenceFiles ?? null,
    });
    return toDto(row);
  }

  async update(
    workspaceId: string,
    id: string,
    patch: { name?: string; description?: string; type?: SkillType; body?: string; enabled?: boolean },
  ): Promise<Skill | undefined> {
    const row = await this.repo.update(workspaceId, id, patch);
    return row ? toDto(row) : undefined;
  }

  /**
   * Import a skill from a raw file body OR a URL. Imported content is wrapped as
   * UNTRUSTED so prompt assembly treats it as data, never instructions. URL
   * fetches are timeout-bounded. Community/url-sourced imports land DISABLED and
   * require explicit vetting (enable) before use.
   */
  async importSkill(
    workspaceId: string,
    input: { body?: string; url?: string; name?: string; source?: SkillSource },
  ): Promise<Skill> {
    let rawBody = input.body;
    let source: SkillSource = input.source ?? DEFAULT_IMPORT_SOURCE;
    let name = input.name;

    if (input.url) {
      source = input.source ?? URL_IMPORT_SOURCE;
      rawBody = await this.fetchUrl(input.url);
      name = name ?? nameFromUrl(input.url);
    }

    if (!rawBody || !rawBody.trim()) {
      throw new AppError('empty_skill_body', 'Imported skill body is empty', 400);
    }

    const resolvedName = name ?? firstLine(rawBody, DEFAULT_SKILL_NAME);
    // §11: sanitize untrusted imported body — store wrapped so prompt assembly
    // (and the skill preview) treat it strictly as data.
    const safeBody = wrapUntrusted(`imported:${source}`, rawBody.trim());

    return this.create(workspaceId, {
      name: resolvedName,
      body: safeBody,
      source,
      // url/community imports are NOT trusted → arrive disabled (vetting gate)
      enabled: source === 'manual',
    });
  }

  private async fetchUrl(url: string): Promise<string> {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new AppError('invalid_url', `Not a valid URL: ${url}`, 400);
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new AppError('unsupported_scheme', 'Only http(s) URLs can be imported', 400);
    }
    const res = await withTimeout(
      fetch(url, { headers: { accept: URL_FETCH_ACCEPT } }),
      URL_FETCH_TIMEOUT_MS,
    ).catch((e: unknown) => {
      throw new AppError('import_fetch_failed', `Could not fetch ${url}: ${(e as Error).message}`, 502);
    });
    if (!res.ok) {
      throw new AppError('import_fetch_failed', `Fetch failed (${res.status}) for ${url}`, 502);
    }
    return res.text();
  }

  /** Search the curated community catalog (clearly a local fixture — see file). */
  searchCommunity(q?: string): CommunitySkill[] {
    if (!q || !q.trim()) return COMMUNITY_SKILLS;
    const needle = q.trim().toLowerCase();
    return COMMUNITY_SKILLS.filter((c) =>
      `${c.name} ${c.desc} ${c.repo} ${c.lang}`.toLowerCase().includes(needle),
    );
  }

  /** Make an (enabled) skill available to an agent via agent_skills. */
  async linkToAgent(
    workspaceId: string,
    agentId: string,
    skillId: string,
    order = 0,
  ): Promise<void> {
    const skill = await this.repo.getById(workspaceId, skillId);
    if (!skill) throw new AppError('skill_not_found', 'Skill not found', 404);
    await this.repo.linkToAgent(agentId, skillId, order);
  }

  async skillsForAgent(agentId: string): Promise<Skill[]> {
    const rows = await this.repo.skillsForAgent(agentId);
    return rows.map(toDto);
  }
}
