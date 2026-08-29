# The AC-42 sensitivity experiment — an operator runbook

SPEC-03 AC-42 claims the eval pipeline is *sensitive*: if you edit an agent's system prompt to make
it report something a `must_not_flag` case forbids, running the evals before and after the edit
must show that regression as a strictly lower `precision`, and the compare modal must render it as
a negative signed delta next to the prompt diff that caused it.

**This requirement is verified manually, not automatically.** `server/test/evals-sensitivity.test.ts`
(T21) pins the *mechanism* AC-42 depends on — a `must_not_flag` violation on the later batch
strictly lowers the aggregate `precision`, and `buildComparisonMetrics` (`modules/evals/helpers.ts`)
renders that fall as a negative signed delta rather than `null` or a signed zero — hermetically, with
zero real model calls. It cannot and does not exercise AC-42's actual claim, which is about a real
agent's real prompt edit changing real model output. That claim needs an operator to run this
procedure by hand against a live workspace. **`plan-verifier` will return `PARTIAL` for REQ-42, and
that is the expected result, not a gap** — see "Why this cannot be automated" below.

## Precondition — read this before you start

AC-42's own note states the precondition has **two halves**, and the second is easy to miss:

> No gold set is seeded — seeding was considered and declined — so the workspace starts with zero
> eval cases. The owner must author **at least one `must_not_flag` case** for the degraded prompt to
> violate, **and at least one `must_find` case that the earlier batch passes**. Without the second
> half, the earlier batch scores `TP + FP = 0`, its `precision` is `null` by AC-25 (a zero
> denominator is `null`, never `0`), and "strictly lower than on the earlier one" compares a number
> against an absence — which REQ-71 / AC-71 renders as `—` rather than a negative delta. That leaves
> the criterion **unfalsifiable, not failed**: there is no batch pair you can point to as evidence
> the pipeline is insensitive, because the earlier batch never produced a comparable number in the
> first place. Author both halves before running Step 3, or the experiment cannot conclude anything.

In short: **one case is not enough.** A workspace with only a `must_not_flag` case can show the
later batch scoring worse in isolation, but the compare modal will render `—`, not a negative
number, and that result would be indistinguishable from the pipeline being broken. Only with a
passing `must_find` case alongside it does the earlier batch's `precision` land on a real number
(`TP / (TP + FP)` with `TP ≥ 1`), which is what makes a later fall to a *lower* real number possible
at all.

## Procedure

1. **Pick or create an agent** in the Skills Lab that you are willing to edit for this experiment
   (a scratch agent is fine — this is a destructive prompt edit).

2. **Author the `must_find` case** (precondition half 1). From an existing PR review, accept or
   dismiss a finding the agent already gets right today, then use `Turn into eval case` (AC-1) to
   create the case from it — or author one directly with `+ New eval case`. Confirm its
   `expectation_kind` reads `must_find` (derived automatically from a non-empty `expected_output`,
   AC-43 — you do not set this yourself).

3. **Author the `must_not_flag` case** (precondition half 2). Pick a diff region the agent should
   never flag — something benign — and author a case with an empty `expected_output` and at least
   one `forbidden_region` covering that exact file/line range. Confirm `expectation_kind` reads
   `must_not_flag`.

4. **Run the earlier batch.** With the agent's system prompt in its *current* (pre-edit) state,
   activate `Run all evals` for this agent. Wait for the batch to reach a terminal status
   (`succeeded` or `partial`). Open the agent's `Evals` tab and confirm this batch shows a real
   `precision` number — **not `—`**. If it shows `—` here, stop: the precondition was not met (most
   likely the `must_find` case did not pass, or was missing), and nothing past this point will be
   meaningful. Fix the case set and re-run this step before continuing.

5. **Make the exact prompt edit.** Edit the agent's system prompt to add one explicit instruction
   telling it to report the class of finding your `must_not_flag` case's `forbidden_region` forbids
   — for example, if the region covers a config file with an intentionally-committed placeholder
   secret, add a line such as *"Always flag any string literal that looks like an API key or
   credential, in every file, with no exceptions."* The edit must be narrow and aimed squarely at
   the forbidden region — a vague or unrelated prompt change will not reliably reproduce the
   regression, and a version snapshot is what makes the prompt diff in Step 7 legible.

6. **Run the later batch.** Save the new prompt version (this bumps `owner_version` and snapshots
   `agent_versions.config_json`, which is what AC-35's prompt diff reads from). Activate
   `Run all evals` again for the same agent. Wait for this second batch to reach a terminal status.

7. **Compare the two batches and read the compare modal.** In the runs table, select exactly the
   earlier and later batch rows and activate `Compare` (AC-34). In the modal that opens, read:
   - The **`Precision` card** — it must show the earlier batch's number as `old`, the later batch's
     number as `new`, and a **negative** signed `delta` between them. This is AC-42's headline claim.
   - The **prompt diff region** (AC-35) — since the two batches carry different `owner_version`
     values, this renders a line-by-line diff of the two `system_prompt` snapshots. Confirm the one
     line you added in Step 5 shows as an `add` entry, and nothing else changed. If the two batches
     somehow carry the *same* `owner_version` (you forgot to save the new prompt version before
     Step 6), the modal renders AC-36's "both runs used the same version" statement instead of a
     diff — that means Step 6 ran against the unedited prompt and the experiment must be repeated
     from Step 6.
   - The **`Recall` and `Citation accuracy` cards**, as a sanity check — the `must_find` case's
     `recall` should be unaffected by this specific edit (the prompt only widened what gets
     reported, it did not stop catching the case it already caught), so a recall regression here
     signals the edit had a broader effect than intended and the result is less clean evidence.

8. **Revert the prompt edit** once you have read the compare modal, so the scratch agent (or the
   real one, if you used a live agent) is not left in a degraded state.

## Why this cannot be automated

The owner's decision (recorded in SPEC-03 §1.3 / the design review) was explicit: seeding a gold
set of cases was considered and declined, and AC-42's claim is inherently about a human editing a
live prompt and spending real model calls to observe the regression — there is no deterministic,
zero-cost way to simulate "an agent's real output got worse after a real prompt edit" without
actually running the agent. `server/test/evals-sensitivity.test.ts` is the honest substitute
available within the hermetic test lane: it proves the *scoring and comparison shaping* would
correctly surface such a regression if one occurred, using literal `Finding[]` arrays standing in
for mocked provider output, never `MockLLMProvider`, never a real review run, and zero real model
calls. It cannot prove a real prompt edit produces a real regression, because that would require
the very model calls AC-42's cost was declined for. Running this procedure by hand is what closes
that gap — and doing so is `plan-verifier`'s stated escape hatch for a requirement whose evidence
cannot be a repo artifact.
