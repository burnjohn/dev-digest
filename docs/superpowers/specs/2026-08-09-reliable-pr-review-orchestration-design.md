# Reliable PR Review Orchestration Design

**Date:** 2026-08-09

**Status:** Approved design, pending written-spec review

## Goal

Make DevDigest review arbitrary user-supplied pull request diffs without asking the user to choose a review strategy, while bounding each model call, preserving finding quality, and avoiding a single slow OpenRouter generation taking down the whole run.

## Context and evidence

The current studio stores `single-pass` on every built-in agent and sends the whole diff to one model call. A real 55k-token General Reviewer request using `deepseek/deepseek-v4-flash` exhausted three 90-second transport attempts. A capped diagnostic spent its entire completion budget on reasoning and returned no JSON. Disabling reasoning made the old model complete, but `deepseek/deepseek-v4-flash-0731` still exceeded 120 seconds with low reasoning.

Paid replays of the same request showed `openai/gpt-5.6-luna` completing in roughly eight seconds and identifying two defects that later commits fixed. `anthropic/claude-sonnet-4.6` is materially more expensive on the full request but has direct PR-review benchmark evidence and a lower false-positive rate than the other top-tier models.

SWE-PRBench reports that all evaluated models find only 15–31% of human review issues and that adding flat context reduces quality. A compact diff-focused representation outperformed richer context for every tested model. This supports focused mapping followed by compact adjudication instead of one large prompt.

Sources:

- [SWE-PRBench paper](https://arxiv.org/html/2603.26130v1)
- [SWE-PRBench dataset and evaluation fixtures](https://huggingface.co/datasets/foundry-ai/swe-prbench)
- [OpenRouter GPT-5.6 Luna](https://openrouter.ai/openai/gpt-5.6-luna-20260709)
- [OpenRouter GPT-5.6 Terra](https://openrouter.ai/openai/gpt-5.6-terra)
- [OpenRouter Claude Sonnet 4.6](https://openrouter.ai/anthropic/claude-sonnet-4.6)
- [OpenRouter Claude Haiku 4.5](https://openrouter.ai/anthropic/claude-haiku-4.5/performance)
- [OpenRouter DeepSeek V4 Flash 0731](https://openrouter.ai/deepseek/deepseek-v4-flash-0731)

## User-visible behavior

- Running a review requires no single-pass/map-reduce choice.
- The Agent editor no longer exposes review strategy.
- Users may still choose an agent provider and preferred model. The preferred model is the first mapper when it is compatible with that provider.
- Existing built-in agents still using the legacy DeepSeek default move to `openai/gpt-5.6-luna`; explicitly customized models remain unchanged.
- The review timeline shows automatic chunking, mapper fallback, adjudication, and exhausted-chunk failures as ordinary run events.
- A run never reports success when part of the diff was not reviewed. If every mapper in the fallback chain fails for any chunk, the run fails with the chunk label and attempted models.
- If candidate adjudication fails on both reducer models, the engine returns the already grounded mapper findings, emits an explicit degraded-mode event, and does not discard completed review work.

## Architecture

### 1. Automatic diff planner

`reviewer-core` owns a pure planner that receives the filtered unified diff and a conservative prompt token budget. It estimates tokens from UTF-8 text without adding a tokenizer dependency.

The planner:

1. removes generated files using the existing gate;
2. keeps small diffs in one focused chunk;
3. splits larger diffs on file and hunk boundaries;
4. groups adjacent complete hunks while the estimated prompt remains within budget;
5. splits an oversized individual hunk into bounded continuation chunks without dropping changed lines;
6. preserves enough file and hunk metadata for the model to cite original new-side line numbers;
7. uses stable chunk labels so retries and traces identify the same scope.

Chunk selection accounts for repeated prompt overhead. A large system prompt, skills, memory, repository map, or PR description therefore reduces the available diff budget instead of silently creating an oversized request.

The legacy `strategy` value remains readable for API/database compatibility, but studio execution does not use it to control orchestration.

### 2. Model roles and bounded generation

The OpenRouter review policy has two roles:

- **Mapper:** preferred agent model, with `openai/gpt-5.6-luna` as the built-in default and `anthropic/claude-haiku-4.5` as the cross-vendor fallback.
- **Adjudicator:** `anthropic/claude-sonnet-4.6`, with `openai/gpt-5.6-terra` as fallback.

Every structured review request has an explicit completion budget. OpenRouter requests also receive model-aware reasoning settings: bounded low reasoning for GPT-5.6 mapping and no reasoning for models whose hidden reasoning can consume the JSON budget. A request-level abort signal continues to bound the complete body read.

Fallback is per chunk. A timeout, transient transport exhaustion, missing choice, provider schema rejection, or invalid structured response advances to the next mapper without rerunning successful chunks. Cancellation never triggers fallback.

Direct OpenAI or Anthropic agents keep their selected provider and automatic chunking, but cross-vendor fallback is only available through an OpenRouter provider. The built-in agents use OpenRouter, so the default path has the full policy.

### 3. Portable structured output

The engine converts the existing Zod `Review` schema into a provider-portable JSON Schema by inlining local references and removing numeric bounds rejected by Anthropic-compatible OpenRouter endpoints. Strict structured output stays enabled.

The original Zod schema remains the final authority after parsing. Schema normalization therefore improves transport compatibility without weakening application validation. No vendored shared contract is edited.

### 4. Map, ground, and adjudicate

Each mapper receives one focused chunk plus the agent prompt and bounded supporting context. Mapper results are grounded immediately against the original unified diff. Ungrounded findings are removed before adjudication so the expensive reducer never spends tokens on impossible citations.

When there are no grounded candidates, the engine returns a deterministic clean review and skips the reducer.

When candidates exist, the engine builds a compact adjudication prompt containing:

- normalized candidate findings;
- a small evidence window around each cited changed line;
- instructions to reject unsupported or duplicate findings;
- instructions to calibrate severity and preserve exact file/line anchors.

Sonnet returns the final `Review`. That output is grounded again, deduplicated, and scored with the existing deterministic severity-based score. If both adjudicators fail, the deterministic merge of grounded mapper findings is used in degraded mode.

### 5. Accounting and observability

Tokens and cost accumulate across every successful and failed-over model call whose provider returns usage. The run trace records actual model names per stage instead of attributing the entire run only to the agent's configured model.

Events distinguish:

- planning and chunk count;
- mapper start and model;
- mapper fallback and cause;
- candidates produced and grounded;
- adjudicator start/fallback;
- final grounding and degraded reducer mode.

The persisted review model remains the configured/preferred mapper for backward compatibility. The run event log and raw output contain the full stage-level model history.

## Failure semantics

- User cancellation aborts the active request and stops all further chunks without retry or fallback.
- A mapper failure retries only according to the provider's bounded transport policy, then advances to the fallback mapper.
- If all mapper models fail for a chunk, the engine throws an aggregate review error naming that chunk and attempted models. The server persists the run as failed.
- A reducer failure advances to the reducer fallback. Exhausting reducer models emits a warning and returns grounded map results.
- Schema repair retries and transport retries remain separate budgets.
- No successful result may omit a chunk silently.

## Configuration and migration

- Built-in agent seed default changes from `deepseek/deepseek-v4-flash` to `openai/gpt-5.6-luna` under the OpenRouter provider.
- Seed reconciliation updates only built-in agents whose model is still the exact legacy default. User-customized models are preserved.
- Existing strategy columns and request fields remain for backward compatibility, but the Agent editor removes the field and the studio executor always requests automatic orchestration.
- No hand-written database migration is required.
- OpenRouter prices continue to come from the existing live model endpoint and price book; model pricing is not hardcoded into the review engine.

## Testing and validation

Implementation follows test-driven development.

Hermetic tests cover:

- token-aware planning for small, multi-file, oversized-file, and oversized-hunk diffs;
- no changed line is dropped or reviewed twice except intentional continuation overlap;
- fixed prompt overhead reduces chunk capacity;
- portable JSON Schema contains no unresolved local references or unsupported numeric bounds and still fails original Zod validation for out-of-range data;
- per-chunk fallback, cancellation short-circuit, and aggregate mapper failure;
- reducer invocation only when grounded candidates exist;
- reducer fallback and deterministic degraded mode;
- token/cost accumulation and stage events;
- server wiring ignores stored strategy;
- legacy built-in agents migrate to Luna while customized agents remain unchanged;
- the Agent editor no longer sends or renders strategy.

Paid integration validation uses the real OpenRouter key and includes:

1. the original 55k-token PR replay;
2. a synthetic single-file oversized diff;
3. a multi-file diff with one planted correctness bug, one injection issue, and one N+1 query;
4. Luna mapper plus Sonnet adjudication;
5. an intentionally invalid primary model to prove automatic fallback.

Success criteria:

- no individual generation exceeds its configured wall-clock budget;
- the original replay completes without manual strategy selection;
- planted findings survive final grounding and adjudication;
- invalid primary model falls back automatically;
- structured output validates through the original Zod schema;
- all reviewer-core and affected server/client tests and typechecks pass.

## Out of scope

- A general-purpose workflow engine for arbitrary LLM tasks.
- Changing the shared `Review` or finding contracts.
- Provider-price-based automatic model switching.
- Automatically posting reviews to GitHub during paid validation.
- Replacing repository-intelligence retrieval or prompt content beyond what is required to budget and focus it per chunk.
