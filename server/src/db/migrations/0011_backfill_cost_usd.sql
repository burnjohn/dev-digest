-- One-time backfill: populate cost_usd for agent_runs rows where token counts
-- are known but cost was never stored. Two gaps produce NULL cost_usd:
--   1. Runs written before the pricing table included the model ID.
--   2. Runs written while cost_usd did not exist (between migrations 0009–0010).
-- Pricing mirrors server/src/adapters/llm/pricing.ts — keep both in sync when
-- adding new models. Rows with an unknown model or missing token counts are left NULL.
UPDATE agent_runs
SET cost_usd = CASE model
  WHEN 'claude-fable-5'            THEN (tokens_in * 10.0  + tokens_out * 50.0)  / 1000000
  WHEN 'claude-opus-4-8'           THEN (tokens_in *  5.0  + tokens_out * 25.0)  / 1000000
  WHEN 'claude-opus-4-7'           THEN (tokens_in *  5.0  + tokens_out * 25.0)  / 1000000
  WHEN 'claude-opus-4-6'           THEN (tokens_in *  5.0  + tokens_out * 25.0)  / 1000000
  WHEN 'claude-sonnet-4-6'         THEN (tokens_in *  3.0  + tokens_out * 15.0)  / 1000000
  WHEN 'claude-haiku-4-5'          THEN (tokens_in *  1.0  + tokens_out *  5.0)  / 1000000
  WHEN 'claude-haiku-4-5-20251001' THEN (tokens_in *  1.0  + tokens_out *  5.0)  / 1000000
  WHEN 'claude-3-5-sonnet-latest'  THEN (tokens_in *  3.0  + tokens_out * 15.0)  / 1000000
  WHEN 'claude-3-5-haiku-latest'   THEN (tokens_in *  0.8  + tokens_out *  4.0)  / 1000000
  WHEN 'claude-3-opus-latest'      THEN (tokens_in * 15.0  + tokens_out * 75.0)  / 1000000
  WHEN 'gpt-5.5'                   THEN (tokens_in *  5.0  + tokens_out * 30.0)  / 1000000
  WHEN 'gpt-5.4'                   THEN (tokens_in *  2.5  + tokens_out * 15.0)  / 1000000
  WHEN 'gpt-5.4-mini'              THEN (tokens_in *  0.75 + tokens_out *  4.5)  / 1000000
  WHEN 'gpt-5.4-nano'              THEN (tokens_in *  0.2  + tokens_out *  1.25) / 1000000
  WHEN 'gpt-5.1'                   THEN (tokens_in *  1.25 + tokens_out * 10.0)  / 1000000
  WHEN 'gpt-5'                     THEN (tokens_in *  1.25 + tokens_out * 10.0)  / 1000000
  WHEN 'gpt-4.1'                   THEN (tokens_in *  2.0  + tokens_out *  8.0)  / 1000000
  WHEN 'gpt-4.1-mini'              THEN (tokens_in *  0.4  + tokens_out *  1.6)  / 1000000
  WHEN 'gpt-4.1-nano'              THEN (tokens_in *  0.1  + tokens_out *  0.4)  / 1000000
  WHEN 'gpt-4o'                    THEN (tokens_in *  2.5  + tokens_out * 10.0)  / 1000000
  WHEN 'gpt-4o-mini'               THEN (tokens_in *  0.15 + tokens_out *  0.6)  / 1000000
  WHEN 'text-embedding-3-small'    THEN (tokens_in *  0.02 + tokens_out *  0.0)  / 1000000
  -- OpenRouter CI runner models (approximate; prices confirmed against openrouter.ai/models).
  -- SYNC REQUIRED: these slugs must also exist in server/src/adapters/llm/pricing.ts.
  WHEN 'z-ai/glm-4.7-flash'        THEN 0.0
  WHEN 'deepseek/deepseek-v4-flash' THEN (tokens_in *  0.14 + tokens_out *  0.28) / 1000000
  WHEN 'z-ai/glm-4.7-flashx'       THEN (tokens_in *  0.15 + tokens_out *  0.4)  / 1000000
  WHEN 'minimax/minimax-m2.5'       THEN (tokens_in *  0.3  + tokens_out *  1.2)  / 1000000
  WHEN 'z-ai/glm-5.1'              THEN (tokens_in *  0.6  + tokens_out *  2.2)  / 1000000
  ELSE NULL
END
WHERE cost_usd IS NULL
  AND tokens_in IS NOT NULL
  AND tokens_out IS NOT NULL
  AND model IS NOT NULL;
