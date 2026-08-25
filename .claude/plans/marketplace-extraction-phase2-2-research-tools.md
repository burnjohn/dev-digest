# Development Plan — DevDigest AI Marketplace extraction: Phase 2, step 2 (`research-tools` plugin)

**Execution mode:** multi-agent (lightweight)

> **WORKING DIRECTORY FOR EXECUTION:** `/Users/viptech/dev/ai agent/dev-digest-ai-marketplace`
> — **not** `dev-digest`. Read-only source:
> `/Users/viptech/dev/ai agent/dev-digest/.claude/agents/researcher.md`.
> Depends on Phase 2 sub-plan 1 (`engineering-paved-path`) only in the sense
> that it should run after it (dependency-then-consumer build order) — this
> plugin itself has **no** dependency on `engineering-paved-path` or
> anything else.

## Context

Second of four sequential Phase 2 sub-plans. `research-tools` is the
simplest of the four: it ships exactly one file,
`.claude/agents/researcher.md`, and research already confirmed (via
targeted grep and a full read of the file) that it is **already
generic** — zero DevDigest-specific paths, module names, or hidden
language mandates. This sub-plan is almost entirely mechanical; the
content-review pass (Step 3) still runs in full per the confirmed rule
that grep alone is not a sufficient extraction check, but expect it to
report no findings.

## Modules involved

`dev-digest-ai-marketplace` only: `plugins/research-tools/**`. Reads (never
writes) `dev-digest/.claude/agents/researcher.md`.

## Constraints

- Architecture spec, per-plugin composition table — `research-tools` ships
  exactly the `researcher` agent, no skills, no dependencies
  (`docs/specs/marketplace-extraction/architecture.md:110`).
- Architecture spec, per-plugin layout — agent-only shape (no `skills/`)
  (`docs/specs/marketplace-extraction/architecture.md:201-203`).
- Architecture spec, Invariants — no DevDigest-specific reference anywhere;
  English-only prose; no absolute local paths (AC-8)
  (`docs/specs/marketplace-extraction/architecture.md:549-557,587-591,636-639`).
- Confirmed via `Read` of the full source file
  (`dev-digest/.claude/agents/researcher.md`, 116 lines): no DevDigest path
  or module name; report format is already generic (`## Findings` /
  `## Evidence` / `## References` / `## Could not determine`); "General
  rules" section already says "Write the report in English" — no hidden
  non-English mandate, unlike three other files found elsewhere in this
  extraction (`spec-creator.md`, `engineering-insights/SKILL.md`,
  `workflow-retro/SKILL.md`, all handled in the `sdd-engineering` sub-plan).
  This is the one file in the whole Phase 2 inventory that needed **zero**
  identified rewrite going in — still subject to the full content-review
  pass below in case something was missed.
- Architecture spec, Contracts — `COMPATIBILITY.md` pins
  `Claude Code >=2.1.110`
  (`docs/specs/marketplace-extraction/architecture.md:272-276`).
- Architecture spec, Contracts — tag convention `research-tools--v1.0.0`;
  `plugin.json`'s `version` must match
  (`docs/specs/marketplace-extraction/architecture.md:263-270`).

## Skills the implementer will use

None. This is meta-editorial work on one agent-definition file, not
application code.

## Ordered steps

All paths below are relative to
`/Users/viptech/dev/ai agent/dev-digest-ai-marketplace` unless marked
"(source, read-only)".

### Step 1 — Implementer: scaffold and copy

1. Create `plugins/research-tools/.claude-plugin/` and
   `plugins/research-tools/agents/`.
2. Copy `dev-digest/.claude/agents/researcher.md` (source, read-only) to
   `plugins/research-tools/agents/researcher.md` verbatim.
3. Review the frontmatter `tools:` list (`Read, Grep, Glob, Bash, WebFetch,
   WebSearch`) — confirm it's still appropriate standalone (it is: no
   `Write`/`Edit`, matching the "read-only research" role description; no
   change needed).

### Step 2 — Implementer: targeted verification

Confirm (already established during planning research, re-confirm on the
actual copied file):
- No DevDigest path/module/repo name.
- No hidden language mandate in the frontmatter `description` or the body's
  "General rules" section.
- No cross-reference to a skill/agent/doc that isn't part of this
  marketplace (e.g. it must not silently assume `/deep-research` or any
  other DevDigest-local command exists — confirmed absent, the file already
  says it never delegates to `/deep-research`, which reads as a
  self-contained rule, not an external dependency).

### Step 3 — Content-review pass (separate dispatch from Step 1–2's implementer)

Full read-through of `plugins/research-tools/agents/researcher.md`, same
bar as every other sub-plan in this Phase: does anything reveal DevDigest
origin, or carry an instruction that doesn't belong in a general-purpose
marketplace agent. Expected outcome, given the research above: no findings.
If the reviewer does find something, fix it and re-run this step before
proceeding.

### Step 4 — Implementer: `.claude-plugin/plugin.json`

```json
{
  "name": "research-tools",
  "version": "1.0.0",
  "description": "A generic, read-only research agent for repository and web research — evidence-cited findings, no code changes."
}
```

No `dependencies` array (confirmed,
`docs/specs/marketplace-extraction/architecture.md:110`).

### Step 5 — Implementer: `COMPATIBILITY.md`, `README.md`, `CHANGELOG.md`

- `COMPATIBILITY.md`: `Claude Code >=2.1.110`.
- `README.md`: what `researcher` does (repository research + external/web
  research, evidence-cited, asks clarifying questions on vague requests, no
  `Write`/`Edit`), how to install standalone
  (`/plugin install research-tools@dev-digest-ai-marketplace`), and a note
  that it has no dependencies and is depended on by `sdd-engineering`.
- `CHANGELOG.md`: `## 1.0.0 — Initial extraction` + one factual sentence
  (the `researcher` agent extracted from the DevDigest engineering harness).

### Step 6 — Validation

```
claude plugin validate ./plugins/research-tools
```
No `--strict` flag.

## Test plan

- `claude plugin validate ./plugins/research-tools` exits clean.
- `grep -rn "/Users/" plugins/research-tools` returns nothing (AC-8).
- `grep -rliE "devdigest|reviewer-core|@devdigest|server/src|~/.devdigest"
  plugins/research-tools` returns nothing.
- Step 3's content-review pass has run and reported no findings (or findings
  were fixed and re-reviewed) — required even though this file was already
  the cleanest in the inventory; the process doesn't skip the safety net
  just because a file looked clean going in.
- `plugin.json`'s `version` (`1.0.0`) matches the future tag
  `research-tools--v1.0.0` exactly.

## Out of scope

Architecture and security review are **not** part of this plan. Also
deferred: `architecture-review`, `sdd-engineering` plugin content (sub-plans
3–4); root `marketplace.json` and combined `claude plugin validate .`
(Phase 2 step-5 follow-up); evals, GitHub Pages catalog, cost baseline,
releases/tagging, install rehearsal (later phases).
