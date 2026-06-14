# reviewer-core (@devdigest/reviewer-core)

## Iron rule
No I/O — no DB, fs, GitHub, or persistence. Only the injected `LLMProvider`. The same code
runs in the studio (server) and in CI. Keep it pure.

## Before answering
Search `reviewer-core/docs/`, `reviewer-core/specs/`, `reviewer-core/INSIGHTS.md` first.

## Conventions (not obvious from code)
- The grounding gate (`src/grounding.ts`) is mandatory; score is computed from findings that SURVIVED grounding, not the model's self-report.
- skills/memory/specs arrive as RESOLVED strings (slug→body is the caller's job).

## Use when
- Pipeline overview → read `reviewer-core/README.md`
- Deep-dives → read `reviewer-core/docs/` · specs → read `reviewer-core/specs/` · findings → read `reviewer-core/INSIGHTS.md`
