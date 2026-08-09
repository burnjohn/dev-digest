# What model to choose

The model selected on an agent is its preferred mapper. The review engine—not a
user-facing strategy switch—plans token-bounded chunks, retries a failed chunk on
fallback models, grounds mapper findings, and adjudicates the grounded candidates.

Freshly seeded built-in agents use `openrouter/openai/gpt-5.6-luna`. Existing
built-ins still on the exact legacy DeepSeek default are reconciled to Luna;
customized provider/model choices are preserved.

## Automatic OpenRouter policy

| Stage | Order | Purpose |
|---|---|---|
| Mapper | selected model → `openai/gpt-5.6-luna` → `anthropic/claude-haiku-4.5` | Review one complete token-bounded chunk. A fallback reruns only the failed chunk. |
| Adjudicator | `anthropic/claude-sonnet-4.6` → `openai/gpt-5.6-terra` | Deduplicate and calibrate grounded candidates against compact changed-line evidence. |

If every mapper fails for a chunk, the run fails instead of silently presenting a
partial review as complete. If both adjudicators fail, the run explicitly degrades
to the already-grounded mapper findings. When no grounded mapper candidates exist,
adjudication is skipped.

Direct OpenAI and Anthropic agents still get automatic chunking, request budgets,
and grounding, but stay within their selected provider: they do not use the
cross-vendor OpenRouter fallback/adjudication chain.

## Price and role

OpenRouter prices change; these were verified on 2026-08-09. The provider's live
model list and returned `usage.cost` remain the runtime source of truth.

| Model | input / output ($/1M) | Role in the policy |
|---|---:|---|
| `openai/gpt-5.6-luna` | 0.10 / 0.60 promotional | Default high-volume mapper: low cost and latency. |
| `anthropic/claude-haiku-4.5` | 1 / 5 | Independent mapper fallback when the preferred model and Luna fail. |
| `anthropic/claude-sonnet-4.6` | 3 / 15 | Primary quality gate for cross-chunk deduplication and severity calibration. |
| `openai/gpt-5.6-terra` | 1 / 6 promotional | Independent adjudicator fallback. |

For a representative 12k-input/1.5k-output Luna map, promotional list price is
about $0.0021. A compact 2k-input/0.5k-output Sonnet adjudication is about $0.0135
and happens only when grounded candidates exist. Chunk count and actual output
length determine the real total.

## Recommendation

- Keep Luna as the default mapper for routine reviews.
- Choose a stronger agent model only when its specialist first pass materially
  improves the findings; the engine will still use the same fallback chain.
- Evaluate quality on repeated PR fixtures. Compare grounded finding precision,
  missed planted defects, severity calibration, fallback frequency, latency, and
  `usage.cost`—not the model's self-reported score, which the engine ignores.
- Do not encode “whole diff” or “one file per call” in custom prompts. The engine
  appends the authoritative scope for the current map/adjudication stage.

## Sources

- [GPT-5.6 Luna on OpenRouter](https://openrouter.ai/openai/gpt-5.6-luna)
- [GPT-5.6 Terra on OpenRouter](https://openrouter.ai/openai/gpt-5.6-terra)
- [Claude Haiku 4.5 on OpenRouter](https://openrouter.ai/anthropic/claude-haiku-4.5)
- [Claude Sonnet 4.6 on OpenRouter](https://openrouter.ai/anthropic/claude-sonnet-4.6)
- [OpenRouter Claude 4.6 migration guide](https://openrouter.ai/docs/cookbook/evaluate-and-optimize/model-migrations/claude-4-6)
