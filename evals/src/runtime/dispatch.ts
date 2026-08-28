/**
 * Content-tier runner selection. Content-only calls (skillTask, the LLM judge) can run on any
 * OpenAI-compatible backend, so under EVAL_BACKEND=openrouter they go direct through
 * run-openrouter (native DeepSeek / any model, no proxy). Default is the Claude Agent SDK.
 *
 * Tool-using tiers (agentTask, workflowTask) do NOT use this — they call runClaude directly,
 * because only the Agent SDK produces the subagent/skill/file-read trace they assert on.
 */

import { runClaude, type Result, type RunOptions } from "./run-claude.js";
import { runOpenRouter } from "./run-openrouter.js";

const BACKEND = process.env.EVAL_BACKEND ?? "subscription";

export function runContent(prompt: string, opts: RunOptions = {}): Promise<Result> {
  return BACKEND === "openrouter" ? runOpenRouter(prompt, opts) : runClaude(prompt, opts);
}
