// Test suite for pr-gate.mjs — the PreToolUse hook behind the `pr-self-review` skill.
//
//   node .claude/hooks/pr-gate.test.mjs
//
// No framework: the four packages own their own vitest suites, and `.claude/` is not a
// package. Exits non-zero on any failure so it can be wired into CI later if wanted.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.CLAUDE_PROJECT_DIR || resolve(fileURLToPath(import.meta.url), '../../..');
const HOOK = join(ROOT, '.claude/hooks/pr-gate.mjs');
const GATE_DIR = join(ROOT, '.devdigest/cache/pr-self-review');
const GATE = join(GATE_DIR, 'gate.json');

const git = (args) =>
  execFileSync('git', ['--no-pager', '-c', 'core.quotepath=false', ...args], {
    cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'],
  });

const digest = () =>
  JSON.parse(execFileSync('node', [HOOK, '--digest'], {
    cwd: ROOT, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: ROOT },
  })).workingTreeDigest;
function run(command) {
  const payload = JSON.stringify({ session_id: 't', tool_name: 'Bash', tool_input: { command } });
  const r = execFileSync('node', [HOOK], {
    cwd: ROOT, input: payload, encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: ROOT },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  return r;
}

function decision(out) {
  if (!out.trim()) return 'ALLOW(silent)';
  try {
    const j = JSON.parse(out);
    return j.hookSpecificOutput.permissionDecision.toUpperCase();
  } catch {
    return 'UNPARSEABLE: ' + out.slice(0, 120);
  }
}

const writeGate = (o) => { mkdirSync(GATE_DIR, { recursive: true }); writeFileSync(GATE, typeof o === 'string' ? o : JSON.stringify(o, null, 2)); };
const clearGate = () => { if (existsSync(GATE)) rmSync(GATE); };

const head = git(['rev-parse', 'HEAD']).trim();
const results = [];
const t = (name, expect, actual, extra = '') =>
  results.push(`${actual === expect ? 'PASS' : 'FAIL'}  ${name}  → ${actual}${extra}`);

// ── D1: no gate, unrelated commands must be SILENT ─────────────────────────────
clearGate();
for (const c of ['ls', 'git status', 'pnpm test', 'cd client && pnpm typecheck',
                 'git commit -m "wip"', 'echo hello', 'gh pr list', 'git pull --rebase']) {
  t(`D1 invisible: ${c}`, 'ALLOW(silent)', decision(run(c)));
}

// ── D6: --help must pass ───────────────────────────────────────────────────────
for (const c of ['gh pr create --help', 'git push --help', 'gh pr ready -h']) {
  t(`D6 help: ${c}`, 'ALLOW(silent)', decision(run(c)));
}

// ── D2: push-like with no gate → DENY ──────────────────────────────────────────
for (const c of ['git push --dry-run', 'git push', 'git push -u origin HEAD',
                 'gh pr create --fill', 'gh pr ready',
                 'cd client && git push', 'GIT_TRACE=1 git push',
                 'git -c core.pager=cat push']) {
  t(`D2 no-gate deny: ${c}`, 'DENY', decision(run(c)));
}

// ── D3: fresh approve → ALLOW ──────────────────────────────────────────────────
const fresh = {
  schemaVersion: 1, verdict: 'approve', branch: 'main', baseSha: head, headSha: head,
  workingTreeDigest: digest(), reviewedAt: new Date().toISOString(), coverage: 'full',
  criticalCount: 0, criticals: [], checksRun: [], checksSkipped: [],
  reportPath: '.devdigest/cache/pr-self-review/report-x.md', override: null,
};
writeGate(fresh);
t('D3 fresh approve', 'ALLOW(silent)', decision(run('git push --dry-run')));

// ── D3b: fresh request_changes → DENY, and the reason must name the critical ───
writeGate({ ...fresh, verdict: 'request_changes', criticalCount: 1,
  criticals: [{ id: 'c1', title: 'Run rows written before commit', file: 'server/src/modules/reviews/service.ts', start_line: 88 }] });
const rc = run('git push');
t('D3b request_changes', 'DENY', decision(rc));
const reason = JSON.parse(rc).hookSpecificOutput.permissionDecisionReason;
t('D3b names the critical', true, reason.includes('Run rows written before commit'));
t('D3b offers override', true, reason.includes('--override'));

// ── D4: stale → DENY ───────────────────────────────────────────────────────────
writeGate({ ...fresh, workingTreeDigest: 'deadbeef' });
const stale = run('git push --dry-run');
t('D4 stale worktree', 'DENY', decision(stale));
t('D4 says STALE', true, JSON.parse(stale).hookSpecificOutput.permissionDecisionReason.includes('STALE'));

writeGate({ ...fresh, headSha: '0'.repeat(40) });
t('D4b stale HEAD', 'DENY', decision(run('git push')));

// ── D5: corrupt gate → fail OPEN ───────────────────────────────────────────────
writeGate('{ this is not json');
t('D5 corrupt gate fails open', 'ALLOW(silent)', decision(run('git push')));

// ── override ───────────────────────────────────────────────────────────────────
writeGate({ ...fresh, verdict: 'request_changes', criticalCount: 1, criticals: [],
  override: { reason: 'hotfix for prod outage, reviewed by hand with the on-call', workingTreeDigest: fresh.workingTreeDigest } });
t('override valid', 'ALLOW(silent)', decision(run('git push')));

writeGate({ ...fresh, verdict: 'request_changes', criticalCount: 1, criticals: [],
  override: { reason: 'because', workingTreeDigest: fresh.workingTreeDigest } });
t('override too short', 'DENY', decision(run('git push')));

writeGate({ ...fresh, verdict: 'request_changes', criticalCount: 1, criticals: [],
  override: { reason: 'a perfectly long and detailed justification here', workingTreeDigest: 'stale-digest' } });
t('override bound to old tree', 'DENY', decision(run('git push')));

clearGate();
console.log(results.join('\n'));
console.log(`\n${results.filter((r) => r.startsWith('PASS')).length}/${results.length} passed`);
