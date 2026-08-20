ALTER TABLE "agent_runs" ADD COLUMN "cost_usd" double precision;--> statement-breakpoint
-- One-time backfill for runs that completed before cost was persisted.
--
-- The VALUES list is a VERBATIM SNAPSHOT of server/src/adapters/llm/pricing.ts
-- (USD per 1M tokens) taken at the time of this migration. It is deliberately
-- frozen: these are historical estimates, and re-running them against today's
-- prices would silently rewrite the past. DO NOT keep this in sync with
-- pricing.ts — runs created after this migration get their real cost from the
-- provider's usage payload instead.
--
-- Models absent from the list keep cost_usd = NULL, which the UI renders as "—".
UPDATE "agent_runs" AS r
SET "cost_usd" = (r."tokens_in" * p.price_in + r."tokens_out" * p.price_out) / 1000000
FROM (VALUES
  ('gpt-5.5', 5.0, 30.0),
  ('gpt-5.4', 2.5, 15.0),
  ('gpt-5.4-mini', 0.75, 4.5),
  ('gpt-5.4-nano', 0.2, 1.25),
  ('gpt-5.1', 1.25, 10.0),
  ('gpt-5', 1.25, 10.0),
  ('gpt-4.1', 2.0, 8.0),
  ('gpt-4.1-mini', 0.4, 1.6),
  ('gpt-4o', 2.5, 10.0),
  ('gpt-4o-mini', 0.15, 0.6),
  ('claude-3-5-sonnet-latest', 3.0, 15.0),
  ('claude-3-5-haiku-latest', 0.8, 4.0),
  ('claude-3-opus-latest', 15.0, 75.0),
  ('z-ai/glm-4.7-flash', 0.0, 0.0),
  ('deepseek/deepseek-v4-flash', 0.14, 0.28),
  ('z-ai/glm-4.7-flashx', 0.15, 0.4),
  ('minimax/minimax-m2.5', 0.3, 1.2),
  ('z-ai/glm-5.1', 0.6, 2.2)
) AS p(model, price_in, price_out)
WHERE r."model" = p.model
  AND r."status" = 'done'
  AND r."tokens_in" IS NOT NULL
  AND r."tokens_out" IS NOT NULL;
