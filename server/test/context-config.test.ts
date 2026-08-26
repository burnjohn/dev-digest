import { describe, it, expect } from 'vitest';
import { homedir } from 'node:os';
import { join, isAbsolute, dirname, resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/platform/config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * T2 (SPEC-01 project context) — `AppConfig.contextSearchRoots` and
 * `AppConfig.contextUploadDir`. Hermetic: `loadConfig` only parses env, it never
 * touches the filesystem.
 */
describe('loadConfig — project-context fields', () => {
  it('contextSearchRoots defaults to [\'.\'] with no env configured', () => {
    const config = loadConfig({} as NodeJS.ProcessEnv);
    expect(config.contextSearchRoots).toEqual(['.']);
  });

  it('parses a comma-separated DEVDIGEST_CONTEXT_SEARCH_ROOTS into a trimmed list', () => {
    const config = loadConfig({
      DEVDIGEST_CONTEXT_SEARCH_ROOTS: ' packages/api , packages/web ,docs',
    } as NodeJS.ProcessEnv);
    expect(config.contextSearchRoots).toEqual(['packages/api', 'packages/web', 'docs']);
  });

  it('drops empty entries produced by stray commas', () => {
    const config = loadConfig({
      DEVDIGEST_CONTEXT_SEARCH_ROOTS: 'apps/,,libs/',
    } as NodeJS.ProcessEnv);
    expect(config.contextSearchRoots).toEqual(['apps/', 'libs/']);
  });

  it('contextUploadDir defaults to an absolute path under ~/.devdigest/context, not under cloneDir', () => {
    const config = loadConfig({} as NodeJS.ProcessEnv);
    expect(config.contextUploadDir).toBe(join(homedir(), '.devdigest', 'context'));
    expect(isAbsolute(config.contextUploadDir)).toBe(true);
    expect(config.contextUploadDir).not.toBe(config.cloneDir);
    expect(config.contextUploadDir.startsWith(config.cloneDir)).toBe(false);
  });

  it('honors DEVDIGEST_CONTEXT_UPLOAD_DIR when set to an absolute path', () => {
    const custom = join(homedir(), 'custom-context-dir');
    const config = loadConfig({
      DEVDIGEST_CONTEXT_UPLOAD_DIR: custom,
    } as NodeJS.ProcessEnv);
    expect(config.contextUploadDir).toBe(custom);
  });

  it('adds no config key for the 400 KB per-document bound or the 5 000-file walk bound', () => {
    const source = readFileSync(resolve(__dirname, '../src/platform/config.ts'), 'utf-8');
    expect(source).not.toMatch(/MAX_FILE_SIZE/);
    expect(source).not.toMatch(/MAX_INDEXED_FILES/);
  });
});
