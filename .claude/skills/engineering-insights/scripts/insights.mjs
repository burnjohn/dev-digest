#!/usr/bin/env node
// Mechanics for the engineering-insights skill.
//
// Division of labour: the model decides WHAT is worth capturing and how to word it.
// This script decides WHERE it lands and guarantees the file stays well-formed —
// fixed section order, machine-stamped dates, append-only, evidence present,
// no near-duplicates. Anything a regex can enforce is enforced here, not in prose.
//
// Usage:
//   node insights.mjs status
//   node insights.mjs route <path>...
//   node insights.mjs check  <target> "<text>"
//   node insights.mjs append <target> "<section>" "<text>" [--force]
//
// No dependencies, Node >= 22.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const TEMPLATE = resolve(SCRIPT_DIR, '../templates/INSIGHTS.md');

/** Fixed section set — exactly the seven rubrics. Order here is the order in the file. */
const SECTIONS = [
  { name: 'What Works', evidence: true },
  { name: "What Doesn't Work", evidence: true },
  { name: 'Codebase Patterns', evidence: true },
  { name: 'Tool & Library Notes', evidence: true },
  { name: 'Recurring Errors & Fixes', evidence: true },
  { name: 'Session Notes', evidence: false, datedGroups: true },
  { name: 'Open Questions', evidence: false },
];

/** Target scope -> file, relative to the repo root. */
const TARGETS = {
  root: 'INSIGHTS.md',
  server: 'server/INSIGHTS.md',
  client: 'client/INSIGHTS.md',
  'reviewer-core': 'reviewer-core/INSIGHTS.md',
  e2e: 'e2e/INSIGHTS.md',
};

/** First match wins. Anything unmatched (scripts/, .github/, docker-compose.yml, …) is root. */
const ROUTES = [
  // Shared contracts live under server/ but every package consumes them, so their
  // findings belong to the cross-cutting file, not to server's.
  [/^server\/src\/vendor\/shared\//, 'root'],
  [/^server\//, 'server'],
  [/^client\//, 'client'],
  [/^reviewer-core\//, 'reviewer-core'],
  [/^e2e\//, 'e2e'],
];

// A one-line entry that survives a year is roughly 40+ characters. Shorter than 25 is
// almost always a stub like "fix the zod bug" that no future session can act on.
const MIN_TEXT_LENGTH = 25;
// Jaccard overlap on content words. 0.4 flags genuine restatements while tolerating
// two different findings about the same file; 0.2 is loose enough to be worth eyeballing.
const DUPLICATE_REFUSE = 0.4;
const DUPLICATE_REPORT = 0.2;
// Per-file entry ceiling. The source article uses 200 for one repo-wide file; these are
// per-module files, so the same signal-to-noise cliff arrives about five times sooner.
const PRUNE_AT = 60;
// Session Notes is the section that rots into a changelog. Three bullets per day forces
// a choice about what the next session actually needs.
const MAX_SESSION_BULLETS = 3;

function repoRoot() {
  let dir = SCRIPT_DIR;
  while (dir !== dirname(dir)) {
    if (existsSync(join(dir, '.git'))) return dir;
    dir = dirname(dir);
  }
  // Fall back to the known layout: <root>/.claude/skills/engineering-insights/scripts/
  return resolve(SCRIPT_DIR, '../../../..');
}

const ROOT = repoRoot();

/** Local date. INSIGHTS_DATE overrides it so tests can assert exact output. */
function today() {
  const override = process.env.INSIGHTS_DATE;
  if (override) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(override)) fail(`INSIGHTS_DATE must be YYYY-MM-DD, got "${override}"`);
    return override;
  }
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function fail(message, code = 1) {
  process.stderr.write(`insights: ${message}\n`);
  process.exit(code);
}

function normalizeSectionName(s) {
  return s
    .replace(/[‘’]/g, "'") // curly apostrophes from copy-paste
    .replace(/\s*&\s*/g, ' & ')
    .replace(/\band\b/gi, '&')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function resolveSection(input) {
  const want = normalizeSectionName(input);
  const exact = SECTIONS.find((s) => normalizeSectionName(s.name) === want);
  if (exact) return exact;
  const prefixed = SECTIONS.filter((s) => normalizeSectionName(s.name).startsWith(want));
  if (prefixed.length === 1) return prefixed[0];
  const list = SECTIONS.map((s) => `  - ${s.name}`).join('\n');
  fail(
    `unknown section "${input}". Valid sections are the seven rubrics:\n${list}\n` +
      'Architectural decisions ("chose X over Y because …") go in Codebase Patterns.',
  );
}

function resolveTarget(input) {
  if (Object.hasOwn(TARGETS, input)) return { scope: input, file: join(ROOT, TARGETS[input]) };
  // Also accept a path: "server", "server/", "server/INSIGHTS.md", or an absolute file.
  const cleaned = input.replace(/\\/g, '/').replace(/\/?INSIGHTS\.md$/i, '').replace(/\/$/, '');
  const asRelative = cleaned.startsWith('/') ? relative(ROOT, cleaned) : cleaned;
  const scope = asRelative === '' || asRelative === '.' ? 'root' : asRelative;
  if (Object.hasOwn(TARGETS, scope)) return { scope, file: join(ROOT, TARGETS[scope]) };
  fail(`unknown target "${input}". Valid targets: ${Object.keys(TARGETS).join(', ')}`);
}

function routeOne(path) {
  const rel = (path.startsWith('/') ? relative(ROOT, path) : path).split(sep).join('/');
  if (rel.startsWith('..')) return 'root'; // outside the repo — cross-cutting by definition
  for (const [pattern, scope] of ROUTES) if (pattern.test(rel)) return scope;
  return 'root';
}

function ensureFile(file, scope) {
  if (existsSync(file)) return readFileSync(file, 'utf8');
  const label = scope === 'root' ? 'repo-wide' : `${scope}/`;
  const body = readFileSync(TEMPLATE, 'utf8').replace('SCOPE', label);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, body);
  return body;
}

/** Index of every `## ` heading, so edits never touch a neighbouring section. */
function sectionBounds(lines, sectionName) {
  const start = lines.findIndex(
    (l) => l.startsWith('## ') && normalizeSectionName(l.slice(3)) === normalizeSectionName(sectionName),
  );
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].startsWith('## ')) {
      end = i;
      break;
    }
  }
  return { start, end };
}

function entryLines(lines, bounds) {
  const out = [];
  for (let i = bounds.start + 1; i < bounds.end; i++) if (lines[i].startsWith('- ')) out.push({ i, text: lines[i] });
  return out;
}

const STOPWORDS = new Set(
  ('the a an and or but if then than of to in on at for with by from as is are was were be been being it its this that these those ' +
    'not no nor so such we you our your they their i me my do does did done use uses used using via when what why how which who whom ' +
    'here there now only just also very can could should would will shall may might must have has had')
    .split(' '),
);

function contentTokens(text) {
  return new Set(
    text
      .toLowerCase()
      .replace(/`/g, ' ')
      .replace(/[^a-z0-9/._@-]+/g, ' ')
      .split(' ')
      .filter((t) => t.length > 2 && !STOPWORDS.has(t)),
  );
}

function similarity(a, b) {
  const A = contentTokens(a);
  const B = contentTokens(b);
  if (A.size === 0 || B.size === 0) return 0;
  let intersection = 0;
  for (const t of A) if (B.has(t)) intersection++;
  return intersection / new Set([...A, ...B]).size;
}

function findSimilar(body, text, threshold) {
  return body
    .split('\n')
    .filter((l) => l.startsWith('- '))
    .map((l) => ({ line: l, score: similarity(l, text) }))
    .filter((c) => c.score >= threshold)
    .sort((a, b) => b.score - a.score);
}

/** Normalize what the model passes in: strip its own bullet/date, unify the arrow. */
function normalizeText(raw) {
  let text = raw.trim().replace(/\s*\n\s*/g, ' ');
  text = text.replace(/^[-*]\s+/, '');
  text = text.replace(/^`?\d{4}-\d{2}-\d{2}`?\s*[—–-]\s*/, '');
  text = text.replace(/\s*->\s*/g, ' → ');
  return text.replace(/\s+/g, ' ').trim();
}

function cmdStatus() {
  const rows = [];
  for (const [scope, rel] of Object.entries(TARGETS)) {
    const file = join(ROOT, rel);
    if (!existsSync(file)) {
      rows.push({ scope, rel, exists: false, total: 0, last: '—', perSection: {} });
      continue;
    }
    const body = readFileSync(file, 'utf8');
    const lines = body.split('\n');
    const perSection = {};
    let total = 0;
    for (const section of SECTIONS) {
      const bounds = sectionBounds(lines, section.name);
      const n = bounds ? entryLines(lines, bounds).length : 0;
      perSection[section.name] = n;
      total += n;
    }
    const dates = body.match(/\d{4}-\d{2}-\d{2}/g) ?? [];
    rows.push({ scope, rel, exists: true, total, last: dates.sort().at(-1) ?? '—', perSection });
  }

  const width = Math.max(...rows.map((r) => r.rel.length));
  const out = ['INSIGHTS files (append with /engineering-insights, read before working in a scope):'];
  for (const r of rows) {
    const flag = !r.exists ? '  (missing — created on first append)' : r.total > PRUNE_AT ? `  ⚠ over ${PRUNE_AT} entries — prune before adding` : '';
    out.push(`  ${r.rel.padEnd(width)}  ${String(r.total).padStart(3)} entries  last ${r.last}${flag}`);
  }
  const filled = rows.filter((r) => r.total > 0);
  if (filled.length > 0) {
    out.push('', 'Non-empty sections:');
    for (const r of filled) {
      const parts = Object.entries(r.perSection)
        .filter(([, n]) => n > 0)
        .map(([name, n]) => `${name} ${n}`);
      out.push(`  ${r.rel}: ${parts.join(' · ')}`);
    }
  }
  process.stdout.write(out.join('\n') + '\n');
}

function cmdRoute(paths) {
  if (paths.length === 0) fail('route needs at least one path');
  const scopes = new Map();
  for (const p of paths) {
    const scope = routeOne(p);
    if (!scopes.has(scope)) scopes.set(scope, []);
    scopes.get(scope).push(p);
  }
  for (const [scope, members] of scopes) {
    process.stdout.write(`${scope}\t${TARGETS[scope]}\t${members.join(' ')}\n`);
  }
  if (scopes.size > 1) {
    process.stdout.write(
      'note: paths span several scopes — write the entry where the fix lives, and add a one-line pointer in the other scope only if a session there would trip over it.\n',
    );
  }
}

function cmdCheck(targetArg, rawText) {
  const { scope, file } = resolveTarget(targetArg);
  if (!existsSync(file)) {
    process.stdout.write(`${TARGETS[scope]} does not exist yet — nothing to duplicate.\n`);
    return;
  }
  const text = normalizeText(rawText ?? '');
  if (!text) fail('check needs the entry text as the second argument');
  const candidates = findSimilar(readFileSync(file, 'utf8'), text, DUPLICATE_REPORT);
  if (candidates.length === 0) {
    process.stdout.write(`No similar entry in ${TARGETS[scope]}.\n`);
    return;
  }
  process.stdout.write(`Similar entries already in ${TARGETS[scope]}:\n`);
  for (const c of candidates.slice(0, 3)) {
    process.stdout.write(`  ${c.score.toFixed(2)}  ${c.line}\n`);
  }
  process.stdout.write(
    '\nIf one of these already states your finding, do not add a second entry. Either leave it alone,\n' +
      'or mark the existing one re-confirmed (append "×2 (DATE)" to it — the one edit that is allowed),\n' +
      'or capture only the part that is genuinely missing, such as the observable symptom.\n',
  );
}

function cmdAppend(targetArg, sectionArg, rawText, flags) {
  if (!targetArg || !sectionArg || !rawText) {
    fail('append needs: <target> "<section>" "<text>"');
  }
  const { scope, file } = resolveTarget(targetArg);
  const section = resolveSection(sectionArg);
  const text = normalizeText(rawText);

  if (text.length < MIN_TEXT_LENGTH) {
    fail(`entry is ${text.length} chars, minimum ${MIN_TEXT_LENGTH}. State the finding so a future session can act on it cold.`);
  }
  if (section.evidence && !/→\s*\S/.test(text)) {
    fail(
      `"${section.name}" entries need evidence. End the entry with "→ " followed by one of:\n` +
        '  → `path/to/file.ts:41`      a file and line\n' +
        '  → `pnpm test foo`           a command that shows it\n' +
        '  → `zod@3.23.8`              a package and version\n' +
        '  → PR #11                    a pull request or commit\n' +
        'A finding nobody can verify is a rumour. Open Questions and Session Notes are exempt.',
    );
  }

  const body = ensureFile(file, scope);

  if (!flags.force) {
    const duplicates = findSimilar(body, text, DUPLICATE_REFUSE);
    if (duplicates.length > 0) {
      process.stderr.write(`insights: ${TARGETS[scope]} already says this:\n`);
      for (const d of duplicates.slice(0, 2)) process.stderr.write(`  ${d.score.toFixed(2)}  ${d.line}\n`);
      process.stderr.write(
        'Re-confirming an existing finding? Append "×2 (DATE)" to that line instead of adding a new one.\n' +
          'Genuinely different finding? Re-run with --force.\n',
      );
      process.exit(3);
    }
  }

  const lines = body.split('\n');
  const bounds = sectionBounds(lines, section.name);
  if (!bounds) {
    fail(`${TARGETS[scope]} has no "## ${section.name}" heading. Restore it from templates/INSIGHTS.md.`);
  }

  const date = today();
  const entry = section.datedGroups ? `- ${text}` : `- \`${date}\` — ${text}`;

  if (section.datedGroups) {
    insertUnderDateHeading(lines, bounds, date, entry, section);
  } else {
    insertAtSectionEnd(lines, bounds, entry);
  }

  writeFileSync(file, lines.join('\n'));
  process.stdout.write(`${TARGETS[scope]} · ${section.name}\n${entry}\n`);
}

function insertAtSectionEnd(lines, bounds, entry) {
  let insertAt = bounds.start + 1;
  for (let i = bounds.start + 1; i < bounds.end; i++) if (lines[i].trim() !== '') insertAt = i + 1;
  // A section whose heading is followed directly by the next one needs a blank line first.
  if (insertAt === bounds.start + 1) lines.splice(insertAt++, 0, '');
  lines.splice(insertAt, 0, entry);
  if (lines[insertAt + 1] !== undefined && lines[insertAt + 1].startsWith('## ')) lines.splice(insertAt + 1, 0, '');
}

function insertUnderDateHeading(lines, bounds, date, entry, section) {
  const heading = `### ${date}`;
  let headingAt = -1;
  for (let i = bounds.start + 1; i < bounds.end; i++) if (lines[i].trim() === heading) headingAt = i;

  if (headingAt === -1) {
    let insertAt = bounds.start + 1;
    for (let i = bounds.start + 1; i < bounds.end; i++) if (lines[i].trim() !== '') insertAt = i + 1;
    if (insertAt === bounds.start + 1) lines.splice(insertAt++, 0, '');
    else lines.splice(insertAt++, 0, '');
    lines.splice(insertAt, 0, heading, '', entry);
    return;
  }

  let end = bounds.end;
  for (let i = headingAt + 1; i < bounds.end; i++) {
    if (lines[i].startsWith('### ')) {
      end = i;
      break;
    }
  }
  const existing = [];
  for (let i = headingAt + 1; i < end; i++) if (lines[i].startsWith('- ')) existing.push(i);
  if (existing.length >= MAX_SESSION_BULLETS) {
    fail(
      `${heading} already has ${existing.length} bullets, the maximum for one day.\n` +
        'Session Notes is for the state the next session needs, not a changelog. Sharpen an existing\n' +
        'bullet, or put the finding in the rubric it belongs to.',
      4,
    );
  }
  const insertAt = (existing.at(-1) ?? headingAt + 1) + 1;
  lines.splice(insertAt, 0, entry);
}

const [command, ...rest] = process.argv.slice(2);
const flags = { force: rest.includes('--force') };
const args = rest.filter((a) => a !== '--force');

switch (command) {
  case 'status':
    cmdStatus();
    break;
  case 'route':
    cmdRoute(args);
    break;
  case 'check':
    cmdCheck(args[0], args[1]);
    break;
  case 'append':
    cmdAppend(args[0], args[1], args[2], flags);
    break;
  default:
    fail(
      'usage:\n' +
        '  node insights.mjs status\n' +
        '  node insights.mjs route <path>...\n' +
        '  node insights.mjs check  <target> "<text>"\n' +
        '  node insights.mjs append <target> "<section>" "<text>" [--force]\n' +
        `targets: ${Object.keys(TARGETS).join(', ')}`,
    );
}
