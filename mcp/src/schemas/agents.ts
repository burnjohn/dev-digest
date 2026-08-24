import { z } from 'zod';

/**
 * `list_agents()` (ring M0) — request/response shapes. Per §5.12.4's named
 * divergence, the response is a re-declared, deliberately narrow projection
 * of `@devdigest/shared`'s `Agent` — never `system_prompt` or
 * `output_schema` (§5.13.2's own promise: "never the agent's system prompt
 * or output schema"). `ports.ts`'s `AgentSummary` (`Pick<Agent, 'id' | 'name'
 * | 'model' | 'enabled'>`) already enforces this at the port; this schema
 * enforces it again at the wire boundary the model actually reads, exactly
 * as `schemas/findings.ts` does for reviews.
 *
 * No arguments (REQ-11's own point: `list_agents` exists precisely because
 * an `agent` id cannot be guessed, so there is nothing to take as input).
 */

export const ListAgentsInput = {};

const AgentSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  model: z.string(),
  enabled: z.boolean(),
});

export const ListAgentsOutput = {
  agents: z.array(AgentSummarySchema),
};

export type ListAgentsInputArgs = z.infer<z.ZodObject<typeof ListAgentsInput>>;
export type ListAgentsOutputResult = z.infer<z.ZodObject<typeof ListAgentsOutput>>;
