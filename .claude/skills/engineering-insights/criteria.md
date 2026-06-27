# Discovery Criteria

An insight must pass **all four tests** before being written. Failing any one test → skip.

---

## The Four Tests

### 1. Survival

Would a competent developer miss this without the entry?
If the information is evident from reading the code, the function signature, or the official docs — skip.

### 2. Specificity

Does this name a concrete file, function, API, or behavior?
A vague observation is not an insight. There must be a specific anchor.

### 3. Recurrence

Could this failure or confusion happen again — to a different agent or a future session?
One-off setup mistakes that will never recur → skip.

### 4. Non-obviousness

Would this surprise a developer who reads the relevant code carefully?
If the answer to the surprise question is "no" → skip.

---

## Pass / Fail Examples

### Mistakes category

| Entry | Verdict | Reason |
| --- | --- | --- |
| `Promise.all()` on the ingest pipeline times out past 30 concurrent LLM calls; use `Promise.allSettled()` with batches of 10. `server/src/modules/ingest/runner.ts:89` | **Pass** | Specific file, specific limit, specific fix — not in docs |
| Be careful with async code | **Fail** | No file, no behavior, no fix — pure noise |
| `groundFindings()` silently drops findings where `finding.file` is `null`; LLM sometimes omits `file` for repo-level comments. Always validate finding count after grounding. `reviewer-core/src/grounding.ts:112` | **Pass** | Names the function, the condition, the consequence, the fix |
| Remember to handle errors | **Fail** | Obvious to any developer; fails Survival and Specificity |

### Patterns category

| Entry | Verdict | Reason |
| --- | --- | --- |
| Checkout flow state must go through `cartStore.ts` — three components share the cart and local state causes silent divergence | **Pass** | Names the file, explains why, not evident from component code alone |
| Use TypeScript types for type safety | **Fail** | Obvious; fails all four tests |
| `apiFetch` in `client/src/lib/api.ts` is the only valid entry point for API calls — bypassing it skips auth headers and the error normalizer | **Pass** | Explains the hidden consequence of not following the rule |

### Decisions category

| Entry | Verdict | Reason |
| --- | --- | --- |
| Chose `Promise.allSettled()` over `Promise.all()` for batch LLM calls — partial success is better than full retry at this scale | **Pass** | Documents the *why* behind a choice that looks arbitrary in code |
| Using Postgres | **Fail** | The stack choice is in README.md — already documented |

### Quirks category

| Entry | Verdict | Reason |
| --- | --- | --- |
| `fastify-type-provider-zod` requires `.strict()` on schemas passed to `reply.send()` — omitting it silently strips extra fields without error | **Pass** | Non-obvious library behavior with a specific fix |
| Prisma Accelerate has a 5 MB response limit — use `.select()` not `.include()` on large relations | **Pass** | Concrete limit, concrete workaround, not in Accelerate landing page docs |
| Node.js requires version ≥ 22 | **Fail** | Already in root CLAUDE.md stack table |

---

## What Never Becomes an Insight

| Observation | Reason |
| --- | --- |
| Anything already in `CLAUDE.md` | Duplication — CLAUDE.md is already loaded |
| Anything in the library's official documentation | Fails Non-obviousness |
| Temporary workarounds tagged with a TODO | Will be fixed; stale immediately |
| Setup steps that ran once during clone | One-time; fails Recurrence |
| IDE or OS-specific behavior | Not reproducible by the agent |
| "It works" with no specifics | Fails all four tests |

---

## When to Stay in Conversation Only

Some discoveries should live only in the current session's context:

- A debugging hypothesis that turned out to be wrong
- A temporary workaround that was immediately reverted
- Context specific to a one-off PR that won't recur
- An observation that the code makes obvious on inspection

These are valuable *now* but add noise permanently. Do not write them.
