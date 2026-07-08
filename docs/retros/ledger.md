# Workflow retro ledger

One row per analyzed run, appended by /workflow-retro (newest last). Costs are API-list estimates.

| Date | Run | Sessions | Contexts | In (uncached) | Cache-write | Cache-read | Out | Cache-hit | Est. cost | Max ∥ | Top action |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 2026-07-02 | Project Context Folder (spec→plan) | adbafdeb | 4 | 69.7k | 890.8k | 12.00M | 111.0k | 92.6% | $12.48 | 2 | Relay subagent digests, not full artifacts, to shrink main's cache-read carry |
| 2026-07-03 | Project Context Folder (full spec→plan→implement) | adbafdeb | 20 | 225.9k | 6.02M | 162.66M | 508.9k | 96.3% | $106.89 | 2 | Avoid cold v2 re-plan; parallelize disjoint implementer waves (max ∥ stuck at 2) |
| 2026-07-04 | PR Why + Risk Brief (full spec→plan→implement) | 632562c8 | 25 | 188.4k | 3.69M | 115.15M | 407.3k | 96.7% | $71.95 | 4 | Split pipeline across sessions (main = 54% / $38.82); batch the reactive UI-polish tail instead of one cold agent per fix |
