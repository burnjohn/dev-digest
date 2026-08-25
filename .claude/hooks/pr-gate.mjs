#!/usr/bin/env node
/**
 * pr-gate — PreToolUse hook for the `pr-self-review` skill.
 *
 * Denies `git push` / `gh pr create` / `gh pr ready` unless
 * `.devdigest/cache/pr-self-review/gate.json` holds a FRESH non-blocking verdict —
 * `approve` or `comment` — or a valid override bound to the same working tree.
 * `request_changes` (i.e. at least one CRITICAL) is the verdict that denies.
 *
 * Three properties this file exists to guarantee, in priority order:
 *
 *  1. INVISIBLE. Every command that is not a push exits 0 with no output. A hook that
 *     chatters on `ls` is a hook that gets deleted, and it takes the working gate with it.
 *  2. FAIL-OPEN. Any internal error — unreadable JSON, missing git, bad payload — allows
 *     the command and warns on stderr. A broken gate that bricks `git push` is removed
 *     within the hour.
 *  3. FRESHNESS. `headSha` alone is trivially defeated (fix nothing, push anyway), so the
 *     gate is also keyed on a digest of the working tree. Any edit makes it STALE, and
 *     STALE is treated exactly like "no gate".
 *
 * Node, not bash, on purpose: the repo root contains spaces and this must work on Windows,
 * where how the harness spawns a `.sh` hook is not something we control.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const GATE_REL = '.devdigest/cache/pr-self-review/gate.json';
const OVERRIDE_MIN_REASON = 20;

/* ── 1. payload ─────────────────────────────────────────────────────────────── */

function readStdin() {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

/* ── 2. does this command push? ─────────────────────────────────────────────── */

/**
 * Split a shell command into segments on `&&`, `||`, `;`, `|` and newlines, so that
 * `cd client && git push` is judged on `git push`, not on `cd`.
 */
function segments(command) {
  return command
    .split(/\r?\n|&&|\|\||[;|]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Strip leading `FOO=bar` env assignments and `sudo`/`command`/`time` wrappers. */
function stripPrefixes(segment) {
  let s = segment;
  for (;;) {
    const next = s.replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S*)\s+|(?:sudo|command|time|env)\s+)/, '');
    if (next === s) return s;
    s = next;
  }
}

const HELP_TOKEN = /(?:^|\s)(?:--help|-h)(?:\s|$)/;

/**
 * `git [--no-pager] [-c k=v]... [-C path]... push`
 * `gh pr create|ready`
 * A `--help` anywhere in the segment means it prints text and exits — never gate that.
 */
function isPushLike(segment) {
  const s = stripPrefixes(segment);
  if (HELP_TOKEN.test(s)) return null;

  const git = /^git(?:\s+(?:--no-pager|--paginate|-c\s+\S+|-C\s+(?:"[^"]*"|'[^']*'|\S+)|--git-dir[= ]\S+|--work-tree[= ]\S+))*\s+push(?:\s|$)/;
  if (git.test(s)) return 'git push';

  const gh = /^gh\s+pr\s+(create|ready)(?:\s|$)/.exec(s);
  if (gh) return `gh pr ${gh[1]}`;

  return null;
}

/* ── 3. repo state ──────────────────────────────────────────────────────────── */

function git(root, args) {
  return execFileSync('git', ['--no-pager', '-c', 'core.quotepath=false', ...args], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
}

/** Like git(), but feeds `input` on stdin — for `hash-object --stdin-paths`. */
function gitWithInput(root, args, input) {
  return execFileSync('git', ['--no-pager', '-c', 'core.quotepath=false', ...args], {
    cwd: root,
    input,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'ignore'],
  });
}

/**
 * sha256 over `status --porcelain=v2 -z` + `diff` + `diff --cached` + the untracked
 * paths and their blob hashes.
 *
 * The first three are required for TRACKED files. `--porcelain=v2` reports the HEAD and
 * INDEX blob hashes but not the worktree content hash, so editing an already-modified
 * file leaves the status output byte-identical — the single most common edit in a fix
 * cycle would otherwise be invisible.
 *
 * The last two are required for UNTRACKED files, which reach the digest through none of
 * the first three: both diffs ignore untracked files entirely, `--porcelain=v2` emits a
 * bare `? <path>` with NO blob hash, and default `-unormal` collapses a wholly-untracked
 * directory to ONE entry. So a whole directory of new files read as a single unchanging
 * line, and rewriting an untracked file was invisible — an approved gate stayed FRESH
 * across an arbitrary rewrite of the exact file class §3 of SKILL.md scopes in.
 *
 * `-uall` on the status call would fix only the collapse, not the missing content hash,
 * so it is not sufficient on its own. Both parts below are load-bearing: the path list
 * alone leaves rewrites invisible, the blob list alone leaves a pure rename invisible
 * (same content, same set of hashes).
 */
function workingTreeDigest(root) {
  const untracked = git(root, ['ls-files', '-o', '--exclude-standard', '-z'])
    .split('\0')
    .filter(Boolean);
  // One subprocess for all of them — this runs on every push-like command, and a spawn
  // per file is a visible pause on Windows. `--stdin-paths` is newline-delimited, so a
  // path containing a newline falls back to one call per file rather than misreading it.
  const blobs = untracked.length
    ? untracked.some((p) => p.includes('\n'))
      ? untracked.map((p) => git(root, ['hash-object', '--', p]).trim()).join('\n')
      : gitWithInput(root, ['hash-object', '--stdin-paths'], `${untracked.join('\n')}\n`)
    : '';

  const parts = [
    git(root, ['status', '--porcelain=v2', '-z']),
    git(root, ['diff']),
    git(root, ['diff', '--cached']),
    untracked.join('\n'), // set + order: adds, deletes, renames
    blobs, // content: in-place rewrites
  ];
  // Length-prefix each part instead of joining on a separator literal. A separator
  // is one stray control character away from silently changing the digest, whose only
  // symptom is that every gate reads STALE. Length prefixes are unambiguous and printable.
  const h = createHash('sha256');
  for (const part of parts) h.update(String(part.length)).update(part);
  return h.digest('hex');
}

/* ── 4. decision ────────────────────────────────────────────────────────────── */

function deny(reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason,
      },
    }),
  );
  process.exit(0);
}

function allow() {
  process.exit(0);
}

const RERUN = 'Run `/pr-self-review` to re-gate.';

function overrideCommand() {
  return 'Override (reason required, min 20 chars):\n  /pr-self-review --override "<why this must ship now>"';
}

/**
 * `node .claude/hooks/pr-gate.mjs --digest`
 *
 * Prints `{ headSha, branch, workingTreeDigest }` as JSON. Phase 5 of the skill MUST use
 * this to stamp `gate.json` rather than recomputing the digest itself: two implementations
 * of the same hash is one implementation too many, and when they disagree the only symptom
 * is that every gate reads STALE forever. (That is not hypothetical — it is how the first
 * version of this file failed.)
 */
function emitDigest() {
  const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  process.stdout.write(
    JSON.stringify({
      headSha: git(root, ['rev-parse', 'HEAD']).trim(),
      branch: git(root, ['rev-parse', '--abbrev-ref', 'HEAD']).trim(),
      workingTreeDigest: workingTreeDigest(root),
    }),
  );
  process.exit(0);
}

/**
 * The verdicts that do NOT block a push.
 *
 * SKILL.md §7 is explicit: a CRITICAL is "the ONLY level that blocks merge", and the
 * verdict is a pure function of the findings (contracts/findings.ts:26) — any CRITICAL
 * → `request_changes`, WARNING/SUGGESTION-only → `comment`, nothing → `approve`. So
 * `comment` means "reviewed, nothing blocking", which §7 lists under "Does not block".
 *
 * This was `verdict === 'approve'` until 2026-08-24, when a live run hit it: a branch
 * with zero CRITICALs and one WARNING (a stray `mcp/pnpm-lock.yaml`) was refused a push.
 * Two things were wrong with that. It collapses a three-level severity rubric into two,
 * making WARNING indistinguishable from CRITICAL in the only place severity is acted on;
 * and several mechanical rules (H3, H5, H12, H17, H18) are WARNING BY DESIGN and were
 * never meant to stop a push. The deny branch below is itself the evidence — on a
 * `comment` verdict it renders "0 blocking issue(s)" and "(see the report)", because it
 * was written assuming criticals exist.
 *
 * It survived because `pr-gate.test.mjs` covered `approve` and `request_changes` but
 * never `comment` — the third enum value was untested. ANY change here needs a
 * `comment` → ALLOW case in that file.
 *
 * A Set rather than `!== 'request_changes'` so an unknown or malformed verdict still
 * fails closed.
 */
const PASSING_VERDICTS = new Set(['approve', 'comment']);

function main() {
  if (process.argv[2] === '--digest') emitDigest();

  const raw = readStdin();
  if (!raw.trim()) allow();

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    allow(); // not our payload shape — say nothing
  }

  const command = payload?.tool_input?.command;
  if (typeof command !== 'string' || !command) allow();

  let matched = null;
  for (const seg of segments(command)) {
    matched = isPushLike(seg);
    if (matched) break;
  }
  if (!matched) allow(); // ← the 99.9% path: silent, no output at all

  const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const gatePath = join(root, GATE_REL);

  let gate;
  try {
    gate = JSON.parse(readFileSync(gatePath, 'utf8'));
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      deny(
        `\`${matched}\` is gated by pr-self-review, and no review has been run for this working tree.\n\n` +
          `No gate file at \`${GATE_REL}\`.\n\n${RERUN}`,
      );
    }
    // Present but unreadable/corrupt → fail OPEN. A gate we cannot parse is our bug,
    // and our bug must not stand between the user and their push.
    process.stderr.write(`pr-gate: ignoring unreadable ${GATE_REL} (${err?.message ?? err})\n`);
    allow();
  }

  if (gate?.schemaVersion !== 1) {
    process.stderr.write(`pr-gate: unknown gate schemaVersion ${gate?.schemaVersion}; allowing\n`);
    allow();
  }

  // Freshness first: a stale approve is worth less than no approve at all.
  let headSha;
  let digest;
  try {
    headSha = git(root, ['rev-parse', 'HEAD']).trim();
    digest = workingTreeDigest(root);
  } catch (err) {
    process.stderr.write(`pr-gate: git unavailable (${err?.message ?? err}); allowing\n`);
    allow();
  }

  const stale = gate.headSha !== headSha || gate.workingTreeDigest !== digest;
  if (stale) {
    const what = gate.headSha !== headSha ? 'HEAD moved' : 'the working tree changed';
    deny(
      `\`${matched}\` is gated by pr-self-review, and the last review is STALE — ${what} since it ran.\n\n` +
        `Reviewed: ${gate.headSha?.slice(0, 7) ?? '?'} · now: ${headSha.slice(0, 7)}\n` +
        `Report: ${gate.reportPath ?? '(none)'}\n\n${RERUN}`,
    );
  }

  const ov = gate.override;
  const overrideValid =
    ov &&
    typeof ov.reason === 'string' &&
    ov.reason.trim().length >= OVERRIDE_MIN_REASON &&
    ov.workingTreeDigest === digest;

  if (PASSING_VERDICTS.has(gate.verdict) || overrideValid) {
    // Passing, but not spotless — say so. A silent allow on a partial review is how a
    // coverage gap becomes invisible; a BLOCKING one is how the gate gets ripped out.
    // stderr only: stdout is the hook's decision channel and must stay clean, and the
    // hook must remain silent on the happy path.
    if (gate.verdict !== 'approve' || gate.coverage === 'partial') {
      const bits = [];
      if (gate.verdict !== 'approve') bits.push(`verdict \`${gate.verdict}\``);
      if (gate.coverage === 'partial') bits.push('coverage `partial`');
      process.stderr.write(
        `pr-gate: allowing \`${matched}\` with ${bits.join(' and ')} — no CRITICAL findings. ` +
          `Report: ${gate.reportPath ?? '(none)'}\n`,
      );
    }
    allow();
  }

  const criticals = Array.isArray(gate.criticals) ? gate.criticals : [];
  const list = criticals.length
    ? criticals
        .slice(0, 5)
        .map((c) => `  • ${c.title ?? c.id ?? 'untitled'}${c.file ? ` — ${c.file}:${c.start_line ?? '?'}` : ''}`)
        .join('\n') + (criticals.length > 5 ? `\n  • …and ${criticals.length - 5} more` : '')
    : '  (see the report)';

  const skipped = Array.isArray(gate.checksSkipped) ? gate.checksSkipped : [];
  const skippedNote = skipped.length
    ? `\nChecks skipped (not counted against you): ${skipped.map((s) => s.id).join(', ')}\n`
    : '';

  deny(
    `\`${matched}\` blocked by pr-self-review — verdict \`${gate.verdict}\`, ` +
      `${gate.criticalCount ?? criticals.length} blocking issue(s).\n\n` +
      `${list}\n${skippedNote}\n` +
      `Report: ${gate.reportPath ?? '(none)'}\n\n` +
      `Fix, then ${RERUN.toLowerCase()}\n` +
      `Or fix the blockers automatically: /pr-self-review --fix\n\n` +
      overrideCommand(),
  );
}

try {
  main();
} catch (err) {
  // Last-resort fail-open. Nothing this hook can get wrong is worth blocking a push over.
  process.stderr.write(`pr-gate: internal error, allowing (${err?.stack ?? err})\n`);
  process.exit(0);
}