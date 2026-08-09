# reviewer-core/specs

Specs for the review engine's contracts and behaviour — the shape of prompts,
grounding rules, verdict/score semantics, and the optional prompt slots (`skills`,
`memory`, `specs`, `callers`) that later lessons feed in.

Because the engine is provider-agnostic and mock-tested, a spec here doubles as the
acceptance criteria for its hermetic vitest cases.
