/**
 * Direct OpenAI-compatible runtime for the CONTENT tier (skillTask). Talks to OpenRouter (or any
 * OpenAI-compatible gateway) with a plain chat.completions call — DeepSeek and other non-Anthropic
 * models work natively here, no Anthropic Skin and no translating proxy.
 *
 * This mirrors reviewer-core/src/llm/openrouter.ts (same OpenAI-SDK-against-OpenRouter pattern) but
 * returns free text instead of structured JSON, which is what the skill-quality judge scores.
 *
 * It has NO tools, subagents, or skills — so it only fits content-only cases. agentTask and
 * workflowTask stay on the Claude Agent SDK (run-claude.ts), which is the only runtime that
 * produces the subagent/skill/file-read trace those tiers assert on.
 */

import OpenAI from "openai";
import { EVAL_MODEL } from "../config.js";
import type { Result, RunOptions } from "./run-claude.js";

const BASE_URL = (process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1").replace(/\/$/, "");

/** Run one content-only turn against an OpenAI-compatible endpoint and shape it as a Result. */
export async function runOpenRouter(prompt: string, opts: RunOptions = {}): Promise<Result> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("EVAL_BACKEND=openrouter but OPENROUTER_API_KEY is not set");

  // Match run-claude's no-tools contract so the injected artifact behaves the same in both runtimes.
  const directive =
    "\n\nYou have NO tools available in this session. Do not attempt any tool calls. " +
    "Answer directly and completely from the information given in the prompt.";
  const system = (opts.systemPrompt ?? "") + directive;

  const client = new OpenAI({ apiKey: key, baseURL: BASE_URL, timeout: 90_000, maxRetries: 2 });

  const started = Date.now();
  let text = "";
  let inputTokens = 0;
  let outputTokens = 0;
  let isError = false;
  try {
    const res = await client.chat.completions.create({
      model: opts.model ?? EVAL_MODEL,
      temperature: 0,
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
    });
    const choice = res.choices?.[0];
    if (!choice) {
      // OpenRouter can return HTTP 200 with no choices (upstream error / moderation) — surface it.
      const errMsg = (res as unknown as { error?: { message?: string } }).error?.message;
      throw new Error(`OpenRouter returned no choices${errMsg ? `: ${errMsg}` : ""}`);
    }
    text = choice.message?.content ?? "";
    inputTokens = res.usage?.prompt_tokens ?? 0;
    outputTokens = res.usage?.completion_tokens ?? 0;
  } catch (err) {
    isError = true;
    text = err instanceof Error ? err.message : String(err);
  }

  return {
    text,
    toolsUsed: [],
    subagents: [],
    skillsInvoked: [],
    filesRead: [],
    numTurns: 1,
    isError,
    metrics: { durationMs: Date.now() - started, inputTokens, outputTokens, toolCallCount: 0 },
  };
}
