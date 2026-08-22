import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/platform/config.js";
import { seed } from "../src/db/seed.js";
import * as t from "../src/db/schema.js";
import { MockGitClient, MockGitHubClient } from "../src/adapters/mocks.js";
import { ConventionsRepository } from "../src/modules/conventions/repository.js";
import { startPg, dockerAvailable, type PgFixture } from "./helpers/pg.js";

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  console.warn("[conventions.it] Docker not available — skipping.");
}

/** Seed a repo row and return its id */
async function seedRepo(
  db: PgFixture["handle"]["db"],
  workspaceId: string,
): Promise<string> {
  const [row] = await db
    .insert(t.repos)
    .values({
      workspaceId,
      owner: "test-org",
      name: "test-repo",
      fullName: "test-org/test-repo",
    })
    .returning({ id: t.repos.id });
  return row!.id;
}

d("ConventionsRepository unit-via-DB (Testcontainers)", () => {
  let pg: PgFixture;
  let workspaceId: string;
  let repoId: string;

  beforeAll(async () => {
    pg = await startPg();
    const { workspaceId: wsId } = await seed(pg.handle.db);
    workspaceId = wsId;
    repoId = await seedRepo(pg.handle.db, workspaceId);
  });
  afterAll(async () => {
    await pg?.stop();
  });

  it("replaceAll inserts conventions and returns them", async () => {
    const repo = new ConventionsRepository(pg.handle.db);
    const rows = await repo.replaceAll(workspaceId, repoId, [
      {
        rule: "Use Result<T>",
        evidencePath: "src/a.ts",
        evidenceSnippet: "return Ok(x)",
        confidence: 0.9,
      },
      {
        rule: "Prefer const",
        evidencePath: "src/b.ts",
        evidenceSnippet: "const x = 1",
        confidence: 0.7,
      },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.workspaceId === workspaceId)).toBe(true);
    expect(rows.every((r) => r.accepted === false)).toBe(true);
  });

  it("listByRepo returns all conventions, sorted accepted-first then confidence desc", async () => {
    const repo = new ConventionsRepository(pg.handle.db);

    // Fresh state: replace with 3 conventions
    const inserted = await repo.replaceAll(workspaceId, repoId, [
      {
        rule: "Rule A",
        evidencePath: "a.ts",
        evidenceSnippet: "",
        confidence: 0.5,
      },
      {
        rule: "Rule B",
        evidencePath: "b.ts",
        evidenceSnippet: "",
        confidence: 0.9,
      },
      {
        rule: "Rule C",
        evidencePath: "c.ts",
        evidenceSnippet: "",
        confidence: 0.8,
      },
    ]);

    // Accept "Rule A" (low confidence)
    await repo.accept(
      workspaceId,
      inserted.find((r) => r.rule === "Rule A")!.id,
    );

    const list = await repo.listByRepo(workspaceId, repoId);
    expect(list[0]!.rule).toBe("Rule A"); // accepted first
    expect(list[1]!.rule).toBe("Rule B"); // higher confidence
    expect(list[2]!.rule).toBe("Rule C");
  });

  it("accept marks convention as accepted and returns updated row", async () => {
    const repo = new ConventionsRepository(pg.handle.db);
    const [inserted] = await repo.replaceAll(workspaceId, repoId, [
      {
        rule: "Accept me",
        evidencePath: "x.ts",
        evidenceSnippet: "x",
        confidence: 0.6,
      },
    ]);
    expect(inserted!.accepted).toBe(false);

    const updated = await repo.accept(workspaceId, inserted!.id);
    expect(updated).toBeDefined();
    expect(updated!.accepted).toBe(true);
    expect(updated!.id).toBe(inserted!.id);
  });

  it("reject physically deletes the convention and returns true", async () => {
    const repo = new ConventionsRepository(pg.handle.db);
    const [inserted] = await repo.replaceAll(workspaceId, repoId, [
      {
        rule: "Reject me",
        evidencePath: "y.ts",
        evidenceSnippet: "y",
        confidence: 0.4,
      },
    ]);

    const ok = await repo.reject(workspaceId, inserted!.id);
    expect(ok).toBe(true);

    const list = await repo.listByRepo(workspaceId, repoId);
    expect(list.some((r) => r.id === inserted!.id)).toBe(false);
  });

  it("reject with unknown id returns false", async () => {
    const repo = new ConventionsRepository(pg.handle.db);
    const ok = await repo.reject(
      workspaceId,
      "00000000-0000-0000-0000-000000000000",
    );
    expect(ok).toBe(false);
  });

  it("updateRule changes the rule text", async () => {
    const repo = new ConventionsRepository(pg.handle.db);
    const [inserted] = await repo.replaceAll(workspaceId, repoId, [
      {
        rule: "Old rule text",
        evidencePath: "z.ts",
        evidenceSnippet: "",
        confidence: 0.75,
      },
    ]);

    const updated = await repo.updateRule(
      workspaceId,
      inserted!.id,
      "New rule text",
    );
    expect(updated).toBeDefined();
    expect(updated!.rule).toBe("New rule text");
    expect(updated!.id).toBe(inserted!.id);
  });

  it("listAccepted returns only accepted conventions", async () => {
    const repo = new ConventionsRepository(pg.handle.db);
    const inserted = await repo.replaceAll(workspaceId, repoId, [
      {
        rule: "Accepted one",
        evidencePath: "a.ts",
        evidenceSnippet: "",
        confidence: 0.9,
      },
      {
        rule: "Not accepted",
        evidencePath: "b.ts",
        evidenceSnippet: "",
        confidence: 0.8,
      },
      {
        rule: "Accepted two",
        evidencePath: "c.ts",
        evidenceSnippet: "",
        confidence: 0.7,
      },
    ]);

    await repo.accept(
      workspaceId,
      inserted.find((r) => r.rule === "Accepted one")!.id,
    );
    await repo.accept(
      workspaceId,
      inserted.find((r) => r.rule === "Accepted two")!.id,
    );

    const accepted = await repo.listAccepted(workspaceId, repoId);
    expect(accepted).toHaveLength(2);
    expect(accepted.every((r) => r.accepted === true)).toBe(true);
    expect(accepted.map((r) => r.rule)).toContain("Accepted one");
    expect(accepted.map((r) => r.rule)).toContain("Accepted two");
  });

  it("replaceAll on re-scan clears previous conventions", async () => {
    const repo = new ConventionsRepository(pg.handle.db);
    await repo.replaceAll(workspaceId, repoId, [
      {
        rule: "Old convention",
        evidencePath: "old.ts",
        evidenceSnippet: "",
        confidence: 0.5,
      },
    ]);

    const fresh = await repo.replaceAll(workspaceId, repoId, [
      {
        rule: "New convention",
        evidencePath: "new.ts",
        evidenceSnippet: "",
        confidence: 0.95,
      },
    ]);

    const list = await repo.listByRepo(workspaceId, repoId);
    expect(list).toHaveLength(1);
    expect(list[0]!.rule).toBe("New convention");
    expect(fresh).toHaveLength(1);
  });

  it("replaceAll with empty array clears all conventions", async () => {
    const repo = new ConventionsRepository(pg.handle.db);
    await repo.replaceAll(workspaceId, repoId, [
      {
        rule: "Will be cleared",
        evidencePath: "x.ts",
        evidenceSnippet: "",
        confidence: 0.9,
      },
    ]);

    const result = await repo.replaceAll(workspaceId, repoId, []);
    expect(result).toHaveLength(0);

    const list = await repo.listByRepo(workspaceId, repoId);
    expect(list).toHaveLength(0);
  });
});

d("Conventions HTTP routes (Testcontainers)", () => {
  let pg: PgFixture;
  let workspaceId: string;
  const config = loadConfig({
    ...process.env,
    NODE_ENV: "test",
  } as NodeJS.ProcessEnv);

  beforeAll(async () => {
    pg = await startPg();
    ({ workspaceId } = await seed(pg.handle.db));
  });
  afterAll(async () => {
    await pg?.stop();
  });

  it("GET /repos/:repoId/conventions → empty list for new repo", async () => {
    const app = await buildApp({
      config,
      db: pg.handle.db,
      overrides: { git: new MockGitClient(), github: new MockGitHubClient() },
    });

    // Create a repo first
    const repoRes = await app.inject({
      method: "POST",
      url: "/repos",
      payload: { url: "https://github.com/acme/conv-test" },
    });
    await app.container.jobs.onIdle();
    const repoId = repoRes.json().id;

    const res = await app.inject({
      method: "GET",
      url: `/repos/${repoId}/conventions`,
    });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
    await app.close();
  });

  it("PATCH /repos/:repoId/conventions/:id → accept updates accepted flag", async () => {
    const app = await buildApp({
      config,
      db: pg.handle.db,
      overrides: { git: new MockGitClient(), github: new MockGitHubClient() },
    });
    await app.container.jobs.onIdle();

    // Seed a repo + convention directly via DB
    const repos = await app.inject({ method: "GET", url: "/repos" });
    const repoId = repos.json()[0]!.id;

    const convRepo = new ConventionsRepository(pg.handle.db);
    const [conv] = await convRepo.replaceAll(workspaceId, repoId, [
      {
        rule: "Via HTTP accept test",
        evidencePath: "src/a.ts",
        evidenceSnippet: "const",
        confidence: 0.8,
      },
    ]);

    const res = await app.inject({
      method: "PATCH",
      url: `/repos/${repoId}/conventions/${conv!.id}`,
      payload: { accepted: true },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().accepted).toBe(true);
    await app.close();
  });

  it("PATCH /repos/:repoId/conventions/:id → reject removes convention", async () => {
    const app = await buildApp({
      config,
      db: pg.handle.db,
      overrides: { git: new MockGitClient(), github: new MockGitHubClient() },
    });
    await app.container.jobs.onIdle();

    const repos = await app.inject({ method: "GET", url: "/repos" });
    const repoId = repos.json()[0]!.id;

    const convRepo = new ConventionsRepository(pg.handle.db);
    const [conv] = await convRepo.replaceAll(workspaceId, repoId, [
      {
        rule: "Reject via HTTP",
        evidencePath: "src/b.ts",
        evidenceSnippet: "let",
        confidence: 0.6,
      },
    ]);

    const res = await app.inject({
      method: "PATCH",
      url: `/repos/${repoId}/conventions/${conv!.id}`,
      payload: { accepted: false },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    await app.close();
  });

  it("PATCH /repos/:repoId/conventions/:id → inline rule edit", async () => {
    const app = await buildApp({
      config,
      db: pg.handle.db,
      overrides: { git: new MockGitClient(), github: new MockGitHubClient() },
    });
    await app.container.jobs.onIdle();

    const repos = await app.inject({ method: "GET", url: "/repos" });
    const repoId = repos.json()[0]!.id;

    const convRepo = new ConventionsRepository(pg.handle.db);
    const [conv] = await convRepo.replaceAll(workspaceId, repoId, [
      {
        rule: "Old rule",
        evidencePath: "src/c.ts",
        evidenceSnippet: "",
        confidence: 0.7,
      },
    ]);

    const res = await app.inject({
      method: "PATCH",
      url: `/repos/${repoId}/conventions/${conv!.id}`,
      payload: { rule: "Edited rule via HTTP" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().rule).toBe("Edited rule via HTTP");
    await app.close();
  });

  it("PATCH /repos/:repoId/conventions/:unknown-id → 404", async () => {
    const app = await buildApp({
      config,
      db: pg.handle.db,
      overrides: { git: new MockGitClient(), github: new MockGitHubClient() },
    });
    await app.container.jobs.onIdle();
    const repos = await app.inject({ method: "GET", url: "/repos" });
    const repoId = repos.json()[0]!.id;

    const res = await app.inject({
      method: "PATCH",
      url: `/repos/${repoId}/conventions/00000000-0000-0000-0000-000000000000`,
      payload: { accepted: true },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
