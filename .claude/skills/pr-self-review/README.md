# pr-self-review

Answers one question: **may this change be pushed?**

Not what could be better about it — that is `/code-review`, and this skill delegates to it
rather than reimplementing it.

> `/code-review` tells you what is wrong. `pr-self-review` tells you whether it is ready to ship.

**As of 2.0.0 this skill enforces nothing.** It is invoked by hand and returns a verdict; the
`gate.json` artifact and the `PreToolUse` hook that once denied `git push` are gone. See the
changelog for why.

- `SKILL.md` — the rules (loaded when the skill triggers)
- `references/routing-table.md` — the path→skill→group map, match semantics, worked example
- `references/mechanical-checks.md` — H1–H18 as copy-pasteable commands
- `references/report-template.md` — every report section with its required shape

Scope is **local, not-yet-pushed changes**. A PR that already exists belongs to the built-in
`/code-review <target>`.

---

## Why this exists

DevDigest has **no local gate before a push**, and this was checked rather than assumed:

- No ESLint, Biome, or Prettier, and no `lint` script in any of the four packages.
- No git hooks — `.git/hooks/` holds only `.sample` files, `core.hooksPath` is unset, and
  there is no husky or lint-staged.
- The only static check is `tsc --noEmit`, and the five workflows run it **in CI, after the
  PR is open**.

At the same time thirteen skills sit in `.claude/skills/` and fire by chance — whichever one
the agent happens to remember. Nothing routes a diff to the skills that govern it.

This skill closes both gaps. A critical defect should cost three local minutes, not a red CI
run on an open PR.

---

## The position it takes

- **Three severity levels, quoted not invented.** `CRITICAL` / `WARNING` / `SUGGESTION` — the
  `Severity` enum at `findings.ts:11`. The rubric is reproduced verbatim from
  `docs/agent-prompts/general-reviewer.md` so the self-review and the product's own reviewer
  cannot drift apart.
- **Findings are `Finding` objects**, field for field, enum for enum. A finding from this
  review pastes into the product's pipeline unchanged, and vice versa.
- **A hallucinated CRITICAL costs more than a missed one.** A false block teaches the user to
  discount the verdict; after the third time the review is decorative. A missed problem costs
  one review comment. Two defences follow from that asymmetry: the mechanical grounding gate
  ported from `reviewer-core/src/grounding.ts`, and an adversarial re-check of every surviving
  CRITICAL with no skills loaded.
- **Deterministic checks before any LLM call.** A type error makes the whole review moot;
  learning that in 20 seconds for $0 beats learning it in 4 minutes for $0.40.
- **Skipped ≠ failed.** Docker down means the check is reported as skipped, loudly, and blocks
  nothing. A verdict that cannot be earned gets ignored.
- **Zero generic bug taxonomy.** No off-by-one checklist, no OWASP list. That knowledge lives
  in `docs/agent-prompts/*.md`, the `security` skill, and the built-in `code-review`; a fourth
  copy would drift within a month.

---

## Points of disagreement

**Enforcement was removed in 2.0.0, and the argument for it is worth keeping.** Versions
1.x shipped three layers: the verdict, a `gate.json` artifact keyed on `headSha` **plus** a
working-tree digest, and a `PreToolUse` hook that denied `gh pr create` / `gh pr ready` /
`git push` outright. The reasoning was sound for what it assumed — a verdict that evaporates
between sessions is persuasion, not enforcement, and a gate keyed on `headSha` alone is
defeated by fixing nothing and pushing anyway.

What it got wrong was the premise. This skill is run **by hand**, by the repo owner, at the
moment they decide to review. Nothing invokes it unattended, so nothing needed to outlive the
session. The three layers bought staleness bugs, an override protocol with a 20-character
justification, and a second implementation of one hash — to enforce a rule on the one person
who had already chosen to follow it. The cost was real and the benefit was assumed.

The lesson generalizes past this skill: **persistence is only worth its complexity when
something runs without a human present.**

**No linter is proposed, anywhere.** The obvious reading of "there is no local gate" is "add
ESLint". This skill explicitly refuses to suggest it — including as a review finding — because
that is a repo-wide decision about which style rules get turned on, not something a PR gate
should smuggle in. `SKILL.md` §5 carries an explicit *Do not suggest* block, because every
generic review skill will try.

**Five phases, not one prompt.** A single-shot review would be cheaper. But
`onion-architecture` (417 lines) plus `frontend-ui-architecture`, `security`,
`react-best-practices`, `next-best-practices`, `zod` and `typescript-expert` is 4–6k lines of
skill body **before** the diff, and on a real change the diff gets pushed out of context.
Hence parallel subagents in phase 3 — with an explicit inline exception for ≤3 files in one
group, where spawning an agent for two lines is absurd.

---

## Sources

Everything here rests on this repo, not on outside material. Each claim below was read at the
cited location on **2026-08-15**.

| Source | Supports |
|---|---|
| `server/src/vendor/shared/contracts/findings.ts` | `Severity` (3 levels, line 11), `Verdict` (line 26), `Finding` shape (line 53), `FindingKind`, `FindingCategory` |
| `docs/agent-prompts/general-reviewer.md` | The severity rubric quoted verbatim in §7; "the verdict is a pure function of your findings" |
| `reviewer-core/src/grounding.ts` | `groundFindings`, `FULL_FILE_KINDS` (line 16), and the walk-the-diff-not-the-range idiom with its rationale (line 44) |
| `TESTING.md` | The `*.it.test.ts` filename split (H4/H5), the per-package suite map, the `skip-worktree` note |
| `.github/workflows/*.yml` (5 files) | The `paths:` filters that define the §5 blast-radius table |
| `AGENTS.md` (root + 4 modules) | Four standalone packages, contracts-are-shared-Zod, secrets policy, the `docker compose down -v` ban, lock-file rule, INSIGHTS protocol |
| `scripts/sync-vendor.sh` | H1/H2 — server is canonical, `--check` is the authority |
| `.gitignore` | `.devdigest/cache/` already ignored (H7, and the artifact location) |
| `.claude/skills/*/SKILL.md` (13) | The routing table's right-hand column |
| `skills-lock.json`, `.claude/skills/README.md` | H18 — the catalog drift this skill detects |
| `.claude/skills/onion-architecture/` | The Tier B file/voice convention this skill follows |

---

## Verification performed

The deliverable is documentation, claim-checked against the tree. The hook-test results that
stood here covered `.claude/hooks/pr-gate.mjs`, removed in 2.0.0; what they proved (30/30, plus
one real hash bug the tests caught before it shipped) is recorded in the 1.0.0 changelog and no
longer describes anything runnable.

### Claims checked against the tree

- **Every scoping command in §3 was executed** on the current working tree (81 entries in
  `CHANGED`). The status-first `-z` parser was confirmed against the four real `R100` records
  (`client/src/components/showcase/` → `client/src/test/showcase/`), which do emit **three**
  NUL fields where every other record emits two.
- **`HEAD == main` right now**, so `merge-base origin/main HEAD` returns HEAD itself and the
  committed range is empty. The branch-less mode in §3 is not hypothetical — it is this repo's
  current state, and it is why the skill offers to create a branch instead of reporting
  "0 files".
- **The mechanical checks were run, not just written.** H3, H4, H7, H9, H11 and H2 all execute
  as printed and return the right answer on the current tree. H18 fires correctly, catching
  the two `skills-lock.json` entries with no folder and (before this change) the missing
  `engineering-insights` catalog row.
- **`git status --porcelain=v2` really does miss worktree edits** — it reports the HEAD and
  index blob hashes only. Verified directly, which is why the digest includes both diffs.
- **It misses untracked content too, and that was the same bug one ring out.** `--porcelain=v2`
  emits a bare `? <path>` with no blob hash, and default `-unormal` collapses a wholly-untracked
  directory to one entry — so on this tree, 24 of the 88 changed files were invisible to
  freshness. Proven with two probes: creating `.claude/hooks/__probe_a.tmp` left the digest
  byte-identical (directory collapse), and rewriting `scripts/__probe_b.tmp` with entirely
  different content left it byte-identical again (no content hash). The digest now also hashes
  `git ls-files -o --exclude-standard -z` and those paths' blobs; both probes move it, and
  removing the probes returns it to baseline. `-uall` alone would have fixed only the first
  probe.
- **`git diff` writes CRLF warnings to stderr on Windows.** Confirmed, and noted in
  `references/mechanical-checks.md`: the pipelines must not be `2>&1`-redirected or warnings
  become file paths.
- **Every path in the routing table resolves.** `client/src/i18n/`, `client/src/lib/api.ts`,
  `client/src/lib/hooks/`, `client/src/vendor/ui/`, `server/src/modules/_shared/context.ts`
  and the four `modules/*/repository*.ts` all exist; `client/next.config.*` matches the real
  `.mjs`, not a `.ts`.

### Three plan claims corrected against the tree

1. **H2 was wrong as specified.** The plan defined it as "any `client/src/vendor/shared/**`
   path in the diff is a hand-edit of a generated tree — CRITICAL". The current tree refutes
   it: six files under `client/src/vendor/shared/**` are modified, `findings.ts` is modified on
   the server side, and `sync-vendor.sh --check` reports **in sync**. That is the intended
   workflow. The naive rule would fire a false CRITICAL on the user's most common
   multi-package change — the single best way to train someone to ignore the verdict.
   H2 now fires **only** when `--check` fails.
2. **`server/package.json` is not `skip-worktree` in this clone.** `TESTING.md` documents it
   as such, and the plan carried that forward as fact, warning that the file would never appear
   in `git diff`. `git ls-files -v` returns no lowercase-letter rows, and `server/package.json`
   *does* appear in the unstaged diff. H3 therefore checks the flag before suppressing, rather
   than assuming either state.
3. **The catalog drift is larger than the plan counted.** The plan noted `README.md` listing 12
   skills against 13 present. The missing one is `engineering-insights` — the skill the session
   protocol in `AGENTS.md` depends on. The plan's third drift (`README.md` referencing a
   `.cursor/skills/` symlink) is confirmed: there is no `.cursor/` directory at all.

### Found while verifying, not in the plan

- **`db/migrations/0011_quiet_patch.sql` is untracked while its `_journal.json` entry is
  modified.** A plain `git diff` sees half the pair and would report a phantom H10. This is the
  strongest argument for `ls-files --others` being in `CHANGED`, and it is a live case, not a
  constructed one.
- **`reviewer-core` and `e2e` use npm; `client` and `server` use pnpm.** The §5 pre-gate table
  is split accordingly. Getting this backwards would fail every pre-gate on those two packages
  for reasons unrelated to the diff.
- **`.github/workflows/**` and `scripts/**` match no skill in the catalog.** They route to SEC
  and CORRECT only. The report says so rather than inventing coverage — `routing-table.md`
  names this explicitly so the gap is visible instead of silently absent.

### Not verified

**The trigger check has not been run.** A skill cannot verify its own trigger from the session
that wrote it — the frontmatter is already loaded here, so any test is circular. The
`description` was written against the proven shape of the sibling Tier B skills and carries the
literal phrasings the user is expected to type, including the Ukrainian one. Open a fresh
session and try:

- *"can I open a PR with these changes?"*
- *"перевір мої локальні зміни перед пушем"*
- *"is this ready to push?"*

If `pr-self-review` does not load, tune the `description`. **Do not rely on the skill firing on
its own until this passes.**

**No end-to-end run has happened.** Phases 0 and 1 are tested; phases 2–5 have never executed
as a whole, so no report has been produced by the real pipeline. In particular the false-positive calibration
the plan asks for — running against three known-good merged commits and expecting **zero**
CRITICAL — is **not done**. Until it is, treat a CRITICAL from this skill as a claim to check,
not a verdict to trust.

---

## Changelog

### 2.0.0 — 2026-08-28

**Enforcement removed. The skill now advises; it does not block.**

- Deleted `.claude/hooks/pr-gate.mjs` and `.claude/hooks/pr-gate.test.mjs`, and the hooks block
  in `.claude/settings.json` that registered them.
- `SKILL.md` §8 "The blocking mechanism" → "What the verdict means": the `gate.json` artifact,
  the `workingTreeDigest` freshness scheme, the `PreToolUse` layer and both escape hatches
  (`--override`, deleting `settings.json`) are gone. The verdict no longer persists, so a
  re-run after a fix is a fresh judgement rather than a re-validation.
- `--override` removed from the flag list; `--since-last-review` (§10, still unbuilt) now
  states plainly that it needs its own persistence.
- Rationale: the skill is invoked manually by the repo owner. Enforcement that survives between
  sessions earns its complexity only when something runs unattended, and nothing here does.

### 1.0.0 — 2026-08-15

Initial release.

- `SKILL.md`: scope and hand-off table, five-phase execution model, diff scoping with the
  `-z` rename trap and the branch-less case, the routing table with its skip rule and
  always-on SEC/CORRECT floor, the subagent contract returning real `Finding` objects, the
  CI-derived pre-gate with its *Do not suggest* block, H1–H18, the quoted severity rubric,
  the grounding gate and adversarial pass, the three-layer blocking mechanism, the report
  contract, and an *Adjacent, not covered here* section delegating to the built-ins.
- `references/routing-table.md`, `references/mechanical-checks.md`, `references/report-template.md`.
- `.claude/hooks/pr-gate.mjs` (Node, fail-open, `--digest` mode) and
  `.claude/hooks/pr-gate.test.mjs` (30 assertions, all passing).
- `.claude/settings.json` created with a hooks block only.
- Every mechanical check executed against the real working tree rather than asserted.
- Three plan claims corrected against the tree (H2's trigger, the `skip-worktree` assumption,
  the size of the catalog drift), and one hash bug found and fixed by testing.
