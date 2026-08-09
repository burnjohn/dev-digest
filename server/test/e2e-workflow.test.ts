import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(
  new URL('../../.github/workflows/e2e-web.yml', import.meta.url),
  'utf8',
);

describe('e2e web workflow', () => {
  it('installs reviewer-core dependencies before loading its raw source from server commands', () => {
    const installReviewerCore = workflow.indexOf('name: Install reviewer-core deps');
    const migrateServer = workflow.indexOf('pnpm db:migrate');
    const seedServer = workflow.indexOf('pnpm db:seed');

    expect(installReviewerCore).toBeGreaterThan(-1);
    expect(installReviewerCore).toBeLessThan(migrateServer);
    expect(installReviewerCore).toBeLessThan(seedServer);
  });

  it('runs when reviewer-core changes', () => {
    expect(workflow).toContain("- 'reviewer-core/**'");
  });
});
