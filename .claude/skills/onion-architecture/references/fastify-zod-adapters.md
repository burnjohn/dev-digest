# Fastify and Zod adapters

Fastify is a driving adapter. Zod schemas in a Fastify route describe the wire boundary; they do not define the domain or replace an application use case.

## Positive route contract

Build every HTTP or SSE adapter in this order:

1. Declare request schemas and response schemas for every status the adapter emits.
2. Authenticate the request and obtain its `workspaceId` context.
3. Map the validated transport values and authenticated context into one use-case input.
4. Call one application use case.
5. Map its typed result or error to an HTTP status, response body, headers, or SSE events.

Do not collapse those steps into a route-owned transaction or business decision, even for a small patch. The handler must not query Drizzle, instantiate a repository or SDK, receive the whole `Container`, or decide whether a review is allowed to complete.

The abbreviated Fastify 5 shape below consumes the `CompleteReview` contract from [core-rules.md](core-rules.md). The authentication plugin or hook that runs before this route supplies `request.auth.workspaceId`; its declaration is omitted. The route plugin receives the use case through plugin options, and the composition root chooses the implementation.

```ts
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { type ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { CompleteReview, Review } from '../../application/complete-review.js';
import {
  ReviewAlreadyCompletedError,
  ReviewNotFoundError,
} from '../../application/complete-review.js';

const CompleteReviewParams = z.object({
  reviewId: z.string().uuid(),
});

const ReviewResponse = z.object({
  id: z.string().uuid(),
  status: z.enum(['running', 'completed']),
});
type ReviewResponseBody = z.infer<typeof ReviewResponse>;

const ErrorResponse = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

interface CompleteReviewRoutesOptions {
  completeReview: CompleteReview;
}

function toReviewResponse(review: Review): ReviewResponseBody {
  return { id: review.id, status: review.status };
}

function mapCompleteReviewError(error: unknown, reply: FastifyReply) {
  if (error instanceof ReviewNotFoundError) {
    return reply.code(404).send({
      error: { code: 'review_not_found', message: 'Review not found' },
    });
  }
  if (error instanceof ReviewAlreadyCompletedError) {
    return reply.code(409).send({
      error: {
        code: 'review_already_completed',
        message: 'Review is already completed',
      },
    });
  }
  throw error;
}

export const completeReviewRoutes: FastifyPluginAsync<
  CompleteReviewRoutesOptions
> = async (appBase, { completeReview }) => {
  const app = appBase.withTypeProvider<ZodTypeProvider>();

  app.post(
    '/reviews/:reviewId/complete',
    {
      schema: {
        params: CompleteReviewParams,
        response: {
          200: ReviewResponse,
          404: ErrorResponse,
          409: ErrorResponse,
          422: ErrorResponse,
        },
      },
    },
    async (request, reply) => {
      try {
        const review = await completeReview({
          workspaceId: request.auth.workspaceId,
          reviewId: request.params.reviewId,
        });
        return toReviewResponse(review);
      } catch (error) {
        return mapCompleteReviewError(error, reply);
      }
    },
  );
};
```

The `try`/`catch` contains transport mapping, not business branching. Keep the repository-wide Fastify error handler as the single place for shared validation and unexpected-error envelopes. DevDigest's established invalid-request contract is `422` with `error.code === 'validation_error'`; do not introduce a generic example's `400` convention. Typed application errors should map to deliberate, stable status/code pairs, while unknown errors continue to the shared handler.

## Zod boundary rules

- Parse unknown HTTP parameters, query strings, headers, and bodies at the HTTP adapter.
- Parse unknown configuration when configuration enters the process, event payloads when a consumer receives them, external API responses in the external adapter, and persisted JSON when the persistence adapter reads it.
- Treat `@devdigest/shared` schemas as canonical cross-package wire contracts. Parse with them at the adapter boundary, then map their DTOs to application or domain values.
- Do not import a Zod schema merely to define or type a domain entity. Domain and application code receive already parsed framework-free values.
- Keep database and external-service checks out of initial Fastify schema validation. Existence, uniqueness, ownership, and other asynchronous policy checks belong in the use case through inner ports.
- Define response schemas and explicit response mappers. They form a second guard against accidentally serializing private fields, database columns, credentials, or internal metadata.
- Do not depend on `instanceof ZodError` across DevDigest's multiple Zod copies. Preserve the existing error-handler convention that recognizes a Zod error by shape—`name === 'ZodError'` plus an `issues` or `errors` array—as well as the type-provider's own validation-error predicate.

Parse once at the owning boundary and pass the resulting typed value inward. Re-parsing the same HTTP DTO inside a use case blurs ownership; failing to parse an external response or persisted JSON before mapping it inward trusts an unknown value.

## Plugins, lifecycle, and composition

Use Fastify plugin encapsulation for route registration, scoped hooks, decorators, prefixes, and lifecycle cleanup. It is assembly and lifecycle scope, not an application boundary: a plugin that decorates `app.db` or `app.container` still violates the onion if a handler uses that decorator to perform business work.

Pass narrow callable use cases in plugin options, as with `completeReview`. Register authentication before protected route plugins, close adapter-owned resources in lifecycle hooks, and keep implementation selection in `server/src/app.ts` or a narrow composition module. Plugin registration order does not justify resolving dependencies from a service locator inside the handler.

## SSE, cancellation, and trace boundaries

An SSE adapter owns transport mechanics: response headers, event encoding, heartbeat and flush behavior, backpressure, disconnect cleanup, and mapping typed application events to public event names and payload schemas. It obtains authenticated `workspaceId` and invokes a named subscribe or stream use case.

Do not mistake transport ownership for policy ownership. Replay ordering and eligibility, cancellation authorization and idempotency, trace visibility, and workspace ownership must hold for HTTP, SSE, jobs, and any future transport, so express them in application/domain contracts and carry `workspaceId` into every relevant use case and port. A bus or persistence adapter may implement buffering or delivery, but the SSE route must not become the only place that decides who may replay, cancel, or inspect a run.

When migrating the existing reviews flow, preserve its replay-first semantics and connection cleanup while replacing direct route access to `RunBus`, repositories, or `Container` with named use cases. Cancellation and trace endpoints are driving adapters too; they do not get an exemption because they are adjacent to the SSE route.

## Verification with `app.inject()`

Test the real Fastify plugin registration and schemas with `app.inject()`. At minimum, assert:

- malformed params/body/query input returns `422` and the established `validation_error` envelope;
- the authenticated `workspaceId`, not a client-supplied substitute, reaches the single use-case input alongside validated transport values;
- each typed application error maps to its stable HTTP status and error code;
- a successful response omits private or extra fields not declared by its mapper/response schema;
- SSE subscribe, replay, cancel, and trace paths reject a resource owned by another workspace and preserve the entrypoint-to-use-case wiring for the authorized workspace.

Use a small fake for `CompleteReview` or the corresponding application seam and record its input/result. Do not mock Fastify's validator, serializer, request, reply, plugin registration, or lifecycle internals. A route test may isolate persistence with the fake use case, but every critical flow retains at least one real composition test spanning `route or SSE entrypoint → use case → adapter`; isolated handler and use-case tests cannot prove that graph is wired.
