# docs/retros

One file per analysed multi-agent run, written by the
[`workflow-retro`](../../.claude/skills/workflow-retro/SKILL.md) skill.

`NN-<slug>.md`, `NN` allocated one at a time — **the filenames are the registry, there is no index
file**, same convention as `docs/plans/` and `<pkg>/specs/`.

A retro answers *was this run's dispatch a good dispatch* — how the work was cut, how it was
briefed, what it cost. It does not judge the code (`architecture-reviewer`), whether the plan
shipped (`plan-verifier`), or what was learned about the codebase (`INSIGHTS.md`).

**These are committed on purpose.** The value of a retro is the trend across runs — token cost per
wave, how often the same file gets rediscovered, whether fan-out is real — and a git-ignored cache
would lose exactly that. The collector's raw JSON is *not* committed; it lands in
`.devdigest/cache/workflow-retro/` and can be regenerated from the transcripts at any time.

**The skill never runs on its own.** It has no hook, and `run-plan` does not chain it. A retro
exists because someone asked for one.

Every `## Proposals` row in a retro is **unapplied**. Applying them is the owner's, by hand.
