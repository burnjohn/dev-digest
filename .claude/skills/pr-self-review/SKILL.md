---
name: pr-self-review
description: >
  PR self-review orchestrator for DevDigest. Runs before git push (PreToolUse hook) or on demand.
  Collects the git diff against origin/main, routes changed files into three buckets (UI Frontend,
  Backend/Domain, Tests), spawns one sub-agent per bucket, collects structured findings, deduplicates,
  and applies the merge gate: CRITICAL findings block the push. Non-critical findings are reported
  as HIGH / MEDIUM recommendations.
  TRIGGER when: "review my changes", "self review", "pr review", "check before push",
  "pr self review", "review pr", "check my diff", or automatically on PreToolUse(Bash git push).
  Does NOT cover: e2e tests (added later), vercel config, node_modules, migrations, vendor/.
---

# PR Self-Review

> **Перевір зміни локально до відкриття PR. Знайди критичні проблеми до того, як вони потраплять у ревью.**

## How to invoke

- **Manually:** "review my changes" / "pr self review" / "check before push"
- **Automatically:** fires on `PreToolUse` when a `git push` command is detected

## Setup (one-time)

Add the following to `.claude/settings.json` to enable the automatic `git push` hook:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash(git push*)",
        "hooks": [
          {
            "type": "prompt",
            "prompt": "Before executing this git push command, invoke the pr-self-review skill and follow its execution algorithm exactly."
          }
        ]
      }
    ]
  }
}
```

For manual invocation, no setup needed — just ask Claude to run the skill.

## Execution algorithm

### Step 1 — Collect diff

```bash
git diff $(git merge-base origin/main HEAD)...HEAD --name-only --diff-filter=AM
```

`--diff-filter=AM` — only Added and Modified files. Skip Deleted/Renamed.

### Step 1.5 — Diff size guard

Count total changed lines:

```bash
git diff $(git merge-base origin/main HEAD)...HEAD --stat | tail -1
```

- If **files > 50** OR **lines changed > 1000** → print a warning before the report:
  ```
  ⚠️  Large PR detected: N files, N lines changed.
  Consider splitting into smaller PRs for more accurate review.
  ```
  Continue the review regardless — this is a warning, not a blocker.

### Step 2 — Filter noise

Exclude the following from analysis (do not pass to sub-agents):

- `**/node_modules/**`
- `**/vendor/**` (but CHECK if `client/src/vendor/shared/contracts/` differs from `server/src/vendor/shared/contracts/` — see [severity-levels](rules/severity-levels.md))
- `**/migrations/**`
- `**/*.log`
- `**/*.md`
- `**/*.json`
- `e2e/**`

Also skip any **line** in a file that has the annotation:

```ts
// pr-self-review-ignore: <reason>
```

Do not report findings on that line. The reason is logged in the report footer as: `Ignored: file:line — reason`.

### Step 3 — Route files to buckets

See [file-routing](rules/file-routing.md) for exact rules.

| Bucket             | Pattern                                                                                  |
| ------------------ | ---------------------------------------------------------------------------------------- |
| **UI Frontend**    | `client/**/*.ts`, `client/**/*.tsx`, `client/**/*.css` (excluding `vendor/`, `*.test.*`) |
| **Backend/Domain** | `server/**/*`, `reviewer-core/**/*` (excluding `*.test.*`)                               |
| **Tests**          | `**/*.test.ts`, `**/*.test.tsx` (from any module)                                        |

If a bucket has zero files after filtering → skip that sub-agent entirely.

### Step 4 — Spawn sub-agents (fan-out, parallel)

Spawn **one sub-agent per non-empty bucket**. Each sub-agent receives:

1. Only its slice of the diff — **full `git diff` content** (not just file names) for each file in the bucket
2. Explicit skill rules extracted from each assigned skill file
3. The structured output schema (see Step 5)

**Diff format to pass to sub-agents:**

```bash
# Get full diff content for specific files only:
git diff $(git merge-base origin/main HEAD)...HEAD -- <file1> <file2> ...
```

If the total diff content exceeds ~8000 tokens, split into batches of files and spawn multiple sub-agents per bucket, merging their findings afterward.

**Sub-agent instructions template:**

```
You are a code reviewer for a Next.js 15 + Fastify + Drizzle project.

Invoke each of the following skills in order using the Skill tool, then apply their rules to the diff:
  1. Call the Skill tool with skill: "<skill-name>" — read its rules and check the diff against them
  [repeat for each skill in this bucket]

For each violation found, return a finding in this exact JSON format:
{ "file": "path/to/file.ts", "line": 42, "severity": "CRITICAL|HIGH|MEDIUM", "skill": "skill-name", "issue": "one sentence", "fix": "one sentence" }

Return ONLY a JSON array of findings. No prose. No explanations outside the array.
If no issues found, return [].

Changed files diff:
[FULL GIT DIFF CONTENT]
```

**Important:** The sub-agent must call the Skill tool for each assigned skill — it does not automatically know the rules unless it loads each skill file via the Skill tool. Listing skill names without calling the tool = no rules loaded = hallucinated review.

**Skill assignments per bucket:**

| Bucket         | Skills                                                                                                                                    |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| UI Frontend    | `frontend-architecture`, `react-best-practices`, `next-best-practices`, `typescript-expert`, `zod`, `security`                            |
| Backend/Domain | `onion-architecture`, `fastify-best-practices`, `drizzle-orm-patterns`, `postgresql-table-design`, `typescript-expert`, `zod`, `security` |
| Tests          | `react-testing-library`, `typescript-expert`                                                                                              |

### Step 5 — Collect and deduplicate findings

Collect findings arrays from all sub-agents. Deduplicate on `file + line`: if two skills report the same `file:line`, keep the one with higher severity; if equal severity, merge `issue` fields.

### Step 6 — Contract sync check

Run separately from sub-agents:

```bash
diff -r client/src/vendor/shared/contracts/ server/src/vendor/shared/contracts/
```

If any differences found → add a CRITICAL finding:

```json
{
  "file": "vendor/shared/contracts/[filename]",
  "line": 0,
  "severity": "CRITICAL",
  "skill": "pr-self-review",
  "issue": "Contract file differs between client and server vendor copies",
  "fix": "Sync the contract file to both client/src/vendor/shared/contracts/ and server/src/vendor/shared/contracts/"
}
```

### Step 6.5 — Test coverage gate

For each changed source file (UI Frontend + Backend/Domain buckets), check if a corresponding test file was also changed:

```
client/src/components/Foo.tsx changed?
→ look for client/src/components/Foo.test.tsx in the diff
→ if missing → HIGH finding
```

Finding format:

```json
{
  "file": "client/src/components/Foo.tsx",
  "line": 0,
  "severity": "HIGH",
  "skill": "pr-self-review",
  "issue": "Component changed but no test file updated",
  "fix": "Update or add Foo.test.tsx to cover the changes"
}
```

Skip this check for:

- Files in `lib/`, `i18n/`, `vendor/`, `contexts/`, `utils/`, `constants/`, `types/` — these are utilities/config, not components with required test coverage
- Next.js page files: `page.tsx`, `layout.tsx`, `loading.tsx`, `error.tsx`, `not-found.tsx` — framework files, not directly testable
- Files that are themselves test files
- Files where the entire file is new (Added) and no test exists yet → downgrade to **MEDIUM**
- Files with < 20 lines changed (minor edits unlikely to break existing tests)

### Step 6.6 — npm audit check

Run only if `package.json` appears in the raw diff (before noise filtering).

Run from the package directory that contains the changed `package.json`:

```bash
# If client/package.json changed:
cd client && npm audit --audit-level=high --json 2>/dev/null | head -50

# If server/package.json changed:
cd server && npm audit --audit-level=high --json 2>/dev/null | head -50

# If reviewer-core/package.json changed:
cd reviewer-core && npm audit --audit-level=high --json 2>/dev/null | head -50
```

If vulnerabilities with severity `high` or `critical` found → add one CRITICAL finding per vulnerability:

```json
{
  "file": "package.json",
  "line": 0,
  "severity": "CRITICAL",
  "skill": "security",
  "issue": "npm dependency has high/critical vulnerability: <package>@<version>",
  "fix": "Run npm audit fix or update <package> to a safe version"
}
```

If `npm audit` is not available or exits with non-JSON output → skip silently.

### Step 7 — Apply merge gate and output report

See [severity-levels](rules/severity-levels.md) for severity definitions.
See [output-format](rules/output-format.md) for exact report format.

**Merge gate:**

- `CRITICAL count > 0` → **BLOCKER** — do NOT execute `git push`, tell user to fix CRITICAL issues
- `CRITICAL count === 0` → **PASS** — execute `git push` (or allow user to proceed), show HIGH/MEDIUM as recommendations

### Step 8 — PR description generator (on PASS only)

After `✅ PASS`, automatically generate a PR description template based on the diff:

```
## What changed
<1-3 sentences summarizing the main change based on diff>

## Modules affected
- client/ — <summary of UI changes>
- server/ — <summary of backend changes>
- reviewer-core/ — <summary if changed>

## How to test
- [ ] <suggested manual test step based on changed files>

## Screenshots
<!-- Add screenshot or GIF of UI changes if applicable -->
```

Print this after the findings report under heading `### 📝 Suggested PR Description`.
Do not generate it if verdict is BLOCKER.

---

## Related skills (used by sub-agents, not directly)

| Skill                     | Bucket                       |
| ------------------------- | ---------------------------- |
| `frontend-architecture`   | UI Frontend                  |
| `react-best-practices`    | UI Frontend                  |
| `next-best-practices`     | UI Frontend                  |
| `react-testing-library`   | Tests                        |
| `onion-architecture`      | Backend/Domain               |
| `fastify-best-practices`  | Backend/Domain               |
| `drizzle-orm-patterns`    | Backend/Domain               |
| `postgresql-table-design` | Backend/Domain               |
| `typescript-expert`       | All buckets                  |
| `zod`                     | UI Frontend + Backend/Domain |
| `security`                | UI Frontend + Backend/Domain |
