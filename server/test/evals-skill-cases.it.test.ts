import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { hermeticOverrides } from './helpers/overrides.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockGitClient, MockGitHubClient, MockLLMProvider } from '../src/adapters/mocks.js';

/**
 * T17 — skill-owned eval cases: validation, synthesis and execution
 * (SPEC-03; docs/plans/09-eval-pipeline.md §4.2, AC-51 through AC-60, AC-68).
 *
 * T-B (2026-08-29) — AC-68 was rewritten: a skill-owned case's arms no
 * longer run under a resolved agent's prompt/model, and a SINGLE-CASE run
 * (`POST /evals/cases/:id/run`) needs no agent at all — the
 * "with no linked enabled agent" tests below are the direct INVERSION of the
 * superseded assertions (was 404, now 200; see the implementer report for
 * T-B, which names exactly this inversion).
 *
 * T-C (2026-08-29) — completes AC-68's SET-run half: `POST /evals/batches`'s
 * skill branch now also consults no agent, no `agent_skills` link and no
 * `agents` row at all — `eval_run_batches.owner_version` is sourced from the
 * SKILL's own `version` (`EvalsRepository.getSkillSummary`) and both
 * `runner_agent_id`/`runner_agent_version` persist `null`. The "POST
 * /evals/batches — skill-owned" tests below are the direct INVERSION of the
 * superseded, still-agent-gated assertions T-B could not complete (gate G2).
 * `systemPrompt`/`model`/`provider` are the agent-free AC-72/AC-73 baseline
 * on both the SET-run and single-case paths, never a resolved agent's own
 * values.
 *
 * Mirrors `evals-routes.it.test.ts`'s (T13) fixture shape. `freshRepo()` does
 * NOT isolate an `.it` test here (server/INSIGHTS.md, 2026-08-17) — every
 * skill/agent/link this suite seeds is torn down in `afterAll`, `agent_skills`
 * links FIRST (this task's 2026-08-25-dated binding insight), so a later
 * scan in this same run never sees an earlier test's link.
 * Every batch/run-starting test needs `hermeticOverrides()`
 * (server/INSIGHTS.md, 2026-08-21) — the pipeline reaches
 * `container.llm('openrouter')` for real (AC-73's default), not `openai`.
 */

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[evals-skill-cases] Docker not available — skipping integration tests.');
}

function reviewFixture(findings: unknown[] = []) {
  return { verdict: 'comment', summary: 'ok', score: 90, findings };
}

d('modules/evals skill-owned cases (T17)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  const createdSkillIds: string[] = [];
  const createdAgentIds: string[] = [];

  beforeAll(async () => {
    pg = await startPg();
    ({ workspaceId } = await seed(pg.handle.db));
  });

  afterAll(async () => {
    // agent_skills first — a link row FKs to both agents and skills, and this
    // suite's own `resolveSkillRunner` scan reads it (this task's binding insight).
    for (const agentId of createdAgentIds) {
      await pg.handle.db.delete(t.agentSkills).where(eq(t.agentSkills.agentId, agentId));
    }
    for (const skillId of createdSkillIds) {
      await pg.handle.db.delete(t.evalCases).where(eq(t.evalCases.ownerId, skillId));
      await pg.handle.db.delete(t.evalRunBatches).where(eq(t.evalRunBatches.ownerId, skillId));
      await pg.handle.db.delete(t.skills).where(eq(t.skills.id, skillId));
    }
    for (const agentId of createdAgentIds) {
      await pg.handle.db.delete(t.evalCases).where(eq(t.evalCases.ownerId, agentId));
      await pg.handle.db.delete(t.evalRunBatches).where(eq(t.evalRunBatches.ownerId, agentId));
      await pg.handle.db.delete(t.agents).where(eq(t.agents.id, agentId));
    }
    await pg?.stop();
  });

  /**
   * `opts.openaiWorks: false` gives `openai` a MockLLMProvider with NO
   * `structured` fixture — `completeStructured` then falls to `{}`, which
   * fails `ReviewSchema.safeParse` and throws (server/INSIGHTS.md,
   * 2026-08-17: "a NEW completeStructured call breaks every existing test
   * unless {} parses"). A batch test uses this deliberately: if the
   * skill-owned path ever regressed to the LINKED AGENT's own `openai`
   * provider instead of AC-73's agent-free `openrouter` baseline, the run
   * would error instead of silently passing — proof of wiring, not just of
   * a 202/200 status code.
   */
  function makeApp(reviewFindings: unknown[] = [], opts: { openaiWorks?: boolean } = {}) {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    return buildApp({
      config,
      db: pg.handle.db,
      overrides: hermeticOverrides({
        git: new MockGitClient(),
        github: new MockGitHubClient(),
        // AC-73: `eval_baseline`'s registry default is `openrouter` /
        // `deepseek/deepseek-v4-flash` — a skill-owned case's with/without
        // arms actually call `container.llm('openrouter')` now, never the
        // linked agent's own `openai` provider. `hermeticOverrides()`'s own
        // `openrouter` default (`intentLlm()`) only recognizes the intent
        // schema and throws for anything else (server/INSIGHTS.md,
        // 2026-08-17), so this test's own review fixture must win that key.
        llm: {
          openai:
            opts.openaiWorks === false
              ? new MockLLMProvider('openai')
              : new MockLLMProvider('openai', { structured: reviewFixture(reviewFindings) }),
          openrouter: new MockLLMProvider('openrouter', { structured: reviewFixture(reviewFindings) }),
        },
      }),
    });
  }

  async function makeAgent(overrides: { enabled?: boolean } = {}) {
    const [row] = await pg.handle.db
      .insert(t.agents)
      .values({
        workspaceId,
        name: `eval-skill-agent-${randomUUID()}`,
        provider: 'openai',
        model: 'gpt-4o-mini',
        systemPrompt: 'Review this diff.',
        enabled: overrides.enabled ?? true,
      })
      .returning();
    createdAgentIds.push(row!.id);
    return row!;
  }

  async function makeSkill(overrides: { enabled?: boolean } = {}) {
    const [row] = await pg.handle.db
      .insert(t.skills)
      .values({
        workspaceId,
        name: `eval-skill-${randomUUID()}`,
        description: 'a test skill',
        type: 'convention',
        source: 'manual',
        body: 'Follow this convention.',
        enabled: overrides.enabled ?? true,
      })
      .returning();
    createdSkillIds.push(row!.id);
    return row!;
  }

  async function linkSkill(agentId: string, skillId: string, order: number) {
    await pg.handle.db.insert(t.agentSkills).values({ agentId, skillId, order });
  }

  async function createSkillCase(
    app: Awaited<ReturnType<typeof makeApp>>,
    skillId: string,
    overrides: Record<string, unknown> = {},
  ) {
    return app.inject({
      method: 'POST',
      url: '/evals/cases',
      payload: {
        owner_kind: 'skill',
        owner_id: skillId,
        name: `case-${randomUUID()}`,
        input_files: { kind: 'new_file', filename: '', after: 'const x = 1;\nconst y = 2;' },
        expected_output: [],
        ...overrides,
      },
    });
  }

  // ===========================================================================
  // POST /evals/cases — skill-owned — REQ-55, REQ-56, REQ-59, REQ-54, 413
  // ===========================================================================

  describe('POST /evals/cases — skill-owned', () => {
    it('REQ-56/REQ-59 — an absent/whitespace-only filename persists as snippet.ts; input_files and input_diff are both stored non-null, input_meta stays null', async () => {
      const app = await makeApp();
      const skill = await makeSkill();

      const res = await createSkillCase(app, skill.id, {
        input_files: { kind: 'new_file', filename: '   ', after: 'const x = 1;\nconst y = 2;' },
        expected_output: [
          { severity: 'WARNING', category: 'bug', title: 'issue', start_line: 1, end_line: 2 },
        ],
      });
      expect(res.statusCode, JSON.stringify(res.json())).toBe(201);
      const body = res.json();
      expect(body.filename).toBe('snippet.ts');
      expect(body.input_diff).toContain('diff --git a/snippet.ts b/snippet.ts');
      expect(body.input_diff).toContain('+const x = 1;');
      expect(body.input_diff).toContain('+const y = 2;');
      expect(body.input_meta).toBeNull();
      // REQ-55: `file` omitted by the client → filled with the synthesized filename.
      expect(body.expected_output[0].file).toBe('snippet.ts');

      const [row] = await pg.handle.db.select().from(t.evalCases).where(eq(t.evalCases.id, body.id));
      expect(row!.inputFiles).not.toBeNull();
      expect(row!.inputDiff).not.toBeNull();
      expect(row!.inputMeta).toBeNull();

      await app.close();
    });

    it('REQ-55/REQ-56 — a client-supplied file on a skill expectation is overwritten with the case filename; a modified_file diff carries both sides', async () => {
      const app = await makeApp();
      const skill = await makeSkill();

      const res = await createSkillCase(app, skill.id, {
        input_files: { kind: 'modified_file', filename: 'custom.py', before: 'x = 0', after: 'x = 1' },
        expected_output: [
          {
            severity: 'WARNING',
            category: 'bug',
            title: 'issue',
            start_line: 1,
            end_line: 1,
            file: 'lies.ts',
          },
        ],
      });
      expect(res.statusCode, JSON.stringify(res.json())).toBe(201);
      const body = res.json();
      expect(body.filename).toBe('custom.py');
      expect(body.expected_output[0].file).toBe('custom.py');
      expect(body.input_diff).toContain('-x = 0');
      expect(body.input_diff).toContain('+x = 1');

      await app.close();
    });

    it('REQ-54 — a client-supplied input_meta is ignored; the stored value is always null', async () => {
      const app = await makeApp();
      const skill = await makeSkill();

      const res = await createSkillCase(app, skill.id, {
        input_meta: { smuggled: true },
      });
      expect(res.statusCode, JSON.stringify(res.json())).toBe(201);
      expect(res.json().input_meta).toBeNull();

      const [row] = await pg.handle.db
        .select()
        .from(t.evalCases)
        .where(eq(t.evalCases.id, res.json().id));
      expect(row!.inputMeta).toBeNull();

      await app.close();
    });

    it('an authored side over 64 KiB answers 413 and persists nothing', async () => {
      const app = await makeApp();
      const skill = await makeSkill();
      const huge = 'x'.repeat(64 * 1024 + 1);

      const before = await pg.handle.db
        .select({ id: t.evalCases.id })
        .from(t.evalCases)
        .where(eq(t.evalCases.ownerId, skill.id));

      const res = await createSkillCase(app, skill.id, {
        input_files: { kind: 'new_file', filename: 'big.ts', after: huge },
      });
      expect(res.statusCode).toBe(413);

      const after = await pg.handle.db
        .select({ id: t.evalCases.id })
        .from(t.evalCases)
        .where(eq(t.evalCases.ownerId, skill.id));
      expect(after.length).toBe(before.length);

      await app.close();
    });
  });

  // ===========================================================================
  // GET /evals/cases — skill-owned — REQ-51
  // ===========================================================================

  describe('GET /evals/cases — skill-owned', () => {
    it("REQ-51 — lists a skill's cases ordered name asc / id asc, workspace-scoped to that owner", async () => {
      const app = await makeApp();
      const skillA = await makeSkill();
      const skillB = await makeSkill();

      const bCase = await createSkillCase(app, skillA.id, { name: 'b-case' });
      const aCase = await createSkillCase(app, skillA.id, { name: 'a-case' });
      const otherCase = await createSkillCase(app, skillB.id, { name: 'other-skill-case' });
      expect(bCase.statusCode, JSON.stringify(bCase.json())).toBe(201);
      expect(aCase.statusCode, JSON.stringify(aCase.json())).toBe(201);
      expect(otherCase.statusCode, JSON.stringify(otherCase.json())).toBe(201);

      const res = await app.inject({
        method: 'GET',
        url: `/evals/cases?owner_kind=skill&owner_id=${skillA.id}`,
      });
      expect(res.statusCode).toBe(200);
      const names = (res.json() as Array<{ name: string }>).map((c) => c.name);
      expect(names).toEqual(['a-case', 'b-case']);

      await app.close();
    });
  });

  // ===========================================================================
  // DELETE /evals/cases/:id — skill-owned — REQ-70
  // ===========================================================================

  describe('DELETE /evals/cases/:id — skill-owned', () => {
    it('REQ-70 — a skill case referenced by a non-terminal batch answers 409 carrying that batch id, and deletes nothing', async () => {
      const app = await makeApp();
      const skill = await makeSkill();
      const kase = (await createSkillCase(app, skill.id)).json();

      const [runningBatch] = await pg.handle.db
        .insert(t.evalRunBatches)
        .values({
          workspaceId,
          ownerKind: 'skill',
          ownerId: skill.id,
          ownerVersion: skill.version,
          status: 'running',
        })
        .returning();
      await pg.handle.db.insert(t.evalRuns).values({ caseId: kase.id, batchId: runningBatch!.id });

      const res = await app.inject({ method: 'DELETE', url: `/evals/cases/${kase.id}` });
      expect(res.statusCode).toBe(409);
      expect(res.json().error.details.batch_id).toBe(runningBatch!.id);

      const stillThere = await pg.handle.db
        .select({ id: t.evalCases.id })
        .from(t.evalCases)
        .where(eq(t.evalCases.id, kase.id));
      expect(stillThere).toHaveLength(1);

      await app.close();
    });
  });

  // ===========================================================================
  // POST /evals/cases/:id/run — skill-owned — AC-11, AC-50, AC-64, AC-65, AC-68
  // ===========================================================================

  describe('POST /evals/cases/:id/run — skill-owned', () => {
    it('AC-68 — runs the with arm only, agent-free, persists a skill-owned batch of 1 with no runner agent and {unavailable: "not_run"} for the without arm, and never 404s', async () => {
      const app = await makeApp([]);
      // AC-68: no agent, no `agent_skills` link at all — the case runs anyway.
      const skill = await makeSkill();
      const kase = (await createSkillCase(app, skill.id)).json();

      const res = await app.inject({ method: 'POST', url: `/evals/cases/${kase.id}/run` });
      expect(res.statusCode, JSON.stringify(res.json())).toBe(200);
      const body = res.json();
      expect(typeof body.pass).toBe('boolean');
      expect(typeof body.duration_ms).toBe('number');
      expect(body.cost_usd).not.toBeNull();
      expect(body.case_id).toBe(kase.id);
      // AC-64/AC-65: the ablation object is served on the run response too.
      expect(body.ablation.without).toEqual({ unavailable: 'not_run' });

      const rows = await pg.handle.db
        .select()
        .from(t.evalRuns)
        .where(eq(t.evalRuns.caseId, kase.id));
      expect(rows).toHaveLength(1);
      // A single-case run is a BATCH OF 1 (owner decision, 2026-08-29) — it
      // used to persist `batch_id: null` and stay invisible to the dashboard.
      expect(rows[0]!.batchId).not.toBeNull();
      const [soloBatch] = await pg.handle.db
        .select()
        .from(t.evalRunBatches)
        .where(eq(t.evalRunBatches.id, rows[0]!.batchId!));
      expect(soloBatch!.ownerKind).toBe('skill');
      expect(soloBatch!.ownerId).toBe(skill.id);
      expect(soloBatch!.casesTotal).toBe(1);
      // Terminal from the INSERT, never `running`.
      expect(soloBatch!.status).not.toBe('running');
      expect(soloBatch!.finishedAt).not.toBeNull();
      // AC-68/AC-69: still agent-free — no runner agent is resolved or recorded.
      expect(soloBatch!.runnerAgentId).toBeNull();
      expect(soloBatch!.runnerAgentVersion).toBeNull();
      const actualOutput = rows[0]!.actualOutput as { without: { unavailable: string } };
      expect(actualOutput.without).toEqual({ unavailable: 'not_run' });

      // AC-64/AC-65: `GET /evals/cases`' latest_run.ablation carries the same
      // stored {with, without} object for this skill-owned run.
      const list = await app.inject({
        method: 'GET',
        url: `/evals/cases?owner_kind=skill&owner_id=${skill.id}`,
      });
      expect(list.statusCode).toBe(200);
      const listed = (list.json() as Array<{ id: string; latest_run: { ablation: unknown } | null }>).find(
        (c) => c.id === kase.id,
      );
      expect(listed?.latest_run?.ablation).toEqual(body.ablation);

      await app.close();
    });

    it('AC-68 — INVERSION of the superseded assertion: a skill with no linked agent, or only disabled ones, still runs a single case (was 404, now 200)', async () => {
      const app = await makeApp([]);
      const skillWithNoLink = await makeSkill();
      const noLinkCase = (await createSkillCase(app, skillWithNoLink.id)).json();

      const skillWithDisabledLink = await makeSkill();
      const disabledAgent = await makeAgent({ enabled: false });
      await linkSkill(disabledAgent.id, skillWithDisabledLink.id, 0);
      const disabledLinkCase = (await createSkillCase(app, skillWithDisabledLink.id)).json();

      const noLinkRes = await app.inject({
        method: 'POST',
        url: `/evals/cases/${noLinkCase.id}/run`,
      });
      expect(noLinkRes.statusCode, JSON.stringify(noLinkRes.json())).toBe(200);

      const disabledLinkRes = await app.inject({
        method: 'POST',
        url: `/evals/cases/${disabledLinkCase.id}/run`,
      });
      expect(disabledLinkRes.statusCode, JSON.stringify(disabledLinkRes.json())).toBe(200);

      await app.close();
    });
  });

  // ===========================================================================
  // POST /evals/batches — skill-owned — AC-13, AC-15, AC-68
  //
  // T-C (2026-08-29) completes the SET-run half of AC-68 that T-B reported
  // as a known gap (gate G2): a skill-owned batch now consults no agent, no
  // `agent_skills` link and no `agents` row at all — `owner_version` is the
  // SKILL's own `version` and both `runner_agent_id`/`runner_agent_version`
  // persist `null`. The three tests below are the direct INVERSION of the
  // superseded, still-agent-gated assertions T-B left in place.
  // ===========================================================================

  describe('POST /evals/batches — skill-owned', () => {
    it('AC-68 — a skill-owned batch consults no agent: owner_version is the skill\'s own version, runner_agent_id/runner_agent_version persist null, and the case runs on the AC-72/AC-73 baseline', async () => {
      // `openaiWorks: false` — if the batch regressed to resolving a LINKED
      // agent's OWN `openai` provider instead of AC-73's `openrouter`
      // baseline, this run would error instead of succeeding (see
      // `makeApp`'s doc comment). No agent is linked at all here.
      const app = await makeApp([], { openaiWorks: false });
      const skill = await makeSkill();
      const kase = await createSkillCase(app, skill.id);
      expect(kase.statusCode, JSON.stringify(kase.json())).toBe(201);

      const res = await app.inject({
        method: 'POST',
        url: '/evals/batches',
        payload: { owner_kind: 'skill', owner_id: skill.id },
      });
      expect(res.statusCode, JSON.stringify(res.json())).toBe(202);
      const { batch_id: batchId } = res.json();

      let status = 'running';
      for (let i = 0; i < 100 && status === 'running'; i++) {
        status = (await app.inject({ method: 'GET', url: `/evals/batches/${batchId}` })).json().status;
        if (status === 'running') await new Promise((r) => setTimeout(r, 20));
      }
      // AC-72/AC-73's wiring proof: had the batch tried to resolve and call a
      // linked agent's `openai` provider (whose mock has no working fixture
      // here), the case would have errored and the batch would be `failed`,
      // never `succeeded`.
      expect(status).toBe('succeeded');

      const [row] = await pg.handle.db
        .select()
        .from(t.evalRunBatches)
        .where(eq(t.evalRunBatches.id, batchId));
      expect(row!.ownerKind).toBe('skill');
      expect(row!.ownerId).toBe(skill.id);
      expect(row!.ownerVersion).toBe(skill.version);
      // AC-68: no runner agent is ever resolved — both columns are null.
      expect(row!.runnerAgentId).toBeNull();
      expect(row!.runnerAgentVersion).toBeNull();

      await app.close();
    });

    it('AC-68 — INVERSION of the superseded assertion: a skill with no linked agent at all, or only disabled ones, still starts a batch (was 400, now 202) and creates a batch row', async () => {
      const app = await makeApp([]);

      const skillWithNoLink = await makeSkill();
      const noLinkCase = await createSkillCase(app, skillWithNoLink.id);
      expect(noLinkCase.statusCode, JSON.stringify(noLinkCase.json())).toBe(201);

      const skillWithDisabledLink = await makeSkill();
      const disabledAgent = await makeAgent({ enabled: false });
      await linkSkill(disabledAgent.id, skillWithDisabledLink.id, 0);
      const disabledLinkCase = await createSkillCase(app, skillWithDisabledLink.id);
      expect(disabledLinkCase.statusCode, JSON.stringify(disabledLinkCase.json())).toBe(201);

      const beforeNoLink = await pg.handle.db
        .select({ id: t.evalRunBatches.id })
        .from(t.evalRunBatches)
        .where(eq(t.evalRunBatches.ownerId, skillWithNoLink.id));

      const noLinkRes = await app.inject({
        method: 'POST',
        url: '/evals/batches',
        payload: { owner_kind: 'skill', owner_id: skillWithNoLink.id },
      });
      expect(noLinkRes.statusCode, JSON.stringify(noLinkRes.json())).toBe(202);

      const afterNoLink = await pg.handle.db
        .select({ id: t.evalRunBatches.id })
        .from(t.evalRunBatches)
        .where(eq(t.evalRunBatches.ownerId, skillWithNoLink.id));
      expect(afterNoLink.length).toBe(beforeNoLink.length + 1);

      const disabledLinkRes = await app.inject({
        method: 'POST',
        url: '/evals/batches',
        payload: { owner_kind: 'skill', owner_id: skillWithDisabledLink.id },
      });
      expect(disabledLinkRes.statusCode, JSON.stringify(disabledLinkRes.json())).toBe(202);

      await app.close();
    });

    it('AC-68 — a DISABLED skill with no linked agent at all still runs normally (enabled gates prompt injection, not eval ownership; ownership needs no agent link either)', async () => {
      const app = await makeApp([]);
      const skill = await makeSkill({ enabled: false });
      const kase = await createSkillCase(app, skill.id);
      expect(kase.statusCode, JSON.stringify(kase.json())).toBe(201);

      const res = await app.inject({
        method: 'POST',
        url: '/evals/batches',
        payload: { owner_kind: 'skill', owner_id: skill.id },
      });
      expect(res.statusCode, JSON.stringify(res.json())).toBe(202);

      await app.close();
    });

    it('AC-15 — a skill with zero cases answers 400 and creates no batch row', async () => {
      const app = await makeApp([]);
      const skill = await makeSkill();
      const enabledAgent = await makeAgent({ enabled: true });
      await linkSkill(enabledAgent.id, skill.id, 0);

      const before = await pg.handle.db
        .select({ id: t.evalRunBatches.id })
        .from(t.evalRunBatches)
        .where(eq(t.evalRunBatches.ownerId, skill.id));

      const res = await app.inject({
        method: 'POST',
        url: '/evals/batches',
        payload: { owner_kind: 'skill', owner_id: skill.id },
      });
      expect(res.statusCode).toBe(400);

      const after = await pg.handle.db
        .select({ id: t.evalRunBatches.id })
        .from(t.evalRunBatches)
        .where(eq(t.evalRunBatches.ownerId, skill.id));
      expect(after.length).toBe(before.length);

      await app.close();
    });
  });
});
