# References — spec authoring

Where each convention in this skill comes from, and how confident to be about it. Follows the
posture of [`.claude/agents/README.md`](../../agents/README.md) §Sources: an *origin* and an
*analogue* are different things, and the hedge is not decoration.

## EARS — the five acceptance-criteria patterns

**External, high confidence. The actual origin.**

Easy Approach to Requirements Syntax, introduced by Alistair Mavin, Philip Wilkinson, Adrian
Harwood and Mark Novak of Rolls-Royce at the 17th IEEE International Requirements Engineering
Conference (RE'09), 2009, in *"Easy Approach to Requirements Syntax (EARS)"*.

The five patterns — ubiquitous, event-driven, state-driven, unwanted behaviour, optional feature —
are EARS as published. What this repo adds on top, and what is therefore **local convention rather
than EARS**:

- Criteria are numbered `AC-1..AC-n` so a plan's `REQ-n` can restate them.
- The banned-word list ("correctly", "properly", "gracefully", "as expected", "user-friendly").
- The falsification test — naming the observation that would prove a criterion false. This is a
  local discipline borrowed from how the rest of the agent set treats an adversarial pass
  (`architecture-reviewer`'s precision pass, `plan-verifier`'s refutation attempt); EARS itself says
  nothing about it.

An earlier iteration of this repo's convention wrote the triggers in Ukrainian (`КОЛИ`, `ПОКИ`,
`ЯКЩО`, `ДЕ`) with `shall` kept in parentheses as the obligation marker. That was dropped when spec
files were settled as English-only, so the triggers are the published `WHEN / WHILE / IF / WHERE`.
Recorded because the Ukrainian form may still appear in course material.

## The three-way design partition

**Internal — this repo's own law, established the hard way.**

Originated in `docs/plans/04-smart-diff.md` §5.8 ("The visual contract"), written 2026-08-22 after
the question was left open and then closed by the owner. Its own framing: transcribed from the PNG
*"so that a session whose tooling cannot render the PNG still has the facts"*, and explicitly
partitioned into what the mockup **is** the spec for, *"where the mockup is NOT the spec — two
pieces of artistic licence, named so nobody implements them"*, and what it does not contradict.

**The citation is deliberately not the only copy.** `docs/plans/README.md` states that a plan *"is a
snapshot of intent that goes stale the moment the work lands"*, and `.claude/agents/README.md`
records that plan outputs get deleted once landed. A convention whose sole definition lives in a
plan file is a convention with an expiry date — which is why it is restated in full in
[`SKILL.md`](SKILL.md) rather than referenced. To read the original while it still exists:

```bash
git log --oneline -- docs/plans/04-smart-diff.md
```

then `git show <sha>:docs/plans/04-smart-diff.md` and search for `5.8`.

## The `AC-n` → `REQ-n` interlock

**Internal, derived — not stated in any single canonical file.**

`docs/plans/README.md` §"Requirements carry IDs" defines `REQ-n` and requires every `REQ` to appear
in at least one task's Acceptance, with a coverage matrix in the plan's §6. `plan-verifier` walks
that `REQ` list. Neither file mentions `AC-n`.

The conclusion drawn in [`SKILL.md`](SKILL.md) — that an `AC` no `REQ` picked up is verified by
nobody — follows from those two facts rather than from a rule anyone wrote down. It is an inference,
and a load-bearing one; if the coverage model changes, re-derive it rather than trusting this line.

## Not claimed as sources

- **ISO/IEC/IEEE 29148** (requirements engineering) shapes the general vocabulary of requirement
  quality — verifiable, unambiguous, singular — and `plan-verifier` cites it. This skill does not
  implement 29148; the overlap is convergent, not derived.
- **User stories** in the `As a <role>, I want <capability>, so that <outcome>` form are ordinary
  agile practice with no single origin worth citing here.
