import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The import-matrix guard (REQ-2, REQ-3, REQ-4, REQ-31) — plan 05 §5.12.2 as
 * DATA, checked by grep rather than by review. Every later `mcp/` task
 * inherits this file unmodified; it is deliberately written to pass TODAY
 * against empty `resolve/`, `run/`, `shaping/` and `tools/` directories and
 * to start failing the moment wave 2+ puts a file in one of them that
 * violates the matrix. That is the intended trap, not a gap (§0.4.4).
 *
 * Every check here is a plain text/regex scan of `mcp/src/**\/*.ts` — the
 * same "checkable by grep" standard `onion-architecture` uses for the
 * server's own ring rules (§6 of that skill).
 */

const SRC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');

interface SourceFile {
  /** POSIX-style path relative to `mcp/src/`, e.g. `api/client.ts`. */
  relPath: string;
  content: string;
}

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const abs = path.join(dir, entry);
    const stat = statSync(abs);
    if (stat.isDirectory()) {
      out.push(...listTsFiles(abs));
    } else if (entry.endsWith('.ts')) {
      out.push(abs);
    }
  }
  return out;
}

function loadSourceFiles(): SourceFile[] {
  return listTsFiles(SRC_ROOT).map((abs) => ({
    relPath: path.relative(SRC_ROOT, abs).split(path.sep).join('/'),
    content: readFileSync(abs, 'utf8'),
  }));
}

interface ImportRef {
  specifier: string;
  typeOnly: boolean;
}

/**
 * Extracts every `import ... from '<specifier>'`, side-effect `import
 * '<specifier>'`, and dynamic `import('<specifier>')` in a file. Deliberately
 * a regex scan, not a parser — matches this repo's existing grep-based
 * convention tests (`server/test/pattern-safety.test.ts` and friends) and
 * keeps the guard dependency-free.
 */
function extractImports(content: string): ImportRef[] {
  const refs: ImportRef[] = [];

  const fromImportRe = /import\s+(type\s+)?[^;]*?\bfrom\s+['"]([^'"]+)['"]/g;
  for (const m of content.matchAll(fromImportRe)) {
    refs.push({ specifier: m[2]!, typeOnly: Boolean(m[1]) });
  }

  const sideEffectRe = /^\s*import\s+['"]([^'"]+)['"]/gm;
  for (const m of content.matchAll(sideEffectRe)) {
    refs.push({ specifier: m[1]!, typeOnly: false });
  }

  const dynamicRe = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const m of content.matchAll(dynamicRe)) {
    refs.push({ specifier: m[1]!, typeOnly: false });
  }

  return refs;
}

function inRing(relPath: string, dir: string): boolean {
  return relPath === dir || relPath.startsWith(`${dir}/`);
}

/**
 * Resolves a relative import specifier from `fromRelPath` to a path relative
 * to `mcp/src/`, POSIX-style, with any `.js`/`.ts` extension stripped. This is
 * what makes the M0 guard (and the cross-ring checks below) check where a
 * `./`-relative import actually LANDS, not just that it starts with a dot —
 * `./api/client.js` from `ports.ts` starts with a dot too, and the old guard
 * treated that as "a sibling" (REQ-31 remediation, 2026-08-23).
 */
function resolveRelativeSpecifier(fromRelPath: string, specifier: string): string {
  const fromDir = path.posix.dirname(fromRelPath);
  const joined = path.posix.normalize(path.posix.join(fromDir, specifier));
  return joined.replace(/\.(js|ts)$/, '');
}

/** True when a resolved (extension-stripped) src-relative path sits inside M0. */
function isM0Path(resolvedNoExt: string): boolean {
  return resolvedNoExt === 'ports' || resolvedNoExt.startsWith('schemas/');
}

const files = loadSourceFiles();

// Sanity: this guard is worthless if it silently ran over zero files.
describe('rings.test.ts sees the real source tree', () => {
  it('finds at least ports.ts, config.ts and api/**', () => {
    const relPaths = files.map((f) => f.relPath);
    expect(relPaths).toContain('ports.ts');
    expect(relPaths).toContain('config.ts');
    expect(relPaths.some((p) => p.startsWith('api/'))).toBe(true);
  });
});

describe('REQ-2 — no drizzle-orm, postgres, fastify, or a server/src/ path under mcp/src/**', () => {
  const forbiddenSpecifiers = ['drizzle-orm', 'postgres', 'fastify'];

  it.each(files.map((f): [string, SourceFile] => [f.relPath, f]))('%s', (_relPath, file) => {
    for (const imp of extractImports(file.content)) {
      for (const forbidden of forbiddenSpecifiers) {
        expect(
          imp.specifier === forbidden || imp.specifier.startsWith(`${forbidden}/`),
          `${file.relPath} imports forbidden module "${imp.specifier}"`,
        ).toBe(false);
      }
      expect(
        imp.specifier.includes('server/src/'),
        `${file.relPath} imports a server/src/ path directly ("${imp.specifier}") — use the ` +
          '"@devdigest/shared" alias instead',
      ).toBe(false);
    }
  });
});

describe('REQ-3 — every @devdigest/shared import under mcp/src/** is `import type`', () => {
  it.each(files.map((f): [string, SourceFile] => [f.relPath, f]))('%s', (_relPath, file) => {
    for (const imp of extractImports(file.content)) {
      if (imp.specifier === '@devdigest/shared' || imp.specifier.startsWith('@devdigest/shared/')) {
        expect(
          imp.typeOnly,
          `${file.relPath} imports "${imp.specifier}" as a VALUE — must be "import type" (§5.3)`,
        ).toBe(true);
      }
    }
  });
});

describe('REQ-4 — nothing under mcp/src/** writes to stdout (stdio is the transport)', () => {
  const forbiddenTokens = ['console.log(', 'console.info(', 'console.debug(', 'process.stdout.write('];

  it.each(files.map((f): [string, SourceFile] => [f.relPath, f]))('%s', (_relPath, file) => {
    for (const token of forbiddenTokens) {
      expect(
        file.content.includes(token),
        `${file.relPath} contains "${token}" — every diagnostic must go to stderr (REQ-4)`,
      ).toBe(false);
    }
  });
});

describe('REQ-31 — the mcp/ ring matrix (§5.12.2)', () => {
  it('fetch() is called only inside api/**', () => {
    const fetchCallRe = /\bfetch\s*\(/;
    for (const file of files) {
      if (inRing(file.relPath, 'api')) continue;
      expect(
        fetchCallRe.test(file.content),
        `${file.relPath} calls fetch() — only api/** (ring M3) may reach the network`,
      ).toBe(false);
    }
  });

  it('no bare URL literal (http:// or https://) outside api/** or config.ts', () => {
    // config.ts (ring M1) is the one named exception: it declares
    // DEVDIGEST_API_URL's loopback DEFAULT (plan §7 T5 "Do"), which is a
    // configuration value, not a request URL under construction — request
    // URLs are built exclusively in api/routes.ts.
    const urlLiteralRe = /https?:\/\//;
    for (const file of files) {
      if (inRing(file.relPath, 'api') || file.relPath === 'config.ts') continue;
      expect(
        urlLiteralRe.test(file.content),
        `${file.relPath} contains a URL literal — only api/** may build request URLs`,
      ).toBe(false);
    }
  });

  it('@modelcontextprotocol/sdk is not imported by resolve/**, run/**, shaping/**, or api/**', () => {
    const gatedRings = ['resolve', 'run', 'shaping', 'api'];
    for (const file of files) {
      if (!gatedRings.some((ring) => inRing(file.relPath, ring))) continue;
      for (const imp of extractImports(file.content)) {
        expect(
          imp.specifier === '@modelcontextprotocol/sdk' || imp.specifier.startsWith('@modelcontextprotocol/sdk/'),
          `${file.relPath} imports the MCP SDK — it belongs to M4 (tools/**) and M5 (server.ts/index.ts) only`,
        ).toBe(false);
      }
    }
  });

  it('api/** imports nothing from tools/**', () => {
    for (const file of files) {
      if (!inRing(file.relPath, 'api')) continue;
      for (const imp of extractImports(file.content)) {
        expect(
          imp.specifier.includes('tools/'),
          `${file.relPath} imports from tools/** — api/** (M3) may not depend on tools/** (M4)`,
        ).toBe(false);
      }
    }
  });

  it('schemas/** and ports.ts import only zod, each other, and @devdigest/shared types', () => {
    const m0Files = files.filter((f) => inRing(f.relPath, 'schemas') || f.relPath === 'ports.ts');
    for (const file of m0Files) {
      for (const imp of extractImports(file.content)) {
        const isZod = imp.specifier === 'zod';
        const isSharedTypeOnly =
          (imp.specifier === '@devdigest/shared' || imp.specifier.startsWith('@devdigest/shared/')) && imp.typeOnly;
        // A ./-relative specifier is only a legal M0 "sibling" if it actually
        // RESOLVES inside M0 (ports.ts <-> schemas/*) — `./api/client.js` from
        // `ports.ts` starts with a dot too, and must NOT pass this check.
        const isM0Sibling =
          imp.specifier.startsWith('.') && isM0Path(resolveRelativeSpecifier(file.relPath, imp.specifier));
        expect(
          isZod || isSharedTypeOnly || isM0Sibling,
          `${file.relPath} imports "${imp.specifier}" — M0 (schemas/**, ports.ts) may import only ` +
            'zod, each other (as a ./-relative path that resolves INSIDE M0), and type-only @devdigest/shared',
        ).toBe(true);
      }
    }
  });

  it('process.env is read only in config.ts', () => {
    for (const file of files) {
      if (file.relPath === 'config.ts') continue;
      expect(
        file.content.includes('process.env'),
        `${file.relPath} reads process.env — the only file allowed to is config.ts (M1)`,
      ).toBe(false);
    }
  });

  it('resolve/**, run/**, and shaping/** do not import from api/** — M2 depends on the ApiPort, never on ApiClient', () => {
    const m2Rings = ['resolve', 'run', 'shaping'];
    for (const file of files) {
      if (!m2Rings.some((ring) => inRing(file.relPath, ring))) continue;
      for (const imp of extractImports(file.content)) {
        if (!imp.specifier.startsWith('.')) continue;
        const resolved = resolveRelativeSpecifier(file.relPath, imp.specifier);
        expect(
          inRing(resolved, 'api'),
          `${file.relPath} imports "${imp.specifier}" (resolves to "${resolved}") — M2 (resolve/**, run/**, ` +
            'shaping/**) may depend on the ApiPort (M0), never on api/** (M3)',
        ).toBe(false);
      }
    }
  });

  it('tools/** does not import api/client.ts — it receives an ApiPort through Deps', () => {
    for (const file of files) {
      if (!inRing(file.relPath, 'tools')) continue;
      for (const imp of extractImports(file.content)) {
        if (!imp.specifier.startsWith('.')) continue;
        const resolved = resolveRelativeSpecifier(file.relPath, imp.specifier);
        expect(
          resolved === 'api/client',
          `${file.relPath} imports "${imp.specifier}" — tools/** (M4) may not import api/client.ts directly, ` +
            'it receives an ApiPort through Deps',
        ).toBe(false);
      }
    }
  });

  it('resolve/**, run/**, and shaping/** do not import tools/**, server.ts, or index.ts', () => {
    const m2Rings = ['resolve', 'run', 'shaping'];
    for (const file of files) {
      if (!m2Rings.some((ring) => inRing(file.relPath, ring))) continue;
      for (const imp of extractImports(file.content)) {
        if (!imp.specifier.startsWith('.')) continue;
        const resolved = resolveRelativeSpecifier(file.relPath, imp.specifier);
        expect(
          inRing(resolved, 'tools') || resolved === 'server' || resolved === 'index',
          `${file.relPath} imports "${imp.specifier}" (resolves to "${resolved}") — M2 may not depend on ` +
            'M4 (tools/**) or M5 (server.ts, index.ts)',
        ).toBe(false);
      }
    }
  });

  it('api/** does not import resolve/**, run/**, shaping/**, server.ts, or index.ts', () => {
    for (const file of files) {
      if (!inRing(file.relPath, 'api')) continue;
      for (const imp of extractImports(file.content)) {
        if (!imp.specifier.startsWith('.')) continue;
        const resolved = resolveRelativeSpecifier(file.relPath, imp.specifier);
        const hitsM2 = ['resolve', 'run', 'shaping'].some((ring) => inRing(resolved, ring));
        expect(
          hitsM2 || resolved === 'server' || resolved === 'index',
          `${file.relPath} imports "${imp.specifier}" (resolves to "${resolved}") — api/** (M3) may not ` +
            'depend on M2 (resolve/**, run/**, shaping/**) or M5 (server.ts, index.ts)',
        ).toBe(false);
      }
    }
  });

  it("config.ts imports only zod and M0 (ports.ts, schemas/**) — the SDK check's gatedRings excludes it", () => {
    const configFile = files.find((f) => f.relPath === 'config.ts');
    expect(configFile, 'config.ts not found under mcp/src/').toBeDefined();
    for (const imp of extractImports(configFile!.content)) {
      const isZod = imp.specifier === 'zod';
      const isM0Sibling =
        imp.specifier.startsWith('.') && isM0Path(resolveRelativeSpecifier('config.ts', imp.specifier));
      expect(
        isZod || isM0Sibling,
        `config.ts imports "${imp.specifier}" — M1 (config.ts) may import only zod and M0 (ports.ts, schemas/**)`,
      ).toBe(true);
    }
  });

  it('resolve/** does not import run/**, and shaping/** imports neither resolve/** nor run/** (no sideways imports)', () => {
    for (const file of files) {
      for (const imp of extractImports(file.content)) {
        if (!imp.specifier.startsWith('.')) continue;
        const resolved = resolveRelativeSpecifier(file.relPath, imp.specifier);
        if (inRing(file.relPath, 'resolve')) {
          expect(
            inRing(resolved, 'run'),
            `${file.relPath} imports "${imp.specifier}" (resolves to "${resolved}") — resolve/** must not import run/**`,
          ).toBe(false);
        }
        if (inRing(file.relPath, 'shaping')) {
          expect(
            inRing(resolved, 'resolve') || inRing(resolved, 'run'),
            `${file.relPath} imports "${imp.specifier}" (resolves to "${resolved}") — shaping/** must not import ` +
              'resolve/** or run/**',
          ).toBe(false);
        }
      }
    }
  });

  it('the relative-import dependency graph of mcp/src/** has no cycles', () => {
    // Nodes are extension-stripped, src-relative paths; edges are resolved
    // `./`-relative imports only (package/absolute specifiers are not part of
    // this internal graph). A simple 3-color DFS — readable rather than clever,
    // per the task's own instruction — finds any back-edge into a node still
    // on the current recursion stack.
    const stripExt = (p: string) => p.replace(/\.ts$/, '');
    const nodes = files.map((f) => stripExt(f.relPath));
    const graph = new Map<string, string[]>();
    for (const file of files) {
      const edges: string[] = [];
      for (const imp of extractImports(file.content)) {
        if (!imp.specifier.startsWith('.')) continue;
        edges.push(resolveRelativeSpecifier(file.relPath, imp.specifier));
      }
      graph.set(stripExt(file.relPath), edges);
    }

    type Color = 'white' | 'gray' | 'black';
    const color = new Map<string, Color>(nodes.map((n) => [n, 'white']));
    const stack: string[] = [];
    let cyclePath: string[] | null = null;

    function visit(node: string): void {
      if (cyclePath) return;
      color.set(node, 'gray');
      stack.push(node);
      for (const next of graph.get(node) ?? []) {
        if (!graph.has(next)) continue; // resolves outside mcp/src/** — not a node in this graph
        const nextColor = color.get(next);
        if (nextColor === 'gray') {
          cyclePath = [...stack.slice(stack.indexOf(next)), next];
          return;
        }
        if (nextColor === 'white') visit(next);
        if (cyclePath) return;
      }
      stack.pop();
      color.set(node, 'black');
    }

    for (const node of nodes) {
      if (color.get(node) === 'white') visit(node);
      if (cyclePath) break;
    }

    expect(cyclePath, `Import cycle found: ${cyclePath ? (cyclePath as string[]).join(' -> ') : ''}`).toBeNull();
  });
});

describe("T5's own structural acceptance", () => {
  it('ApiPort declares listActiveRuns, and api/routes.ts builds /pulls/:id/runs/active', () => {
    const ports = files.find((f) => f.relPath === 'ports.ts');
    const routes = files.find((f) => f.relPath === 'api/routes.ts');
    expect(ports?.content).toMatch(/listActiveRuns\s*\(/);
    expect(routes?.content).toMatch(/runs\/active/);
  });

  it('ApiClient is never instantiated at module scope anywhere under mcp/src/**', () => {
    // Top-of-line (no leading whitespace) `new ApiClient(` — the composition
    // root (server.ts, ring M5) is the only place allowed to construct one,
    // and even there it must happen inside a function, not at module scope.
    const moduleScopeCtorRe = /^(export\s+)?const\s+\w+\s*=\s*new\s+ApiClient\(/m;
    for (const file of files) {
      expect(
        moduleScopeCtorRe.test(file.content),
        `${file.relPath} constructs ApiClient at module scope — build it once, inside a function, in server.ts`,
      ).toBe(false);
    }
  });
});
