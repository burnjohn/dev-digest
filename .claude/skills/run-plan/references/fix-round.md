# The `FIX-n` round protocol

Read this before dispatching the first fix of a run. It covers one thing: turning a read-only
reviewer's finding into an `implementer` dispatch, safely and repeatedly.

`architecture-reviewer` and `plan-verifier` are read-only by allowlist and by design. Neither fixes
anything, so without this step their findings live in a chat transcript and are actioned by hand or
not at all.

---

## 1. What becomes a fix, and what does not

| Source | Becomes a `FIX-n`? |
|---|---|
| `architecture-reviewer` — `CRITICAL` | **yes** |
| `architecture-reviewer` — `MAJOR` | **yes** |
| `architecture-reviewer` — `MINOR` | no — recorded. It does not enter the verdict, and the verdict is what the loop exits on |
| any finding marked `[pre-existing]` | no — recorded. The reviewer already excludes it from its own gating count; this loop did not create it and does not own it |
| anything under `### Advisory` | no — the reviewer marks that section ungrounded itself |
| `plan-verifier` — `NOT IMPLEMENTED` on a `REQ` | **yes** |
| `plan-verifier` — `PARTIAL` | no — it means "implemented, not proven by a test". That is phase 5's input, not a fix |
| `plan-verifier` — `CANNOT VERIFY` | no — record the blocker it named. An environmental blocker is a `[parent session]` step |
| a spec `AC` cited by no `REQ` | **never** — a scope gap owned by `implementation-planner`. This skill may not invent the missing requirement. Quote the `AC` verbatim and escalate |
| any finding on a **Tier A** path | **never** — a `[parent session]` step. Name the replacement action, not the file |
| a fix that would add behaviour no `REQ` covers | **no** — record the reason and escalate. A reviewer finding is not a licence to widen scope |

Anything in the "no" column is **written into the report with its reason**. An unfixed `CRITICAL`
that nobody wrote down reads exactly like one nobody found.

---

## 2. The block

Copied from `docs/plans/README.md` §"Remediation". Do not improvise a different shape — the
implementer validates the same mandatory fields here as in a plan task, and a block missing one is
refused.

~~~markdown
### FIX-1 — <the finding, in one line>
**Wave:** n/a · **Parallel:** no · **Lane:** backend · **Depends on:** n/a
**Dispatched:** YYYY-MM-DD
**Source finding:** `architecture-reviewer` — CRITICAL, `server/src/modules/x/service.ts:12`
**Implements:** REQ-4 (re-open) | n/a — structural only

**Owned paths (exclusive):**
- `server/src/modules/x/service.ts` (edit)

**May read:** `server/src/modules/x/repository.ts`

**Skills (mandatory):** `onion-architecture`, `typescript-expert`

**Binding insights:** none

**Do:** <what the fix is, as intent — 1-3 sentences>

**Acceptance:**
- [ ] <the finding's own words, restated as a checkable fact about the code>

**Red flags:**
- [ ] <the mistake this particular fix invites>

**Inner loop:** `cd server && pnpm exec vitest run <the covering test> --reporter=dot --silent`
**Done condition:** `cd server && pnpm typecheck && pnpm exec vitest run --exclude '**/*.it.test.ts'`
~~~

### Filling it in

- **`Parallel:`** is `no` when the fix set has one member and `yes` when several are fanned out
  together. It is never `n/a`. `Wave:` and `Depends on:` may be `n/a` — this is an inline block.
- **`Dispatched:`** is **today's** date here, unlike a plan task. A fix block is authored now, so
  every `INSIGHTS.md` entry really is older than it, which is what the conflict rule should see.
- **`Source finding:`** carries the agent, the severity, and the `file:line` **exactly as reported**.
  This is what makes round N+1's report auditable against round N's.
- **`Implements:`** re-opens the `REQ` the finding touches, or says `n/a — structural only`. A
  structural fix that claims a `REQ` it does not restore is a false coverage claim.
- **`Skills:`** comes from the lane table in `docs/plans/README.md` §"Skills per lane", keyed on the
  owned path — not from the finding's wording, and not from the task the finding came from.
- **`Acceptance:`** restates the reviewer's own words as a checkable fact about the code. Do not
  soften it and do not broaden it: the box the reviewer would tick, and no other.
- **`Do:`** is intent, not code, in one to three sentences.
- **`Inner loop:` / `Done condition:`** are copied from the lane's rows in
  `docs/plans/README.md` §"Done-condition commands". Never invented. In the `process` lane both are
  `n/a`, and the acceptance box is closed by **quoting the file content** that satisfies it.

---

## 3. Dispatching a fix set

1. **Check disjointness first.** A fix set fanned out together is a wave, and there is no §6 to
   record the check in — so the session runs it. Two fix blocks naming the same file is silent lost
   work: implementers share one checkout, and whichever writes second overwrites the first.
2. **Merge, do not split, when two findings share a file.** Two `CRITICAL`s in
   `service.ts` are one `FIX-n` with two acceptance boxes, not two blocks racing each other.
3. **Max 5 concurrent**, same as a wave.
4. **A Tier B path forces a solo dispatch** — `**Parallel:** no` and nothing alongside it.

---

## 4. Re-review scope

Round 1 reviews the union of every dispatched task's `Owned paths`.

**Every later round reviews only the `Owned paths` of the fix blocks that round dispatched.** The
rest of the surface already passed and re-reading it buys nothing but tokens — this is where the
loop's cost is actually controlled.

The scope narrows monotonically. If a round needs to *widen* scope to judge a fix, that is a signal
the fix reached outside its owned paths — treat it as a regression, not as a reason to re-review
everything.

---

## 5. Exit, in this order

1. **`PASS`** → leave the loop.
2. **Regression guard** — the round reports a `CRITICAL` at a `file:line` the previous round did
   not. Stop immediately and report both findings side by side. A fix that broke something is worse
   than the finding it closed, and another automatic round will not un-break it; the owner decides.
3. **Cap reached** (`--rounds`, default 2) with a `CRITICAL` still open → `G6`. Stop. Print every
   open finding verbatim — severity, `file:line`, and the violated rule as the reviewer quoted it.

There is no fourth exit and no "one more round because it was close". A loop that can talk itself
into another round has no cap.

---

## 6. Counting

`FIX-n` numbering is continuous across the whole run, not per round: round 1 producing three fixes
and round 2 producing one gives `FIX-1`…`FIX-4`. The report's rounds table is keyed on those
numbers, so a reader can trace any fix back to the round and the finding that produced it.
