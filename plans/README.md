# plans/ — Implementation Plans

Implementation Plans for DevDigest features, authored by the **`implementation-planner`**
agent. Each plan is one file, `PLAN-NN-<kebab-feature>.md`, with a global `PLAN-NN` number.

A plan is the **hand-off artifact** between chats: the planner writes it here (read-only
otherwise), and the downstream `implementer` / reviewer chats **read it from this folder**
instead of re-deriving it. That is what makes the multi-chat, multi-agent flow cheap and
drift-free — the plan lives in a file, not in one chat's context.

A plan turns an approved **`SPEC-NN`** (see [`../specs/`](../specs/README.md)) into a task
graph: single-owner tasks, dependency order, per-task skill sets, and success checks. It
consumes the spec read-only and never edits it.

## Conventions

- **Number:** global sequence, zero-padded — `PLAN-01`, `PLAN-02`, …
- **Links to spec:** frontmatter `spec:` = the `SPEC-NN` this plan implements (or `—` if the
  work was planned without a spec).
- **Status:** `draft` → `approved` → `in-progress` → `done`.
- **Template:** start from [`TEMPLATE.md`](TEMPLATE.md).
- **Execution mode:** every plan records `multi-agent` (N parallel implementers) or
  `single-agent` (one sequential pass) — the user's confirmed choice.

See [`../.claude/agents/WORKFLOW.md`](../.claude/agents/WORKFLOW.md) for where a plan sits in
the full spec → plan → implement → review → verify pipeline.

## Index

<!-- implementation-planner appends one line per plan below: - [PLAN-NN Title](file.md) — spec — Status -->

- [PLAN-01 Project Context](PLAN-01-project-context.md) — SPEC-01 — done
- [PLAN-02 Why + Risk Brief](PLAN-02-why-risk-brief.md) — SPEC-02 — draft
- [PLAN-03 Eval Pipeline](PLAN-03-eval-pipeline.md) — SPEC-03 — draft
