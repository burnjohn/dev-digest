---
name: pr-self-review
description: "Reviews local, not-yet-pushed changes against this repo's own rules and issues a
  blocking verdict before a PR is opened. Use before `gh pr create`, `gh pr ready`, or `git push`;
  when the user asks 'review my changes', 'can I merge this', 'is this ready to push', 'check my
  work before the PR', or 'перевір мої зміни перед PR'. Scopes the diff (branch vs main merge-base
  plus staged, unstaged and untracked), routes each file to the repo's own skills, runs the
  CI-equivalent checks the change actually triggers, applies the H1-H18 hard rules, grounds and
  adversarially verifies every CRITICAL, then writes a gate file that decides whether the push may
  proceed. Use this even when the user only says 'I'm about to push'."
metadata:
  version: "1.0.0"
---

# pr-self-review

Answers exactly one question: **may this change be pushed?**

Not *what could be better about it* — that is `/code-review`, and this skill delegates to it
rather than reimplementing it. This skill owns scoping, routing, the deterministic pre-gate,
the H1–H18 hard rules, grounding, verification, the verdict, and the gate artifact.

`/code-review` tells you what is wrong. `pr-self-review` decides whether you may ship it.

**Why it exists:** DevDigest has no local gate before a push. There is no ESLint, Biome, or
Prettier in any of the four packages, no `lint` script anywhere, and no git hooks
(`.git/hooks/` holds only `.sample` files, `core.hooksPath` is unset, no husky, no
lint-staged). The only static check is `tsc --noEmit`, and it runs **in CI, after the PR is
open**. Meanwhile thirteen skills sit in `.claude/skills/` and fire by chance. This skill
closes both gaps: a critical defect should cost three local minutes, not a red CI run on an
open PR.

**Reference files** — read on demand, not up front:
- `references/routing-table.md` — the full path→skill→group map, match semantics, group definitions
- `references/mechanical-checks.md` — H1–H18 as copy-pasteable commands
- `references/report-template.md` — every report section, with the required shape of each

---

## 1. Scope

**In scope:** local changes not yet on a remote PR — the branch's commits against its
merge-base with `main`, plus staged, unstaged, and untracked files.

**Out of scope, hand these off:**

| Ask | Goes to |
|---|---|
| Review a PR number, a branch target, or a path | built-in `/code-review <target>` |
| Apply general quality fixes | `/simplify`, `/code-review --fix` |
| Post findings to an existing PR | `/code-review --comment` / `--post` |
| Deep multi-agent cloud review | `/code-review ultra` (user-triggered and billed — never launch it) |

If the user names a PR number, this skill is the wrong tool. Say so in one line and hand off.

**Flags:** `--fast` (skip everything Docker-dependent) · `--e2e` (add the hermetic e2e lane) ·
`--fix` (§10) · `--override "<reason>"` (§8) · `--since-last-review` (§10).

---

## 2. Phases

Five phases. Subagents run in phase 3 and nowhere else.

| Phase | Mode | Does |
|---|---|---|
| 0 | inline | scope the diff; check skill-catalog drift |
| 1 | inline | mechanical hard rules (§6) — pure git/grep, ~2s, no LLM |
| 2 | inline | deterministic pre-gate (§5) — typecheck/tests; **short-circuits** |
| 3 | **parallel** | one subagent per matched group |
| 4 | inline | grounding gate + adversarial verification of every CRITICAL |
| 5 | inline | report + write `gate.json` |

A failure in phase 1 or 2 stops the run before any LLM call. A type error makes the whole
review moot — learning that in 20 seconds for $0 beats learning it in 4 minutes for $0.40.

**Print the cost plan before phase 3 and let the user cancel it.** For example:
`8 groups · 81 files · ~8 subagent calls · est. 4 min`. A reviewer that quietly spends eight
agent calls is a reviewer the user disables.

---

## 3. Scoping the diff (phase 0)

**Use bash, not PowerShell.** The repo's own scripts are bash, and PowerShell 5.1 has no
`&&`. The repo root **contains spaces**: start each block with a quoted `cd` and never
construct `git -C $ROOT`.

Prefix every git call with `git --no-pager -c core.quotepath=false`. Without
`quotepath=false`, git octal-escapes non-ASCII paths and every glob in §4 silently misses
them.

```bash
BASE=$(git merge-base origin/main HEAD) \
  || BASE=$(git merge-base upstream/main HEAD) \
  || BASE=$(git merge-base main HEAD) \
  || BASE=HEAD
```

Do **not** use `--fork-point`: it depends on reflog and is empty on a fresh clone.

Four sources, unioned — the exact commands are in `references/mechanical-checks.md`:

```bash
git diff --name-status -M -C -z "$BASE" HEAD    # committed on the branch
git diff --name-status -M -C -z --cached        # staged
git diff --name-status -M -C -z                 # unstaged
git ls-files --others --exclude-standard -z     # untracked — the most-forgotten category
```

**Traps you must encode, not assume:**

- **`--name-status -z` emits renames as three NUL fields** (`R097`, old, new) and everything
  else as two. Parse **status-first**: read the status, then 2 paths if it starts with
  `R`/`C`, else 1. Getting this wrong silently corrupts the whole file list from the first
  rename onward.
- **Untracked is not a nicety.** On the current tree, `db/migrations/0011_quiet_patch.sql`
  is untracked while its `_journal.json` entry is committed — a plain `git diff` sees half
  the pair and reports a phantom.
- **Deletions (`D`)** route to skills but never to line-level review: there is no new side,
  and grounding would drop every finding anyway. They get one mechanical check instead —
  `grep -rn "<basename>" client/src server/src` for dangling references.
- **Binaries** — detect via `git diff --numstat -z` (row is `-<TAB>-<TAB><path>`) and
  exclude from LLM review.
- **`R100`** (pure move, no content change) — excluded from LLM review, **kept** for
  `frontend-ui-architecture`. A pure move is exactly that skill's question. The current tree
  has four (`client/src/components/showcase/` → `client/src/test/showcase/`).

**Diff content:** `git diff -M -C -U15`. Fifteen lines of context, not the default three —
a reviewer must see the enclosing function to judge a guard clause. In the same pass,
collect the set of **new-side line numbers** from each `@@ -a,b +c,d @@` header; that set is
the input to the grounding gate in §7.

**Branch-less mode.** When `HEAD == main`, the committed range is empty and the review runs
over working tree + index only. Say that out loud — never report "0 files" — and **offer to
create a branch**, because the user's literal workflow ("before every PR") is impossible
from `main`.

**Limits.** There is **no file-count or line-count ceiling.** A large diff is *batched*, never
truncated: split each group's files into chunks of ~25 and spawn one subagent per chunk (still
max 5 concurrent, still in group-priority order). The first push of a long-lived branch is
legitimately 80+ files, and a cap that turns "big" into "unpushable" only teaches `--override`.

The cap this replaced existed to stop a huge diff from being pushed out of a subagent's context
by the 4–6k lines of skill bodies loaded ahead of it (§4). Batching addresses that directly —
each agent sees ~25 files — so size alone no longer implies under-review.

`coverage: "partial"` means **files were actually not reviewed**: the time budget ran out, a
subagent died, or the user cancelled mid-run. It is never inferred from size. Only a genuine gap
blocks a green gate; a large diff where every file was routed and reviewed is `coverage: "full"`.

Print the batch count in the cost plan before phase 3 (§2) so an expensive run can still be
cancelled — consent replaces the cap.

---

## 4. Routing

Full table, group definitions, and match semantics: `references/routing-table.md`. The
summary:

| Glob | Skill | Group |
|---|---|---|
| `server/src/**/*.ts` (except `vendor/shared/**`, `*.test.ts`) | `onion-architecture` | BE |
| `server/src/{app,server}.ts`, `modules/*/routes.ts`, `modules/_shared/context.ts`, `platform/**` | `fastify-best-practices` | BE |
| `server/src/db/**`, `modules/*/repository*.ts`, `modules/*/repository/*.repo.ts` | `drizzle-orm-patterns` | DATA |
| `server/src/db/schema/**`, `db/migrations/**/*.sql` | `postgresql-table-design` | DATA |
| `client/src/**` (anything) | `frontend-ui-architecture` | FE |
| `client/src/app/**`, `client/next.config.*`, `lib/api.ts`, `src/i18n/**` | `next-best-practices` | FE |
| `client/src/**/*.tsx`, `client/src/lib/hooks/**` | `react-best-practices` | FE |
| `client/src/{app,components,vendor/ui}/**/*.tsx` | `web-design-guidelines`, `vercel-react-best-practices` *(global)* | FE |
| `client/src/**/*.test.{ts,tsx}`, `client/src/test/**` | `react-testing-library` | TEST |
| `**/vendor/shared/**`, or any file whose added lines contain `from 'zod'` | `zod` | CONTRACT |
| `**/tsconfig*.json`, `**/*.d.ts`, `**/vendor/shared/**`, files the pre-gate type-errored in | `typescript-expert` | CONTRACT |
| any `*.{ts,tsx,sql,sh,yml}` or `package.json` | `security` + built-in `security-review` | **SEC** |
| **any change at all** | built-in `code-review` | **CORRECT** |
| `*.md` whose added lines open a ` ```mermaid ` fence | `mermaid-diagram` | DOCS |

A file may match several rows; **every match activates**.

**The skip rule, stated once:** *a skill with no matching files is not loaded, not
mentioned, and its group is not spawned.* Cost is linear in the diff's footprint, not in the
catalog's size. But **skipped skills are listed in the report** with their reason — otherwise
the reader cannot tell "clean" from "not checked".

**SEC and CORRECT are an always-on floor.** They are what stops a diff touching only
`scripts/dev.sh` from getting no review at all.

### Execution model

Phase 3 spawns **one subagent per matched group** — or per ~25-file chunk of a group (§3) —
max **5 concurrent**. Priority, which is the dispatch order (and, if a run is cancelled or the
budget expires, decides what got covered first):

```
SEC → CORRECT → BE → DATA → CONTRACT → FE → TEST → DOCS
```

**Why not inline and sequential:** `onion-architecture` (417 lines) plus
`frontend-ui-architecture`, `security`, `react-best-practices`, `next-best-practices`, `zod`
and `typescript-expert` is 4–6k lines of skill body **before** the diff itself. On a real
change the diff gets pushed out of context. **Exception:** ≤3 files matching exactly one
group — review inline; spawning an agent for two lines is absurd.

### Subagent contract

Give each subagent exactly this:

- Load these skills, in this order: `<list>`. Treat them as **binding repo rules**, not advice.
- Read `<module>/INSIGHTS.md` for every module your files touch, and honour it. (§10.3)
- Your file subset is `<list>`. Review nothing outside it — another agent owns the rest.
- **Scope discipline:** report only what this diff introduced or worsened. A pre-existing
  problem the diff merely touched is **not** a finding — it goes in `context_notes`.
- Severity rubric: the verbatim block in §7. Anything speculative ("might be", "could
  potentially", "if this isn't handled elsewhere") is at most WARNING, **never** CRITICAL.
- Every finding must cite `file` plus `start_line`/`end_line` on the **new** side of the diff.
- You are **read-only**: do not run tests (phase 2 did), do not edit, do not touch git.
- Return exactly this JSON:
  `{group, skills_loaded, files_reviewed, findings[], context_notes[], coverage, coverage_note}`

`findings[]` is **field-for-field the `Finding` object** from
`server/src/vendor/shared/contracts/findings.ts:53` — same names, same enums (`severity`,
`category` ∈ `bug|security|perf|style|test`, `kind`, `confidence` ∈ [0,1]). That is the
point: a finding from this review pastes into the product's own pipeline unchanged, and
vice versa.

---

## 5. Deterministic pre-gate (phase 2)

Runs **before any LLM call**. Blast radius is taken straight from the `paths:` filters of
the five CI workflows, so a green pre-gate means the same suites CI will run have run here.

| Trigger in the diff | Command | Docker | Blocks? |
|---|---|---|---|
| `*/vendor/shared/**`, `scripts/sync-vendor.sh` | `./scripts/sync-vendor.sh --check` (repo root) | no | **yes** |
| `client/**`, `server/src/vendor/shared/**` | `cd client && pnpm typecheck && pnpm test` | no | **yes** |
| `server/**`, `reviewer-core/**` | `cd server && pnpm typecheck` + `pnpm exec vitest run --exclude '**/*.it.test.ts'` | no | **yes** |
| `server/**`, `reviewer-core/**` | `cd server && pnpm exec vitest run .it.test` | **yes** | yes if Docker is up, else SKIP |
| `reviewer-core/**`, `server/src/vendor/shared/**` | `cd reviewer-core && npm run typecheck && npm test` | no | **yes** |
| `client/**`, `server/**`, `reviewer-core/**`, `e2e/**` | `cd e2e && npm run typecheck` | no | yes |
| same | `cd e2e && npm run e2e:hermetic` | **yes** | only under `--e2e` |

- **`client` and `server` use pnpm. `reviewer-core` and `e2e` use npm.** Run every command
  from *inside* the package — there is no root `package.json`.
- **The fan-out is asymmetric on purpose.** A change under `server/src/vendor/shared/**`
  triggers **four** suites. Contract edits are the expensive case by design.
- **Docker:** probe with `docker info` (2s timeout). Down ⇒ `server-integration` and
  `e2e:hermetic` go to `checksSkipped` with a reason and **do not block**. The integration
  tests already self-skip via `dockerAvailable()`; forcing them would produce a green no-op.
- **Budget: 5 minutes.** Past it, stop and set `coverage: "partial"`. `--fast` skips every
  Docker-dependent lane up front.

### Do not suggest

Every generic review skill will try to recommend these. All of them are wrong here:

- **"Run the linter."** There is no linter. No ESLint, no Biome, no Prettier, no `lint`
  script in any of the four packages. Do not suggest adding one as a review finding either —
  that is a repo-wide decision, not a PR comment.
- **`docker compose down -v`** — ever, against the dev stack. `-v` deletes the
  `devdigest_pgdata` volume and every imported repo and review with it.
- **`pnpm db:migrate`** as part of a review. Migrations are manual by design and are not
  applied on boot; a review must not mutate the developer's database. Mention it in the
  draft PR description's Notes instead.
- **Hand-editing a lock file.** `pnpm-lock.yaml` and `package-lock.json` are regenerated by
  the package manager only.

---

## 6. Mechanical hard rules (phase 1)

No LLM. Every rule is a boolean over paths and diff text, so each fires with
`confidence: 1.0` and **skips** the adversarial pass in §7 — there is nothing here to
hallucinate. Full commands: `references/mechanical-checks.md`.

| ID | Rule | Sev |
|---|---|---|
| H1 | Contract drift — `sync-vendor.sh --check` exits non-zero | CRITICAL |
| H2 | `client/src/vendor/shared/**` changed **and** not in sync with canonical | CRITICAL |
| H3 | Lock file changed with no `package.json` change in the same package | CRITICAL |
| H4 | DB-backed `server/**/*.test.ts` not named `*.it.test.ts` — lands in the hermetic lane and fails CI | CRITICAL |
| H5 | `*.it.test.ts` with no pg/testcontainers import — clutters the Docker lane | WARNING |
| H6 | Secret literal in added lines (`sk-…`, `ghp_[A-Za-z0-9]{36}`, `github_pat_`, `BEGIN … PRIVATE KEY`, `AKIA…`, `<KEY>=` with a value) | CRITICAL, `kind: secret_leak` |
| H7 | `secrets.json` anywhere, or anything under `.devdigest/` except `cache/` | CRITICAL |
| H8 | Committed runtime data — `clones/`, `test-results/`, `.next/`, `coverage/`, `node_modules/` | CRITICAL |
| H9/H10 | Migration `.sql` without a `_journal.json` entry, or the reverse | CRITICAL |
| H11 | An **existing** migration modified (status `M`, not `A`) — already applied to `devdigest_pgdata` | CRITICAL |
| H12 | `process.env` added under `modules/**`, or in `platform/` outside `config.ts` | WARNING |
| H13 | `reviewer-core/dist/**` — the engine is consumed as TypeScript source | CRITICAL |
| H14 | A root `package.json` or `pnpm-workspace.yaml` — four standalone packages by design | CRITICAL |
| H15 | Cross-package relative import (`../../server/`, `../../client/`) instead of a tsconfig alias | CRITICAL |
| H16 | `docker compose down -v` added to a script or doc | CRITICAL |
| H17 | `INSIGHTS.md` lines removed — the file is append-only | WARNING |
| H18 | Skill-catalog drift — a skill folder with no README row, or a `skills-lock.json` entry with no folder | WARNING |

**H1–H3, H6–H8 and H13–H16 apply to untracked files too** — which is why §3 unions in
`ls-files --others`. A forgotten `secrets.json` that was never `git add`ed is the most likely
real H7, and no `git diff` will ever show it.

**H2 is narrower than it looks, deliberately.** It fires only when `sync-vendor.sh --check`
*fails*. A byte-identical client copy is by definition the script's output and cannot be
distinguished from one — flagging it would make H2 fire on every correct contract change, and
a false CRITICAL on the user's most common multi-package edit is how `--override` becomes a
habit. See `references/mechanical-checks.md` § H2 for the tree evidence.

---

## 7. Severity, the CRITICAL gate, and false-positive defence

### The rubric is a quotation, not an invention

Reproduced verbatim from [`docs/agent-prompts/general-reviewer.md`](../../../docs/agent-prompts/general-reviewer.md),
so that the self-review and the product's own reviewer cannot drift apart:

> - **CRITICAL** — a defect that, once merged, can cause a security breach, data
>   loss/corruption, incorrect results, a crash, or a broken contract that callers
>   depend on. This is the ONLY level that blocks merge.
> - **WARNING** — a real problem worth fixing that does not block: a missed edge
>   case, degraded behaviour, or a maintainability/perf risk that bites at scale.
> - **SUGGESTION** — a minor improvement or nit; the PR is safe to merge without it.
>
> Assign the severity you would defend to the author's face. Do NOT inflate: a
> speculative issue ("might be", "could potentially", "if X isn't already handled
> elsewhere") is at most a WARNING, never CRITICAL. If you would dismiss your own
> finding as a likely false positive, do not report it at all.

Three levels — `CRITICAL`, `WARNING`, `SUGGESTION`. Not high/medium/low. This is the
`Severity` enum at `findings.ts:11`; speak the product's language rather than inventing one.

**The verdict is a pure function of the findings** (`Verdict` at `findings.ts:26`):
any CRITICAL ⇒ `request_changes`; only WARNING/SUGGESTION ⇒ `comment`; nothing ⇒ `approve`.
Never `request_changes` with an empty list; never `approve` while reporting a CRITICAL.

### BLOCKED if any of these hold

1. A verified CRITICAL survived the two mechanisms below.
2. A mechanical check in §6 **failed** (boolean, not judgement — `confidence: 1.0`, exempt
   from verification).
3. The deterministic pre-gate in §5 **failed**.

**Does not block:** WARNING/SUGGESTION only, or a check that was **skipped** rather than
failed (Docker absent). A skip is reported loudly and blocks nothing. *A gate that cannot be
earned gets ripped out by the root.*

### Mechanism 1 — the grounding gate (mechanical)

Ported from [`reviewer-core/src/grounding.ts`](../../../reviewer-core/src/grounding.ts).
Applied before a finding is counted:

- Drop it if `finding.file` is not in the changed-file set.
- Drop it if `[start_line, end_line]` does not intersect the new-side line set — **by
  iterating the diff's lines, not the model's range.** The comment at `grounding.ts:44`
  explains why: `start_line`/`end_line` come from untrusted model output, so walking
  `[lo..hi]` lets one finding with `end_line: 2_000_000_000` hang the loop. The diff is
  bounded; the claimed range is not.
- `kind ∈ {secret_leak, lethal_trifecta, phantom, hook}` is **exempt from the line check** —
  file presence is enough. This is `FULL_FILE_KINDS` at `grounding.ts:16`, copied as-is.

Dropped findings go to the report's `Dropped (ungrounded)` section **with their reason** —
visible, never swallowed. That table is the instrument that reveals a misbehaving subagent.

### Mechanism 2 — the adversarial pass (LLM, inline, per surviving CRITICAL)

The parent agent re-checks each one **with no skills loaded**:

1. **`Read` the real file** at the cited range **±40 lines**, from disk — not from the diff.
   A diff hides the mitigation living thirty lines above the hunk.
2. **`Grep` for the guard the finding claims is missing** — the validator, the `await`, the
   authz check, the `??`.
3. Three questions; **all three** must be yes:
   - **Mechanism** — name the concrete input that triggers the wrong behaviour. "Could be
     unsafe" is a failure.
   - **Introduced here** — does the `+` side introduce or worsen it, or was it already true
     at `BASE`? Already true ⇒ demote to `context_notes`.
   - **Not handled elsewhere** — is there a guard anywhere on the path? If yes, drop it.
4. **Any doubt ⇒ demote to WARNING** with the verification note attached. Does not block.
5. **Confidence floor:** a finding with `confidence < 0.7` cannot be CRITICAL. Full stop.

Every surviving CRITICAL carries a one-sentence `**Verified:**` line in the report saying
what was read, what was grepped, and whether it was introduced here. A CRITICAL without that
line has not been verified and must be demoted before the report is written.

### The position that settles every borderline case

**A hallucinated CRITICAL costs more than a missed one.** A false block teaches the user to
reach for `--override`, and after the third time the gate is decorative. A missed problem
costs one review comment. When the two errors are not symmetric, do not treat them as if
they were.

---

## 8. The blocking mechanism

Three layers. All three are needed — layer (i) alone is persuasion, not enforcement, and it
evaporates between sessions.

### (i) The skill's verdict

On `request_changes`, do not run `gh pr create`, `gh pr ready`, or `git push` for this
branch. Cheap, honest, zero installation.

### (ii) The gate artifact — memory

`.devdigest/cache/pr-self-review/gate.json` (already git-ignored via `.devdigest/cache/`):

```json
{ "schemaVersion": 1, "verdict": "request_changes", "branch": "…",
  "baseSha": "…", "headSha": "…", "workingTreeDigest": "sha256(…)",
  "reviewedAt": "…", "coverage": "full", "criticalCount": 2, "criticals": [],
  "checksRun": [], "checksSkipped": [{ "id": "…", "reason": "docker daemon not reachable" }],
  "reportPath": "…", "override": null }
```

**Freshness is the whole point.** A gate keyed only on `headSha` is trivially defeated: fix
nothing, amend nothing, and the green gate still stands. So the key is `headSha` **plus**
`workingTreeDigest`, a sha256 over five parts — `git status --porcelain=v2 -z`, `git diff`,
`git diff --cached`, the untracked path list (`git ls-files -o --exclude-standard -z`), and
those paths' blob hashes (`git hash-object --stdin-paths`).

Both diffs are required, and this was verified rather than assumed: `--porcelain=v2` reports
the HEAD and index blob hashes but **not** the worktree content hash, so editing an
already-modified file leaves the status output byte-identical. Without the diffs in the
digest, the most common edit in a fix cycle would be invisible.

The last two parts cover **untracked** files, which the first three miss entirely — the same
bug one ring out, and also verified rather than assumed. Both diffs ignore untracked files;
`--porcelain=v2` emits a bare `? <path>` with **no** blob hash; and default `-unormal`
collapses a wholly-untracked directory to a **single** entry, so adding a file inside one
does not move the digest either. That is fail-open on exactly the file class §3 goes out of
its way to scope in: stamp an `approve`, rewrite any untracked file completely, and the gate
still reads FRESH. Two notes for anyone changing this:

- `-uall` on the status call fixes only the directory collapse, **not** the missing content
  hash. It is not sufficient on its own.
- Both new parts are load-bearing. The path list alone leaves in-place rewrites invisible;
  the blob list alone leaves a pure rename invisible (same content, same set of hashes).

`--exclude-standard` keeps `.devdigest/cache/` out of the digest, which is load-bearing in
the other direction: if `gate.json` were hashed, writing a fresh gate would perturb the value
it had just recorded and *every* gate would read STALE.

**Do not compute the digest yourself.** Phase 5 stamps `gate.json` from the hook's own
implementation:

```bash
node .claude/hooks/pr-gate.mjs --digest    # → {"headSha":"…","branch":"…","workingTreeDigest":"…"}
```

Two implementations of one hash is one too many. When they disagree, the *only* symptom is
that every gate reads STALE forever, and nothing in the output says why — which is exactly
how the first version of this hook failed (see `README.md` → Verification).

Any edit ⇒ `STALE` ⇒ treated as "no gate". The consequence is intentional: after fixing a
finding you must re-run. That is why the `--fix` cycle in §10 is a necessity, not a luxury.

### (iii) The `PreToolUse` hook — enforcement

`.claude/settings.json` (a new file, **hooks block only**) registers a `Bash` matcher running
`node .claude/hooks/pr-gate.mjs`.

**The hook is Node, not bash — the most important decision here.** A `.sh` hook on Windows
depends on how the harness spawns it, and the repo root contains spaces: a shell hook is a
quoting bug waiting for its moment. Node is guaranteed present (four Node packages),
cross-platform, and parses JSON natively.

`pr-gate.mjs` behaviour:

1. Read the payload from stdin; take `tool_input.command`.
2. No match on `gh pr create` / `gh pr ready` / `git push` — allowing for `cd … &&` prefixes,
   `git -c …`, and env prefixes — ⇒ **exit 0, silently**. The hook must be invisible on
   99.9% of calls, or it gets deleted.
3. Match ⇒ read `gate.json`. Deny when it is absent; when `verdict === "request_changes"`
   without a valid override; or when `headSha`/`workingTreeDigest` disagree (STALE).

   **`approve` and `comment` both pass — only `request_changes` denies.** This follows
   directly from §7: a CRITICAL is "the ONLY level that blocks merge", and the verdict is a
   pure function of the findings, so `comment` means *WARNING/SUGGESTION only* — exactly the
   case §7 lists under "Does not block". Several mechanical rules (H3, H5, H12, H17, H18) are
   WARNING **by design** and must not stop a push.

   Use an allow-list (`new Set(['approve','comment'])`), not `!== 'request_changes'`, so an
   unknown or malformed verdict still fails closed.

   On a non-`approve` pass, or when `coverage` is `"partial"`, write one line to **stderr**
   saying so and allow. A silent allow is how a coverage gap becomes invisible; a *blocking*
   one is how the gate gets ripped out. Never write to stdout — the hook must stay silent on
   the happy path.

   > **Regression note, 2026-08-24.** This read `verdict !== "approve"` until a live run hit
   > it: a branch with zero CRITICALs and one WARNING (a stray `mcp/pnpm-lock.yaml`) was
   > refused a push. It survived because `pr-gate.test.mjs` covers `approve` and
   > `request_changes` but **never `comment`** — the third enum value was untested. The deny
   > branch was itself the evidence: on a `comment` verdict it renders "0 blocking issue(s)"
   > and "(see the report)", because it was written assuming criticals exist. **Any change
   > here needs a `comment` → ALLOW case in `pr-gate.test.mjs`.**
4. Deny via `permissionDecisionReason` carrying the verdict, the blocking CRITICAL titles,
   the report path, and the exact override command.
5. **Fail open on internal error.** If the script itself throws, exit 0 with a warning on
   stderr. A broken gate that bricks `git push` gets `settings.json` deleted within the hour,
   taking the working gate with it.

### Two escape hatches, both explicit

- `/pr-self-review --override "<reason>"` writes `override` into `gate.json`. The reason is
  **mandatory, ≥20 characters**. The override is bound to the same `workingTreeDigest`, so it
  dies the moment the code changes — you cannot override once and coast.
- Delete `.claude/settings.json`. Documented outright: *a gate you can only escape by a trick
  teaches people tricks.* Whoever wants out should leave through the door.

---

## 9. The report

Written to `.devdigest/cache/pr-self-review/report-<base7>-<head7>.md`; the chat gets the
banner, the counts, the CRITICAL titles, and the path. Full shape:
`references/report-template.md`.

Sections, in order — none optional, empty ones print `_none_`:

verdict banner → pre-gate table → hard-rules table → CRITICAL (each with its `**Verified:**`
line) → WARNING → SUGGESTION → **Pre-existing (not blocking)** → **Dropped (failed
grounding)** → **Coverage** → **Draft PR description**.

**Coverage is not decoration.** Without it the reader cannot distinguish *the frontend is
clean* from *nobody looked at the frontend* — and that distinction is the entire value of
routed review. It lists which skills ran, which were skipped and why, and which files were
not line-reviewed (binary, pure rename, deleted).

**The draft PR description** is close to free: the skill has already read the whole diff, so
the PR body costs nothing extra and is exactly what the user was about to type. Its test-plan
checkboxes are generated from the same blast-radius table as the pre-gate (§5), so the PR
body and the local gate can never disagree about what needed to run.

---

## 10. Beyond the minimum

1. **Changed-lines-only discipline, enforced twice** — in the subagent prompt *and*
   mechanically in the grounding gate. Without both, reviewing a 400-line file becomes
   reviewing the whole file and the signal drowns.
2. **Pre-existing problems go in a separate non-blocking bucket** (`context_notes`). Do not
   discard them — a reviewer who sees real rot may say so. But they do not touch the verdict.
   This is what stops *"I touched the file, so I now own its entire history."*
3. **Read the touched module's `INSIGHTS.md` before reviewing** and pass the relevant entries
   into each subagent's prompt. AGENTS.md already requires this for *writing* code; a reviewer
   who ignores logged gotchas will rediscover every one of them. It is also the cheapest
   false-positive reduction available — `server/INSIGHTS.md` already documents traps a naive
   reviewer would flag wrongly.
4. **The `--fix` cycle.** After a blocked run, `/pr-self-review --fix` applies fixes for
   **CRITICAL only** and **must** re-run the whole gate — `workingTreeDigest` just changed, so
   by construction the gate is STALE. Never auto-fix WARNING or SUGGESTION; that turns review
   into uninvited refactoring.
5. **Cost limits declared up front.** Max 5 *concurrent* subagents, ~25 files per subagent,
   5-minute pre-gate, with `--fast` to skip the Docker lanes. There is no cap on total files or
   lines (§3) — a big diff costs more batches, not less coverage. Print the plan before
   spending, so an expensive review can be cancelled.
6. **Skill-catalog drift detection in phase 0.** The catalog is demonstrably stale
   (`skills-lock.json` lists `architecture-patterns` and `github-workflow-automation` with no
   folders), and a router that trusts a stale catalog routes files to skills that no longer
   exist. WARNING once per session, not once per run.
7. **`engineering-insights` at the tail** — but hard-gated. Invoke it only after a run that
   produced a CRITICAL, an override, or a mechanical failure. Ungated, it yields one padding
   entry per review, which that skill's own "never pad" rule forbids.
8. **`--since-last-review`.** `gate.json` keeps the previous `workingTreeDigest`; on re-run,
   review only what changed since, carrying unresolved findings forward. Turns the fix cycle
   from O(full review) into O(delta).
9. **Non-`main` base detection.** Alongside `origin` there is `upstream`
   (`ai-agentic-engineering-neo/dev-digest`). A PR to `upstream` has a different merge-base.
   Ask once, cache the answer in `gate.json`.

---

## 11. Adjacent, not covered here

**Complement and delegate — never duplicate.**

This skill owns: diff scoping, routing, the deterministic pre-gate, H1–H18, grounding +
verification, the verdict, `gate.json`, and the push block. It delegates general bug hunting
to the built-in **`code-review`** (group CORRECT) and vulnerability hunting to the built-in
**`security-review`** (group SEC, beside the `security` skill). The SEC and CORRECT rows in
the routing table *are* that delegation.

This file contains **zero** generic bug taxonomy — no "check for off-by-one", no OWASP list.
That knowledge already lives in three places (`docs/agent-prompts/*.md`, the `security`
skill, the built-in `code-review`), and a fourth copy would drift within a month.

Explicit non-conflicts:

- **`/code-review <target>`** (a PR number, a branch) stays with the built-in. This skill
  reviews only local, unopened changes. A PR number named ⇒ hand off.
- **`/code-review --fix` and `/simplify`** remain the change-applying tools.
  `pr-self-review --fix` is a thin wrapper that fixes CRITICAL only and re-gates.
- **`--comment` / `--post`** publish into a PR that exists. By definition this skill runs
  before that.
- **`/code-review ultra`** is user-triggered and billed. Never launch it; mention it if the
  user wants depth this skill does not provide.
