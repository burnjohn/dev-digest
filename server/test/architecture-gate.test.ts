import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

const serverRoot = fileURLToPath(new URL('../', import.meta.url));
const depcruise = path.join(serverRoot, 'node_modules', '.bin', 'depcruise');
const knownViolationsPath = path.join(
  serverRoot,
  '.dependency-cruiser-known-violations.json',
);

function cruise(inputs: string[], outputType: 'err' | 'json' = 'err') {
  return spawnSync(
    depcruise,
    ['--config', '.dependency-cruiser.cjs', '--output-type', outputType, ...inputs],
    { cwd: serverRoot, encoding: 'utf8' },
  );
}

function cruiseFixture(name: string, outputType: 'err' | 'json' = 'err') {
  return cruise([`test/fixtures/architecture/${name}/src`], outputType);
}

function outputOf(result: ReturnType<typeof cruise>) {
  return `${result.stdout}${result.stderr}`;
}

function expectFixtureViolation(name: string, ruleName: string) {
  const result = cruiseFixture(name);
  const output = outputOf(result);
  expect(result.status).not.toBe(0);
  expect(output).toContain(`error ${ruleName}:`);
  return output;
}

interface ViolationLike {
  type: string;
  from: string;
  to: string;
  cycle?: Array<{ name: string }>;
  rule: { severity: string; name: string };
}

function normalizeViolations(violations: ViolationLike[]) {
  return violations
    .map((violation) => ({
      type: violation.type,
      from: violation.from,
      to: violation.to,
      cycle: violation.cycle?.map((leg) => leg.name) ?? [],
      rule: violation.rule,
    }))
    .sort((left, right) =>
      JSON.stringify(left).localeCompare(JSON.stringify(right)),
    );
}

describe('backend architecture dependency gate', () => {
  test('accepts inward dependencies and another feature public contract', () => {
    const result = cruiseFixture('valid');
    expect(result.status).toBe(0);
    expect(outputOf(result)).toContain('no dependency violations found');
  });

  test('accepts Fastify, Zod, and shared wire contracts in a legacy route', () => {
    const result = cruiseFixture('legacy-route-valid');
    expect(result.status).toBe(0);
    expect(outputOf(result)).toContain('no dependency violations found');
  });

  test('rejects circular backend dependencies', () => {
    const output = expectFixtureViolation(
      'cycle-invalid',
      'no-circular-backend-dependencies',
    );
    expect(output).toContain('domain/first.ts');
    expect(output).toContain('domain/second.ts');
  });

  test('rejects a domain dependency on an application layer', () => {
    const output = expectFixtureViolation(
      'domain-layer-invalid',
      'domain-depends-only-inward',
    );
    expect(output).toContain('application/complete-review.ts');
  });

  test('rejects domain dependencies on composition, _shared, and flat outer code', () => {
    const output = expectFixtureViolation(
      'domain-composition-invalid',
      'domain-depends-only-inward',
    );
    expect(output).toContain('src/app.ts');
    expect(output).toContain('modules/_shared/context.ts');
    expect(output).toContain('modules/reviews/service.ts');
  });

  test('rejects a domain dependency on the _shared barrel', () => {
    const output = expectFixtureViolation(
      'shared-barrel-invalid',
      'domain-depends-only-inward',
    );
    expect(output).toContain('modules/_shared/index.ts');
  });

  test('rejects application code that imports a persistence adapter', () => {
    const output = expectFixtureViolation(
      'invalid',
      'application-depends-only-inward',
    );
    expect(output).toContain('adapters/persistence/review-repository.ts');
  });

  test('rejects application code that imports an npm-backed boundary dependency', () => {
    const output = expectFixtureViolation(
      'npm-invalid',
      'application-depends-only-inward',
    );
    expect(output).toContain('node_modules/zod/');
  });

  test('rejects application dependencies on composition, _shared, routes, services, and repositories', () => {
    const output = expectFixtureViolation(
      'application-flat-invalid',
      'application-depends-only-inward',
    );
    expect(output).toContain('src/app.ts');
    expect(output).toContain('modules/_shared/context.ts');
    expect(output).toContain('modules/repos/repository.ts');
    expect(output).toContain('modules/reviews/repository.ts');
    expect(output).toContain('modules/reviews/routes.ts');
    expect(output).toContain('modules/reviews/service.ts');
  });

  test('rejects an application dependency on the _shared barrel', () => {
    const output = expectFixtureViolation(
      'shared-barrel-invalid',
      'application-depends-only-inward',
    );
    expect(output).toContain('modules/_shared/index.ts');
  });

  test('rejects a type-only application dependency on infrastructure', () => {
    const result = cruiseFixture('application-flat-invalid', 'json');
    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout) as {
      summary: { violations: Array<ViolationLike & { dependencyTypes: string[] }> };
    };
    expect(parsed.summary.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          to: expect.stringMatching(/modules\/reviews\/repository[.]ts$/),
          dependencyTypes: expect.arrayContaining(['type-only']),
          rule: {
            severity: 'error',
            name: 'application-depends-only-inward',
          },
        }),
      ]),
    );
  });

  test('rejects persistence, repositories, Container, adapters, and driven dependencies in a legacy route', () => {
    const output = expectFixtureViolation(
      'legacy-route-invalid',
      'legacy-routes-do-not-query-persistence',
    );
    expect(output).toContain('modules/reviews/repository.ts');
    expect(output).toContain('src/platform/container.ts');
    expect(output).toContain('src/adapters/github/client.ts');
    expect(output).toContain('node_modules/openai/');
    expect(output).toContain('fs/promises');
  });

  test('rejects repositories, Container, adapters, and vendors in a legacy service', () => {
    const output = expectFixtureViolation(
      'legacy-service-invalid',
      'legacy-services-do-not-construct-infrastructure',
    );
    expect(output).toContain('modules/reviews/repository.ts');
    expect(output).toContain('src/platform/container.ts');
    expect(output).toContain('src/adapters/github/client.ts');
    expect(output).toContain('node_modules/openai/');
  });

  test('rejects a feature public API that exports a private adapter', () => {
    const output = expectFixtureViolation(
      'public-api-invalid',
      'feature-public-api-does-not-export-adapters',
    );
    expect(output).toContain('adapters/http/routes.ts');
  });

  test('rejects reviewer-core dependencies on server source and vendors', () => {
    const output = expectFixtureViolation(
      'reviewer-core-invalid',
      'reviewer-core-does-not-depend-on-server-or-vendors',
    );
    expect(output).toContain('src/vendor/shared/index.ts');
    expect(output).toContain('node_modules/openai/');
  });

  test('rejects every adapter category importing a different adapter category', () => {
    const result = cruiseFixture('adapter-isolation-invalid');
    const output = outputOf(result);
    expect(result.status).not.toBe(0);
    for (const kind of ['http', 'persistence', 'external', 'jobs']) {
      expect(output).toContain(
        `error no-${kind}-adapter-to-other-adapter-kinds:`,
      );
    }
  });

  test("rejects a feature-root import of another feature's private adapter", () => {
    const output = expectFixtureViolation(
      'cross-feature-invalid',
      'no-cross-feature-imports-into-reviews-adapters',
    );
    expect(output).toContain('reviews/adapters/persistence/review-repository.ts');
  });

  test('matches the known-violations inventory to the raw production graph exactly', () => {
    const result = cruise(['src', '../reviewer-core/src'], 'json');
    expect(result.status).toBe(0);
    const raw = JSON.parse(result.stdout) as {
      summary: { violations: ViolationLike[] };
    };
    const known = JSON.parse(
      readFileSync(knownViolationsPath, 'utf8'),
    ) as ViolationLike[];

    expect(normalizeViolations(known)).toEqual(
      normalizeViolations(raw.summary.violations),
    );
  });
});
