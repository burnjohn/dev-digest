import { defineConfig } from "vitest/config";
import TrendReporter from "./src/trend-reporter.js";

export default defineConfig({
  test: {
    // *.eval.ts = model-backed evals; src/**/*.test.ts = the pure stats unit tests.
    include: ["**/*.eval.ts", "src/**/*.test.ts"],
    // Real Claude sessions (and a subagent dispatch) are slow — give them room.
    testTimeout: 240_000,
    hookTimeout: 240_000,
    // One session per test; a few files can run concurrently. Keep it modest to stay cheap.
    fileParallelism: true,
    // A model-backed case is a real, billed Claude session — cap flake retries at 1 (so at most
    // 2 sessions total per case) instead of vitest's unbounded default, for token economy. A
    // retried run appends its own record to records.jsonl; harmless for the deterministic
    // src/**/*.test.ts lane, which never needs the second attempt.
    retry: 1,
    reporters: ["default", new TrendReporter()],
  },
});
