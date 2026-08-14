# Skill detail — tabs

**Status:** shipped (phases 1–2; Evals is its own future lesson, per Scope — out)
**Packages touched:** server, client
**Follows:** `specs/01-skills.md` (shipped)

## Problem

The Skills design changed after `01` shipped. The page is no longer a card grid
with a side preview — it is a **list plus a detail panel with five tabs**:
Config · Preview · Evals · Stats · Versions.

Most of it is presentation over data that already exists. One tab is not: three
of the four numbers on **Stats** cannot be computed at all today, and shipping
the panel without saying so would put invented figures on screen.

## What already exists

Worth stating, because it is most of the work:

- **Every chart the design needs is vendored and unused.** `MetricCard` (KPI tile
  with delta + sparkline), `Donut`, `CircularScore` (the ring on ACCEPT RATE),
  `ProgressBar`, `LineChart`, `Sparkline`, `Card` — all in
  `client/src/vendor/ui/charts/` and `primitives/`, referenced only by
  `components/showcase/Showcase.tsx`.
- **Versions has its endpoint already**: `GET /skills/:id/versions` over the
  `skill_versions` table, written by `01`.
- **Used-by has its endpoint already**: `GET /skills/:id/agents`.
- `formatTokenCount` (`client/src/lib/format.ts:40`) and `estimateTokens`
  (`reviewer-core/src/prompt.ts`) cover the editor's "166 tokens" read-out.
- `eval_cases.owner_kind` is already `'skill' | 'agent'`, and `EvalDashboard` /
  `EvalCaseInput` / `EvalRunRecord` are already written in
  `contracts/eval-ci.ts` — the Evals tab has its schema, just no implementation.

## The data gap

**PULL FREQUENCY, ACCEPT RATE, FINDINGS (30D) and FINDINGS BY CATEGORY are not
answerable with SQL today.** Two independent reasons:

1. **No record of which skills were in which run.** The trace stores
   `prompt_assembly.skills` as the *concatenated markdown bodies* inside the
   `run_traces.trace` jsonb — no ids, no names (`contracts/trace.ts`). There is
   no `run_skill_links` table.
2. **A finding does not know which skill produced it.** `findings` has
   `severity`, `category`, `accepted_at`, `dismissed_at` and no skill column
   (`db/schema/reviews.ts`).

### Decision — record the link, and label the metric honestly

Add `run_skill_links`, written where `run-executor` already resolves the agent's
skills. That makes pull frequency real and makes "findings produced by runs that
included this skill" real.

It does **not** make per-skill accept rate causal, and the UI must not pretend
otherwise. The number is *accept rate of findings from runs in which this skill
was in the prompt* — an association. A skill sitting in the prompt beside four
others gets credit for all five's findings. The tile is labelled accordingly and
the tooltip says so.

**Rejected:** attributing each finding to the skill that triggered it. It needs a
`Finding.skill_id` in the contract, a prompt change on every agent asking the
model to name the rule it applied, and models do that unreliably — a
confidently-wrong number is worse than an honestly-approximate one.

### Metric definitions (write these into the tooltips)

| Tile | Definition |
| --- | --- |
| USED BY | `count(agent_skills WHERE skill_id = :id)` — exact |
| PULL FREQUENCY | runs that included this skill ÷ runs by agents that link it, over the window. Drops when the skill is globally disabled — that is the point |
| ACCEPT RATE | `accepted / (accepted + dismissed)` over findings from runs that included this skill. **Association, not attribution** |
| FINDINGS (30D) | findings from runs that included this skill, in the window |
| FINDINGS BY CATEGORY | the same set, grouped by `findings.category` |

## Contract changes

`@devdigest/shared` first, then both vendored copies via
`scripts/check-contracts.sh --fix`.

- `contracts/observability.ts` — new `SkillStats` (`used_by_agents`,
  `runs_with_skill`, `runs_total`, `pull_rate`, `findings_total`, `accepted`,
  `dismissed`, `pending`, `accept_rate`, `findings_by_category[]`,
  `window_days`). Modelled on the existing `AgentStats`, which is the same shape
  one level up.
- `contracts/knowledge.ts` — `Skill` gains read-only `used_by_agents`,
  `pull_rate`, `accept_rate` (all nullish) for the list-card footer.

## Scope — in / out

**In**

- `SkillDetail` with five tabs; tab state in `?tab=`, matching the agent editor.
- **Config** — the existing form plus a line-number gutter, the `<name>.md`
  filename chip, an `unsaved` badge (local body ≠ server body) and a live token
  estimate.
- **Preview** — rendered markdown, captioned "Rendered as the reviewing agent
  receives it".
- **Versions** — the history from `GET /skills/:id/versions`, each version
  viewable, with **restore** (a restore is a normal body update, so it creates a
  new version rather than rewriting history).
- **Stats** — `run_skill_links` + `GET /skills/:id/stats`, the four tiles, the
  agents list, and the category donut.
- The left column becomes a list; cards gain the `N agents · X% pull · Y% accept`
  footer.

**Out**

- **Evals.** The tab renders in the strip with an empty state saying it belongs
  to its own lesson, and `Run on evals` is hidden until then. Building it means
  case CRUD plus an execution path that scores recall/precision/citation — more
  work than everything above combined, and `eval_cases` is empty in the seed.
- The eight extra sidebar entries in the mockup (Onboarding Tour, Project
  Context, Conventions, Eval Dashboard, Memory, Multi-Agent Review, Agent
  Performance, CI Runs). Those are other lessons; `SKILLS LAB` already exists.
- Syntax highlighting in the editor. A gutter over the existing `Textarea` is
  ~40 lines and no dependency; CodeMirror is six packages and a jsdom mock for
  one input. A skill body is markdown prose, not code.
- Version **diffing**. There is no text-diff library in the client, and
  `components/diff-viewer` consumes a unified diff it would have to be given.
  View-and-restore first; diff if it is actually missed.

## Phases

Each phase is independently shippable and independently reviewable.

1. **Tab shell + Config + Preview + Versions.** No new data. Splits
   `SkillPreview` into `SkillDetail`, converts the grid to a list, adds the
   gutter/unsaved/token read-outs, and wires Versions to the endpoint that
   already exists.
2. **Stats.** Migration for `run_skill_links`, the write in `run-executor`, the
   grouped-query stats route, the tab, and the list-card footer. The only phase
   with a migration.
3. **Evals.** Its own lesson.

## Acceptance criteria

1. Tab state survives a reload and a browser back — `?tab=` is the source of
   truth, as in the agent editor.
2. The `unsaved` badge appears iff the edited body differs from the server's, and
   clears on save.
3. The token read-out uses the same `ceil(chars / 4)` estimate as the run trace,
   and is labelled an estimate.
4. Versions lists every recorded version newest-first; restoring an old body
   produces a NEW version rather than mutating history.
5. Disabling a skill makes its PULL FREQUENCY fall on subsequent runs — the tile
   reflects the kill switch, which is what makes it worth showing.
6. Deleting a skill removes its `run_skill_links` rows (FK cascade), and no stats
   query 500s on a skill with zero runs — every tile renders a `—`, not a `NaN`.
7. The ACCEPT RATE tile's tooltip states that it is association, not attribution.

## Open questions

- **Pull-frequency denominator.** "Runs by agents that link this skill" is the
  definition above, and it is the one that makes the number react to the enabled
  toggle. The alternative — all runs in the workspace — is easier to compute but
  reads as a popularity contest between unrelated agents. Revisit if the first
  one is confusing on real data.
- **`run_skill_links` retention.** Rows cascade on skill delete, so deleting a
  skill erases the history that would explain past runs. Acceptable while stats
  are per-skill (a deleted skill has no page); reconsider if a workspace-level
  dashboard ever needs to attribute historical cost.
- Whether the list-card footer should hide its stats entirely for a skill with no
  runs, or show `—`. Depends on how empty a fresh workspace looks; decide with
  the seeded data in front of us.
