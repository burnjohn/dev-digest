# specs/ — Spec-Driven Development specs

Feature specifications for DevDigest, authored by the **`spec-creator`** agent.
Each spec is one file, `SPEC-NN-<kebab-feature>.md`, with a global `SPEC-NN`
number. A spec captures *what* a feature must do and *why* — as EARS-testable
acceptance criteria — **before** it is planned (`implementation-planner`) or implemented
(`implementer`).

These are **feature specs** and are distinct from the per-module *reference* specs
(`server/specs/`, `client/specs/`, `reviewer-core/specs/`), which document contracts
and schemas that already exist.

## Conventions

- **Number:** global sequence, zero-padded — `SPEC-01`, `SPEC-02`, …
- **Status:** `draft` → `approved` → `implemented` (or `superseded`). Ownership of each
  transition: **`spec-creator`** sets `draft` (and flips a superseded spec to `superseded`);
  **the user** approves `draft → approved`; **`plan-verifier`** flips `approved → implemented`
  once every `AC-N` is verified MET against the code. No agent silently self-approves.
- **module tag:** frontmatter `module:` = primary module or `cross-cutting`.
- **Template:** start from [`TEMPLATE.md`](TEMPLATE.md).
- **Supersedes:** a spec that replaces another links it in `Supersedes:` and flips
  the old one's `Status:` to `superseded`.

## Index

<!-- spec-creator appends one line per spec below: - [SPEC-NN Title](file.md) — hook — Status -->
- [SPEC-01 Project Context](SPEC-01-project-context.md) — manual-attach repo markdown as untrusted `## Project context` that steers review agents; zero new LLM calls — implemented
- [SPEC-02 Why + Risk Brief](SPEC-02-why-risk-brief.md) — compact PR-page card assembled from L03 intent/smart-diff + L04 blast with exactly one grounded, per-PR-cached LLM call — approved
- [SPEC-03 Eval Pipeline](SPEC-03-eval-pipeline.md) — turn accepted/dismissed findings into a fixed regression dataset; run agents over it for code-computed recall/precision/citation (zero-LLM scoring) and compare prompt versions — draft
