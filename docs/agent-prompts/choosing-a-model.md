# What model to choose

A guide to picking the LLM behind a reviewer agent. The model is set per agent
(`agents.provider` + `agents.model`); the seed defaults every built-in agent to
`openrouter` / `deepseek/deepseek-v4-flash`. You can change it per agent in the
studio (the model dropdown) or via `PUT /agents/:id { "model": "…" }`.

## Why the model matters

The prompts (see [`README.md`](./README.md)) tell the model *what* to do; the model
decides *how well*. The cheap default (`deepseek-v4-flash`) is fast and nearly free
but, even with good prompts, tends to:

- **inflate severity** — calling a 2-query sequence or an intended feature
  `CRITICAL`, which turns harmless PRs into blockers;
- **reason inconsistently** — occasionally shipping a finding whose own rationale
  concludes "there is no bug";
- **over-pattern-match** — e.g. labelling a plain REST read as a "lethal trifecta".

A stronger model spends more per run but calibrates severity, follows the
verdict/severity rubric, and produces far fewer false positives. For a review gate,
fewer false blockers is usually worth a few cents.

## Cost per run

A single-pass review of a small/medium PR is roughly **~12k input + ~1.5k output
tokens** (observed: 9k–17k total). The `$/run` column below uses that estimate —
bigger diffs scale up linearly. Prices are OpenRouter list prices (USD per 1M
tokens) as surfaced by the studio's model list; verify live before relying on them.

| Model | in / out ($/M) | ~$/run | Notes |
|---|---|---|---|
| `deepseek/deepseek-v4-flash` *(current default)* | 0.09 / 0.18 | **~$0.0015** | Fast, nearly free. Severity inflation + weak instruction-following. |
| `deepseek/deepseek-v3.2` | 0.23 / 0.34 | ~$0.003 | Cheap step up, decent reasoning. |
| `deepseek/deepseek-chat-v3.1` | 0.21 / 0.79 | ~$0.004 | Solid budget reviewer. |
| **`deepseek/deepseek-v4-pro`** ⭐ | 0.435 / 0.87 | **~$0.006** | **Best cheap upgrade.** Same family/provider → drop-in (no prompt or format change), 1M context, clearly stronger reasoning. Start here. |
| `anthropic/claude-haiku-4.5` | 1 / 5 | ~$0.02 | Cheapest Claude; good at holding the rubric. |
| `google/gemini-2.5-pro` | 1.25 / 10 | ~$0.03 | Strong, good value. |
| `openai/gpt-4.1` | 2 / 8 | ~$0.035 | Reliable instruction-following. |
| **`anthropic/claude-sonnet-5`** ⭐ | 3 / 15 | **~$0.05** | **Quality benchmark.** Best severity calibration, lowest false-positive rate of the practical options. Same list price as the Sonnet 4.6 it supersedes — and cheaper still while the $2/$10 introductory rate runs (through 2026-08-31). |
| `anthropic/claude-opus-5` | 5 / 25 | ~$0.10 | Top-tier reasoning; overkill for routine review, useful as a gold-standard reference. Supersedes Opus 4.8 at the same price. |

(All ~40× the default still lands at ≈5 cents/run — trivial for evaluating quality.)

## Recommendation

1. **Cheap, low-risk upgrade → `deepseek/deepseek-v4-pro`.** Only the `model` field
   changes; everything else (prompts, structured output, context) is identical. This
   alone should remove most of the severity-inflation wobble. ~4× the cost, still a
   fraction of a cent per run.
2. **Quality benchmark → `anthropic/claude-sonnet-4.6`.** Switch one agent to it and
   compare side by side. If the quality jump is worth ~$0.05/run for your use, make
   it the default for the gating agents (e.g. Security).
3. **Mixed strategy.** Cheap model for advisory/Performance passes, a strong model
   for the agent that actually blocks merge (Security). Cost follows importance.

## How to A/B test

1. Point one agent at the new model (studio model dropdown, or `PUT /agents/:id`).
2. Re-run all agents on the same PR (`POST /pulls/:id/review { "all": true }` or the
   **Run Review** button).
3. Compare the runs in the timeline + the raw model output in each run's trace
   (`run_traces.raw_output`). Look at: were the findings real, was severity honest,
   did the verdict match the findings, any duplicates or false trifecta?

Because `score` and the merge gate are derived deterministically from the grounded
findings (not the model's self-report), the comparison is apples-to-apples across
models — only the findings and their severities change.
