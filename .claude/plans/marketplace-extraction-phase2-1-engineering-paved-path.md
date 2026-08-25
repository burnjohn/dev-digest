# Development Plan — DevDigest AI Marketplace extraction: Phase 2, step 1 (`engineering-paved-path` plugin)

**Execution mode:** multi-agent (lightweight)

> **WORKING DIRECTORY FOR EXECUTION:** `/Users/viptech/dev/ai agent/dev-digest-ai-marketplace`
> — **not** `dev-digest`. Read-only source material comes from
> `/Users/viptech/dev/ai agent/dev-digest/.claude/skills/**`; nothing under
> `dev-digest/**` is edited by this plan. This plan produces
> `plugins/engineering-paved-path/**` plus that plugin's own
> `.claude-plugin/plugin.json`, `README.md`, `CHANGELOG.md`,
> `COMPATIBILITY.md` inside `dev-digest-ai-marketplace`.

## Context

Lab steps 3–5 ("Проєктуємо dependency graph" / "Збираємо sdd-engineering" /
"Реєструємо плагіни в marketplace") apply per-plugin. This is the first of
four sequential sub-plans for Phase 2, built in dependency order —
`engineering-paved-path` has zero dependencies of its own and is a
dependency of both `architecture-review` and `sdd-engineering`, so it goes
first (mirrors the release order the architecture spec mandates: "the
system (shall) never publish a `sdd-engineering` release before its three
declared dependencies... are tagged" — the same ordering is the sane build
order, not just the release order).

Research already done (recorded here so the next sub-plan doesn't have to
re-derive it): the 11 skills named in the architecture spec's per-plugin
composition table split into two very different editorial buckets.

**Bucket A — already close to generic** (light editorial pass: verify, don't
rewrite): `react-best-practices`, `react-testing-library`,
`next-best-practices`, `fastify-best-practices`, `drizzle-orm-patterns`,
`postgresql-table-design`, `zod`, `typescript-expert`, `security`,
`mermaid-diagram`. A targeted grep
(`grep -rl -iE "devdigest|reviewer-core|@devdigest|server/src|~/.devdigest"`)
across all of these returned **zero hits** except one harmless false
positive: `security/examples.md:287` uses the illustrative string
`/app/server/src/...` inside a "what an error message could leak" code
example — this is a generic Express-stack illustration, not a DevDigest
path; the content-review pass (Step 4 below) must confirm it reads as
generic and leave it if so, not "fix" a non-problem.

**Bucket B — the one file that needs substantive rewrite, not just
path-swapping**: `onion-architecture/SKILL.md`. Verified by reading the full
file
(`dev-digest/.claude/skills/onion-architecture/SKILL.md`): it is written
entirely in terms of DevDigest's own repo — `server/`, `reviewer-core/`,
`@devdigest/shared`, `server/src/platform/container.ts`,
`server/src/adapters/mocks.ts`, `ContainerOverrides`, cross-references to
`client/**`/`e2e/**`/`react-ui-architecture` skill boundaries that don't
exist in this marketplace. It also contains, at lines 8–14, a
`## Language` section instructing **"Answer in Ukrainian — that's the
language this team works in"** — this directly violates the architecture
spec's English-only invariant
(`docs/specs/marketplace-extraction/architecture.md:587-591`) and is the
kind of hidden-language-mandate a DevDigest-term grep will never catch
(confirmed: a grep for `devdigest|reviewer-core|...` does flag this file,
but only because of the *other* DevDigest terms on the same lines — a file
with **only** a language mandate and no DevDigest noun would slip past that
grep entirely, which is exactly why Step 4 below is a full read-through,
not a grep substitute).

`onion-architecture/evals/evals.json` exists but is **out of scope for this
phase** — per-skill eval fixtures are generalized-evals work
(`docs/specs/marketplace-extraction/architecture.md`'s "generalized subset
of `evals/skills`..." line, Phase 4 per the task boundary). Do not copy any
skill's `evals/` subdirectory in this phase.

## Modules involved

`dev-digest-ai-marketplace` only: `plugins/engineering-paved-path/**`. Reads
(never writes) `dev-digest/.claude/skills/{react-best-practices,
react-testing-library, next-best-practices, fastify-best-practices,
onion-architecture, drizzle-orm-patterns, postgresql-table-design, zod,
typescript-expert, security, mermaid-diagram}/**`.

## Constraints

- Architecture spec, per-plugin composition table — `engineering-paved-path`
  ships exactly these 11 skills, no agents, no dependencies
  (`docs/specs/marketplace-extraction/architecture.md:109`).
- Architecture spec, per-plugin layout — skills-only shape (no `agents/`)
  (`docs/specs/marketplace-extraction/architecture.md:201-203`).
- Architecture spec, Invariants — every extracted file must not reference a
  DevDigest-specific path/module/table/repo name; this is a **blocking
  extraction defect**, not a style nit
  (`docs/specs/marketplace-extraction/architecture.md:549-557`).
- Architecture spec, Invariants — English-only prose in every committed file,
  no exceptions (`docs/specs/marketplace-extraction/architecture.md:587-591`).
  Confirmed live counter-example to fix: `onion-architecture/SKILL.md:8-14`'s
  "Answer in Ukrainian" section must be deleted entirely, not translated —
  the marketplace has no fixed team language to mandate.
- Architecture spec, Invariants — `${CLAUDE_PLUGIN_ROOT}` for plugin-root
  scripts, `${CLAUDE_SKILL_DIR}` for scripts living inside a specific skill;
  never a hardcoded relative path
  (`docs/specs/marketplace-extraction/architecture.md:561-566`). None of
  these 11 skills currently ship an executable script that resolves its own
  location (`typescript-expert/scripts/ts_diagnostic.py` only reads
  cwd-relative `tsconfig.json`/`package.json` from the *consuming* project,
  not its own skill directory — verified via `Read`, no change needed there
  unless the content-review pass finds otherwise).
- Architecture spec — no plugin/skill may read/expect DevDigest's
  `~/.devdigest/secrets.json`, `CLAUDE.md`, `INSIGHTS.md`, or any
  `docs/specs/*.md` — none of these 11 skills currently do (grep-confirmed).
- Architecture spec, Contracts — `.claude-plugin/plugin.json` is the single
  source of truth for composition + `dependencies`; `marketplace.json`
  carries only `source` + catalog metadata, written in the Phase 2 step-5
  follow-up, not here
  (`docs/specs/marketplace-extraction/architecture.md:207-223`).
- Architecture spec, Contracts — `COMPATIBILITY.md` pins
  `Claude Code >=2.1.110`
  (`docs/specs/marketplace-extraction/architecture.md:272-276`).
- Architecture spec, Contracts — tag convention `engineering-paved-path--v1.0.0`
  (used later at release time, not this phase, but the plugin's own
  `version: "1.0.0"` in `plugin.json` must match it exactly)
  (`docs/specs/marketplace-extraction/architecture.md:263-270`).
- Architecture spec — "large list 'про запас' increases discovery context and
  support burden" (lab step 3) — do not add a 12th skill or expand scope
  beyond the 11 named; if a skill's content turns out to reference another
  skill that isn't in this list (e.g. `react-ui-architecture`,
  `pr-self-review` in `onion-architecture`'s "Out of scope" section), that
  cross-reference must be removed or reworded generically, not resolved by
  pulling in the extra skill.
- No absolute local filesystem paths (e.g. `/Users/...`) in any committed
  file (AC-8, `docs/specs/marketplace-extraction/architecture.md:636-639`).

## Skills the implementer will use

None of `dev-digest`'s own applied skills (`react-best-practices`,
`fastify-best-practices`, etc.) apply to *doing* this task — this is
meta-editorial work on skill-definition markdown files, not application code
written using those skills. The one exception: if the plugin's `README.md`
gains a small diagram (optional, e.g. illustrating "no dependencies, consumed
by `architecture-review` and `sdd-engineering`"), use the `mermaid-diagram`
skill for it — optional, not required to force a diagram in.

## Ordered steps

All paths below are relative to
`/Users/viptech/dev/ai agent/dev-digest-ai-marketplace` unless marked
"(source, read-only)".

### Step 1 — Implementer: scaffold plugin directory + copy Bucket A skills

1. Create `plugins/engineering-paved-path/.claude-plugin/` and
   `plugins/engineering-paved-path/skills/`.
2. For each Bucket A skill, copy the skill's full directory tree **except any
   `evals/` subdirectory** from
   `dev-digest/.claude/skills/<name>/` (source, read-only) to
   `plugins/engineering-paved-path/skills/<name>/`, preserving internal
   relative structure (e.g. `zod/references/*.md`,
   `fastify-best-practices/rules/*.md`, `typescript-expert/scripts/`,
   `typescript-expert/references/`). Representative paths already verified to
   exist and need copying as-is (pending the light pass in step 3 below):
   `react-best-practices/{SKILL.md,examples.md}`,
   `react-testing-library/{SKILL.md,README.md}`,
   `next-best-practices/{SKILL.md,*.md}` (19 files),
   `fastify-best-practices/{SKILL.md,tile.json,rules/*.md}` (19 files),
   `drizzle-orm-patterns/{SKILL.md,references/*.md}` (9 files),
   `postgresql-table-design/SKILL.md`,
   `zod/{SKILL.md,README.md,AGENTS.md,assets/templates/_template.md,
   references/*.md}` (48 files, excluding `evals/evals.json`),
   `typescript-expert/{SKILL.md,references/*,scripts/ts_diagnostic.py}`,
   `security/{SKILL.md,checklists.md,examples.md,references.md}`,
   `mermaid-diagram/{SKILL.md,examples.md}`.

### Step 2 — Implementer: rewrite `onion-architecture/SKILL.md`

Copy `dev-digest/.claude/skills/onion-architecture/SKILL.md` to
`plugins/engineering-paved-path/skills/onion-architecture/SKILL.md`, then
rewrite in place (do **not** copy `evals/`):

- Delete the `## Language` section (lines 8–14 in the source) entirely — no
  language mandate of any kind.
- Rewrite the frontmatter `description` to drop `server/`, `reviewer-core/`
  and describe the trigger generically: "backend code organized in
  onion/hexagonal layers — domain logic with no I/O, services depending on
  DI-resolved ports, adapters at the edge" — keep the *behavioral* trigger
  conditions (route importing an adapter directly, a service `new`-ing a
  concrete adapter class, a "where does this code go" question) since those
  are pattern-level, not DevDigest-specific.
- Rewrite the "Why this exists" section to speak generically about *a*
  backend with a DI container and a pure-domain package, not `server/` and
  `reviewer-core/` by name.
- Rewrite the layer table and the "Red flags" code examples using generic
  placeholder names (e.g. a generic `modules/<name>/service.ts` /
  `adapters/<kind>/*.ts` / `platform/container.ts` shape, without
  `OctokitGitHubClient`, `SimpleGitClient`, `@devdigest/shared`, or any other
  DevDigest-specific class/package name) — keep the *shape* of the examples
  (they're good, concrete, and pattern-general already), just de-brand the
  identifiers.
- Rewrite "Exemplars already in this codebase" — this section cannot survive
  extraction as written (it points at files that don't exist in a consumer
  project). Replace with either: (a) drop the section entirely and note in
  its place that a consuming project should identify its own composition
  root / pure-domain package once it adopts this pattern, or (b) keep it as
  a labeled *illustrative* example clearly marked as such, not "in this
  codebase". Pick (a) — simpler, avoids inventing a fictional example
  project.
- Rewrite "Out of scope" — drop the `react-ui-architecture` and
  `pr-self-review` cross-references (neither is extracted, per architecture
  spec Module boundaries); replace with a generic note that frontend
  placement and PR-hygiene concerns are out of this skill's scope, without
  naming skills that don't exist in this marketplace.
- Keep the "Quick checklist" section, generalized the same way as the layer
  table.

### Step 3 — Implementer: light editorial pass over Bucket A

For each Bucket A skill's files, confirm (fix if found, these are expected
to already be clean per the grep run, this is verification not blind
rewriting):

- No DevDigest path/module/table/repo name anywhere.
- No hidden language mandate (the grep for DevDigest terms will not catch a
  language instruction with no DevDigest noun in it — read each `SKILL.md`
  frontmatter + first ~20 lines specifically for any "Answer in
  X language" / "Written in X" instruction, the pattern found in
  `onion-architecture` and, in the `sdd-engineering` sub-plan's research,
  also found in `spec-creator.md`, `engineering-insights/SKILL.md`, and
  `workflow-retro/SKILL.md` — three more instances a plain grep for
  "devdigest" would have missed entirely).
- `security/examples.md:287`'s `/app/server/src/...` string: confirm it
  reads as a generic illustrative leak example (it does — it's inside a
  "what this stack trace could reveal" comment, unrelated to any real
  DevDigest path) and leave it unchanged.
- No `${CLAUDE_SKILL_DIR}`/`${CLAUDE_PLUGIN_ROOT}` gap: `typescript-expert/
  scripts/ts_diagnostic.py` reads only cwd-relative `tsconfig.json`/
  `package.json` (the *consuming* project's files, correctly) — confirm no
  path inside the script assumes its own script location; if a future skill
  addition needs its own directory, it must use `${CLAUDE_SKILL_DIR}`.

### Step 4 — Content-review pass (separate dispatch from Step 1–3's implementer)

This is a **full read-through of every file touched in Steps 1–3**, not a
grep re-run. Dispatch as an independent pass (a fresh `general-purpose`
agent, or the orchestrating session itself reading each file cold) whose
only job is: read every copied/rewritten file top to bottom and answer "does
anything here reveal this content originated from DevDigest, or carry an
instruction that doesn't belong in a general-purpose marketplace skill" —
covers things a keyword grep structurally cannot catch: hidden language
mandates, an offhand "as this team does X" phrasing, a cross-reference to a
skill/agent/doc that isn't part of this marketplace, an example that
implies a specific tech stack the skill doesn't claim to support. Report any
finding; fix before proceeding to Step 5. This step is mandatory and
separate from Step 3's targeted verification — Step 3 checks the *known*
issue classes already found during planning research; Step 4 is the
open-ended safety net for issues research didn't anticipate.

### Step 5 — Implementer: `.claude-plugin/plugin.json`

```json
{
  "name": "engineering-paved-path",
  "version": "1.0.0",
  "description": "Shared engineering-practice skills: React, React Testing Library, Next.js, Fastify, onion/hexagonal architecture, Drizzle ORM, PostgreSQL table design, Zod, TypeScript, web security (OWASP), and Mermaid diagrams."
}
```

No `dependencies` array — this plugin has none (confirmed,
`docs/specs/marketplace-extraction/architecture.md:109`).

### Step 6 — Implementer: `COMPATIBILITY.md`, `README.md`, `CHANGELOG.md`

- `COMPATIBILITY.md`: one line/section — `Claude Code >=2.1.110`.
- `README.md`: what the plugin ships (list the 11 skills with a one-line
  description each — can lift the opening sentence of each skill's own
  `description` frontmatter, rewritten to be plugin-catalog-appropriate
  rather than agent-trigger-appropriate), how to install standalone
  (`/plugin install engineering-paved-path@dev-digest-ai-marketplace`), and
  a note that it has no dependencies and is depended on by
  `architecture-review` and `sdd-engineering`.
- `CHANGELOG.md`: single entry, `## 1.0.0 — Initial extraction` +
  one-line summary (11 skills extracted from the DevDigest engineering
  harness — this changelog entry is the one place in this plugin allowed to
  name DevDigest, since a changelog documenting provenance/history is not
  the same as functional content depending on it; keep it to one factual
  sentence, not a full narrative).

### Step 7 — Validation

From `dev-digest-ai-marketplace` root:
```
claude plugin validate ./plugins/engineering-paved-path
```
Fix any schema error reported before moving to the next sub-plan. Do **not**
add a `--strict` flag (no such flag exists,
`docs/specs/marketplace-extraction/architecture.md:289-290`).

## Test plan

- `claude plugin validate ./plugins/engineering-paved-path` exits clean —
  this is the only mechanical check available at this stage (no
  `marketplace.json` yet to run `claude plugin validate .` against; that
  comes in the Phase 2 step-5 follow-up after all four plugins exist).
- `grep -rn "/Users/" plugins/engineering-paved-path` (excluding none — there
  is no `.git` inside this path) returns nothing (AC-8).
- `grep -rliE "devdigest|reviewer-core|@devdigest|server/src|~/.devdigest"
  plugins/engineering-paved-path` returns nothing, **except** the confirmed
  harmless `security/examples.md:287` false positive (a coincidental
  substring match on `server/src` inside a generic illustrative string, not
  an actual DevDigest reference) — if the content-review pass in Step 4
  confirms this reading, it is an accepted pass, not a failure to chase.
- Step 4's content-review pass is itself part of "passing" this test plan —
  a green grep with an unexecuted content-review pass is not sufficient
  given the confirmed hidden-language-mandate pattern; the plan is not done
  until Step 4 has actually run and reported no findings (or findings have
  been fixed and re-reviewed).
- Manual check: every file under `plugins/engineering-paved-path/skills/`
  traces to a name in the architecture spec's 11-skill list — no extra
  skill folder, no `evals/` subdirectory anywhere in this plugin yet.

## Out of scope

Architecture and security review are **not** part of this plan or the
executing agent's job — they belong to separate review agents. Also
explicitly deferred to later sub-plans/phases: `research-tools`,
`architecture-review`, `sdd-engineering` plugin content (sub-plans 2–4);
root `.claude-plugin/marketplace.json` and the combined `claude plugin
validate .` (Phase 2 step-5 follow-up, after all four plugins exist);
per-skill `evals/` fixtures (Phase 4, generalized evals); the GitHub Pages
catalog, cost baseline, releases/tagging, and install rehearsal (Phases 3,
5, 6, and the lab's later steps respectively).
