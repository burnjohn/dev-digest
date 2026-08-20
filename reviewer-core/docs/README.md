# reviewer-core/docs

How the engine works today. Deep dives too long for `README.md`.

Good candidates: the grounding heuristics and exactly which findings get
dropped, deterministic score recomputation, prompt slot ordering and token
budget, `parseWithRepair` failure modes, the injection-fencing rules, the
map-reduce path.

Not here: the pipeline diagram and public API (that is `../README.md`), intent
for unbuilt slots (`../specs/`), rejected approaches (`../INSIGHTS.md`).

Built-in agent system prompts live in `../docs/agent-prompts/` at repo root —
link, do not copy.
