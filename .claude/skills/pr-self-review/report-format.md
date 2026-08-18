# Output format

Two artifacts per run, both under `.claude/pr-review/` (gitignored):

| File                  | Consumer                        |
| --------------------- | ------------------------------- |
| `<sha>.json`          | `scripts/pr-gate.sh` (machine)  |
| `<sha>.pr.md`         | the human, as a PR body draft   |

Plus the terminal summary, which is written for the person, not the gate.

---

## 1. Verdict file — `.claude/pr-review/<sha>.json`

`<sha>` is the full `git rev-parse HEAD`. The gate refuses a file whose `sha` or
`worktree_hash` does not match the current state — that binding is the whole
mechanism, since it is what stops a `PASS` earned on one set of changes from
being spent on another.

```jsonc
{
  "schema": 1,
  "sha": "c6160d9…",                 // git rev-parse HEAD
  "worktree_hash": "9f2a…",          // MUST come from: scripts/pr-gate.sh --worktree-hash
  "branch": "HW_L02",
  "base": "512f309…",                // git merge-base main HEAD
  "verdict": "PASS",                 // "PASS" | "BLOCKED"
  "generated_at": "2026-08-14T09:31:02Z",

  "zones": ["client", "server"],     // activated zones (routing.md §1)
  "skills_run": ["react-best-practices", "onion-architecture", "…"],
  "skills_skipped": [
    { "skill": "postgresql-table-design", "reason": "no schema changes in diff" }
  ],
  "suites_deferred": [
    { "suite": "e2e", "reason": "runs in CI — too slow for a pre-PR gate" }
  ],
  "suppressed": [
    { "rule": "A2.2", "file": "client/src/vendor/ui/Button.tsx", "reason": "…", "via": "baseline" }
  ],
  "truncated": null,                 // or "42 of 137 files reviewed — diff over budget"

  "counts": { "CRITICAL": 0, "WARNING": 3, "SUGGESTION": 5 },
  "findings": [ /* Finding[] — see below */ ]
}
```

`worktree_hash` **must** be produced by `scripts/pr-gate.sh --worktree-hash`, not
recomputed by hand. The skill and the gate have to agree byte-for-byte, so the
definition lives in exactly one place.

### Finding

The shared `Finding` from
[`server/src/vendor/shared/contracts/findings.ts`](../../../server/src/vendor/shared/contracts/findings.ts),
plus three local fields. Reusing the shared shape is deliberate: the same
severity vocabulary drives the CI gate, so local and CI verdicts are comparable
rather than merely similar.

```jsonc
{
  // --- shared Finding ---
  "id": "f_01",
  "severity": "CRITICAL",            // CRITICAL | WARNING | SUGGESTION
  "category": "security",            // bug | security | perf | style | test  (+ "build" for Stage A)
  "title": "Path traversal via repoId reaches fs.readFile",
  "file": "server/src/modules/repo/routes.ts",
  "start_line": 88,
  "end_line": 94,
  "rationale": "…markdown…",
  "suggestion": "…markdown…",        // nullable
  "confidence": 0.9,                 // 0..1

  // --- pr-self-review additions ---
  "source": "security",              // skill name, or a conventions.md rule id ("A2.4")
  "stage": "B",                      // "A" deterministic | "B" skill review
  "verified": { "attempts": 2, "upheld": 2 }  // null for stage A and non-critical
}
```

Rules the writer must hold to:

- `start_line`/`end_line` **must** intersect a real diff hunk. This mirrors the
  citation-grounding gate in `reviewer-core` — an ungrounded finding is dropped
  in Stage C, not reported.
- `category: "build"` is local-only, for Stage A toolchain failures. Never send
  it to a `@devdigest/shared` consumer.
- Only `severity: "CRITICAL"` blocks. `verdict` is `BLOCKED` iff
  `counts.CRITICAL > 0` — the equivalent of `ci_fail_on: "critical"`, the default
  in [`knowledge.ts`](../../../server/src/vendor/shared/contracts/knowledge.ts).

---

## 2. Terminal summary

```
PR SELF-REVIEW — HW_L02 → main
23 files · 2 zones · 7 skills · 41s

BLOCKED — 1 critical

  CRITICAL  security   server/src/modules/repo/routes.ts:88
            Path traversal via repoId reaches fs.readFile
            [security] confidence 0.90 · verified 2/2

  WARNING   style      client/src/app/page.tsx:12
            Effect re-runs on every render (missing dep array)
            [react-best-practices] confidence 0.70
            … 2 more warnings, 5 suggestions — see .claude/pr-review/<sha>.json

  Stage A   contracts ✓  client:typecheck ✓ lint ✓ test ✓  server:typecheck ✓ lint ✓ test ✓

  Skills    onion ✓ · fastify ✓ · security ✗1 · react ⚠1 · next ✓ · ts ✓ · frontend-ui ✓
  Skipped   drizzle, postgresql (no schema changes) · RTL (no tests in diff) · e2e (runs in CI)
  Suppressed  1 via baseline (A2.2 client/src/vendor/ui/Button.tsx)

  Fix the critical, then re-run. To override: PR_SELF_REVIEW_SKIP=1
```

Three lines carry more weight than they look:

- **`Skipped`** — without it there is no way to tell "checked and clean" from
  "never ran", and those mean very different things when a merge is on the line.
- **`Suppressed`** — a baseline that grows in silence is a gate that has been
  switched off one entry at a time.
- **`truncated`** — if the diff exceeded budget, say what was not covered.
  Silent truncation reads as full coverage.

## 3. PR body draft — `.claude/pr-review/<sha>.pr.md`

The run already has the analysed diff, so this is nearly free. Sections:

```markdown
## What changed
<2–5 bullets, grouped by zone>

## Why
<intent, inferred from the diff and branch name; mark as a guess if unsure>

## Risk areas
<files a reviewer should read first, and why — from the findings>

## How to verify
<the commands Stage A ran, plus any manual step the diff implies>

## Not covered
<deferred suites, truncation, suppressions>
```

Never invent a ticket number, a rollout plan, or a test that was not run. An
unverifiable claim in a PR body is worse than an empty section.
