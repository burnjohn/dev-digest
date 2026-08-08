import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

const serverRoot = fileURLToPath(new URL('../', import.meta.url));
const depcruise = path.join(serverRoot, 'node_modules', '.bin', 'depcruise');

function cruiseFixture(
  name: 'valid' | 'invalid' | 'npm-invalid' | 'cross-feature-invalid',
) {
  return spawnSync(
    depcruise,
    [
      '--config',
      '.dependency-cruiser.cjs',
      '--output-type',
      'err',
      `test/fixtures/architecture/${name}/src`,
    ],
    { cwd: serverRoot, encoding: 'utf8' },
  );
}

describe('backend architecture dependency gate', () => {
  test('accepts application code that depends inward on domain', () => {
    const result = cruiseFixture('valid');
    const output = `${result.stdout}${result.stderr}`;
    expect(result.status).toBe(0);
    expect(output).toContain('no dependency violations found');
  });

  test('rejects application code that imports a persistence adapter', () => {
    const result = cruiseFixture('invalid');
    const output = `${result.stdout}${result.stderr}`;
    expect(result.status).not.toBe(0);
    expect(output).toContain('application-depends-only-inward');
  });

  test('rejects application code that imports an npm-backed boundary dependency', () => {
    const result = cruiseFixture('npm-invalid');
    const output = `${result.stdout}${result.stderr}`;
    expect(result.status).not.toBe(0);
    expect(output).toContain('application-depends-only-inward');
  });

  test("rejects a feature-root import of another feature's private adapter", () => {
    const result = cruiseFixture('cross-feature-invalid');
    const output = `${result.stdout}${result.stderr}`;
    expect(result.status).not.toBe(0);
    expect(output).toContain('no-cross-feature-imports-into-reviews-adapters');
  });
});
