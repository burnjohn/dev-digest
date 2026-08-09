# Reliable PR Review Orchestration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace user-selected single-pass/per-file execution with automatic token-aware review orchestration, bounded OpenRouter calls, model fallback, and compact final adjudication.

**Architecture:** `reviewer-core` plans complete diff chunks, maps each chunk through a provider-aware model chain, grounds candidates, and adjudicates compact evidence when OpenRouter is available. The server always invokes automatic orchestration, reconciles untouched built-in agents to Luna and orchestration-neutral prompts, and records stage/model details; the client removes the obsolete strategy selector.

**Tech Stack:** TypeScript 5.7 strict, Vitest 2, Zod 3.24, OpenAI SDK 4.x, Fastify 5, Drizzle/PostgreSQL, React 19, Next.js 15, Testing Library, OpenRouter paid API.

## Global Constraints

- Work only in `/Users/anton/repos/dev-digest/.worktrees/fix-reliable-review-map-reduce` on `fix/reliable-review-map-reduce`.
- Never read from, fetch, push to, or open a PR against the `upstream` remote; GitHub operations target only `gunnzolder/dev-digest` through `gh`.
- Do not edit `server/src/vendor/shared/`, `client/src/vendor/shared/`, `server/src/db/migrations/`, or `client/src/vendor/ui/`.
- `reviewer-core` remains pure except for its injected `LLMProvider`, emits no JavaScript, and keeps the existing grounding gate and injection guard unchanged.
- Every production behavior starts with a failing test, is observed failing for the intended reason, then receives the minimum implementation needed to pass.
- Real paid OpenRouter validation is explicitly allowed, but it must not post a GitHub review.
- Existing user-customized agent models and system prompts must not be overwritten.
- A successful run must not silently omit any planned diff chunk.

## File Structure

| File | Responsibility |
|---|---|
| `reviewer-core/src/llm/structured.ts` | provider-portable JSON Schema plus authoritative Zod parse |
| `reviewer-core/src/llm/openrouter.ts` | request timeout, completion cap, and model-aware reasoning body |
| `reviewer-core/src/review/chunks.ts` | pure token estimation and complete diff chunk planning |
| `reviewer-core/src/review/model-policy.ts` | internal mapper/adjudicator chains and request budgets |
| `reviewer-core/src/review/adjudicate.ts` | compact candidate evidence prompt and deterministic dedupe fallback |
| `reviewer-core/src/review/run.ts` | map/fallback/ground/adjudicate orchestration and accounting |
| `reviewer-core/src/prompt.ts` | trusted stage-specific system instruction slot |
| `reviewer-core/src/index.ts` | public exports for testable pure helpers |
| `reviewer-core/test/*.test.ts` | hermetic red/green coverage for each engine boundary |
| `reviewer-core/test/live/openrouter-review.live.test.ts` | opt-in paid OpenRouter smoke/replay validation |
| `reviewer-core/vitest.live.config.ts` | isolated live-test configuration |
| `reviewer-core/package.json` | explicit `test:live` command |
| `server/src/modules/reviews/run-executor.ts` | automatic engine wiring and stage/model trace metadata |
| `server/src/platform/container.ts` | disable repeated same-model OpenRouter timeout attempts; engine fallback owns recovery |
| `server/src/db/seed.ts` | Luna default plus guarded legacy-row reconciliation |
| `server/src/db/seed-prompts.ts` | orchestration-neutral built-in prompts |
| `docs/agent-prompts/*.md` | human-readable mirrors of built-in prompts |
| `server/test/seed-review-defaults.it.test.ts` | DB-backed reconciliation behavior |
| `server/test/reviews.it.test.ts` | studio wiring and trace behavior |
| `client/src/app/agents/[id]/_components/AgentEditor/_components/ConfigTab/ConfigTab.tsx` | Agent editor without strategy selector/state/payload |
| `client/src/app/agents/[id]/_components/AgentEditor/_components/ConfigTab/constants.ts` | remaining provider and CI gate constants |
| `client/src/app/agents/[id]/_components/AgentEditor/AgentEditor.test.tsx` | UI absence and save-payload regression guard |
| `client/messages/en/agents.json` | remove obsolete strategy copy |

---

### Task 1: Provider-portable Review schema

**Files:**
- Modify: `reviewer-core/src/llm/structured.ts`
- Create: `reviewer-core/test/structured.test.ts`

**Interfaces:**
- Produces: `portableJsonSchema(schema: Record<string, unknown>): Record<string, unknown>`
- Keeps: `toJsonSchema<T>(schema: z.ZodType<T>, name: string): JsonSchema`
- Invariant: transport schema is relaxed only for unsupported JSON-Schema keywords; `parseWithRepair` still validates the original Zod schema.

- [ ] **Step 1: Write failing portable-schema tests**

Create tests that convert the real shared `Review` schema and recursively assert that the result contains no `$ref`, `$defs`, `definitions`, `minimum`, or `maximum`. Add a hand-built schema with two references to the same definition and assert both are independently inlined. Finally call `parseWithRepair(Review, raw)` with `confidence: 2` and assert `ok === false` so transport normalization cannot weaken application validation.

```ts
const json = toJsonSchema(Review, 'Review').schema;
expect(findKeys(json, '$ref')).toEqual([]);
expect(findKeys(json, 'minimum')).toEqual([]);
expect(findKeys(json, 'maximum')).toEqual([]);

const parsed = parseWithRepair(Review, JSON.stringify(reviewWithConfidence(2)));
expect(parsed.ok).toBe(false);
```

- [ ] **Step 2: Run the new test and verify RED**

Run: `cd reviewer-core && npm test -- test/structured.test.ts`

Expected: FAIL because the current Zod-generated schema retains local references and numeric bounds.

- [ ] **Step 3: Implement recursive normalization**

Add a pure recursive walker that resolves only local `#/$defs/...` and `#/definitions/...` references, detects reference cycles with a path-local `Set`, clones resolved nodes, strips definition containers after expansion, and omits `minimum`/`maximum`. Call it from `toJsonSchema` before returning.

```ts
export function portableJsonSchema(root: Record<string, unknown>): Record<string, unknown> {
  const definitions = readDefinitions(root);
  return normalizeNode(root, definitions, new Set()) as Record<string, unknown>;
}
```

- [ ] **Step 4: Run the focused test and full reviewer-core suite**

Run: `cd reviewer-core && npm test -- test/structured.test.ts && npm test && npm run typecheck`

Expected: focused test and all 34+ tests pass; typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add reviewer-core/src/llm/structured.ts reviewer-core/test/structured.test.ts
git commit -m "fix(reviewer): normalize structured output schemas"
```

### Task 2: Bounded, model-aware OpenRouter generation

**Files:**
- Modify: `reviewer-core/src/llm/openrouter.ts`
- Modify: `reviewer-core/test/openrouter.test.ts`
- Modify: `server/src/platform/container.ts`

**Interfaces:**
- Produces internally: `openRouterTuning(model: string, maxTokens?: number): Record<string, unknown>`
- Consumes existing `StructuredRequest.timeoutMs` and `StructuredRequest.maxTokens` without changing shared contracts.
- Server OpenRouter provider uses `transportRetries: 0`; model-level fallback in Task 5 owns recovery.

- [ ] **Step 1: Write failing request-body and timeout tests**

Extend the injected-fetch seam to capture request JSON and abort timing. Assert:

- DeepSeek V4 receives `reasoning: { enabled: false }` and `max_tokens: 4096`.
- GPT-5.6 Luna receives `reasoning: { effort: 'low' }`.
- Qwen Coder Next receives no reasoning field.
- `req.timeoutMs: 20` aborts near 20 ms even when provider default is 90 seconds.

The production mutation each test catches is respectively hidden reasoning consuming JSON output, an unsupported reasoning field on non-reasoning models, or request timeout being ignored.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `cd reviewer-core && npm test -- test/openrouter.test.ts`

Expected: FAIL because the request body has no reasoning control and uses only the provider-level timeout.

- [ ] **Step 3: Implement model-aware body and request timeout**

Use exact model-family predicates, default review output to 4096 only when the caller supplied a cap, and build a fresh `AbortSignal.timeout(req.timeoutMs ?? this.timeoutMs)` per transport attempt. Do not change cancellation semantics.

```ts
function openRouterTuning(model: string): Record<string, unknown> {
  if (model.startsWith('deepseek/deepseek-v4')) return { reasoning: { enabled: false } };
  if (model.startsWith('openai/gpt-5.6-')) return { reasoning: { effort: 'low' } };
  return {};
}
```

Set `transportRetries: 0` only in the server's production `OpenRouterProvider` construction. Existing provider unit tests continue to exercise retry behavior by supplying explicit test options.

- [ ] **Step 4: Verify focused and package tests**

Run: `cd reviewer-core && npm test -- test/openrouter.test.ts && npm test && npm run typecheck`

Run: `cd server && pnpm test --exclude '**/*.it.test.ts' && pnpm typecheck`

Expected: all commands exit 0.

- [ ] **Step 5: Commit**

```bash
git add reviewer-core/src/llm/openrouter.ts reviewer-core/test/openrouter.test.ts server/src/platform/container.ts
git commit -m "fix(review): bound OpenRouter model generation"
```

### Task 3: Token-aware diff planner

**Files:**
- Create: `reviewer-core/src/review/chunks.ts`
- Create: `reviewer-core/test/chunks.test.ts`
- Modify: `reviewer-core/src/index.ts`

**Interfaces:**
- Produces: `estimateTokens(text: string): number`
- Produces: `planReviewChunks(input: PlanReviewChunksInput): ReviewChunk[]`

```ts
export interface ReviewChunk {
  label: string;
  diffText: string;
  files: string[];
  estimatedTokens: number;
}

export interface PlanReviewChunksInput {
  diff: UnifiedDiff;
  promptOverheadTokens: number;
  maxPromptTokens?: number;
  minDiffTokens?: number;
}
```

- [ ] **Step 1: Write failing planner tests**

Use literal unified-diff fixtures and assert:

1. a small two-file diff stays one chunk;
2. complete file blocks are grouped without exceeding the token budget;
3. multiple hunks in one file split on hunk boundaries;
4. one oversized hunk splits into adjusted continuation hunks whose union contains every added/deleted line exactly once;
5. increasing `promptOverheadTokens` increases chunk count;
6. overhead leaving less than `minDiffTokens` throws `PromptBudgetExceededError` rather than emitting an oversized chunk;
7. labels remain stable across identical calls.

- [ ] **Step 2: Run the planner test and verify RED**

Run: `cd reviewer-core && npm test -- test/chunks.test.ts`

Expected: FAIL because `chunks.ts` and its exports do not exist.

- [ ] **Step 3: Implement file/hunk parsing and conservative token estimation**

Estimate as `ceil(utf8Bytes / 3)` using `TextEncoder`. Parse raw unified diff into file header plus hunk blocks. Greedily pack complete blocks under `maxPromptTokens - promptOverheadTokens`.

For an oversized hunk, split diff lines and recompute each synthetic header's old/new start and counts. Context lines advance both sides, additions advance new only, deletions advance old only, and `\\ No newline at end of file` advances neither. Repeat file metadata and the original hunk function suffix but never duplicate a changed line.

- [ ] **Step 4: Verify focused and full engine suites**

Run: `cd reviewer-core && npm test -- test/chunks.test.ts && npm test && npm run typecheck`

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add reviewer-core/src/review/chunks.ts reviewer-core/test/chunks.test.ts reviewer-core/src/index.ts
git commit -m "feat(reviewer): plan token-aware diff chunks"
```

### Task 4: Stage-aware prompts and internal model policy

**Files:**
- Modify: `reviewer-core/src/prompt.ts`
- Modify: `reviewer-core/test/prompt.test.ts`
- Create: `reviewer-core/src/review/model-policy.ts`
- Create: `reviewer-core/test/model-policy.test.ts`
- Modify: `reviewer-core/src/index.ts`

**Interfaces:**
- Adds optional `stageInstruction?: string` to `PromptParts`.
- Produces: `reviewModelPlan(provider: LLMProvider['id'], preferredModel: string): ReviewModelPlan`.

```ts
export interface ReviewModelPlan {
  mappers: readonly string[];
  adjudicators: readonly string[];
  mapMaxTokens: number;
  adjudicateMaxTokens: number;
  mapTimeoutMs: number;
  adjudicateTimeoutMs: number;
}
```

- [ ] **Step 1: Write failing stage-prompt tests**

Assert an agent prompt containing “full PR diff in one pass” is followed by the exact trusted instruction `CURRENT REVIEW SCOPE — one chunk of a larger pull request`; assert it appears after the injection guard and is absent when no stage instruction is supplied.

- [ ] **Step 2: Write failing model-policy tests**

Assert OpenRouter preferred DeepSeek produces mapper order `[preferred, Luna, Haiku]`, preferred Luna deduplicates Luna, adjudicators are `[Sonnet, Terra]`, and direct OpenAI/Anthropic policies contain only the preferred mapper and no cross-vendor adjudicators.

- [ ] **Step 3: Run focused tests and verify RED**

Run: `cd reviewer-core && npm test -- test/prompt.test.ts test/model-policy.test.ts`

Expected: FAIL because neither API exists.

- [ ] **Step 4: Implement prompt slot and policy constants**

Append the trusted stage instruction to the system message after the existing injection guard. Keep the existing guard byte-for-byte unchanged. Implement stable deduplication and export named model constants for seed/runtime tests.

- [ ] **Step 5: Verify engine tests and typecheck**

Run: `cd reviewer-core && npm test && npm run typecheck`

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add reviewer-core/src/prompt.ts reviewer-core/test/prompt.test.ts reviewer-core/src/review/model-policy.ts reviewer-core/test/model-policy.test.ts reviewer-core/src/index.ts
git commit -m "feat(reviewer): define review stages and model policy"
```

### Task 5: Mapper fallback, grounding, and compact adjudication

**Files:**
- Create: `reviewer-core/src/review/adjudicate.ts`
- Create: `reviewer-core/test/adjudicate.test.ts`
- Modify: `reviewer-core/src/review/reduce.ts`
- Modify: `reviewer-core/src/review/run.ts`
- Modify: `reviewer-core/test/run.test.ts`
- Modify: `reviewer-core/src/index.ts`

**Interfaces:**
- Produces: `buildAdjudicationMessages(input): ChatMessage[]`
- Produces: `dedupeFindings(findings: Finding[]): Finding[]`
- Extends `ReviewOutcome.chunks` to include actual `model` and `stage`.
- Keeps `ReviewInput.strategy` only as a deprecated compatibility field; the planner determines execution.

- [ ] **Step 1: Write failing adjudication-helper tests**

Assert evidence contains only the cited file and a small changed-line window, candidates are wrapped as untrusted data, duplicate findings collapse deterministically, and exact file/line anchors survive.

- [ ] **Step 2: Write failing orchestration tests**

Use a real scripted `LLMProvider` fake that records complete structured requests and returns full `StructuredResult` objects. Cover these observable behaviors:

- a small diff maps once through the preferred model;
- a large diff uses every planned chunk;
- a mapper error falls back to Luna/Haiku only for the failed chunk;
- a caller-aborted signal stops immediately and never calls fallback;
- exhausting all mappers names the chunk and attempted models in the thrown error;
- mapper findings are grounded before reducer input;
- no grounded candidates skips adjudication and returns score 100;
- OpenRouter candidates use Sonnet adjudication, then Terra on failure;
- exhausting adjudicators returns deduplicated grounded candidates and emits degraded mode;
- token/cost totals and raw output include all successful map and adjudication calls;
- chunk trace entries carry the actual stage/model.

- [ ] **Step 3: Run focused tests and verify RED**

Run: `cd reviewer-core && npm test -- test/adjudicate.test.ts test/run.test.ts`

Expected: FAIL because current execution obeys stored strategy, maps per file only, uses one model, and performs deterministic concatenation without LLM adjudication.

- [ ] **Step 4: Implement compact evidence and deterministic fallback**

Parse changed lines from the original unified diff, render a maximum three-line context window around each candidate anchor, and wrap candidates/evidence through `wrapUntrusted`. Deduplicate by normalized `file:start_line:end_line:category:title` while keeping the highest-confidence duplicate.

- [ ] **Step 5: Implement automatic orchestration in `run.ts`**

Compute prompt overhead using `assemblePrompt` with an empty diff, call `planReviewChunks`, and map sequentially so cancellation and spend remain predictable. For each model attempt pass explicit `maxTokens`, `timeoutMs`, stage instruction, session id, and signal. Catch any model error except caller cancellation, emit fallback, and continue the chain.

Ground each partial immediately. If no candidates remain, skip reducer. For OpenRouter candidates call adjudicators in order; direct providers use deterministic dedupe/reduce. Ground and score the final review again.

- [ ] **Step 6: Verify focused and full reviewer-core tests**

Run: `cd reviewer-core && npm test -- test/adjudicate.test.ts test/run.test.ts`

Run: `cd reviewer-core && npm test && npm run typecheck`

Expected: all pass with no warning output.

- [ ] **Step 7: Commit**

```bash
git add reviewer-core/src/review/adjudicate.ts reviewer-core/test/adjudicate.test.ts reviewer-core/src/review/reduce.ts reviewer-core/src/review/run.ts reviewer-core/test/run.test.ts reviewer-core/src/index.ts
git commit -m "feat(reviewer): orchestrate grounded map adjudication"
```

### Task 6: Studio wiring and guarded built-in reconciliation

**Files:**
- Modify: `server/src/modules/reviews/run-executor.ts`
- Modify: `server/src/modules/reviews/constants.ts`
- Modify: `server/src/db/seed.ts`
- Modify: `server/src/db/seed-prompts.ts`
- Modify: `docs/agent-prompts/general-reviewer.md`
- Modify: `docs/agent-prompts/security-reviewer.md`
- Modify: `docs/agent-prompts/performance-reviewer.md`
- Create: `server/test/seed-review-defaults.it.test.ts`
- Modify: `server/test/reviews.it.test.ts`

**Interfaces:**
- Studio omits `strategy` when calling `reviewPullRequest`.
- Seed reconciliation changes model only when provider/model equal the legacy built-in pair.
- Prompt reconciliation changes a built-in prompt only when it exactly equals the legacy prompt text.

- [ ] **Step 1: Write failing seed reconciliation integration test**

Seed a database, change one built-in to a custom model/prompt, force another built-in back to the exact legacy DeepSeek model/prompt, seed again, and assert:

- untouched legacy row becomes OpenRouter Luna with the new neutral prompt;
- customized row remains byte-for-byte unchanged;
- a third seed is idempotent and does not increment versions or create duplicates.

- [ ] **Step 2: Write failing studio wiring test**

Persist an agent with `strategy: 'single-pass'`, run a diff large enough for multiple planned chunks through injected LLMs, and assert the trace contains multiple `review_file` entries whose `meta` includes stage and actual model. This catches any reintroduction of `agent.strategy` into execution.

- [ ] **Step 3: Run focused tests and verify RED**

Run: `cd server && pnpm test test/seed-review-defaults.it.test.ts test/reviews.it.test.ts`

Expected: FAIL because seed does not reconcile existing rows and run-executor forwards stored strategy.

- [ ] **Step 4: Implement guarded reconciliation and neutral prompts**

Export legacy prompt constants internally or define exact old/new pairs in `seed.ts`. Update only exact legacy values; never use a broad name-only update. Change the three prompt mirrors in the same commit.

- [ ] **Step 5: Wire automatic execution and trace stage/model**

Remove `REVIEW_STRATEGY` from runtime use. Map `outcome.chunks` to trace entries with `args: chunk.label` and `meta: `${chunk.stage}:${chunk.model}``. Keep persisted review and run config model as the preferred agent model for compatibility.

- [ ] **Step 6: Verify server tests**

Run: `cd server && pnpm test test/seed-review-defaults.it.test.ts test/reviews.it.test.ts`

Run: `cd server && pnpm test --exclude '**/*.it.test.ts' && pnpm typecheck`

Expected: focused integration tests, all hermetic tests, and typecheck pass.

- [ ] **Step 7: Commit**

```bash
git add server/src/modules/reviews/run-executor.ts server/src/modules/reviews/constants.ts server/src/db/seed.ts server/src/db/seed-prompts.ts docs/agent-prompts server/test/seed-review-defaults.it.test.ts server/test/reviews.it.test.ts
git commit -m "feat(server): enable automatic review orchestration"
```

### Task 7: Remove the obsolete Agent strategy control

**Files:**
- Modify: `client/src/app/agents/[id]/_components/AgentEditor/_components/ConfigTab/ConfigTab.tsx`
- Modify: `client/src/app/agents/[id]/_components/AgentEditor/_components/ConfigTab/constants.ts`
- Modify: `client/src/app/agents/[id]/_components/AgentEditor/AgentEditor.test.tsx`
- Modify: `client/messages/en/agents.json`

**Interfaces:**
- The Agent API response may still contain `strategy`; the editor neither renders nor sends it.
- Provider/model, CI gate, repo-intelligence, and system-prompt controls remain unchanged.

- [ ] **Step 1: Write failing UI and payload tests**

Capture the `useUpdateAgent().mutate` input in the existing component test. Assert `queryByText('Review strategy')` is null, click Save, and assert the sent patch has no own `strategy` property while retaining `model`, `ci_fail_on`, and `repo_intel`.

- [ ] **Step 2: Run the focused client test and verify RED**

Run: `cd client && pnpm test -- AgentEditor.test.tsx`

Expected: FAIL because the selector renders and the patch contains `strategy`.

- [ ] **Step 3: Remove strategy state, selector, constant, and messages**

Do not change the vendored `Agent` contract. Remove only the editor-facing imports/state/effect/save field/UI and dead translation keys.

- [ ] **Step 4: Verify client test, full suite, typecheck, and build**

Run: `cd client && pnpm test -- AgentEditor.test.tsx && pnpm test && pnpm typecheck && pnpm build`

Expected: all exit 0; static rendering has no missing-message errors.

- [ ] **Step 5: Commit**

```bash
git add client/src/app/agents/[id]/_components/AgentEditor/_components/ConfigTab/ConfigTab.tsx client/src/app/agents/[id]/_components/AgentEditor/_components/ConfigTab/constants.ts client/src/app/agents/[id]/_components/AgentEditor/AgentEditor.test.tsx client/messages/en/agents.json
git commit -m "feat(client): make review strategy automatic"
```

### Task 8: Paid OpenRouter validation and final verification

**Files:**
- Create: `reviewer-core/test/live/openrouter-review.live.test.ts`
- Create: `reviewer-core/vitest.live.config.ts`
- Modify: `reviewer-core/package.json`
- Modify if insight is confirmed: `reviewer-core/INSIGHTS.md` through the engineering-insights script only

**Interfaces:**
- Produces command: `npm run test:live`
- Reads `OPENROUTER_API_KEY`; never reads or posts GitHub credentials.

- [ ] **Step 1: Write the opt-in paid test before the live-test harness**

The live test constructs `OpenRouterProvider`, calls `reviewPullRequest`, and asserts original Zod validation, bounded completion, automatic fallback from an invalid preferred model, and planted grounded findings. Build a 55k-class synthetic multi-file diff plus an oversized single-file hunk entirely in memory so no GitHub request is made.

- [ ] **Step 2: Run the live command and verify initial RED**

Run: `cd reviewer-core && OPENROUTER_API_KEY="$(node -e 'const fs=require("fs");const p=process.env.HOME+"/.devdigest/secrets.json";const j=JSON.parse(fs.readFileSync(p,"utf8"));process.stdout.write(j.OPENROUTER_API_KEY||"")')" npm run test:live`

Expected: FAIL because the live Vitest config/script does not exist yet.

- [ ] **Step 3: Add the isolated live configuration and package script**

Configure only `test/live/**/*.test.ts`, `testTimeout: 180_000`, and the same shared-contract alias as the hermetic config. Add `"test:live": "vitest run --config vitest.live.config.ts"`.

- [ ] **Step 4: Run paid validation**

Run the command from Step 2. Record latency, models attempted, tokens, cost, chunk count, and grounded findings from test output. If quality assertions fail, adjust prompts/budgets through a fresh red-green cycle rather than weakening assertions.

- [ ] **Step 5: Run complete verification**

```bash
cd reviewer-core && npm test && npm run typecheck
cd ../server && pnpm test --exclude '**/*.it.test.ts' && pnpm test test/seed-review-defaults.it.test.ts test/reviews.it.test.ts && pnpm typecheck
cd ../client && pnpm test && pnpm typecheck && pnpm build
cd .. && git diff --check && git status --short
```

Expected: every test command reports zero failures, both typechecks and client build exit 0, and `git diff --check` is silent.

- [ ] **Step 6: Run engineering-insights sweep**

Run:

```bash
node .claude/skills/engineering-insights/scripts/insights.mjs status
node .claude/skills/engineering-insights/scripts/insights.mjs check reviewer-core "Automatic per-chunk model fallback completes a bounded review without rerunning successful chunks"
```

Append only genuinely new, evidence-backed findings through the script. If none exist, record nothing and report that explicitly.

- [ ] **Step 7: Commit validation assets and any scripted insight update**

```bash
git add reviewer-core/test/live reviewer-core/vitest.live.config.ts reviewer-core/package.json reviewer-core/INSIGHTS.md
git commit -m "test(reviewer): validate automatic OpenRouter review"
```

- [ ] **Step 8: Review the complete branch**

Inspect `git diff origin/main...HEAD`, verify every spec success criterion maps to a passing test or paid result, then invoke `superpowers:requesting-code-review`, `code-reviewer`, `code-simplifier`, and `security-reviewer` as required by their trigger rules. Apply accepted findings through new TDD cycles.
