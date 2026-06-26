# Spec: reviewPullRequest()

Describes the contract for the engine's main entry point.

## Inputs (`ReviewInput`)

| Field | Type | Required | Notes |
|---|---|---|---|
| `systemPrompt` | string | yes | Agent system prompt — `INJECTION_GUARD` appended automatically |
| `modelId` | string | yes | Provider-qualified model ID (e.g., `openai/gpt-4o`) |
| `diff` | `UnifiedDiff` | yes | Parsed diff — source of truth for grounding |
| `llmProvider` | `LLMProvider` | yes | Injected — no direct SDK imports inside the engine |
| `skills` | string? | no | Appended as a prompt slot |
| `memory` | string? | no | Appended as a prompt slot |
| `specs` | string? | no | Appended as a prompt slot |
| `callers` | string? | no | Appended as a prompt slot |
| `repoMap` | string? | no | Appended as a prompt slot |
| `prDescription` | string? | no | Appended as a prompt slot |
| `strategy` | `'auto' \| 'single-pass' \| 'map-reduce'` | no | Defaults to `auto` |

## Outputs (`ReviewOutcome`)

| Field | Notes |
|---|---|
| `review` | `Review` — verdict, score (recomputed post-grounding), findings (grounded only) |
| `events` | `ReviewEvent[]` — progress log (mirrors SSE stream) |
| `assembly` | `PromptAssembly` — snapshot of what was sent to the LLM |
| `grounding` | Summary: N kept, N dropped |

## Strategy selection (`auto`)

| Condition | Strategy chosen |
|---|---|
| All files ≤ 400 lines | `single-pass` — one LLM call for the full diff |
| Any file > 400 lines | `map-reduce` — one LLM call per large file, results merged via `reduceReviews()` |

## Grounding invariants

- Every finding in the output cites a `file` + `start_line` that exists in `diff`
- Full-file kinds (`secret_leak`, `lethal_trifecta`, `phantom`, `hook`) require only that the file exists
- Score is recomputed from surviving findings — LLM-reported score is never trusted
- Dropped findings are recorded in `grounding` summary but never returned in `review.findings`

## Prompt invariants

- Untrusted content (diff, PR body, code) is always wrapped in `<untrusted>…</untrusted>`
- `INJECTION_GUARD` is always the last rule in the system prompt — never before user-provided rules
- Optional slots are omitted entirely when `undefined` — no empty section headers in the prompt

## Edge cases

| Scenario | Behavior |
|---|---|
| Empty diff | Returns zero findings, verdict `comment`, score 0 |
| LLM returns malformed JSON | `parseWithRepair()` attempts fix; on failure returns parse error in `events` |
| All findings dropped by grounding | Score 0, verdict `comment`, `review.findings = []` |
| Single file > 400 lines in map-reduce | That file gets its own LLM call; others batched normally |
