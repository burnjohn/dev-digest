import { spawn } from 'node:child_process';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, extname } from 'node:path';
import type {
  CodeIndex,
  RepoRef,
  CodeMatch,
  CodeSymbol,
  CodeReference,
  GitClient,
} from '@devdigest/shared';
import { compileSafeRegex } from '../../platform/pattern-safety.js';
import { extractSymbols, extractReferences } from './extract.js';

/**
 * CodeIndex — ripgrep search + an ENHANCED regex symbol/reference
 * extractor (A3, L04). The symbol/reference logic lives in `./extract.ts`
 * (unit-tested in isolation); see that file's header for why we strengthened
 * the regex extractor rather than wiring `web-tree-sitter` under the
 * parallel-phase no-install constraint.
 *
 * grep(): uses the `@vscode/ripgrep` binary when resolvable; otherwise falls
 * back to a pure-Node recursive scan so it works with zero native deps (tests).
 * Because WHICH engine runs depends on an optional dependency resolving, the two
 * are held to identical observable behaviour: the same patterns are refused (via
 * `platform/pattern-safety`), the same caps apply, and neither throws on a bad
 * pattern — see `grep`.
 */

const CODE_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const IGNORE_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', '.next', 'coverage']);

/** Matches per file. Bounds a pathological pattern's output on one huge file. */
const MAX_MATCHES_PER_FILE = 200;
/** Matches overall. Both engines stop here, so neither can balloon memory. */
const MAX_TOTAL_MATCHES = 5_000;
/** Files above this are skipped — minified bundles are not searchable source. */
const MAX_FILESIZE = '2M';
/** Longest line a pattern is evaluated against, bounding one match call. */
const MAX_LINE_CHARS = 2_000;

/**
 * Build ripgrep's argv.
 *
 * Exported for test: the ORDER and the two terminators are the security-relevant
 * part, and asserting on the array is the only way to pin them without spawning.
 *
 * `-e <pattern>` and the `--` before the path are both load-bearing. Passed
 * positionally, a pattern beginning with `-` is parsed by ripgrep as an OPTION,
 * and ripgrep's `--pre=<COMMAND>` runs an external program per searched file — so
 * a caller-controlled pattern would reach process execution. (`spawn` is used
 * without a shell, so this was never shell injection; it was ripgrep's own flag
 * parsing, which is why quoting would not have helped.)
 */
export function buildRgArgs(pattern: string, root: string): string[] {
  return [
    '--line-number',
    '--no-heading',
    '--color=never',
    `--max-count=${MAX_MATCHES_PER_FILE}`,
    `--max-filesize=${MAX_FILESIZE}`,
    // Everything after this is data, never options.
    '-e',
    pattern,
    '--',
    root,
  ];
}

let rgPathCache: string | null | undefined;
async function resolveRg(): Promise<string | null> {
  if (rgPathCache !== undefined) return rgPathCache;
  try {
    // Optional native dep; resolved at runtime. Falls back to pure-Node grep if absent.
    const mod = (await import(/* @vite-ignore */ '@vscode/ripgrep' as string)) as {
      rgPath?: string;
    };
    rgPathCache = mod.rgPath ?? null;
  } catch {
    rgPathCache = null;
  }
  return rgPathCache;
}

export class RipgrepCodeIndex implements CodeIndex {
  constructor(private git: Pick<GitClient, 'clonePathFor'>) {}

  private root(repo: RepoRef): string {
    return this.git.clonePathFor(repo);
  }

  /**
   * Search the clone. Returns `[]` for a pattern that is unusable — invalid
   * syntax, or one the safety dialect refuses.
   *
   * Empty-on-bad-pattern rather than throwing, because the two engines have to
   * AGREE: ripgrep exits 2 on a bad pattern and this adapter has always resolved
   * `[]` for that, while the Node fallback used to let a `SyntaxError` escape.
   * Which of the two runs depends on whether an optional native dep resolved, so
   * a caller written against one behaviour broke under the other.
   */
  async grep(repo: RepoRef, pattern: string): Promise<CodeMatch[]> {
    // Validate ONCE, before either engine, so both refuse exactly the same set.
    if (!compileSafeRegex(pattern)) return [];
    const root = this.root(repo);
    const rg = await resolveRg();
    if (rg) return this.grepWithRg(rg, root, pattern);
    return this.grepWithNode(root, pattern);
  }

  private grepWithRg(rg: string, root: string, pattern: string): Promise<CodeMatch[]> {
    return new Promise((resolve, reject) => {
      const matches: CodeMatch[] = [];
      const proc = spawn(rg, buildRgArgs(pattern, root));
      // Parse line-by-line off the stream instead of buffering the whole of
      // stdout: a broad pattern over a large clone produced one string holding
      // every hit in the repo before a single match was emitted.
      let carry = '';
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve(matches);
      };
      const take = (raw: string) => {
        // Strip the CR of a CRLF pair before matching. `.` in a JS regex does NOT
        // match `\r` (it is a line terminator), so on a CRLF file every line kept
        // its trailing `\r` and the match below failed for ALL of them — this
        // adapter silently returned zero results for CRLF-checked-out repos.
        const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
        // <path>:<line>:<text>
        const m = line.match(/^(.*?):(\d+):(.*)$/);
        if (!m) return;
        matches.push({ path: relative(root, m[1]!), line: Number(m[2]), text: m[3]! });
        if (matches.length >= MAX_TOTAL_MATCHES) {
          proc.kill();
          finish();
        }
      };
      proc.stdout.on('data', (d) => {
        if (done) return;
        carry += d.toString();
        const lines = carry.split('\n');
        carry = lines.pop() ?? '';
        for (const line of lines) take(line);
      });
      proc.on('error', reject);
      proc.on('close', () => {
        if (!done && carry) take(carry);
        finish();
      });
    });
  }

  private async grepWithNode(root: string, pattern: string): Promise<CodeMatch[]> {
    // Non-null: `grep` already refused anything `compileSafeRegex` rejects.
    const re = compileSafeRegex(pattern)!;
    const matches: CodeMatch[] = [];
    for (const file of await this.walk(root)) {
      const content = await readFile(file, 'utf8').catch(() => '');
      // `/\r?\n/`, not `'\n'`: a stray trailing `\r` both breaks `$`-anchored
      // patterns and leaks into the returned `text`. Same CRLF trap as the rg path.
      const lines = content.split(/\r?\n/);
      let perFile = 0;
      for (let i = 0; i < lines.length; i++) {
        // Truncate the line before matching, not after: this is what bounds the
        // input to a single `re.test`, and it is the other half of the ReDoS
        // defence (the pattern dialect being the first).
        const line = lines[i]!;
        if (re.test(line.length > MAX_LINE_CHARS ? line.slice(0, MAX_LINE_CHARS) : line)) {
          matches.push({ path: relative(root, file), line: i + 1, text: line });
          perFile += 1;
          if (perFile >= MAX_MATCHES_PER_FILE) break;
          if (matches.length >= MAX_TOTAL_MATCHES) return matches;
        }
      }
    }
    return matches;
  }

  /** Enhanced regex symbol extractor (functions, classes + methods, arrows, types). */
  async symbols(repo: RepoRef): Promise<CodeSymbol[]> {
    const root = this.root(repo);
    const out: CodeSymbol[] = [];
    for (const file of await this.walk(root)) {
      if (!CODE_EXT.has(extname(file))) continue;
      const content = await readFile(file, 'utf8').catch(() => '');
      const rel = relative(root, file);
      for (const s of extractSymbols(content)) {
        out.push({ path: rel, name: s.name, kind: s.kind, line: s.line });
      }
    }
    return out;
  }

  /** Enhanced reference finder: call sites / `new` / member-calls / JSX usage. */
  async references(repo: RepoRef, symbol: string): Promise<CodeReference[]> {
    const root = this.root(repo);
    const out: CodeReference[] = [];
    for (const file of await this.walk(root)) {
      if (!CODE_EXT.has(extname(file))) continue;
      const content = await readFile(file, 'utf8').catch(() => '');
      const rel = relative(root, file);
      for (const r of extractReferences(content, symbol)) {
        out.push({ fromPath: rel, toSymbol: symbol, line: r.line });
      }
    }
    return out;
  }

  private async walk(dir: string, acc: string[] = []): Promise<string[]> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return acc;
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (IGNORE_DIRS.has(e.name)) continue;
        await this.walk(join(dir, e.name), acc);
      } else if (e.isFile()) {
        const full = join(dir, e.name);
        const s = await stat(full).catch(() => null);
        if (s && s.size < 2_000_000) acc.push(full);
      }
    }
    return acc;
  }
}
