# Report template

Written to `.devdigest/cache/pr-self-review/report-<base7>-<head7>.md` (already git-ignored
via `.devdigest/cache/`). The chat gets the banner, the counts, the CRITICAL titles, and the
report path — never the whole file.

Sections, in this order. **None is optional.** An empty section prints its header and
`_none_`; deleting it makes "we found nothing" indistinguishable from "we did not look".

---

## Verdict banner

One of exactly three, matching the `Verdict` enum in
`server/src/vendor/shared/contracts/findings.ts`.

```markdown
# 🔴 request_changes — 2 blocking

`feat/severity-filters` · base `378c184` → head `9a1f2c3` · coverage **full** · 4m12s
Blocked by: H4 (mechanical) · 1 verified CRITICAL
```

```markdown
# 🟡 comment — 0 blocking, 6 to consider

`feat/severity-filters` · base `378c184` → head `9a1f2c3` · coverage **full** · 3m48s
Safe to push. Nothing here blocks the merge.
```

```markdown
# 🟢 approve — clean

`feat/severity-filters` · base `378c184` → head `9a1f2c3` · coverage **full** · 1m02s
Checked: 12 files across BE, DATA, SEC, CORRECT. Zero findings.
```

The verdict is a **pure function of the findings** — never write one that disagrees with the
list below it. Any verified CRITICAL ⇒ `request_changes`. Only WARNING/SUGGESTION ⇒
`comment`. Nothing ⇒ `approve`.

`coverage` is `full` or `partial`. **`partial` can never carry `approve`** — write `comment`
with the coverage gap named in the banner.

---

## Deterministic pre-gate

```markdown
## Pre-gate

| Check | Trigger | Result | Time |
|---|---|---|---|
| `sync-vendor.sh --check` | `server/src/vendor/shared/**` | ✅ in sync | 0.4s |
| `client` typecheck + test | `client/**` | ✅ 41 passed | 38s |
| `server` typecheck + unit | `server/**` | ❌ **TS2345** `modules/reviews/service.ts:88` | 51s |
| `server` integration | `server/**` | ⏭️ skipped — Docker daemon not reachable | — |
| `reviewer-core` typecheck + test | `reviewer-core/**` | ✅ 18 passed | 12s |
| `e2e` typecheck | `client/**`, `server/**` | ✅ | 9s |
| `e2e:hermetic` | — | ⏭️ skipped — needs `--e2e` | — |
```

❌ blocks. ⏭️ **does not** — say so in the row. A skipped check is loudly reported and
never counted against the author; a gate that cannot be earned gets ripped out.

A ❌ here short-circuits: phase 3 never runs, no subagents are spawned, no LLM is called.
Say that explicitly in the banner, or the empty findings list reads as "clean".

---

## Mechanical checks

```markdown
## Hard rules (H1–H18)

| ID | Rule | Result |
|---|---|---|
| H4 | DB-backed test not named `*.it.test.ts` | ❌ `server/test/reviews-flow.test.ts` |
| H9 | Migration without `_journal.json` entry | ✅ `0011_quiet_patch` present in journal |
| H2 | Generated vendor tree hand-edited | ✅ client copy changed, verified in sync |
| … | | |

**14 passed · 1 failed · 3 not applicable**
```

Mechanical failures are `confidence: 1.0` and skip the adversarial pass — they are booleans
over paths, with nothing to hallucinate. List the *not applicable* ones too, collapsed to a
count; a reader who cannot see H6 ran cannot trust that no secret leaked.

---

## Findings

Each finding renders field-for-field from the `Finding` object it already is
(`findings.ts:53`) — same names, same enums. That is the point: a finding from here pastes
into the product's own pipeline unchanged.

```markdown
### 🔴 CRITICAL · bug · `modules/reviews/service.ts:88-94`

**Run rows are written before the transaction commits**

The `await` on `repo.insertRun(tx, row)` was dropped, so `runId` is read from a pending
promise. A second request arriving inside the same tick reads `undefined` and writes a run
with a null FK, which the `runs_review_id_fkey` constraint rejects at commit — the whole
review is lost, not just the second request.

```suggestion
const runId = await repo.insertRun(tx, row);
```

`confidence: 0.9` · `kind: finding`
**Verified:** read `service.ts:48-134` from disk; grepped `insertRun` for a caller-side
`await` — none. Introduced by this diff (`BASE` had the `await` at line 91).
```

The `**Verified:**` line is mandatory on every CRITICAL and appears on nothing else. It
records the §7 adversarial pass in one sentence: what was read from disk, what was grepped,
and the answer to *was it introduced here*. A CRITICAL without that line has not been
verified and must be demoted to WARNING before the report is written.

WARNING and SUGGESTION use the same block with 🟡 / 🔵 and no verification line.

---

## Pre-existing — not blocking

```markdown
## Pre-existing (context, not findings)

- `modules/repos/service.ts:212` — the `catch {}` swallowing clone errors predates this
  branch; the diff moved the block but did not change its behaviour.
```

This is where "I touched the file, so I now own its whole history" goes to die. A reviewer
who sees real rot is allowed to say so. It does not touch the verdict, and it is not a
`Finding` — it is a `context_notes` string.

---

## Dropped — failed grounding

```markdown
## Dropped (ungrounded)

| Finding | Reason |
|---|---|
| FE: "missing key prop in PRRow list" `PRRow.tsx:210-214` | lines 210-214 do not intersect any diff hunk in `PRRow.tsx` |
| BE: "unvalidated body in POST /webhooks" `modules/hooks/routes.ts:31` | file `modules/hooks/routes.ts` not present in diff |
```

Visible, never swallowed. This table is the instrument that shows a subagent is
misbehaving — a group that drops half its findings is a routing or prompt bug, and it is
invisible if drops are silent. Reasons are copied from the grounding gate verbatim.

---

## Coverage

```markdown
## Coverage — full

**Reviewed:** 74 of 81 changed files across 8 groups.

| Group | Files | Skills loaded |
|---|---|---|
| SEC | 58 | `security`, `security-review` |
| CORRECT | 81 | `code-review` |
| BE | 9 | `onion-architecture`, `fastify-best-practices` |
| … | | |

**Skills not loaded**
| Skill | Reason |
|---|---|
| `mermaid-diagram` | no matching files |
| `vercel-react-best-practices` | skill not available in this session |

**Not line-reviewed (7)**
| File | Why |
|---|---|
| `client/src/test/showcase/Showcase.tsx` ← `components/showcase/` | pure rename (`R100`) — routed to `frontend-ui-architecture` only |
| `client/src/components/mermaid-diagram/MermaidDiagram.tsx` | deleted — reference sweep run instead, 0 dangling imports |
| `.github/workflows/client.yml` | no skill in the catalog covers GitHub Actions |
```

Coverage is not decoration. Without it the reader cannot distinguish *the frontend is clean*
from *nobody looked at the frontend*, and that distinction is the whole value of routed
review. The `Skills not loaded` table must separate **no matching files** (the routing
worked) from **not available** (a check silently did not happen).

---

## Draft PR description

Free — the skill has already read the entire diff. The test-plan checkboxes are generated
from the same blast-radius table that drove the pre-gate (`SKILL.md` §5), so the PR body and
the local gate can never disagree about what needed to run.

```markdown
## Draft PR description

> Copy from here down.

### What
Per-run severity filters on the Review runs timeline, toggleable from the PR list.

### Why
Reviewers scanning a large PR need to collapse SUGGESTION noise without losing the
CRITICAL count. Closes #41.

### How
- `Severity` filter state lifted to the run row and persisted per run.
- `findings.ts` unchanged — the filter is a view concern.

### Test plan
- [x] `cd client && pnpm typecheck && pnpm test` — 41 passed
- [x] `cd server && pnpm typecheck` — clean
- [x] `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` — 112 passed
- [ ] `cd server && pnpm exec vitest run .it.test` — **not run** (Docker unavailable locally)
- [x] `cd reviewer-core && npm run typecheck && npm test` — 18 passed
- [x] `cd e2e && npm run typecheck` — clean

### Notes
`0011_quiet_patch.sql` is a new migration — run `pnpm db:migrate` in `server/` after
pulling. Migrations are not applied on boot.
```

Carry the ⏭️ skips into the test plan as unchecked boxes with the reason. A green local
report that hides an unrun suite is how a red CI lands anyway.
