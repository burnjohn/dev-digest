# Spec: Review Run

Describes the behavior of `POST /pulls/:id/review` and the `ReviewService.runReview()` pipeline.

## Inputs

| Field | Type | Source | Notes |
|---|---|---|---|
| `pr_id` | UUID | route param | Must exist and belong to workspace |
| `agent_ids` | UUID[] | request body | Must be enabled agents in the workspace |
| diff | string | DB (`pr_files`) | Assembled from stored file diffs |
| system_prompt | string | agent config | Merged with `INJECTION_GUARD` by reviewer-core |
| repo_map | string? | repo-intel cache | Omitted when `REPO_INTEL_ENABLED=false` or index not ready |
| skills | string? | agent config | Appended as a prompt slot (L02+) |

## Response (immediate)

Returns before the review completes:
```json
{
  "pr_id": "...",
  "runs": [{ "run_id": "...", "agent_id": "...", "agent_name": "..." }],
  "reviews": []
}
```
Client subscribes to `GET /runs/:id/events` (SSE) for live progress.

## Outputs (persisted after run)

| Entity | Table | Notes |
|---|---|---|
| Run record | `agent_runs` | Created upfront with status `running` |
| Review | `reviews` | One per agent, verdict + score |
| Findings | `findings` | Only grounded findings (see grounding behavior) |
| Trace | `run_traces` | Single JSONB document, full run log |

## Grounding behavior

- Finding cites `file` + `start_line` that exist in the diff → **kept**
- Finding cites a non-existent line → **dropped**, never persisted
- Full-file kinds (`secret_leak`, `lethal_trifecta`, `phantom`, `hook`) → file must exist in diff
- Score is recomputed from surviving findings only — LLM score is discarded

## SSE event stream (`GET /runs/:id/events`)

| Event `kind` | When emitted |
|---|---|
| `run.started` | Run begins |
| `run.progress` | Each LLM chunk or tool call |
| `run.grounding` | After grounding (N kept / N dropped) |
| `run.complete` | All findings persisted, trace written |
| `run.error` | Fatal failure |

## Edge cases

| Scenario | Expected behavior |
|---|---|
| Agent not found | 404 before run starts, no `agent_runs` row created |
| PR has no diff | Run completes, zero findings, verdict `comment`, score 0 |
| LLM timeout / error | Run marked `failed`; error message persisted in trace |
| All findings dropped by grounding | Score 0, verdict `comment` |
| Stale `running` run on boot | Reaped to `complete` by `ReviewService` on server startup |
| Diff > 400 lines per file | Map-reduce strategy: one LLM call per large file, merged by `reduceReviews()` |
