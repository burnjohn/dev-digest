import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/platform/config.js";
import { seed } from "../src/db/seed.js";
import { MockGitClient, MockGitHubClient } from "../src/adapters/mocks.js";
import { startPg, dockerAvailable, type PgFixture } from "./helpers/pg.js";

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  console.warn("[skills.it] Docker not available — skipping.");
}

d("Skills CRUD + versioning (Testcontainers)", () => {
  let pg: PgFixture;
  const config = loadConfig({
    ...process.env,
    NODE_ENV: "test",
  } as NodeJS.ProcessEnv);

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
  });
  afterAll(async () => {
    await pg?.stop();
  });

  it("POST /skills → 201 with version=1", async () => {
    const app = await buildApp({
      config,
      db: pg.handle.db,
      overrides: { git: new MockGitClient(), github: new MockGitHubClient() },
    });
    const res = await app.inject({
      method: "POST",
      url: "/skills",
      payload: {
        name: "No hardcoded secrets",
        description: "Never commit credentials",
        type: "security",
        body: "Rule: do not commit secrets.",
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.id).toBeDefined();
    expect(body.version).toBe(1);
    expect(body.name).toBe("No hardcoded secrets");
    await app.close();
  });

  it("GET /skills → lists created skills", async () => {
    const app = await buildApp({
      config,
      db: pg.handle.db,
      overrides: { git: new MockGitClient(), github: new MockGitHubClient() },
    });
    const res = await app.inject({ method: "GET", url: "/skills" });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
    expect(res.json().length).toBeGreaterThan(0);
    await app.close();
  });

  it("GET /skills/:id → returns single skill", async () => {
    const app = await buildApp({
      config,
      db: pg.handle.db,
      overrides: { git: new MockGitClient(), github: new MockGitHubClient() },
    });
    const list = await app.inject({ method: "GET", url: "/skills" });
    const skillId = list.json()[0]!.id;

    const res = await app.inject({ method: "GET", url: `/skills/${skillId}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe(skillId);
    await app.close();
  });

  it("GET /skills/:id → 404 for unknown id", async () => {
    const app = await buildApp({
      config,
      db: pg.handle.db,
      overrides: { git: new MockGitClient(), github: new MockGitHubClient() },
    });
    const res = await app.inject({
      method: "GET",
      url: "/skills/00000000-0000-0000-0000-000000000000",
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("PUT /skills/:id name-only change → version stays at 1", async () => {
    const app = await buildApp({
      config,
      db: pg.handle.db,
      overrides: { git: new MockGitClient(), github: new MockGitHubClient() },
    });

    const created = await app.inject({
      method: "POST",
      url: "/skills",
      payload: {
        name: "Skill for rename",
        type: "custom",
        body: "Some body content.",
      },
    });
    const skillId = created.json().id;

    const updated = await app.inject({
      method: "PUT",
      url: `/skills/${skillId}`,
      payload: { name: "Skill renamed" },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().name).toBe("Skill renamed");
    expect(updated.json().version).toBe(1); // no body change → no version bump
    await app.close();
  });

  it("PUT /skills/:id body change → version bumps to 2", async () => {
    const app = await buildApp({
      config,
      db: pg.handle.db,
      overrides: { git: new MockGitClient(), github: new MockGitHubClient() },
    });

    const created = await app.inject({
      method: "POST",
      url: "/skills",
      payload: {
        name: "Skill for versioning",
        type: "rubric",
        body: "Version 1 body.",
      },
    });
    const skillId = created.json().id;

    const updated = await app.inject({
      method: "PUT",
      url: `/skills/${skillId}`,
      payload: { body: "Version 2 body — updated." },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().version).toBe(2);
    expect(updated.json().body).toBe("Version 2 body — updated.");
    await app.close();
  });

  it("GET /skills/:id/versions → returns version history", async () => {
    const app = await buildApp({
      config,
      db: pg.handle.db,
      overrides: { git: new MockGitClient(), github: new MockGitHubClient() },
    });

    const created = await app.inject({
      method: "POST",
      url: "/skills",
      payload: { name: "Versioned skill", type: "custom", body: "Body v1." },
    });
    const skillId = created.json().id;

    await app.inject({
      method: "PUT",
      url: `/skills/${skillId}`,
      payload: { body: "Body v2." },
    });

    const versions = await app.inject({
      method: "GET",
      url: `/skills/${skillId}/versions`,
    });
    expect(versions.statusCode).toBe(200);
    const vArr = versions.json();
    expect(vArr.length).toBe(2);
    expect(vArr.find((v: { version: number }) => v.version === 1)?.body).toBe(
      "Body v1.",
    );
    expect(vArr.find((v: { version: number }) => v.version === 2)?.body).toBe(
      "Body v2.",
    );
    await app.close();
  });

  it("POST /skills/:id/restore → restores body and bumps version", async () => {
    const app = await buildApp({
      config,
      db: pg.handle.db,
      overrides: { git: new MockGitClient(), github: new MockGitHubClient() },
    });

    const created = await app.inject({
      method: "POST",
      url: "/skills",
      payload: {
        name: "Restore test",
        type: "convention",
        body: "Original body.",
      },
    });
    const skillId = created.json().id;

    await app.inject({
      method: "PUT",
      url: `/skills/${skillId}`,
      payload: { body: "Modified body." },
    });

    const restored = await app.inject({
      method: "POST",
      url: `/skills/${skillId}/restore`,
      payload: { version: 1 },
    });
    expect(restored.statusCode).toBe(201);
    expect(restored.json().body).toBe("Original body.");
    expect(restored.json().version).toBe(3); // v1 body → v3 snapshot
    await app.close();
  });

  it("GET /skills/:id/stats → returns stats shape", async () => {
    const app = await buildApp({
      config,
      db: pg.handle.db,
      overrides: { git: new MockGitClient(), github: new MockGitHubClient() },
    });
    const list = await app.inject({ method: "GET", url: "/skills" });
    const skillId = list.json()[0]!.id;

    const res = await app.inject({
      method: "GET",
      url: `/skills/${skillId}/stats`,
    });
    expect(res.statusCode).toBe(200);
    const stats = res.json();
    expect(typeof stats.agent_count).toBe("number");
    expect(typeof stats.pull_frequency_pct).toBe("number");
    expect(typeof stats.accept_rate_pct).toBe("number");
    await app.close();
  });

  it("DELETE /skills/:id → { ok: true } and skill is gone", async () => {
    const app = await buildApp({
      config,
      db: pg.handle.db,
      overrides: { git: new MockGitClient(), github: new MockGitHubClient() },
    });

    const created = await app.inject({
      method: "POST",
      url: "/skills",
      payload: { name: "To delete", type: "custom", body: "bye." },
    });
    const skillId = created.json().id;

    const del = await app.inject({
      method: "DELETE",
      url: `/skills/${skillId}`,
    });
    expect(del.statusCode).toBe(200);
    expect(del.json().ok).toBe(true);

    const gone = await app.inject({ method: "GET", url: `/skills/${skillId}` });
    expect(gone.statusCode).toBe(404);
    await app.close();
  });

  it("PUT skills enabled=false → skill is disabled", async () => {
    const app = await buildApp({
      config,
      db: pg.handle.db,
      overrides: { git: new MockGitClient(), github: new MockGitHubClient() },
    });

    const created = await app.inject({
      method: "POST",
      url: "/skills",
      payload: { name: "Toggle skill", type: "custom", body: "content." },
    });
    const skillId = created.json().id;

    const disabled = await app.inject({
      method: "PUT",
      url: `/skills/${skillId}`,
      payload: { enabled: false },
    });
    expect(disabled.json().enabled).toBe(false);
    await app.close();
  });

  it("POST /skills with missing body → 422 validation error", async () => {
    const app = await buildApp({
      config,
      db: pg.handle.db,
      overrides: { git: new MockGitClient(), github: new MockGitHubClient() },
    });
    const res = await app.inject({
      method: "POST",
      url: "/skills",
      payload: { name: "Missing body", type: "custom" }, // body field omitted
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("validation_error");
    await app.close();
  });
});

// SSRF tests — no DB required
describe("POST /skills/import-url SSRF protection (no DB)", () => {
  const config = loadConfig({
    ...process.env,
    NODE_ENV: "test",
  } as NodeJS.ProcessEnv);

  it("rejects localhost URLs → non-2xx error", async () => {
    const app = await buildApp({ config });
    const res = await app.inject({
      method: "POST",
      url: "/skills/import-url",
      payload: { url: "http://localhost/secret", name: "test" },
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.json().error.message).toMatch(/private|local|https/i);
    await app.close();
  });

  it("rejects 127.x.x.x IPs → non-2xx error", async () => {
    const app = await buildApp({ config });
    const res = await app.inject({
      method: "POST",
      url: "/skills/import-url",
      payload: { url: "http://127.0.0.1/file", name: "test" },
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    await app.close();
  });

  it("rejects 10.x private IPs → non-2xx error", async () => {
    const app = await buildApp({ config });
    const res = await app.inject({
      method: "POST",
      url: "/skills/import-url",
      payload: { url: "http://10.0.0.1/file", name: "test" },
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    await app.close();
  });

  it("rejects plain HTTP external URLs → non-2xx error", async () => {
    const app = await buildApp({ config });
    const res = await app.inject({
      method: "POST",
      url: "/skills/import-url",
      payload: { url: "http://example.com/skill.md", name: "test" },
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.json().error.message).toMatch(/https/i);
    await app.close();
  });

  it("rejects missing name → 422", async () => {
    const app = await buildApp({ config });
    const res = await app.inject({
      method: "POST",
      url: "/skills/import-url",
      payload: { url: "https://example.com/skill.md" },
    });
    expect(res.statusCode).toBe(422);
    await app.close();
  });
});
