# Development Plan — Phase 6.2: Install sdd-engineering@1.0.0 in `plugin-install-target` (lab Крок 10)

**Execution mode:** multi-agent, same governing split as the rest of Phase
6 — but this sub-plan has **no file-editing task inside
`dev-digest-ai-marketplace` for the planning `implementer` subagent at
all**. Every command here (`claude plugin marketplace/install/list`, the
live SDD workflow rehearsal, `git commit` in `plugin-install-target`) is
executed by the **orchestrating session**, because it either needs
`Bash`+network access the implementer doesn't have, or it *is* the
installed plugin's own agents running live (a different multi-agent
system than this planning session's — see Context) which this session
drives interactively, not delegates to its own `implementer` subagent.

Working directory: `/Users/viptech/dev/ai agent/plugin-install-target`
for every step below **unless marked otherwise**.

## Context

Precondition: Phase 6.1 is complete — all four tags
(`engineering-paved-path--v1.0.0`, `research-tools--v1.0.0`,
`architecture-review--v1.0.0`, `sdd-engineering--v1.0.0`) exist and are
pushed to `github.com/viptech/dev-digest-ai-marketplace`. Do not start
this phase until `git tag -l` in that repo shows all four.

`plugin-install-target` (`/Users/viptech/dev/ai agent/plugin-install-target`)
is the fixed install rehearsal target from `architecture.md`'s Open
questions §2 — a minimal Node.js project, own `CLAUDE.md`, own git repo
with **no GitHub remote** (`git remote -v` confirmed empty), and
deliberately **no** `.claude/agents/`, `.claude/skills/`, or `.claude-plugin/`
of its own. Confirmed again at Phase 6 planning time: 2 commits, `npm
test` (`node --test`) green against `src/greet.js`/`src/greet.test.js`.

**Coordinator's confirmed decisions for this phase (2026-08-25):**
- No `gh repo create` for `plugin-install-target` — the homework's own
  wording ("посилання на pull request **або** commit") accepts a plain
  local commit, and creating a real GitHub repo/PR adds avoidable network
  risk before the 2026-08-28 23:45 deadline. This phase produces exactly
  one commit in `plugin-install-target`, referenced by its SHA — no
  `gh pr create`, no remote push for this repo.
- Stable-channel mechanism (relevant to Phase 6.3, not this phase, but the
  `marketplace add` command run here in Step 1 is the *same* command whose
  pinned-ref variant Phase 6.3 reuses) is the direct `owner/repo@<tag>`
  form, confirmed working in `claude plugin marketplace add --help`
  (Claude Code 2.1.243) and `code.claude.com/docs/en/plugin-marketplaces`.
  This phase's Step 1 adds the **unpinned** default-ref source (the
  "latest" channel) — no `@<ref>` suffix here.

**"Trace or telemetry" for AC-4, honestly scoped:** `plugin-install-target`
has no bespoke telemetry pipeline (that is a DevDigest product feature —
`server/`'s trace tables — which explicitly does not exist here). The
evidence this phase actually has available is Claude Code's own CLI/session
surfaces: `claude plugin list --json`'s per-plugin `version` field, `claude
plugin details <plugin>@<marketplace>`'s component inventory, and the live
session transcript's tool-use blocks (each `Task`/subagent dispatch names
the agent; each namespaced `Skill` invocation shows the `<plugin>:<skill>`
form). This plan uses those three surfaces as AC-4's evidence — it does not
invent a telemetry system DevDigest's own architecture never built for this
repo.

## Modules involved

- `plugin-install-target` (its whole tree) — receives one real commit from
  a live SDD-workflow rehearsal.
- `dev-digest-ai-marketplace` — read-only in this phase (its
  `marketplace.json`/tags are the install *source*; nothing here edits
  that repo).

## Constraints

From `docs/specs/marketplace-extraction/architecture.md` and the lab's own
Крок 10 checklist (`L08/04-hands-on-lab.md:306-335`):

- **AC-1**: the rehearsal must run the full workflow using only files the
  plugin and its dependencies ship — no DevDigest-local file may be read.
  Since `plugin-install-target` has zero local `.claude/` content by
  construction, any agent/skill observed running here necessarily came
  from the installed plugin (this is the whole point of this specific
  install target per `architecture.md`'s Open questions §2).
- **AC-2**: `claude plugin list --json` after install must show **no**
  `dependency-unsatisfied`, `range-conflict`, or `no-matching-tag` entries
  for any of the four plugins.
- **AC-4**: trace/telemetry evidence — see the honestly-scoped definition
  above; capture it (screenshots/copied CLI output) for the homework demo
  video, but do not write a bespoke telemetry artifact file into this repo
  that the architecture spec never asked for.
- **"If a target project already has local copies of the same
  agents/skills, warn before trusting a trace"** invariant
  (architecture.md:592-596) — not triggered here (confirmed precondition:
  zero local copies), but state this confirmation explicitly in the demo
  narration rather than silently assuming it.
- **`${CLAUDE_SKILL_DIR}` resolution check** — lab step 10's explicit item
  ("`workflow-retro/scripts/analyze_journals.py` використовує
  `${CLAUDE_SKILL_DIR}`") requires one **deliberate, explicit** invocation
  of `workflow-retro` in this rehearsal specifically to confirm the script
  resolves its own skill directory correctly once installed via the
  marketplace (a different code path than running it from a checked-out
  `plugins/` directory, which is all prior phases tested). This is the one
  place in this phase where `workflow-retro` is *supposed* to run — do not
  conflate it with the "does not auto-activate" check, which is about the
  main SDD workflow, not `workflow-retro` specifically.
- **Project instructions must not be silently overridden** — confirm
  `plugin-install-target`'s own `CLAUDE.md` conventions (plain ESM,
  `node --test`, no build step) are still respected by whatever the
  installed `implementer` (the plugin's own agent, not this planning
  session's) writes.
- **No secrets, no absolute path** committed in the new commit (AC-8,
  general SECURITY.md policy) — before committing, grep the diff for any
  `/Users/viptech/...` path or credential-shaped string.

## Ordered steps

### Step 1 — orchestrating session: add the marketplace + install

```sh
cd "/Users/viptech/dev/ai agent/plugin-install-target"
claude plugin marketplace add viptech/dev-digest-ai-marketplace --scope project
claude plugin install sdd-engineering@dev-digest-ai-marketplace --scope project
```

Confirm the install output lists `sdd-engineering` plus its three resolved
dependencies (`engineering-paved-path`, `research-tools`,
`architecture-review`) at `1.0.0` each.

### Step 2 — orchestrating session: verify no dependency errors (AC-2)

```sh
claude plugin list --json
```

Read the JSON output; confirm no `dependency-unsatisfied`,
`range-conflict`, or `no-matching-tag` entries for any of the four
plugins. Save this output for the homework demo (copy into the demo
recording/transcript — not into a committed file in either repo, since
neither architecture.md nor the homework asks for a checked-in JSON dump).

### Step 3 — orchestrating session: start a fresh session / `/reload-plugins`

Start a new Claude Code session inside `plugin-install-target` (or run
`/reload-plugins` in the current one) so the newly-installed plugin is
actually loaded before the rehearsal below.

### Step 4 — orchestrating session: drive one short SDD workflow live

Ask (inside `plugin-install-target`, as a normal user prompt to the
now-plugin-equipped session) for a small, real feature — e.g. "add a
`farewell(name)` function mirroring the existing `greet(name)`, with its
own test." Walk the lab's Крок 10 behavior checklist item by item while it
runs, confirming each:

- `spec-creator` is available and reachable from `sdd-engineering`
  (namespaced correctly; no bare-name collision with anything local, since
  nothing local exists).
- The drafted spec appears at the documented path
  (`docs/specs/<module>/SPEC-NN-<slug>.md` per `spec-creator.md`'s own
  Step 3 rule) — `plugin-install-target` has no `docs/specs/` yet, so this
  also confirms the agent creates the directory rather than assuming it
  pre-exists.
- `implementation-planner` builds its Development Plan from that spec
  (not from invented requirements).
- `run-plan` dispatches the plugin's own `implementer` (this is the
  installed agent under test, distinct from this planning session's
  `implementer` subagent — do not conflate the two anywhere in the demo
  narration).
- `research-tools:researcher` is available for delegated discovery if
  either agent needs it (may or may not fire for a task this small — note
  whichever happens, don't force it).
- `architecture-review:architecture-reviewer` and `plan-verifier` form an
  independent review gate before the plan is considered complete.
- The main SDD workflow did **not** need `workflow-retro` to auto-fire —
  confirm it did not run unless Step 5 below explicitly requests it.
- Trace/telemetry (per the honestly-scoped definition above) shows the
  active plugin name/version and its resolved dependency plugins/versions
  throughout.
- `plugin-install-target`'s own `CLAUDE.md` conventions were respected
  (plain ESM, side-by-side `foo.js`/`foo.test.js`, `node --test`, no build
  step) — the plugin's `implementer` should not have introduced a build
  step or a different test framework.

### Step 5 — orchestrating session: explicit `workflow-retro` invocation (script-path check)

Separately from Step 4's main workflow, explicitly ask for a retro (e.g.
"run a workflow retro on that run") specifically to exercise
`workflow-retro/scripts/analyze_journals.py`'s `${CLAUDE_SKILL_DIR}`
resolution in an installed (not checked-out) context — confirm the script
finds its own directory correctly and does not fail with a hardcoded-path
assumption.

### Step 6 — orchestrating session: run the target project's own tests

```sh
npm test
```

Confirm the plugin's `implementer` produced a real, passing feature (the
new `farewell` function + its test), not just a spec/plan with no code —
`npm test` here is `plugin-install-target`'s own `node --test` per its
`CLAUDE.md`, unrelated to `dev-digest-ai-marketplace`'s `evals/`.

### Step 7 — orchestrating session: security self-check before committing

```sh
git diff --stat
git diff | grep -n "/Users/viptech" || echo "no absolute paths found"
```

Confirm no absolute local path or secret-shaped string is in the diff
(AC-8) before committing.

### Step 8 — orchestrating session: commit (this phase's homework evidence)

```sh
git add -A
git commit -m "Install sdd-engineering@dev-digest-ai-marketplace: add farewell() via the installed SDD workflow"
git log --oneline -1
```

Record the resulting commit SHA — this is the homework's "посилання на
pull request або commit" artifact for `plugin-install-target` (coordinator
confirmed: local commit is sufficient, no `gh repo create`/PR needed).

## Test plan

- `claude plugin list --json` (Step 2) — no `dependency-unsatisfied`,
  `range-conflict`, or `no-matching-tag` entries. Pass = clean.
- `npm test` inside `plugin-install-target` (Step 6) — all tests green,
  including the new `farewell` test the rehearsal produced.
- Manual lab Крок 10 checklist (Step 4/5) — every bullet confirmed, not
  assumed; note any bullet that didn't fire naturally and had to be
  explicitly prompted (e.g. `researcher`).
- `git log --oneline -1` in `plugin-install-target` (Step 8) shows the new
  commit; `git diff` self-check (Step 7) found no absolute path/secret.

## Out of scope

Tagging/releasing (Phase 6.1, already complete before this phase starts),
the 1.1.0 update and rollback rehearsal (Phase 6.3), any `gh repo
create`/real GitHub PR for `plugin-install-target` (coordinator's explicit
decision against it for this homework cycle), and architecture/security
review of whatever code the installed `implementer` agent writes during
the rehearsal — that review, if wanted, is a separate pass by a review
agent, not this plan's job.
