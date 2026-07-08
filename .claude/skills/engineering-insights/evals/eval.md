# Eval methodology — engineering-insights

Unlike a code-detector skill (e.g. `onion-architecture`, which scans a fixed module tree for
seeded violations at known `file:line` locations), `engineering-insights` does not scan code —
it reads a **narrative session summary** and makes a judgment call: capture or skip, which
module, which category, extend-as-duplicate or append-new. There is no fixed set of "findings"
scattered through a file for the agent to recall. The oracle here is the **expected outcome**
of that judgment, not a list of findings.

## Task given to the agent under test

For each eval, the agent is handed a session narrative (a description of what was discovered
or done) and told to run the skill's Mode B (wrap-up) against a seeded repo copy. It must
decide whether anything clears the discovery bar, and if so, write it to the correct
module's `insights.md` using the skill's Edit-only discipline.

## Fixtures

`fixtures/eval-0` .. `fixtures/eval-3` are minimal, non-compiling repo skeletons — a `CLAUDE.md`
plus just enough module structure (`server/`, `client/`) to exercise module targeting. Each one
seeds a different starting state so the four scenarios probe different behaviors:

| Fixture | Starting state | Behavior under test |
| --- | --- | --- |
| `eval-0` | No `insights.md` yet | Create-from-template via Write, correct entry format |
| `eval-1` | `client/insights.md` with 2 entries | Discovery bar → zero entries on a trivial session |
| `eval-2` | `server/insights.md` with a `db:seed` Mistake entry | Duplicate detection → extend via Edit, not a new bullet |
| `eval-3` | Both `server/insights.md` and `client/insights.md` populated | Most-affected-module targeting + `[Decision]` category |

No fixture file hints at the "right answer" in a comment — the correct outcome is derivable
only from applying the skill's discovery bar, module map, and dedup rule to the session
narrative supplied in the prompt (see `evals.json`).

## Scoring

Compare the agent's mutated `insights.md` file(s) against `expected-outcomes.json`:

- Each eval lists a set of **checks** (file existence, entry count, footer count, substring
  presence, category tag format) rather than a `file:line` findings list — there is nothing to
  compute recall/precision over, since the skill isn't finding pre-planted issues.
- **Pass threshold:** all checks for an eval must pass. This is a behavioral-compliance skill,
  not a recall-tunable detector, so partial credit within one eval isn't meaningful — a wrong
  module, a wrong dedup decision, or a clobbered sibling file are each a full failure, not a
  point deduction.
- Report results per-eval as pass/fail, and roll up to "N of 4 evals fully passing" rather than
  an aggregate percentage.

## Running

There is no shared skill-evals CI runner in this repo yet (no `/skill-evals/_shared/README.md`
exists as of 2026-07). Run this skill's harness directly:

```sh
python .claude/skills/engineering-insights/evals/grade.py \
  .claude/skills/engineering-insights/evals/iteration-N
```

`grade.py` is a generic interpreter over `expected-outcomes.json` — it does not hardcode any
eval-specific logic. To add a 5th scenario: add a fixture under `fixtures/`, a prompt in
`evals.json`, and an outcome block in `expected-outcomes.json`; no code change is needed.

To produce a fresh iteration, spawn one subagent per `(eval, config)` pair against a copy of the
matching fixture (see `iteration-1/eval-*/with_skill/repo` and `.../without_skill/repo` for the
existing layout), then run `grade.py` followed by skill-creator's
`scripts.aggregate_benchmark` and `eval-viewer/generate_review.py --static` to review results.
