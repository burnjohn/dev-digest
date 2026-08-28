#!/usr/bin/env node
/**
 * workflow-retro — telemetry collector.
 *
 * Reads Claude Code's own JSONL transcripts for ONE session and emits a single JSON
 * document with per-agent facts. It computes nothing subjective: every number here is
 * summed from disk, so the skill's prose can cite evidence instead of recollection.
 *
 * Node, not bash, on purpose: `jq` is not installed on this machine, the repo root contains
 * spaces, and how the harness spawns a `.sh` script on Windows is not something this file
 * controls. Node is guaranteed present (four Node packages) and parses JSON natively.
 *
 * Usage:
 *   node .claude/skills/workflow-retro/scripts/collect.mjs [--session <id>] [--project <slug>]
 *                                                         [--out <path>] [--list]
 *
 *   --session   session id (the UUID directory name in your scratchpad path).
 *               Omitted: the most recently modified transcript for this project.
 *   --project   project slug under ~/.claude/projects. Omitted: derived from cwd.
 *   --out       write JSON here instead of stdout.
 *   --list      print the available sessions (id, mtime, size, agent count) and exit.
 *
 * IMPORTANT — the number this exists to get right:
 *   The parent transcript records `<subagent_tokens>` per agent. That figure is the
 *   agent's FINAL-TURN context size, not what it burned. Measured against summed
 *   `message.usage`, it understates billable tokens by 2-4x and ignores cache reads
 *   entirely. This script reports both and names them differently: `billable` (summed)
 *   and `peakContext` (as reported). Never present the second one as "spent".
 */

import { createReadStream } from 'node:fs'
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { homedir } from 'node:os'
import path from 'node:path'

const PROJECTS = path.join(homedir(), '.claude', 'projects')

// ---------------------------------------------------------------- arguments

function parseArgs (argv) {
  const out = { session: null, project: null, out: null, list: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--list') out.list = true
    else if (a === '--session') out.session = argv[++i]
    else if (a === '--project') out.project = argv[++i]
    else if (a === '--out') out.out = argv[++i]
  }
  return out
}

/** `C:\D\A B\c` -> `C--D-A-B-c`, matching Claude Code's own slug for the cwd. */
function slugForCwd (cwd) {
  return cwd.replace(/[\\/:]/g, '-').replace(/\s+/g, '-')
}

async function exists (p) {
  try { await stat(p); return true } catch { return false }
}

async function resolveProjectDir (slug) {
  if (slug) {
    const dir = path.join(PROJECTS, slug)
    if (!(await exists(dir))) throw new Error(`no such project dir: ${dir}`)
    return dir
  }
  const derived = path.join(PROJECTS, slugForCwd(process.cwd()))
  if (await exists(derived)) return derived
  throw new Error(
    `could not derive a project dir from cwd (${process.cwd()}).\n` +
    `Pass --project <slug>. Available:\n  ` +
    (await readdir(PROJECTS)).join('\n  ')
  )
}

async function listSessions (projectDir) {
  const rows = []
  for (const name of await readdir(projectDir)) {
    if (!name.endsWith('.jsonl')) continue
    const id = name.slice(0, -6)
    const st = await stat(path.join(projectDir, name))
    let agents = 0
    const subDir = path.join(projectDir, id, 'subagents')
    if (await exists(subDir)) {
      agents = (await readdir(subDir)).filter(f => f.endsWith('.meta.json')).length
    }
    rows.push({ session: id, modified: st.mtime.toISOString(), bytes: st.size, agents })
  }
  return rows.sort((a, b) => b.modified.localeCompare(a.modified))
}

// ---------------------------------------------------------------- streaming

/** Stream a JSONL file, ignoring lines that do not parse. Never loads the file whole. */
async function eachLine (file, fn) {
  const rl = createInterface({ input: createReadStream(file, 'utf8'), crlfDelay: Infinity })
  for await (const line of rl) {
    if (!line.trim()) continue
    let rec
    try { rec = JSON.parse(line) } catch { continue }
    fn(rec)
  }
}

const ZERO = () => ({
  input: 0, output: 0, cacheCreate: 0, cacheRead: 0, thinking: 0, assistantTurns: 0
})

function addUsage (acc, msg) {
  const u = msg?.usage
  if (!u) return
  acc.input += u.input_tokens || 0
  acc.output += u.output_tokens || 0
  acc.cacheCreate += u.cache_creation_input_tokens || 0
  acc.cacheRead += u.cache_read_input_tokens || 0
  acc.thinking += u.output_tokens_details?.thinking_tokens || 0
  acc.assistantTurns += 1
}

/** Billable = everything the provider charges for. Cache reads are billed, but cheaply. */
function billable (acc) {
  return acc.input + acc.output + acc.cacheCreate
}

// ---------------------------------------------------------------- the parent pass

const NOTIFICATION_FIELDS = [
  'task-id', 'tool-use-id', 'status', 'summary',
  'subagent_tokens', 'tool_uses', 'duration_ms'
]

function scrapeNotification (text) {
  const out = {}
  for (const key of NOTIFICATION_FIELDS) {
    const m = text.match(new RegExp(`<${key}>([\\s\\S]*?)</${key}>`))
    if (m) out[key] = m[1].trim()
  }
  const result = text.match(/<result>([\s\S]*)<\/result>/)
  if (result) out.result = result[1].trim()
  return out
}

/**
 * A task-notification does not have one stable home. Observed shapes, all in the parent:
 * `user` with a string `message.content`, `queue-operation` with `content`, and
 * `attachment` with `attachment.prompt`. Look in all three rather than pick one — a
 * collector that knows only the shape it was written against silently reports zeros.
 */
function notificationText (rec) {
  const candidates = [
    typeof rec.message?.content === 'string' ? rec.message.content : null,
    typeof rec.content === 'string' ? rec.content : null,
    typeof rec.attachment?.prompt === 'string' ? rec.attachment.prompt : null
  ]
  for (const c of candidates) {
    if (c && c.includes('<task-notification>')) return c
  }
  return null
}

async function readParent (file) {
  const usage = ZERO()
  const dispatches = []          // Agent tool_use blocks, in launch order
  const notifications = new Map() // task-id -> notification
  const resolvedModel = new Map() // agentId -> model string
  let firstTs = null
  let lastTs = null
  let userTurns = 0

  await eachLine(file, rec => {
    if (rec.timestamp) {
      if (!firstTs || rec.timestamp < firstTs) firstTs = rec.timestamp
      if (!lastTs || rec.timestamp > lastTs) lastTs = rec.timestamp
    }

    const noteText = notificationText(rec)
    if (noteText) {
      const n = scrapeNotification(noteText)
      if (n['task-id']) {
        // An agent can be resumed and notify again — keep the newest, and never
        // count one agent twice because the same notification reached two records.
        const prev = notifications.get(n['task-id'])
        const at = rec.timestamp || null
        if (!prev || (at && (!prev.at || at > prev.at))) {
          notifications.set(n['task-id'], { ...n, at })
        }
      }
      return
    }

    if (rec.type === 'assistant') {
      addUsage(usage, rec.message)
      for (const block of rec.message?.content || []) {
        if (block.type === 'tool_use' && block.name === 'Agent') {
          dispatches.push({
            toolUseId: block.id,
            agentType: block.input?.subagent_type || 'general-purpose',
            description: block.input?.description || '',
            promptChars: (block.input?.prompt || '').length,
            background: block.input?.run_in_background !== false,
            launchedAt: rec.timestamp || null
          })
        }
      }
      return
    }

    if (rec.type === 'user') {
      // A real turn is a string prompt the human typed. Tool results and the
      // notification blobs handled above are also `user` records — exclude them.
      if (typeof rec.message?.content === 'string') userTurns += 1
      const r = rec.toolUseResult
      if (r && typeof r === 'object' && r.agentId) {
        resolvedModel.set(r.agentId, r.resolvedModel || null)
        // The sync path carries real aggregates; keep them when present.
        if (r.totalDurationMs || r.toolStats) {
          resolvedModel.set(r.agentId + ':stats', {
            totalDurationMs: r.totalDurationMs ?? null,
            toolStats: r.toolStats ?? null
          })
        }
      }
    }
  })

  return { usage, dispatches, notifications, resolvedModel, firstTs, lastTs, userTurns }
}

// ---------------------------------------------------------------- the agent pass

async function readAgent (file) {
  const usage = ZERO()
  const tools = {}                 // tool name -> count
  const filesRead = new Set()
  const filesWritten = new Set()
  const zeroHitSearches = []
  const pendingSearch = new Map()  // tool_use_id -> {tool, needle}
  let firstTs = null
  let lastTs = null
  let model = null
  let attributionSkill = null
  let finalText = ''

  await eachLine(file, rec => {
    if (rec.timestamp) {
      if (!firstTs || rec.timestamp < firstTs) firstTs = rec.timestamp
      if (!lastTs || rec.timestamp > lastTs) lastTs = rec.timestamp
    }
    if (rec.attributionSkill && !attributionSkill) attributionSkill = rec.attributionSkill

    if (rec.type === 'assistant') {
      addUsage(usage, rec.message)
      if (rec.message?.model) model = rec.message.model
      let text = ''
      for (const block of rec.message?.content || []) {
        if (block.type === 'text') text += block.text
        if (block.type !== 'tool_use') continue
        tools[block.name] = (tools[block.name] || 0) + 1
        const inp = block.input || {}
        if (block.name === 'Read' && inp.file_path) filesRead.add(inp.file_path)
        if ((block.name === 'Write' || block.name === 'Edit') && inp.file_path) {
          filesWritten.add(inp.file_path)
        }
        if (block.name === 'Grep' || block.name === 'Glob') {
          pendingSearch.set(block.id, { tool: block.name, needle: inp.pattern || '' })
        }
      }
      if (text.trim()) finalText = text.trim()
      return
    }

    if (rec.type === 'user') {
      for (const block of rec.message?.content || []) {
        if (block.type !== 'tool_result') continue
        const search = pendingSearch.get(block.tool_use_id)
        if (!search) continue
        pendingSearch.delete(block.tool_use_id)
        const body = typeof block.content === 'string'
          ? block.content
          : (block.content || []).map(c => c.text || '').join('')
        if (/No files found|No matches found|^\s*$/i.test(body)) {
          zeroHitSearches.push(search)
        }
      }
    }
  })

  return {
    usage,
    tools,
    filesRead: [...filesRead],
    filesWritten: [...filesWritten],
    zeroHitSearches,
    firstTs,
    lastTs,
    model,
    attributionSkill,
    finalText
  }
}

// ---------------------------------------------------------------- assembly

function overlapWindows (agents) {
  // Max number of agents whose [start,end] intervals overlap at any instant.
  const events = []
  for (const a of agents) {
    if (!a.startedAt || !a.endedAt) continue
    events.push([a.startedAt, 1], [a.endedAt, -1])
  }
  events.sort((x, y) => x[0] === y[0] ? x[1] - y[1] : x[0].localeCompare(y[0]))
  let cur = 0
  let max = 0
  for (const [, delta] of events) { cur += delta; if (cur > max) max = cur }
  return max
}

async function main () {
  const args = parseArgs(process.argv.slice(2))
  const projectDir = await resolveProjectDir(args.project)

  if (args.list) {
    process.stdout.write(JSON.stringify(await listSessions(projectDir), null, 2) + '\n')
    return
  }

  let session = args.session
  if (!session) {
    const sessions = await listSessions(projectDir)
    if (!sessions.length) throw new Error(`no transcripts in ${projectDir}`)
    session = sessions[0].session
  }

  const parentFile = path.join(projectDir, `${session}.jsonl`)
  if (!(await exists(parentFile))) throw new Error(`no transcript for session ${session}`)

  const parent = await readParent(parentFile)

  // Roster: subagents/*.meta.json is the only complete 1:1 enumeration.
  const subDir = path.join(projectDir, session, 'subagents')
  const metas = []
  if (await exists(subDir)) {
    for (const name of await readdir(subDir)) {
      if (!name.endsWith('.meta.json')) continue
      const agentId = name.slice('agent-'.length, -'.meta.json'.length)
      try {
        metas.push({ agentId, ...JSON.parse(await readFile(path.join(subDir, name), 'utf8')) })
      } catch { /* a truncated meta is not worth failing the whole run over */ }
    }
  }

  const byToolUseId = new Map(parent.dispatches.map(d => [d.toolUseId, d]))
  const agents = []

  for (const meta of metas) {
    const jsonl = path.join(subDir, `agent-${meta.agentId}.jsonl`)
    const body = (await exists(jsonl)) ? await readAgent(jsonl) : null
    const dispatch = byToolUseId.get(meta.toolUseId) || null
    const note = parent.notifications.get(meta.agentId) || null
    const stats = parent.resolvedModel.get(meta.agentId + ':stats') || null

    agents.push({
      agentId: meta.agentId,
      agentType: meta.agentType || dispatch?.agentType || null,
      description: meta.description || dispatch?.description || null,
      spawnDepth: meta.spawnDepth ?? null,
      parentAgentId: meta.parentAgentId ?? null,
      spawnedBySkill: body?.attributionSkill ?? null,
      model: parent.resolvedModel.get(meta.agentId) || body?.model || null,
      startedAt: dispatch?.launchedAt || body?.firstTs || null,
      endedAt: note?.at || body?.lastTs || null,
      durationMs: note?.duration_ms ? Number(note.duration_ms) : (stats?.totalDurationMs ?? null),
      status: note?.status || null,
      promptChars: dispatch?.promptChars ?? null,
      tokens: body ? {
        billable: billable(body.usage),
        ...body.usage,
        peakContextReported: note?.subagent_tokens ? Number(note.subagent_tokens) : null
      } : null,
      toolUses: body ? Object.values(body.tools).reduce((a, b) => a + b, 0) : null,
      toolBreakdown: body?.tools ?? null,
      filesRead: body?.filesRead ?? [],
      filesWritten: body?.filesWritten ?? [],
      zeroHitSearches: body?.zeroHitSearches ?? [],
      transcript: (await exists(jsonl)) ? jsonl : null,
      reportChars: (note?.result || body?.finalText || '').length
    })
  }

  agents.sort((a, b) => (a.startedAt || '').localeCompare(b.startedAt || ''))

  // Cross-agent duplication: the concrete form of "the same thing was read N times".
  const readers = new Map()
  for (const a of agents) {
    for (const f of a.filesRead) {
      if (!readers.has(f)) readers.set(f, new Set())
      readers.get(f).add(a.agentId)
    }
  }
  const duplicateReads = [...readers.entries()]
    .filter(([, set]) => set.size > 1)
    .map(([file, set]) => ({ file, readers: set.size, agentIds: [...set] }))
    .sort((x, y) => y.readers - x.readers)

  const agentTotals = agents.reduce((acc, a) => {
    if (!a.tokens) return acc
    acc.billable += a.tokens.billable
    acc.cacheRead += a.tokens.cacheRead
    acc.output += a.tokens.output
    acc.thinking += a.tokens.thinking
    return acc
  }, { billable: 0, cacheRead: 0, output: 0, thinking: 0 })

  const sumAgentDuration = agents.reduce((n, a) => n + (a.durationMs || 0), 0)
  const wallMs = parent.firstTs && parent.lastTs
    ? Date.parse(parent.lastTs) - Date.parse(parent.firstTs)
    : null

  const report = {
    schemaVersion: 1,
    session,
    projectDir,
    parentTranscript: parentFile,
    collectedFrom: { parentTranscript: true, agentTranscripts: agents.filter(a => a.transcript).length },
    window: { firstEvent: parent.firstTs, lastEvent: parent.lastTs, wallMs },
    parent: {
      tokens: { billable: billable(parent.usage), ...parent.usage },
      userTurns: parent.userTurns,
      dispatchesIssued: parent.dispatches.length
    },
    agents: {
      count: agents.length,
      withTranscript: agents.filter(a => a.transcript).length,
      byType: agents.reduce((m, a) => { m[a.agentType] = (m[a.agentType] || 0) + 1; return m }, {}),
      maxSpawnDepth: agents.reduce((n, a) => Math.max(n, a.spawnDepth || 0), 0),
      totals: agentTotals,
      peakConcurrency: overlapWindows(agents),
      sumDurationMs: sumAgentDuration,
      parallelismRatio: wallMs ? Number((sumAgentDuration / wallMs).toFixed(2)) : null,
      list: agents
    },
    totals: {
      billable: billable(parent.usage) + agentTotals.billable,
      cacheRead: parent.usage.cacheRead + agentTotals.cacheRead,
      note: 'billable = input + output + cache_creation, summed from message.usage across the ' +
            'parent transcript and every agent transcript (disjoint files, no double counting). ' +
            'Agent-reported subagent_tokens is final-turn context size and is NOT this number.'
    },
    duplicateReads,
    unmatched: {
      dispatchesWithoutMeta: parent.dispatches
        .filter(d => !metas.some(m => m.toolUseId === d.toolUseId))
        .map(d => ({ toolUseId: d.toolUseId, agentType: d.agentType, description: d.description })),
      notificationsWithoutAgent: [...parent.notifications.keys()]
        .filter(id => !metas.some(m => m.agentId === id))
    }
  }

  const json = JSON.stringify(report, null, 2)
  if (args.out) {
    await mkdir(path.dirname(path.resolve(args.out)), { recursive: true })
    await writeFile(args.out, json + '\n', 'utf8')
    process.stdout.write(`${args.out}\n`)
  } else {
    process.stdout.write(json + '\n')
  }
}

main().catch(err => {
  process.stderr.write(`workflow-retro/collect: ${err.message}\n`)
  process.exit(1)
})
