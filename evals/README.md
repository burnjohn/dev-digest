# evals

Evals for the DevDigest Claude Code harness — **skills** (`.claude/skills/*`), **subagents**
(`.claude/agents/*`), and **workflow-level** behavior (`CLAUDE.md` + on-disk config). Plain
**vitest + the Claude Agent SDK**, in the same toolchain as the rest of the repo (`pnpm`).

Runs on the Claude Code **subscription** by default — the API key is stripped from spawned
processes, so calls use the login / credential helper, never per-token API billing. No external
services, no third-party judge.

The **same tests** can also run on **OpenRouter** (DeepSeek and other cheap models) by setting
`EVAL_BACKEND=openrouter` — no code changes, just env vars. See
[Runners: Claude Code vs OpenRouter](#runners-claude-code-default-vs-openrouter) below.

> Built to the *eval statistics upgrade* plan (`evals/docs/eval-stats-upgrade.md`): persisted
> per-run records, per-practice statistics, and a with-vs-without-artifact benchmark, on top of
> the modular `src/` engine described below.

## Install (from the lesson template)

This package is self-contained — it only adds the `evals/` folder and never touches `server/`
or `client/`, so it merges into your repo cleanly:

```bash
git fetch upstream
git merge upstream/l06-evals    # adds evals/ only — no conflicts
cd evals && pnpm install
```

If your repo has diverged too far for a clean merge, just copy the `evals/` directory in whole
and commit it. It is deliberately **not** an npm package: it reads your `.claude/skills/*` and
`.claude/agents/*` by relative path, and you write cases in it — so the code sits in front of
you, not hidden in `node_modules`.

## Three tiers

1. **Static gate (no model)** — `pnpm eval:quality` checks SKILL.md structure/frontmatter/links.
2. **Quality evals (LLM-judged)** — per skill/agent, isolate the artifact's *content* and judge it.
3. **Workflow evals (trace-asserted)** — load the real harness and check *systemic* behavior:
   does a subagent get dispatched, does a skill activate, does `CLAUDE.md` change what gets read.

On top of the tiers sit three statistical tools: **repeat** (run one thing N times → stability),
**delta** (diff two labeled repeat runs → version-vs-version), **benchmark** (run with vs without
the artifact → measured lift). All three read the same persisted `results/records.jsonl`.

## Two ways to run a case (and why)

- **`skillTask` / `agentTask`** inject the artifact's content as the system prompt and load **no**
  on-disk config. This isolates the artifact's *content* — the right question for skill/agent
  quality. (Relies on the SDK default `settingSources: []`, which reads nothing from disk.)
- **`workflowTask`** loads the real harness (`settingSources: ["project"]` → `CLAUDE.md` + project
  skills/agents). The *systemic* tier: does a skill actually **activate**, does a subagent actually
  get **dispatched**, does `CLAUDE.md` change behavior? A content-only eval can't see this.

## Two scorers (both subscription-only)

- `patternMatch(output, expected)` — deterministic substring coverage, no model. Use it as a
  cheap first tier: don't pay the judge for what a substring settles. When a case has a `grounding`
  gate it runs first and must equal `1.0`; the judge is skipped if it fails (cheap-tier economy).
- `llmJudge(output, practices)` — one structured `query()` → strict JSON, binary PASS/FAIL per
  practice, PASS only with a verbatim evidence quote (the LLM Message Pattern). The judge defaults
  to a **stronger family** (`EVAL_JUDGE_MODEL=claude-sonnet-5`) than the task (`claude-haiku-4-5`)
  to soften single-model self-preference. On a shared subscription families still overlap — the
  real mitigations are *blind + binary + verbatim evidence*.

## Runners: Claude Code (default) vs OpenRouter

The same eval tests run against two backends, chosen by `EVAL_BACKEND` — you never edit a test to
switch. The model name is a **separate** knob (`EVAL_MODEL` / `EVAL_JUDGE_MODEL`), and its format
differs per backend.

| `EVAL_BACKEND` | Runtime | Auth | Model name format |
|---|---|---|---|
| `subscription` *(default)* | Claude Agent SDK on the Claude Code login | none (API key stripped) | Anthropic ID — `claude-haiku-4-5` |
| `openrouter` | see split below | `OPENROUTER_API_KEY` | OpenRouter slug — `deepseek/deepseek-chat`, `anthropic/claude-haiku-4.5`, `google/gemini-...` |

**Why the backend splits by tier.** OpenRouter's native "Anthropic Skin" only serves *Anthropic*
models, and only the Claude Agent SDK produces the subagent/skill/file-read trace the workflow tier
asserts on. So under `openrouter`:

- **Content tier** (`skillTask` + the LLM judge) → a **direct** OpenAI-compatible call
  (`src/runtime/run-openrouter.ts`, mirroring `reviewer-core/src/llm/openrouter.ts`). DeepSeek and
  any non-Anthropic model work here **natively, no proxy**. Routed via `src/runtime/dispatch.ts`.
- **Tool tiers** (`agentTask`, `workflowTask`) → stay on the Claude Agent SDK, pointed at
  `ANTHROPIC_BASE_URL`. This works out-of-the-box only with `anthropic/*` slugs (the Skin). Cheap
  **non-Anthropic** models here need a LiteLLM translating proxy — **now bundled** under
  `evals/proxy/`. Start it (`pnpm proxy:up`) and point `OPENROUTER_BASE_URL` at it
  (`http://localhost:4000`). See [Running tool tiers on cheap models](#running-tool-tiers-on-cheap-models-litellm-proxy).

The default (`subscription`) path is untouched — the dispatcher only diverges when
`EVAL_BACKEND=openrouter`.

### Examples — the same `pnpm eval:skills`, three ways

```bash
# 1. Local, Anthropic (default — set nothing)
pnpm eval:skills

# 2. OpenRouter + DeepSeek (native, no proxy)
EVAL_BACKEND=openrouter \
EVAL_MODEL=deepseek/deepseek-chat \
EVAL_JUDGE_MODEL=deepseek/deepseek-chat \
OPENROUTER_API_KEY=sk-or-... \
pnpm eval:skills

# 3. OpenRouter, but an Anthropic model via the Skin
EVAL_BACKEND=openrouter \
EVAL_MODEL=anthropic/claude-haiku-4.5 \
OPENROUTER_API_KEY=sk-or-... \
pnpm eval:skills
```

> **Gotcha:** always set `EVAL_MODEL` together with `EVAL_BACKEND=openrouter` — the default
> `claude-haiku-4-5` is an Anthropic ID and OpenRouter won't find it. Use an OpenRouter slug.

### The OpenRouter engine — running EVERY tier (incl. tool tiers) on cheap models

The content tier talks to OpenRouter natively, but the **tool tiers** (`agentTask`, `workflowTask`)
run inside the Claude Agent SDK, which speaks the Anthropic wire protocol. OpenRouter's Anthropic
Skin only serves that shape for `anthropic/*` slugs — so to back the tool tiers with a cheap
non-Anthropic model (Gemini Flash, DeepSeek, …) the SDK is routed through the bundled **LiteLLM
translating proxy**. This is the "engine" that makes cheap CI runs possible; it lives entirely
inside `evals/` and needs no code changes to use.

**Engine pieces** (all in `evals/`):

| File | Role |
|------|------|
| `proxy/litellm.config.yaml` | LiteLLM config: a wildcard route forwarding any `EVAL_MODEL` slug to OpenRouter, in no-auth mode |
| `proxy/docker-compose.yml` | Runs `ghcr.io/berriai/litellm` on `:4000`, both wire formats on one port |
| `scripts/litellm-proxy.sh` | `up` / `down` / `wait` wrapper (reads `OPENROUTER_API_KEY` from env, else `~/.devdigest/secrets.json`) |
| `src/runtime/env.ts` | Points the SDK's `ANTHROPIC_BASE_URL` at `OPENROUTER_BASE_URL` (the proxy) under `EVAL_BACKEND=openrouter` |
| `src/runtime/run-openrouter.ts` | Content tier's direct OpenAI-format call — also honours `OPENROUTER_BASE_URL` |

The proxy accepts **both** shapes on one port — `POST /v1/messages` (Anthropic, from the SDK) and
`POST /chat/completions` (OpenAI, from the content tier) — and translates each to the target model
on OpenRouter. Because `OPENROUTER_BASE_URL` overrides the base for **both** tiers, a single env var
routes the whole suite through it. `pnpm proxy:*` are thin wrappers over the script.

```bash
# 1. Start the proxy (Docker). Reads OPENROUTER_API_KEY from env or ~/.devdigest/secrets.json.
pnpm proxy:up                                  # → http://localhost:4000

# 2. Point every tier at it and run the workflow tier on a cheap model
EVAL_BACKEND=openrouter \
OPENROUTER_BASE_URL=http://localhost:4000 \
OPENROUTER_API_KEY=sk-or-... \
EVAL_MODEL=google/gemini-2.5-flash \
EVAL_JUDGE_MODEL=google/gemini-2.5-flash \
pnpm eval:workflow

# 3. Stop it when done
pnpm proxy:down
```

`EVAL_MODEL` is forwarded verbatim to OpenRouter (the wildcard route in `proxy/litellm.config.yaml`),
so you never edit config to try a new model. The proxy runs in **no-auth** mode — do not expose the
port publicly.

#### Which cheap model — verified

The tool tiers assert on real tool use (subagent dispatch, doc reads, skill activation), so the
model has to be capable enough to actually *do* it, not just be reachable. Measured on the bundled
workflow cases:

| Model | Content + routing/read traces | Subagent **dispatch** (`Agent`→ `architecture-reviewer`) |
|-------|------------------------------|-----------------------------------------------------------|
| `google/gemini-2.5-flash` | ✅ | ✅ **recommended** |
| `deepseek/deepseek-chat` | ✅ | ❌ does the work inline instead of dispatching |
| `openai/gpt-4.1-mini` | ✅ | ❌ |

**Two caveats for the tool tiers on cheap models:**

1. **Rate-limit flakiness under load.** Running the whole suite back-to-back can get throttled by
   OpenRouter, degrading runs to a single turn (so a dispatch that passes in isolation may fail in a
   full run). Run tool-tier cases **sequentially** and/or with retries; keep concurrency low in CI.
2. **`activation` cases are behaviour-shaped.** They assert the model invokes the **Skill** tool.
   A capable model may instead perform the underlying action directly (e.g. `Write` the insight
   file), which the test counts as a miss even though it did the right thing. Treat `activation` as
   **indicative, not blocking** when running on non-Anthropic models. (On the Anthropic path the
   model invokes the Skill tool, so it passes.)

> **Isolation note.** `workflowTask` runs with `settingSources:["project"]` + `bypassPermissions`
> against the live repo. A model that decides to `Write` can touch real files (e.g. your local
> memory dir) even though `WORKFLOW_ALLOWED_TOOLS` is a read-only list. In CI this is harmless (the
> checkout is disposable); locally, prefer the Anthropic path or a throwaway clone for the workflow
> tier.

### Wiring it into GitHub Actions (per-PR)

The engine is CI-ready: bring the proxy up as a step, wait for it, run the tier, tear it down. Put
the OpenRouter key in the repo's **Actions secrets** as `OPENROUTER_API_KEY` (Settings → Secrets and
variables → Actions). Create `.github/workflows/<name>.yml` in your repo:

```yaml
name: evals
on:
  pull_request:
    paths: ['evals/**', '.claude/**', 'CLAUDE.md']   # only when the harness/artifacts change

permissions:
  contents: read

jobs:
  workflow-evals:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: evals
    env:
      EVAL_BACKEND: openrouter
      OPENROUTER_BASE_URL: http://localhost:4000
      OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}   # repo Actions secret
      EVAL_MODEL: google/gemini-2.5-flash
      EVAL_JUDGE_MODEL: google/gemini-2.5-flash
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 10 }
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
          cache-dependency-path: evals/pnpm-lock.yaml
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck

      # --- the engine ---
      - run: docker compose -f proxy/docker-compose.yml up -d   # OPENROUTER_API_KEY from job env
      - run: pnpm proxy:wait                                     # block until the proxy answers
      - run: pnpm eval:workflow                                  # or eval:agents / eval:skills / eval
      - if: failure()
        run: docker compose -f proxy/docker-compose.yml logs --tail 100
      - if: always()
        run: docker compose -f proxy/docker-compose.yml down
```

Notes:
- ubuntu runners ship Docker + `docker compose`, so no extra setup is needed.
- The proxy container reads `OPENROUTER_API_KEY` straight from the job `env` (which is fed by the
  secret) — you don't pass it to `docker compose` explicitly.
- Because tool tiers cost real tokens, gate on `paths:` (only when the harness/artifacts change) and
  keep the case count small. For a stricter gate, split into a required `eval:agents`/`eval:skills`
  job and a non-blocking `eval:workflow` job (activation flakiness, above).

## Module layout — `src/` (the engine)

The engine is split by responsibility with one-directional dependencies (config knows nothing of
runtime; runtime nothing of scoring; the `dsl/` composes everything). Eval files import from the
single barrel `src/index.ts`, never by deep relative path.

```
src/
  config.ts             # all tunables: EVAL_MODEL, EVAL_JUDGE_MODEL, MAX_TURNS, EVAL_CONFIG,
                        #   thresholds, flaky bounds (20/80), cost-regression ratio (125%), tool allow-lists
  ansi.ts               # color constants + color() helper (one place owns terminal styling)
  git.ts                # gitInfo() — short sha + dirty flag (shared by record.ts and repeat.ts)
  runtime/
    env.ts              # subscriptionEnv() — strips ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN
    run-claude.ts       # runClaude() — the headless turn-loop; Result / RunOptions / Metrics types
  artifacts/
    paths.ts            # REPO_ROOT / SKILLS_DIR / AGENTS_DIR / RESULTS_DIR anchors
    load.ts             # skillContent() (SKILL.md + references/*.md), agentContent()
    fixture.ts          # fixtureReader(import.meta.url) — inline a case's fixtures into a prompt
  tasks.ts              # skillTask / agentTask / workflowTask — compose runtime + artifacts;
                        #   skill/agentTask skip injection under EVAL_CONFIG=baseline (benchmark lift)
  scoring/
    pattern-match.ts    # patternMatch() — deterministic substring coverage
    llm-judge.ts        # llmJudge(), parseVerdict(), Verdict, the judge rubric
  logging/
    log.ts              # logTrace() (tools/subagents/skills/reads/metrics), logVerdict() (per-practice)
  records/
    record.ts           # record() → results/records.jsonl + full output to results/outputs/<run>/<slug>.md
    stats.ts            # pure: calcStats(), loadRecords(), aggregate(), byConfig(), computeFlags()
    stats.test.ts       # the only non-model unit tests — the statistics math
    benchmark.ts        # eval:benchmark CLI (with vs without artifact)
  trend-reporter.ts     # vitest reporter: pass/fail rows → results/history.jsonl
  compare.ts            # eval:compare — run-flip view over history.jsonl
  repeat.ts             # eval:repeat — N runs of one pattern → stability stats (reads records.jsonl)
  delta.ts              # eval:delta — diff two labeled repeat runs
  scaffold.ts           # eval:scaffold — list skills/agents, generate template eval files
  skill-quality.ts      # eval:quality — static SKILL.md gate (no model)
  dsl/
    describe.ts         # describeSkill / describeAgent / describeWorkflow — labeled groups
    case.ts             # SkillCase / AgentCase / WorkflowCase types; runSkillCases / runAgentCases / runWorkflowCases
  index.ts              # barrel — the only import surface for eval files
```

## Case layout — where your tests, prompts, and fixtures live

> The package ships with **no example cases** — `skills/`, `agents/`, and `workflow/` are yours to
> fill. The names below (`onion-architecture`, `architecture-reviewer`, …) are **illustrations of
> the format only**, not files in the repo. Create your own with `pnpm eval:scaffold`.

You bring your own skills/agents, so **you scaffold cases, not hand-copy files**:

```bash
pnpm eval:scaffold                 # list every skill/agent in .claude and whether it has evals
pnpm eval:scaffold <skill-name>    # generate evals/skills/<name>/{eval.ts, cases.ts, fixtures/}
pnpm eval:scaffold --agent <name>  # same under evals/agents/<name>/  (refuses to overwrite)
```

Then fill in the generated `*.cases.ts` and run `pnpm vitest run skills/<name>`. Keep it minimal —
one or two cases per skill is enough; there is no need to cover every skill.

Cases live in the `evals/` package (**not** inside `.claude/skills/*` or `.claude/agents/*` —
that folder is the skill's *payload*; a fixture there would leak into the assembled prompt).
The folders mirror the artifacts one-to-one, and each case folder holds three kinds of file:

| File | Holds | Example |
|------|-------|---------|
| `*.eval.ts` | thin: `describe* + run*Cases` — *what* runs, nothing else | `onion-architecture.eval.ts` |
| `*.cases.ts` | the data: prompt, practices, grounding, threshold, maxTurns, kind | `onion-architecture.cases.ts` |
| `fixtures/` | raw inputs inlined into prompts (diffs, code, session traces) | `fixtures/widgets-service.ts` |

```
evals/
  skills/onion-architecture/
    onion-architecture.eval.ts     # describeSkill("onion-architecture", () => runSkillCases(...))
    onion-architecture.cases.ts    # export const cases: SkillCase[] = [ { name, prompt, practices, threshold } ]
    fixtures/widgets-service.ts
  agents/architecture-reviewer/
    architecture-reviewer.eval.ts  # describeAgent(...) — identical shape to a skill
    architecture-reviewer.cases.ts
    fixtures/auth-route-violation.diff
  workflow/
    review-workflow.eval.ts        # describeWorkflow("review", () => runWorkflowCases(cases))
    review-workflow.cases.ts       # export const cases: WorkflowCase[] = [ ... ]  (see below)
```

A thin eval file is the whole file:

```ts
import { describeSkill, runSkillCases } from "../../src";
import { cases } from "./onion-architecture.cases.js";

describeSkill("onion-architecture", () => runSkillCases("onion-architecture", cases));
// vitest output groups as:  skill:onion-architecture > review flags widget-module layering violations
```

`run*Cases` owns the one true **measure → record → assert** body (model call + scorers in a
`try`, `record()` in `finally`, `expect` strictly after). Case authors never write that loop, so
the assert-before-record bug can't recur.

### Skill / agent case (`SkillCase` / `AgentCase`)

Judge-and-grounding shaped. Same type for both tiers; only the task differs (`skillTask` vs
`agentTask`).

```ts
export const cases: SkillCase[] = [
  {
    name: "review flags widget-module layering violations",
    kind: "quality",
    prompt: reviewPrompt(["widgets-service.ts", "widgets-routes.ts"]),  // inlines fixtures
    practices: [
      "flagged the direct Drizzle DB query inside service.ts as a layering violation",
      "flagged that the service leaks the Drizzle row type out of infrastructure",
      // ...
    ],
    grounding: [],        // optional substrings that must ALL appear before the judge runs
    threshold: 0.6,       // judge score gate
    maxTurns: 8,          // optional
  },
];
```

`kind`: `quality` (judge) · `grounding` (patternMatch only, must equal 1).

### Workflow case (`WorkflowCase`)

Trace-asserted, not judged — a discriminated union routed by `kind`. The folder is organized by
*scenario* (`review-workflow`), not by a single artifact, because a workflow is cross-cutting
(`CLAUDE.md` + skills + agents together).

```ts
export const cases: WorkflowCase[] = [
  { kind: "dispatch",   name: "dispatches the architecture-reviewer subagent",
    prompt: `Use the architecture-reviewer subagent to audit ${AUTH_DIFF}...`,
    expectSubagent: "architecture-reviewer", maxTurns: 6 },

  { kind: "activation", name: "engineering-insights activates on a discovery prompt",
    prompt: "I just figured out why the pgvector query returned nothing...",
    skill: "engineering-insights", shouldActivate: true, maxTurns: 4 },

  { kind: "activation", name: "near-miss negative — same topic as a question must NOT activate",
    prompt: "Explain how pgvector column dimensions work and why a mismatch returns zero rows...",
    skill: "engineering-insights", shouldActivate: false, maxTurns: 4 },

  { kind: "contrast",   name: "CLAUDE.md routes an API-route task to api-contracts doc",
    prompt: "I'm about to add POST /reviews/:id/rerun. Follow this repo's conventions...",
    expectFileRead: "server/docs/api-contracts.md", tools: ["Read", "Grep", "Glob"], maxTurns: 6 },
];
```

How each `kind` asserts:

| `kind` | Runs | Passes when |
|--------|------|-------------|
| `dispatch` | `workflowTask` | `result.subagents` contains `expectSubagent` |
| `activation` | `workflowTask` | `activated(result, skill) === shouldActivate` (positive **and** near-miss negative) |
| `contrast` | treatment (real repo) **and** control (empty tmpdir, `settingSources:[]`) | `expectFileRead` read in treatment, NOT in control |

Workflow records carry an empty `practices[]` (no judge) but a full trace; `contrast` writes two
records — `<label>:treatment` and `<label>:control`.

## Commands & parameters

```bash
cd evals && pnpm install

pnpm eval:quality        # fast static gate (no model)
pnpm eval                # all quality + workflow evals, once
pnpm eval:skills         # just skills/
pnpm eval:agents         # just agents/
pnpm eval:workflow       # just workflow/
pnpm vitest run skills/onion-architecture       # one artifact
pnpm vitest run src/records/stats.test.ts       # the only non-model unit test (stats math)
```

### `eval:repeat` — stability of one thing

```bash
pnpm eval:repeat <vitest pattern> [-n times=5] [-t testNamePattern] [--label name]
pnpm eval:repeat skills/onion-architecture -n 5 --label baseline
```
Runs the pattern N times, then prints per-test pass rate, a per-**practice** table
(`passed/total (pct)`), and metric stats (`turns`, `duration_ms`, `tokens_out` as mean ± stddev;
n<5 prints an "indicative only" caveat). `--label` saves the aggregate to
`results/repeat-<label>.json` for delta.

### `eval:delta` — version vs version (the canonical loop)

The primary "before vs after a change" workflow. **Capture the baseline label BEFORE you edit** —
there is no way to reconstruct it afterwards short of reverting.

```bash
pnpm eval:repeat skills/onion-architecture -n 5 --label baseline   # BEFORE the edit
#   ...edit SKILL.md...
pnpm eval:repeat skills/onion-architecture -n 5 --label candidate  # AFTER the edit
pnpm eval:delta baseline candidate
```
Shows the delta at three levels: per-test pass rate, per-**practice** (which practice
improved/regressed — the main signal), and metrics (`baseline → candidate (±diff)`). Green =
improved, red = regressed, dim = unchanged. A practice on one side only renders `— → X%`.

### `eval:benchmark` — measured lift (with vs without the artifact)

```bash
pnpm eval:benchmark <vitest pattern> [-n runs=5]
pnpm eval:benchmark skills/engineering-insights -n 5    # a skill
pnpm eval:benchmark agents/architecture-reviewer -n 5   # an agent
```

**candidate vs baseline** — the whole idea. The benchmark runs the *same test case* in two
configurations:

- **candidate** = *with the artifact*. The skill's content (or the agent's definition) is
  injected into the system prompt — the normal, artifact-on condition.
- **baseline** = *without it*. The identical prompt, case, and model, but the artifact is **not**
  injected (raw model). Enabled by `EVAL_CONFIG=baseline`, which makes `skillTask`/`agentTask`
  skip injection.

The **difference** between them is the artifact's measured value ("lift") — not a feeling that it
"seems to help." If candidate and baseline score the same, the artifact adds nothing the model
didn't already do. Example output:

```
  metric      candidate   baseline    Δ
  pass_rate   100%        80%        +20%     ← the skill added 20% reliability on this case

  practices (candidate → baseline):
     80% → 100%  noted the rejected alternative ...   ← read as candidate% → baseline%
```

**What `baseline` removes — and what it must NOT.** A case has two text parts: the *user prompt*
(the task + its fixture — the input the model must work on) and the *system prompt* (the
artifact under test). `baseline` removes **only the artifact**. The user prompt and fixture stay
**identical** to candidate. That is the definition of a controlled A/B: change exactly one
variable (artifact on/off), hold everything else constant, so the delta is attributable to the
artifact and nothing else. This is not a quirk of this package — it is how controlled evals work
everywhere (skill-creator v2's with_skill/without_skill runs the same prompt too).

You therefore **cannot (and should not) "hide the fixture" from baseline.** The fixture is not a
hint the baseline peeked at — it is the shared task both configurations must perform. Giving
baseline a different input would change two variables at once and make Δ meaningless (two runners,
different distances).

**Low lift is usually a task-design signal, not a baseline problem.** If a fixture already spells
out the answers the practices check for (e.g. `session-pgvector-dim.md` literally contains
"1536", "3072", the rejected alternative, the follow-up), then even the raw model just has to
summarize faithfully — so baseline scores high and lift is small (`non_discriminating` flags mark
the practices that no longer discriminate). The lever is **the task, not baseline isolation**: to
measure real lift, feed a *raw* input with the answer removed (e.g. the bug symptom with no
diagnosis) and check whether the model reaches the conclusion on its own. Baseline fails it, the
artifact-equipped candidate passes it, and Δ becomes large and honest. Both sides still get the
same raw input — the experiment stays controlled.

It runs N candidate + N baseline **sequentially** (subscription rate limits) and writes
`results/benchmarks/<timestamp>/benchmark.json` + `benchmark.md` (mean ± stddev / min / max per
config, the delta, a per-practice matrix, and analyst flags). **Skills/agents only** — it refuses
`workflow/` patterns (a "no artifact" baseline is meaningless for the systemic tier, which has its
own control-vs-treatment design).

### `eval:compare` — run-flip history

```bash
pnpm eval:compare            # last two runs from results/history.jsonl
pnpm eval:compare --list     # list recorded runs
```
Cheap and orthogonal; the `TrendReporter` keeps writing test-level outcome rows on every run.

### Environment variables

| Env var | Default | Meaning |
|---------|---------|---------|
| `EVAL_BACKEND` | `subscription` | runner: `subscription` (Claude Code) or `openrouter` — see [Runners](#runners-claude-code-default-vs-openrouter) |
| `EVAL_MODEL` | `claude-haiku-4-5` | model under test. Anthropic ID on `subscription`; OpenRouter slug on `openrouter` |
| `EVAL_JUDGE_MODEL` | `claude-sonnet-5` | judge model (stronger family); same slug-format rule as `EVAL_MODEL` |
| `OPENROUTER_API_KEY` | — | required when `EVAL_BACKEND=openrouter`; also in `~/.devdigest/secrets.json` |
| `OPENROUTER_BASE_URL` | OpenRouter | override to point at a local LiteLLM proxy for non-Anthropic tool-tier models |
| `EVAL_MAX_TURNS` | `8` | max agent turns per case |
| `EVAL_CONFIG` | `candidate` | `benchmark` sets this to `baseline` to skip artifact injection |
| `EVAL_QUIET` | unset | suppress per-run trace spam during multi-run aggregation |

## Records, statistics, flags

Every run appends one line to `results/records.jsonl` and the full model output to
`results/outputs/<run_id>/<slug>.md`. `results/` is gitignored and append-only — **deleting
`results/` is always safe**.

Record schema (`schema: 1`):

```jsonc
{ "schema": 1, "run_id": "...", "git_sha": "...", "dirty": false, "config": "candidate",
  "nodeid": "…/onion-architecture.eval.ts > skill:onion-architecture > review flags ...", "label": "...",
  "outcome": true, "score": 0.8, "threshold": 0.6,
  "practices": [ { "practice": "...", "passed": true, "evidence": "verbatim quote" } ],
  "grounded": 1, "num_turns": 1,
  "metrics": { "durationMs": 0, "inputTokens": 0, "outputTokens": 0, "toolCallCount": 0 },
  "trace": { "tools": [], "subagents": [], "skills": [], "reads": [] }, "output_file": "..." }
```

Statistics semantics:

- **Sample stddev** (n−1). n<5 is indicative only — the tools say so.
- **Practice identity is the practice text.** Reword a practice and you start a new statistics
  series by design (a practice is a prompt; a reworded prompt is a different measurement).
- **Empty ≠ zero.** A series with n=0 renders `—` and flags `missing_data`; a series of n>0 all
  failing renders `0%` and flags `always_failing`. The two are never conflated (this matters for
  grounding-gated tests at baseline, whose per-practice series is legitimately empty because the
  judge was skipped).

Analyst flags (benchmark): `non_discriminating` (100% in both configs), `always_failing` (0% in
both), `flaky` (pass rate strictly 20–80% within a config), `cost_regression` (candidate mean
tokens > 125% of baseline), `missing_data` (a config has zero records for a test/practice).

## Which change → which run

| Change | Run |
|--------|-----|
| A skill's `SKILL.md` (quick check) | `pnpm vitest run skills/<skill>` |
| A subagent file (quick check) | `pnpm vitest run agents/<agent>` |
| `CLAUDE.md` / activation / dispatch | `pnpm eval:workflow` |
| Any artifact's structure | `pnpm eval:quality` |
| A `SKILL.md` edit you want to **measure** | repeat/delta loop: `--label baseline` before, `--label candidate` after, then `eval:delta` |
| New skill/agent — is it **worth its tokens**? | `pnpm eval:benchmark skills/<skill> -n 5` |
| Adding evals for one of **your** skills/agents | `pnpm eval:scaffold <name>` (or `--agent <name>`) |
| Model / Claude Code version | `pnpm eval` (whole suite) |
| Stats math changed | `pnpm vitest run src/records/stats.test.ts` |

## Safety

Sessions run with `permissionMode: "bypassPermissions"`, so `workflowTask` keeps a **read-only
allow-list** (`Read, Grep, Glob, Task, Agent, Skill` — no `Bash`/`Write`/`Edit`). Don't copy the
bypass pattern into a context that grants write tools.

## Deferred (recorded so it isn't rediscovered)

- **Data-driven case DSL** — markdown case files + a `gray-matter` loader + `{{file:...}}`
  placeholders. `*.cases.ts` already carries the same fields as typed TS; convert to markdown only
  once the case count approaches ~15–20, when a parser earns its keep. `run*Cases` won't change.
- **`--baseline <git-ref>`** via git worktree — rejected; the repeat/delta label discipline gives
  version-vs-version comparison without worktree lifecycle risk.
