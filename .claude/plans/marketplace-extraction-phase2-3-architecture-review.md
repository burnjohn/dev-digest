# Development Plan — DevDigest AI Marketplace extraction: Phase 2, step 3 (`architecture-review` plugin)

**Execution mode:** multi-agent (lightweight)

> **WORKING DIRECTORY FOR EXECUTION:** `/Users/viptech/dev/ai agent/dev-digest-ai-marketplace`
> — **not** `dev-digest`. Read-only source:
> `/Users/viptech/dev/ai agent/dev-digest/.claude/agents/architecture-reviewer.md`.
> **Do not** extract `architecture-reviewer-lite.md` or
> `architecture-reviewer-strict.md` — these are eval-only A/B variants used
> to benchmark the real agent, explicitly excluded by the architecture spec
> (`docs/specs/marketplace-extraction/architecture.md:62-65`).
> Run this sub-plan **after** Phase 2 sub-plan 1
> (`engineering-paved-path`) is committed — this plugin's `plugin.json`
> declares a real dependency on it (`^1.0.0`), and validating that edge is
> easiest once the dependency plugin already exists on disk.

## Context

Third of four sequential Phase 2 sub-plans. `architecture-review` ships one
agent, `architecture-reviewer`, and is the second dependency plugin
`sdd-engineering` needs. Unlike `research-tools`, this agent's source file
is **heavily DevDigest-coupled** — confirmed by a full read of
`dev-digest/.claude/agents/architecture-reviewer.md` (96 lines) during
planning research:

- Frontmatter `description` (lines 3–8) names `server/reviewer-core` and
  `client feature-folder shape` explicitly.
- The "Rule source, not freelancing" section (lines 37–57) hardcodes
  `onion-architecture` as "the" rubric and cites
  `server/src/platform/container.ts`, `adapters/<kind>/`,
  `client/CLAUDE.md`'s feature-folder boundary, `server/CLAUDE.md`'s module
  shape — none of which exist in a consuming project by those names.
- The "Evidence rule" section (lines 59–72) checks for a nonexistent
  `REVIEW.md` in "this repo" — fine as a generic pattern, but the prose
  needs to read as "the target project," not assume DevDigest's specific
  absence-of-`REVIEW.md` fact holds elsewhere.
- "What this agent does not do" (lines 74–81) references `pr-self-review`
  and `simplify` — neither is part of this marketplace; must be reworded or
  dropped.

This is exactly the file the architecture spec's Invariants call out by
name: "This applies to `architecture-reviewer` in particular: it (shall)
read repository-local architecture docs supplied by the consumer project at
runtime, never a hardcoded check against `reviewer-core`, `server/`, or
`@devdigest/shared`"
(`docs/specs/marketplace-extraction/architecture.md:555-557`). The rewrite
in Step 2 below is not optional cleanup — it is the core deliverable of
this sub-plan; everything else (plugin.json, docs) is scaffolding around it.

No hidden language mandate was found in this file (grep for "Ukrainian"/
"Language" across `.claude/agents/*.md` did not flag it) — but Step 4's
content-review pass still runs in full per the established rule.

## Modules involved

`dev-digest-ai-marketplace` only: `plugins/architecture-review/**`. Reads
(never writes) `dev-digest/.claude/agents/architecture-reviewer.md`. Also
reads `plugins/engineering-paved-path/skills/onion-architecture/SKILL.md`
(already-generalized, from sub-plan 1) as a live reference for what the
rewritten agent should point to by namespaced name.

## Constraints

- Architecture spec, per-plugin composition table — `architecture-review`
  ships exactly the `architecture-reviewer` agent (generalized), no skills
  of its own, and depends on `engineering-paved-path@^1.0.0`
  (`docs/specs/marketplace-extraction/architecture.md:111`).
- Architecture spec, Contracts — `architecture-review`'s own `plugin.json`
  "carries its own dependency on `engineering-paved-path@^1.0.0`" — called
  out explicitly as a real edge, not incidental
  (`docs/specs/marketplace-extraction/architecture.md:225-227`).
- Architecture spec, Invariants — the `architecture-reviewer` generalization
  requirement quoted above, verbatim binding constraint
  (`docs/specs/marketplace-extraction/architecture.md:549-557`).
- Architecture spec, Contracts — namespaced references: this agent must
  refer to the onion-architecture rule source as
  `engineering-paved-path:onion-architecture`, never a bare `onion-architecture`
  (`docs/specs/marketplace-extraction/architecture.md:249-258`).
- Architecture spec, Invariants — English-only prose; no absolute local
  paths (AC-8) (`docs/specs/marketplace-extraction/architecture.md:587-591,636-639`).
- Architecture spec, Contracts — `COMPATIBILITY.md` pins
  `Claude Code >=2.1.110`; tag convention `architecture-review--v1.0.0`
  (`docs/specs/marketplace-extraction/architecture.md:263-276`).
- Lab step 3 — "`architecture-review` ... депонує на `engineering-paved-path`.
  Він читає repository-local architecture docs замість hardcoded перевірок
  `reviewer-core`, `server/` чи `@devdigest/shared`"
  (`L08/04-hands-on-lab.md:96`) — the "reads repository-local docs" behavior
  must be an explicit instruction in the rewritten agent, not just an
  absence of hardcoded names.
- Do not extract `architecture-reviewer-lite.md` / `architecture-reviewer-strict.md`
  (`docs/specs/marketplace-extraction/architecture.md:62-65`).

## Skills the implementer will use

None directly — meta-editorial work on one agent-definition file. The
implementer should, however, *read* the already-extracted
`engineering-paved-path:onion-architecture` skill content (from sub-plan 1)
as reference material for what namespaced name and rule shape to point to —
that's a research input, not a "skill applied."

## Ordered steps

All paths below are relative to
`/Users/viptech/dev/ai agent/dev-digest-ai-marketplace` unless marked
"(source, read-only)".

### Step 1 — Implementer: scaffold and copy

1. Create `plugins/architecture-review/.claude-plugin/` and
   `plugins/architecture-review/agents/`.
2. Copy `dev-digest/.claude/agents/architecture-reviewer.md` (source,
   read-only) to `plugins/architecture-review/agents/architecture-reviewer.md`
   as the starting point for Step 2's rewrite.

### Step 2 — Implementer: rewrite `architecture-reviewer.md`

- **Frontmatter `description`**: rewrite to "Read-only architectural review:
  checks a project's code against its own already-codified architectural
  boundaries — conventions declared in the project's own instructions/docs
  or in an installed architecture-pattern skill such as
  `engineering-paved-path:onion-architecture` — and reports findings as
  severity + file:line evidence + verification reasoning. Cannot edit
  files." Drop the DevDigest-specific `server/reviewer-core` /
  "client feature-folder shape" phrasing entirely.
- **"Rule source, not freelancing" section**: rewrite so the rubric is
  discovered at runtime from the *consuming* project, not hardcoded:
  - If the consuming project has `engineering-paved-path:onion-architecture`
    installed (or another architecture-pattern skill), apply it as the
    primary rubric via its namespaced name — do not inline a copy of its
    rules here (that would duplicate content between agent prompt and
    skill, which the editorial checklist explicitly forbids).
  - Otherwise (or in addition), read the target project's own
    architecture-level instructions — its root/module `CLAUDE.md`-equivalent
    files, or any `docs/architecture*.md`/`ARCHITECTURE.md` it has — as the
    rule source. Name this generically ("the project's own codified
    conventions, wherever they live"), not `client/CLAUDE.md` /
    `server/CLAUDE.md` by literal path.
  - Keep the "do not invent new architecture opinions beyond what's already
    codified" rule and the Fowler/dependency-cruiser citations — those are
    pattern-general, not DevDigest-specific.
- **"Evidence rule" section**: reword "No repo-level `REVIEW.md` exists yet
  in this repo (checked as part of this plan's own research)" — that's a
  DevDigest-specific fact frozen into the prompt. Replace with an
  instruction to check for an optional `REVIEW.md` in the *target* project
  at runtime and raise the evidence bar if one exists, without asserting
  DevDigest's specific absence-of-`REVIEW.md` as a fact about every
  consumer.
- **"What this agent does not do" section**: drop the `pr-self-review` and
  `simplify` skill names (neither is part of this marketplace). Reword
  generically: "Code quality/style and PR-hygiene concerns are a different
  reviewer's territory; security is a dedicated security skill/reviewer's
  territory; plan-conformance is `sdd-engineering:plan-verifier`'s job (if
  installed)." Use the namespaced form since `plan-verifier` lives in a
  different plugin (`sdd-engineering`).
- **Report format**: keep as-is (already generic — severity + `file:line` +
  verification reasoning, "Not architecture (out of scope)" section).
- Confirm no hidden language mandate was introduced by this rewrite (there
  was none in the source; don't add one).

### Step 3 — Implementer: targeted verification

- No DevDigest path/module/repo name remains anywhere in the rewritten file.
- Every cross-reference to another skill/agent uses the fully-qualified
  `<plugin>:<component>` form where it crosses a plugin boundary
  (`engineering-paved-path:onion-architecture`,
  `sdd-engineering:plan-verifier`) — never a bare name.
- The "reads repository-local architecture docs at runtime" behavior (lab
  step 3's explicit requirement) is stated as an actual instruction the
  agent follows, not merely implied by the absence of hardcoded paths.

### Step 4 — Content-review pass (separate dispatch from Step 1–3's implementer)

Full read-through of `plugins/architecture-review/agents/architecture-reviewer.md`
end to end. Given how much this file changed in Step 2, this pass matters
more here than in sub-plans 1–2: confirm the rewrite didn't leave a
half-generalized sentence (e.g. a rule described generically in one
paragraph but still citing `server/` two paragraphs later), confirm no new
DevDigest-shaped assumption was accidentally introduced while rewriting
(e.g. assuming every consumer has a `client/`+`server/` split), and confirm
the namespaced references resolve to components that actually exist in
sub-plan 1's already-extracted `engineering-paved-path` plugin. Fix any
finding and re-run this step before proceeding.

### Step 5 — Implementer: `.claude-plugin/plugin.json`

```json
{
  "name": "architecture-review",
  "version": "1.0.0",
  "description": "A generalized, read-only architectural-review agent that checks code against a project's own already-codified structural conventions.",
  "dependencies": [
    { "name": "engineering-paved-path", "version": "^1.0.0" }
  ]
}
```

### Step 6 — Implementer: `COMPATIBILITY.md`, `README.md`, `CHANGELOG.md`

- `COMPATIBILITY.md`: `Claude Code >=2.1.110`.
- `README.md`: what `architecture-reviewer` does (read-only, evidence-based,
  reads the consuming project's own architecture conventions and/or
  `engineering-paved-path:onion-architecture` if installed, reports
  severity + `file:line` findings, cannot edit files), its dependency on
  `engineering-paved-path@^1.0.0` and why (it uses that skill as one
  possible rule source), how to install standalone
  (`/plugin install architecture-review@dev-digest-ai-marketplace`), and a
  note that it's depended on by `sdd-engineering`.
- `CHANGELOG.md`: `## 1.0.0 — Initial extraction` + one factual sentence
  (the `architecture-reviewer` agent extracted and generalized from the
  DevDigest engineering harness; hardcoded DevDigest-specific rule sources
  replaced with runtime discovery of the consuming project's own
  conventions).

### Step 7 — Validation

```
claude plugin validate ./plugins/architecture-review
```
This should also confirm the `dependencies` entry resolves against the
already-extracted `plugins/engineering-paved-path` (sub-plan 1) without a
`dependency-unsatisfied` or `no-matching-tag` error at this local
(untagged, `--plugin-dir`-style) validation stage — full tag-based
resolution only becomes testable at release time (later phase), but schema
validation of the dependency entry itself should pass now. No `--strict`
flag.

## Test plan

- `claude plugin validate ./plugins/architecture-review` exits clean.
- `grep -rn "/Users/" plugins/architecture-review` returns nothing (AC-8).
- `grep -rliE "devdigest|reviewer-core|@devdigest|server/src|~/.devdigest|client/CLAUDE|server/CLAUDE"
  plugins/architecture-review` returns nothing.
- Step 4's content-review pass has run and reported no findings (or findings
  were fixed and re-reviewed) — mandatory, and higher-stakes here than in
  sub-plans 1–2 given the scope of the rewrite.
- Manual re-read: every cross-plugin reference in the final file uses the
  `<plugin>:<component>` namespaced form.
- `plugin.json`'s `dependencies` entry (`engineering-paved-path@^1.0.0`)
  matches the architecture spec's Contracts section exactly.

## Out of scope

Architecture and security review of *this plan's own execution* are **not**
part of this plan — they belong to separate review agents (note: this
sub-plan's *subject matter* is an architecture-review agent, but the
sub-plan's own execution still gets no special exemption from that rule).
Also deferred: `sdd-engineering` plugin content (sub-plan 4); root
`marketplace.json` and combined `claude plugin validate .` (Phase 2 step-5
follow-up, run only after all four plugins exist, including this one and
`sdd-engineering`); evals, GitHub Pages catalog, cost baseline,
releases/tagging, install rehearsal (later phases).
