---
name: deprecation-policy
description: When the diff removes or replaces a public surface, require a deprecation window instead of a silent deletion.
type: convention
---

# Deprecation over deletion

A public surface is never deleted in the same change that replaces it. Deletion is
a separate, later change, made after callers have had a release to move. When the
diff removes or replaces something callers depend on, check for all four parts of
a deprecation and report whichever is missing.

## The four parts

1. **The old surface still works.** The field, route, or export is still there and
   still returns what it returned before.
2. **It is marked.** `@deprecated` on the symbol or schema field, with one line
   saying what to use instead.
3. **The replacement exists in the same change.** A deprecation with nowhere to go
   is just an unannounced removal with extra steps.
4. **The removal is scheduled.** A version or date, in the marker itself — not in a
   ticket nobody reading this code will see.

A removal that skips part 1 is a breaking change; report it as CRITICAL and say so.
A removal that has part 1 but is missing 2, 3, or 4 is a WARNING: callers keep
working today, but nothing tells them they are on a dead path.

## Bad — silent deletion

```diff
 export const ReviewDto = z.object({
   id: z.string(),
-  score: z.number(),
   rating: z.number(),
 });
```

`score` is gone in the same commit `rating` appears. Every consumer reading `score`
breaks on deploy, with no warning in any previous release. The rename is invisible
in the type system of anyone downstream.

## Bad — marked, but removed anyway

```diff
-  /** @deprecated use rating */
-  score: z.number(),
```

The marker was added and the field deleted in the same release. A deprecation
window that never elapsed is not a deprecation.

## Good — both shapes, marked, with an end date

```diff
 export const ReviewDto = z.object({
   id: z.string(),
+  /** @deprecated use `rating`; removed in v3.0 (2026-10) */
   score: z.number(),
+  rating: z.number(),
 });
```

Old callers keep reading `score`, new callers read `rating`, and the removal is a
scheduled change someone can plan for.

## Good — a route deprecated by addition

```diff
+app.get('/reviews/:id/summary', handler);          // replacement
 app.get('/reviews/:id/digest', async (req, reply) => {
+  reply.header('Deprecation', 'true');
+  reply.header('Sunset', 'Wed, 01 Oct 2026 00:00:00 GMT');
+  reply.header('Link', '</reviews/:id/summary>; rel="successor-version"');
   return handler(req, reply);
 });
```

## What to report

Name the surface, the caller that would break, and which of the four parts is
missing. When the change removes something with no replacement at all, say what a
caller is supposed to do instead — if there is no answer, that is the finding.
