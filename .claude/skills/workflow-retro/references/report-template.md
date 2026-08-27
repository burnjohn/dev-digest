# The retro file — sections, in order

Written to `docs/retros/NN-<slug>.md`. **None of these sections is optional.** An empty one prints
its header and `_none_`; deleting it makes "we found nothing" indistinguishable from "we did not
look". Same rule as `pr-self-review`'s report template, and for the same reason.

Fill-in text below. Angle brackets are placeholders.

---

~~~
# Retro: <run title>

**Session:** `<session-id>` · **Plan:** `docs/plans/NN-slug.md` | none
**Ran:** <first event ISO> → <last event ISO> (<wall clock>)
**Collected:** `.devdigest/cache/workflow-retro/<session>.json` — <n> of <m> agent transcripts read
**Coverage:** full | partial — <what is missing and why, when G2 fired>

## Cost

| | Billable | Cache reads | Output | Thinking |
|---|---|---|---|---|
| Parent session | <n> | <n> | <n> | <n> |
| Agents (<count>) | <n> | <n> | <n> | <n> |
| **Total** | **<n>** | <n> | <n> | <n> |

Billable is `input + output + cache_creation` summed from `message.usage` across disjoint
transcripts. Cache reads are billed separately and far cheaper — they are shown, never added in.

## The run

| # | Agent | Task | Model | Started | Duration | Billable | Tools | Status |
|---|---|---|---|---|---|---|---|---|
| 1 | <type> | <description> | <model> | <hh:mm:ss> | <n>s | <n> | <n> | <status> |

**Spawn tree:** <depth-1 agents, with any depth-2 children nested under their parent>
**Peak concurrency:** <n> · **Σ agent time:** <n>s · **Wall:** <n>s · **Ratio:** <r>
<one sentence on what the ratio says — was the fan-out real>

## Measured findings

Each row is something the transcripts show, not something an agent said.

| Finding | Evidence | Costs | Fix belongs in |
|---|---|---|---|
| <what happened> | <field from the collector JSON, with numbers> | <tokens/time, or "—"> | `<file>` |

### Duplicated context
| File | Read independently by | Total re-reads |
|---|---|---|
| `<path>` | <n> agents | <n> |

<or `_none_`>

### Searches that found nothing
| Term | Agents that searched it | Likely cause |
|---|---|---|

<or `_none_`>

## Claimed, not verified

From agents' own `### Notes for the integrator` and `### Insight candidates`. **An agent's account
of its own work is a claim, not evidence** (`.claude/agents/README.md`). Rows are promoted to the
table above only after the claim was checked against the tree in this session.

| Claim | Source agent | Checked? | Verdict |
|---|---|---|---|
| <claim> | <agent> | yes / no | confirmed / refuted / unverified |

<or `_none_`>

## Surprises

Things an agent reported that contradicted the plan's or the spec's assumptions. These are the
highest-value rows in the file and the easiest to lose — they usually live in one sentence of one
agent's report.

| Assumption | What was actually true | Where the assumption came from |
|---|---|---|

<or `_none_`>

## Proposals

Diffs for the owner to apply or reject. **This skill applies none of them.** Every row names a
file; a proposal with no target file is not a proposal and does not belong here.

| # | Target | Change | Why — the measured signal behind it |
|---|---|---|---|
| P1 | `.claude/agents/<name>.md` | <the edit, concretely> | <the number or observation that motivates it> |

<or `_none_`>

## What went right

Only entries that should be *repeated deliberately* — a wave cut that worked, a preamble that
prevented a class of question, a model choice that paid. Not praise. If nothing here is
reproducible on purpose, write `_none_`.

## Not done by this skill

No agent file, skill file or `INSIGHTS.md` was edited. Nothing was staged or committed. The
proposals above are unapplied.
~~~
