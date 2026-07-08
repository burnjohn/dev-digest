# Development Plan: GET /reviews/:id/export Markdown Endpoint

**Date:** 2026-07-05  
**Feature:** Export a review as markdown  
**Layer Affinity:** service (ReviewService) + route handler (routes.ts)

---

## Context

The client needs to export a single review as markdown. This is a new, non-persisted transformation endpoint (zero DB writes, zero LLM calls). It:

1. **Reads existing review** — via `GET /reviews/:id` logic (workspace-scoped)
2. **Transforms findings to markdown** — deterministic format
3. **Streams markdown** — content-type: `text/markdown`

## Architecture Fit

**Layer placement:** Onion (Fastify layer → Service layer → Repository layer)

- **Route handler** (`routes.ts`): Validates `reviewId` param via `getContext` (workspace-scoping), delegates to service
- **Service method** (`ReviewService.exportReviewAsMarkdown`): Pure transformation logic, returns markdown string
- **No new repository methods**: Reuse existing `ReviewService.getReview()` (already fetches review + findings)
- **No DB writes**: Query-only; workspace-scoped via PR join

**Conventions enforced:**

- Every call to `findingsForReview` passes `workspaceId` and joins through reviews → PR → workspace ✓
- Secrets/creds never embedded in routes ✓  
- Shared types stay in `@devdigest/shared` ✓
- Service is side-effect free (pure transformation of Review DTO → markdown) ✓

## Skills Applied

- Fastify 5 routing conventions (Zod + TypeProvider)
- ReviewDto/ReviewDtoFinding structure (already available from `helpers.ts`)
- Workspace-scoped queries via context pattern
- Markdown generation (no external library; raw template strings)

## Constraints

- No new tables/migrations (read-only)
- No breaking changes to existing routes
- Markdown format must be deterministic (same review → same markdown every time)
- Response type must signal markdown to clients (`text/markdown; charset=utf-8`)

## Implementation Steps

1. **Add route handler** to `routes.ts`:
   - `GET /reviews/:id/export`
   - Schema: `{ params: IdParams }` 
   - Response: `text/markdown` content-type
   - Calls `service.exportReviewAsMarkdown(reviewId, workspaceId)`

2. **Add service method** `ReviewService.exportReviewAsMarkdown()`:
   - Calls `this.getReview(workspaceId, reviewId)` (reuse existing fetch)
   - Returns 404 if review not found
   - Formats review + findings as markdown string (template literal)
   - Format includes: PR title, agent name, verdict, summary, findings table
   - Pure transformation (no DB writes, no side effects)

3. **Markdown template structure:**
   ```
   # Review: [PR Title] — [Agent Name]
   
   **Verdict:** [verdict]  
   **Score:** [score]/10  
   **Model:** [model]  
   **Date:** [created_at]
   
   ## Summary
   
   [summary]
   
   ## Findings
   
   ### Critical ([count])
   | File | Line | Category | Title | Rationale |
   | --- | --- | --- | --- | --- |
   | ... |
   
   ### Warning ([count])
   | ... |
   
   ### Suggestion ([count])
   | ... |
   ```

4. **Type safety:**
   - Accept `reviewId: string` from params
   - Return `Promise<string>` (markdown)
   - Fastify reply: `.type('text/markdown').send(markdown)`

5. **Error handling:**
   - Review not found → 404 via `NotFoundError` (existing pattern)
   - Workspace mismatch → 404 (already enforced by `getContext` + PR join)

## Acceptance Criteria

- ✅ Route `GET /reviews/:id/export` exists and is callable
- ✅ Returns markdown string with content-type `text/markdown`
- ✅ Markdown includes PR title, agent name, verdict, score, summary, findings
- ✅ Findings grouped by severity (Critical/Warning/Suggestion)
- ✅ Each finding row has: file, line, category, title, rationale
- ✅ Returns 404 for non-existent review (workspace-scoped)
- ✅ Returns 404 for cross-workspace attempt
- ✅ No DB writes; pure read + transformation
- ✅ Service method is side-effect free
- ✅ Deterministic: same review → identical markdown every time

## Testing Plan

**Unit tests** (`service.ts`):
- Mock ReviewRepository, call `exportReviewAsMarkdown()` with a sample ReviewDto
- Verify markdown structure contains all fields
- Verify finding grouping by severity
- Verify no DB calls occur

**Integration tests** (`routes.it.test.ts`):
- Create a PR + review (via seed or prior integration steps)
- Call `GET /reviews/:id/export`
- Assert response status 200 + content-type `text/markdown`
- Assert markdown body is well-formed (contains PR title, findings, etc.)
- Call with wrong reviewId → assert 404
- Call from different workspace → assert 404 (cross-workspace isolation)

## Out of Scope

- UI button/trigger (client task)
- Custom markdown templates (hardcoded format only)
- Streaming large reviews (inline markdown generation only)
- Markdown options/flags (single deterministic format)
- File downloads (client handles `Content-Disposition` if needed)

---

## Notes

- Reuse `ReviewService.getReview()` to avoid duplicate workspace-scoping logic
- Template format matches the review card UI structure (for consistency)
- No LLM calls in markdown generation (deterministic)
- Endpoint is read-only; fits the "report export" use case
