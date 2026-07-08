/**
 * The headless turn-loop driver. Runs one Claude Agent SDK session on the subscription and
 * extracts what the session ACTUALLY did (tools, subagents, skills, reads) — not its prose.
 */

import { query, type Options } from "@anthropic-ai/claude-agent-sdk";
import { EVAL_MODEL, MAX_TURNS, SPAWN_TOOLS } from "../config.js";
import { REPO_ROOT } from "../artifacts/paths.js";
import { subscriptionEnv } from "./env.js";

export interface Metrics {
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  /** Total tool_use blocks seen (NOT deduplicated — a measure of work done). */
  toolCallCount: number;
}

export interface Result {
  text: string;
  toolsUsed: string[];
  subagents: string[];
  /** Skills activated via the Skill tool (workflow mode); name may be "plugin:skill". */
  skillsInvoked: string[];
  filesRead: string[];
  numTurns: number;
  isError: boolean;
  metrics: Metrics;
}

export interface RunOptions {
  systemPrompt?: string;
  allowedTools?: string[];
  maxTurns?: number;
  cwd?: string;
  model?: string;
  /** ["project"] loads on-disk CLAUDE.md + skills/agents; default [] keeps the run isolated. */
  settingSources?: Array<"user" | "project" | "local">;
  /**
   * Early-stop hook. Called after every tool_use with the trace collected SO FAR; return true to
   * end the session immediately. Lets a dispatch/trace case stop the moment its evidence is in
   * (e.g. the subagent was launched) instead of waiting for a heavy nested subagent to finish.
   * On an early stop the run is NOT an error and metrics reflect only what ran before the stop.
   */
  stopWhen?: (partial: Pick<Result, "subagents" | "filesRead" | "skillsInvoked" | "toolsUsed">) => boolean;
}

/** Run one headless Claude turn-loop and extract what it ACTUALLY did (not its prose). */
export async function runClaude(prompt: string, opts: RunOptions = {}): Promise<Result> {
  const allowedTools = opts.allowedTools ?? [];
  const cwd = opts.cwd ?? REPO_ROOT;
  // The SDK is handed the artifact as a bare-string system prompt, so — unlike a real Claude Code
  // session — it gets NO environment block telling it where it is running. A tool-using agent then
  // guesses an absolute prefix for its Read paths (`/root/...`, `/home/user/...`); when the guess
  // misses it declares the repo "inaccessible" and gives up, tanking the case. Inject the working
  // directory the way production always does, so path resolution is deterministic, not a lottery.
  let systemPrompt = opts.systemPrompt;
  if (allowedTools.length === 0) {
    // With no tools, a subagent/skill prompt that says "read files" will loop on denied tool
    // calls until max-turns. For these content-only evals the input is already in the prompt,
    // so tell the model to answer directly.
    const directive =
      "\n\nYou have NO tools available in this session. Do not attempt any tool calls. " +
      "Answer directly and completely from the information given in the prompt.";
    systemPrompt = (systemPrompt ?? "") + directive;
  } else {
    const directive =
      `\n\nYour working directory is the repository root at \`${cwd}\`. Reference every file by its ` +
      "repo-relative path from there (e.g. `reviewer-core/CLAUDE.md`, `server/CLAUDE.md`) — do NOT " +
      "prepend `/root`, `/home/...`, or any other guessed absolute prefix. If a Read returns " +
      "'file not found', locate the file with Glob before concluding it is absent: you are running " +
      "inside the repository and it is fully readable. Never claim you lack access to the repository.";
    systemPrompt = (systemPrompt ?? "") + directive;
  }

  // bypassPermissions auto-approves EVERY tool call; allowedTools only pre-approves, it does NOT
  // restrict. Measured on CI: an agent allow-listed to Read/Glob/Grep still ran Bash and
  // ReportFindings (and ReportFindings swallows report content the judge then never sees).
  // disallowedTools is the actual gate — deny the mutating/output-hijacking tools unless the
  // case explicitly allowed them.
  const DENIED_UNLESS_ALLOWED = [
    "Bash",
    "Write",
    "Edit",
    "NotebookEdit",
    "ReportFindings",
    "WebFetch",
    "WebSearch",
  ];
  const disallowedTools = DENIED_UNLESS_ALLOWED.filter((t) => !allowedTools.includes(t));

  const options: Options = {
    model: opts.model ?? EVAL_MODEL,
    maxTurns: opts.maxTurns ?? MAX_TURNS,
    permissionMode: "bypassPermissions", // paired with disallowedTools above — see comment
    systemPrompt,
    allowedTools,
    disallowedTools,
    cwd,
    // Default: do NOT load on-disk config — isolates the injected artifact. workflowTask overrides.
    settingSources: opts.settingSources ?? [],
    env: subscriptionEnv(),
  };

  const textParts: string[] = [];
  const tools: string[] = [];
  const subagents: string[] = [];
  const skills: string[] = [];
  const reads: string[] = [];
  let resultText = "";
  let isError = false;
  let numTurns = 0;
  let toolCallCount = 0;
  // Resource metrics, read defensively off the result message (field names verified against the
  // installed SDK's types). On the subscription path total_cost_usd is meaningless, so we ignore
  // it and surface tokens only. Fall back to 0 whenever a field is absent — never throw.
  let durationMs = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let stoppedEarly = false;
  // Wall-clock fallback: on an early stop we break before the result message that carries
  // duration_ms/usage, so those stay 0. Stamp duration ourselves, and accumulate output tokens
  // off each assistant message, so an early-stopped case still reports meaningful metrics.
  const startedAt = Date.now();

  // The SDK throws on an error result (e.g. max-turns). We still want the partial output
  // and the tool/subagent trace we collected, so catch and fall through with isError=true.
  try {
    loop: for await (const msg of query({ prompt, options })) {
      if (msg.type === "assistant") {
        numTurns++;
        outputTokens += (msg.message as any).usage?.output_tokens ?? 0;
        for (const block of msg.message.content as any[]) {
          if (block.type === "text") textParts.push(block.text);
          else if (block.type === "tool_use") {
            tools.push(block.name);
            toolCallCount++;
            const input = block.input ?? {};
            if (SPAWN_TOOLS.has(block.name)) {
              const sub = input.subagent_type ?? input.agent_type ?? input.name;
              if (sub) subagents.push(sub);
            }
            if (block.name === "Read") {
              const fp = input.file_path ?? input.path;
              // Normalize to forward slashes: on Windows the Read tool receives an absolute
              // backslash path, but every expectFilesRead in cases.ts is authored POSIX-style
              // (e.g. "reviewer-core/docs/pipeline.md") and matched via .includes() — a raw
              // backslash path never contains that substring, so unnormalized paths silently
              // fail every trace/contrast assertion on Windows even when the right file was read.
              if (fp) reads.push(fp.replace(/\\/g, "/"));
            }
            if (block.name === "Skill") {
              const s = input.skill ?? input.command;
              if (s) skills.push(s);
            }
            // Evidence is in — break the loop before a heavy nested subagent runs to completion.
            // Breaking the async iterator triggers its return()/abort, tearing down the subprocess.
            if (
              opts.stopWhen?.({
                subagents: [...new Set(subagents)],
                filesRead: reads,
                skillsInvoked: [...new Set(skills)],
                toolsUsed: [...new Set(tools)],
              })
            ) {
              stoppedEarly = true;
              break loop;
            }
          }
        }
      } else if (msg.type === "result") {
        isError = msg.subtype !== "success";
        const m = msg as any;
        numTurns = m.num_turns ?? 0;
        durationMs = m.duration_ms ?? 0;
        inputTokens = m.usage?.input_tokens ?? 0;
        outputTokens = m.usage?.output_tokens ?? 0;
        if (m.result) resultText = m.result;
      }
    }
  } catch (err) {
    isError = true;
    if (!resultText && textParts.length === 0) {
      throw err; // nothing usable collected — surface the failure
    }
  }

  // Early stop never reached the result message, so fall back to the wall-clock duration.
  if (stoppedEarly && durationMs === 0) durationMs = Date.now() - startedAt;

  return {
    text: resultText || textParts.join("\n"),
    toolsUsed: [...new Set(tools)],
    subagents: [...new Set(subagents)],
    skillsInvoked: [...new Set(skills)],
    filesRead: reads,
    numTurns,
    isError,
    metrics: { durationMs, inputTokens, outputTokens, toolCallCount },
  };
}
