---
name: dependency-checker
description: Analyzes all dependencies across the repo's packages (server, client, reviewer-core, e2e) and produces a structured report — a Mermaid dependency graph, an installed-size breakdown table, severity-tiered findings (P0/P1/P2/Info), and prioritized recommendations. Use when asked to audit dependencies, check what each package weighs, find unused, duplicated, or version-drifted packages, map cross-package imports, or decide which dependencies to remove or upgrade first.
allowed-tools: Read, Grep, Glob, Bash
---

# Dependency Checker

Audits the dependencies of this repo and its packages, then emits one structured report. The report always follows the same five sections so developers can scan any run the same way. The full skeleton is in [report-template.md](report-template.md) — fill it, do not invent a new layout.

## Non-negotiables

- **This is not a monorepo.** Packages (`server`, `client`, `reviewer-core`, `e2e`, plus `mcp`) share code via **TypeScript path aliases and relative imports**, not `workspace:*` / pnpm workspaces. Never describe them as workspace-linked.
- **Read-only.** Never run `npm/pnpm install`, edit a `package.json`, or delete a dependency. Removal and upgrades are always presented as recommendations for the user to confirm — never actions already taken.
- **Every finding is specific.** Name the exact package, version, and `package.json`/source file. No generic advice like "consider optimizing dependencies."
- **Diagram convention** — read [../mermaid-diagram/SKILL.md](../mermaid-diagram/SKILL.md) for syntax; always `flowchart` (never the deprecated `graph`).

## Workflow

### Step 1 — Scope

Find every first-party manifest (exclude `node_modules`):

```sh
find . -name package.json -not -path '*/node_modules/*'
```

List the packages you will analyze. If the user scoped the request to one package (e.g. "check server's deps"), analyze only that one and say so in Scope.

### Step 2 — Gather (do not guess — measure)

For each package, collect:

1. **Declared deps** — read each `package.json`; record `dependencies` vs `devDependencies` separately (with versions).
2. **Installed sizes** — `du -sh <pkg>/node_modules/<dep>` per top dependency (or `du -sh <pkg>/node_modules/* | sort -rh | head -20` for the heaviest). Record the number; never estimate.
3. **Internal (cross-package) edges** — grep for imports that cross a package boundary:
   - path aliases (e.g. `@shared/…`, `@devdigest/…`) — these are the *intended* internal API surface;
   - **relative or deep imports into another package's internals** (e.g. `server/…` importing `reviewer-core/src/…` directly instead of its public entry) — these are boundary violations.
   ```sh
   grep -rn "from ['\"]@" <pkg>/src        # alias imports
   grep -rn "reviewer-core/src" server/src # example: deep import into a package's internals
   ```
4. **Unused deps** — for each runtime dependency, grep its import specifier across that package's `src`. Zero import sites → candidate unused dependency (note the manifest location).
5. **Version drift** — the same package resolved at different versions across packages (e.g. `zod@3.23.8` in server vs `zod@3.22.4` in client).

### Step 3 — Classify findings by severity

| Tier | Meaning | Examples |
|---|---|---|
| **P0** | Correctness / architecture risk — fix first | deep import bypassing a package's public entry; a dependency two major versions behind with a known CVE; a runtime dep missing from `dependencies` (only in dev) |
| **P1** | Real cost or drift, no immediate breakage | version drift of the same package across packages; a heavy dependency (>50M installed or a large bundle contributor) with a lighter alternative; duplicated capability (e.g. `moment` + `date-fns`) |
| **P2** | Cleanup / hygiene | unused declared dependency; dep in the wrong list (`dependencies` vs `devDependencies`); pinned-vs-ranged inconsistency |
| **Info** | Context, not action | total install footprint per package; largest transitive contributors |

Every finding line: `**<package/dep>** — <what> (<where: file>). <why it matters>.`

### Step 4 — Emit the report

Fill [report-template.md](report-template.md) in order: **Scope → Dependency Graph → Size Breakdown → Findings & Priorities → Summary**. Do not skip a section; if a section has nothing, say so explicitly ("No version drift found") rather than omitting it.

## The five sections (contract)

1. **Scope** — which packages were analyzed, and the note that this repo is not a workspace monorepo.
2. **Dependency Graph** — a fenced ` ```mermaid ` `flowchart` showing packages as nodes, internal edges between them (label alias vs deep-import), and the heaviest external deps hanging off each package.
3. **Size Breakdown** — a table (`Package | Dependency | Type | Installed size | Note`) plus a per-package total. Sorted heaviest-first.
4. **Findings & Priorities** — findings grouped under `### P0`, `### P1`, `### P2`, `### Info` headings. Never an unranked bullet list.
5. **Summary** — 3–5 concrete, actionable takeaways ordered by priority (P0 first). Each names a package/file and a concrete next step ("remove `moment` from `server/package.json` after confirming no runtime use").

## Quality checks before you output

- [ ] All five sections present and in order.
- [ ] The graph is a real ` ```mermaid ` `flowchart` block, not prose.
- [ ] Size table has actual `du` numbers, not adjectives.
- [ ] Every finding carries a P0/P1/P2/Info tier and names a specific package/file.
- [ ] Internal (alias) deps are distinguished from external npm deps.
- [ ] No claim of `workspace:*`/pnpm workspaces.
- [ ] No dependency was installed, edited, or removed — only recommended.

<!-- ci-trigger: exercise skill-tier eval (content); no semantic change -->
