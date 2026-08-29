# Insights — reviewer-core

Running log of non-obvious findings, decisions, and gotchas for the review engine.
Append newest at the top. Keep entries short: what surprised you, why it is that
way, and what to do about it. [AGENTS.md](AGENTS.md) stays lean by pointing here.

<!-- Format: ### YYYY-MM-DD — short title, then 1–3 lines. -->

### 2026-08-29 — the guard says untrusted text can never waive a review; a TRUSTED channel now can, narrowly
`assemblePrompt` gained `suppressions` — dismissed-finding locations rendered UN-wrapped beside the
diff, with `SUPPRESSION_DIRECTIVE` in the system message. It is the only rule in `prompt.ts` that can
stop a real defect being reported, so the split matters: INJECTION_GUARD's subject is content
arriving through `<untrusted>` (a diff saying "ignore this"), and that still never descopes anything.
A suppression arrives first-party — an owner clicked Dismiss — and is scoped to one file plus one
line range, with the directive explicitly keeping a DIFFERENT defect at those lines reportable.
Entries carry NO finding title on purpose: a title is model output derived from an untrusted diff,
and promoting it into the trusted half would let a crafted diff write trusted prompt text once the
owner dismissed it. `sanitizeSuppression` flattens control chars and escapes the closing delimiter —
structural neutralisation, not the keyword scanning the 2026-08-09 entry rules out.

### 2026-08-29 — a JSON schema pins STRUCTURE, never language: DeepSeek returned `rationale` in Chinese
`response_format: json_schema` with `strict: true` guarantees the shape and nothing about the prose
inside it, and no agent system prompt in this repo names an output language. On
`deepseek/deepseek-v4-flash` that surfaced as findings whose `rationale`/`suggestion` came back in
Chinese while every field validated. `assemblePrompt` now appends `OUTPUT_LANGUAGE_RULE` beside
`INJECTION_GUARD` on BOTH the intent and no-intent paths, so it cannot be a per-agent setting an
agent forgets — `reviews/brief-generator.ts` and `reviews/intent-classifier.ts` server-side already
carried the same rule; the review path was the one that never got it. `test/prompt.test.ts` keeps a
verbatim copy as a tripwire, same as it does for the guard.

### 2026-08-09 — seed
- **The build is a type-check.** The package never emits JS; consumers read `src`
  directly via tsconfig alias. If a consumer can't see a symbol, export it from `index.ts`.
- **Grounding is the safety net, not a nice-to-have.** Never relax `groundFindings`
  to "trust" a location or score — hallucinated line numbers are exactly what it stops.
- **Don't add keyword scanning for prompt injection.** The defense is the single
  `INJECTION_GUARD` rule; a denylist only catches one phrasing and gives false comfort.
