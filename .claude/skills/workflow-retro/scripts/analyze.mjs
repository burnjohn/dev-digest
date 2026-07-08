#!/usr/bin/env node
/**
 * workflow-retro analyzer — deterministic metrics from Claude Code session
 * transcripts (~/.claude/projects/<slug>/). Judgment stays with the model;
 * this script only counts.
 *
 * Usage:
 *   node analyze.mjs --list [N]                 # recent sessions, newest first
 *   node analyze.mjs --session <uuid>[,<uuid>…] # analyze one run (may span sessions)
 *   node analyze.mjs --session latest
 *   [--project <transcripts-dir>] [--json]
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// ---------- pricing ($ per MTok; cache read = 0.1×in, write 5m = 1.25×in, 1h = 2×in) ----------
const PRICES = [
  { match: /fable-5|mythos-5/, in: 10, out: 50 },
  { match: /opus/, in: 5, out: 25 },
  { match: /sonnet/, in: 3, out: 15 },
  { match: /haiku/, in: 1, out: 5 },
];
const priceFor = (model) => PRICES.find((p) => p.match.test(model || '')) || { in: 3, out: 15 };

// ---------- args ----------
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
};
const has = (name) => args.includes(name);

function defaultProjectDir() {
  const slug = process.cwd().replace(/[^a-zA-Z0-9]/g, '-');
  return path.join(os.homedir(), '.claude', 'projects', slug);
}
const projectDir = flag('--project') || defaultProjectDir();
if (!fs.existsSync(projectDir)) {
  console.error(`Transcripts dir not found: ${projectDir}`);
  process.exit(1);
}

// ---------- jsonl helpers ----------
function readJsonl(file) {
  const out = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line) continue;
    try { out.push(JSON.parse(line)); } catch { /* torn tail line */ }
  }
  return out;
}

function sessionFiles() {
  return fs.readdirSync(projectDir)
    .filter((f) => f.endsWith('.jsonl'))
    .map((f) => ({ id: f.replace(/\.jsonl$/, ''), file: path.join(projectDir, f), mtime: fs.statSync(path.join(projectDir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
}

function sessionTitle(entries) {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e.type === 'ai-title') {
      const t = e.title || e.text || e.value || '';
      if (t) return String(t).slice(0, 70);
    }
  }
  const firstUser = entries.find((e) => e.type === 'user' && e.message);
  const c = firstUser?.message?.content;
  const text = typeof c === 'string' ? c : Array.isArray(c) ? (c.find((b) => b.type === 'text')?.text || '') : '';
  return text.replace(/\s+/g, ' ').slice(0, 70);
}

// ---------- per-context analysis (main chain or one subagent) ----------
function analyzeContext(entries, label) {
  const seen = new Set();
  const usage = { in: 0, cc5m: 0, cc1h: 0, cacheRead: 0, out: 0 };
  const tools = {};
  const readFiles = new Set();
  const models = new Set();
  let first = null, last = null, apiCalls = 0;

  for (const e of entries) {
    if (e.timestamp) {
      const t = Date.parse(e.timestamp);
      if (!Number.isNaN(t)) { first = first === null ? t : Math.min(first, t); last = last === null ? t : Math.max(last, t); }
    }
    if (e.type !== 'assistant' || !e.message) continue;
    for (const b of e.message.content || []) {
      if (b.type === 'tool_use') {
        tools[b.name] = (tools[b.name] || 0) + 1;
        const fp = b.input?.file_path;
        if (b.name === 'Read' && typeof fp === 'string') readFiles.add(fp.replace(/\\/g, '/'));
      }
    }
    const key = e.requestId || e.message.id;
    if (!key || seen.has(key) || !e.message.usage) continue; // usage repeats per content-block entry
    seen.add(key);
    apiCalls++;
    if (e.message.model) models.add(e.message.model);
    const u = e.message.usage;
    usage.in += u.input_tokens || 0;
    usage.cacheRead += u.cache_read_input_tokens || 0;
    usage.out += u.output_tokens || 0;
    const cc = u.cache_creation;
    if (cc) { usage.cc5m += cc.ephemeral_5m_input_tokens || 0; usage.cc1h += cc.ephemeral_1h_input_tokens || 0; }
    else usage.cc5m += u.cache_creation_input_tokens || 0;
  }

  const model = [...models][0] || '';
  const p = priceFor(model);
  const cost = (usage.in * p.in + usage.cc5m * 1.25 * p.in + usage.cc1h * 2 * p.in + usage.cacheRead * 0.1 * p.in + usage.out * p.out) / 1e6;
  const promptTotal = usage.in + usage.cc5m + usage.cc1h + usage.cacheRead;
  return {
    label, models: [...models], apiCalls, usage, cost,
    cacheHit: promptTotal ? usage.cacheRead / promptTotal : 0,
    tools, readFiles: [...readFiles],
    start: first, end: last, wallSec: first !== null ? Math.round((last - first) / 1000) : 0,
  };
}

function analyzeSession(id) {
  const mainFile = path.join(projectDir, `${id}.jsonl`);
  if (!fs.existsSync(mainFile)) { console.error(`No such session: ${id}`); process.exit(1); }
  const mainEntries = readJsonl(mainFile);
  const contexts = [analyzeContext(mainEntries, 'main')];
  const subDir = path.join(projectDir, id, 'subagents');
  if (fs.existsSync(subDir)) {
    for (const f of fs.readdirSync(subDir).filter((f) => f.endsWith('.jsonl'))) {
      const metaFile = path.join(subDir, f.replace(/\.jsonl$/, '.meta.json'));
      let label = f.replace(/\.jsonl$/, '');
      if (fs.existsSync(metaFile)) {
        try {
          const m = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
          label = `${m.agentType || 'agent'} — ${(m.description || '').slice(0, 50)}`;
        } catch { /* keep filename */ }
      }
      contexts.push(analyzeContext(readJsonl(path.join(subDir, f)), label));
    }
  }
  return { id, title: sessionTitle(mainEntries), contexts };
}

// ---------- aggregation ----------
const fmt = (n) => n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(n);
const pct = (x) => (x * 100).toFixed(1) + '%';
const mins = (s) => s >= 60 ? `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s` : `${s}s`;

function maxConcurrency(intervals) {
  const ev = [];
  for (const [s, e] of intervals) { ev.push([s, 1], [e, -1]); }
  ev.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let cur = 0, max = 0;
  for (const [, d] of ev) { cur += d; max = Math.max(max, cur); }
  return max;
}

function report(sessions) {
  const all = sessions.flatMap((s) => s.contexts.map((c) => ({ ...c, session: s.id.slice(0, 8) })));
  const subs = all.filter((c) => c.label !== 'main');
  const total = { in: 0, cc: 0, cacheRead: 0, out: 0, cost: 0, apiCalls: 0 };
  for (const c of all) {
    total.in += c.usage.in; total.cc += c.usage.cc5m + c.usage.cc1h;
    total.cacheRead += c.usage.cacheRead; total.out += c.usage.out;
    total.cost += c.cost; total.apiCalls += c.apiCalls;
  }
  const promptTotal = total.in + total.cc + total.cacheRead;
  const subCost = subs.reduce((a, c) => a + c.cost, 0);

  const lines = [];
  lines.push(`# Run metrics — ${sessions.map((s) => `${s.id.slice(0, 8)} "${s.title}"`).join(' + ')}`, '');
  lines.push(`| context | session | model | API calls | in (uncached) | cache-write | cache-read | out | cache-hit | wall | est. cost |`);
  lines.push(`|---|---|---|---|---|---|---|---|---|---|---|`);
  for (const c of all) {
    lines.push(`| ${c.label} | ${c.session} | ${c.models.join(',') || '?'} | ${c.apiCalls} | ${fmt(c.usage.in)} | ${fmt(c.usage.cc5m + c.usage.cc1h)} | ${fmt(c.usage.cacheRead)} | ${fmt(c.usage.out)} | ${pct(c.cacheHit)} | ${mins(c.wallSec)} | $${c.cost.toFixed(2)} |`);
  }
  lines.push(`| **TOTAL** | | | ${total.apiCalls} | ${fmt(total.in)} | ${fmt(total.cc)} | ${fmt(total.cacheRead)} | ${fmt(total.out)} | ${pct(promptTotal ? total.cacheRead / promptTotal : 0)} | | **$${total.cost.toFixed(2)}** |`, '');
  lines.push(`Subagent share of cost: ${pct(total.cost ? subCost / total.cost : 0)} — this is what the parent context never sees (in-context estimates undercount by exactly this).`, '');

  // parallelism
  const iv = subs.filter((c) => c.start !== null).map((c) => [c.start, c.end]);
  if (iv.length) {
    const busy = subs.reduce((a, c) => a + c.wallSec, 0);
    const span = (Math.max(...iv.map((i) => i[1])) - Math.min(...iv.map((i) => i[0]))) / 1000;
    lines.push(`Parallelism: ${subs.length} subagents, max concurrent ${maxConcurrency(iv)}, sum-of-wall ${mins(busy)} over a ${mins(Math.round(span))} span (factor ${(busy / Math.max(span, 1)).toFixed(1)}×).`, '');
  }

  // tool calls
  const toolTotal = {};
  for (const c of all) for (const [k, v] of Object.entries(c.tools)) toolTotal[k] = (toolTotal[k] || 0) + v;
  const toolStr = Object.entries(toolTotal).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(' · ');
  lines.push(`Tool calls: ${toolStr || 'none'}`, '');

  // duplicated reads across contexts
  const fileCtx = {};
  for (const c of all) for (const f of c.readFiles) (fileCtx[f] ||= new Set()).add(c.label);
  const dup = Object.entries(fileCtx).filter(([, s]) => s.size >= 3).sort((a, b) => b[1].size - a[1].size).slice(0, 12);
  if (dup.length) {
    lines.push(`Files Read in ≥3 contexts (pre-fetch / preload candidates):`);
    for (const [f, s] of dup) lines.push(`- ${f} — ${s.size} contexts`);
    lines.push('');
  }
  return lines.join('\n');
}

// ---------- entry ----------
if (has('--list')) {
  const n = parseInt(flag('--list'), 10) || 10;
  for (const s of sessionFiles().slice(0, n)) {
    const entries = readJsonl(s.file);
    const subDir = path.join(projectDir, s.id, 'subagents');
    const nSubs = fs.existsSync(subDir) ? fs.readdirSync(subDir).filter((f) => f.endsWith('.jsonl')).length : 0;
    const kb = Math.round(fs.statSync(s.file).size / 1024);
    console.log(`${s.id}  ${new Date(s.mtime).toISOString().slice(0, 16)}  ${String(kb).padStart(6)}KB  subagents:${String(nSubs).padStart(2)}  "${sessionTitle(entries)}"`);
  }
  process.exit(0);
}

let ids = (flag('--session') || 'latest').split(',').map((x) => x.trim()).filter(Boolean);
if (ids.includes('latest')) ids = [sessionFiles()[0].id];
const sessions = ids.map(analyzeSession);
if (has('--json')) console.log(JSON.stringify(sessions, null, 2));
else console.log(report(sessions));
