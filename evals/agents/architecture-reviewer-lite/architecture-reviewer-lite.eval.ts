import { describeAgent, runAgentCases } from "../../src/index.js";
// Deliberately reuses the strict variant's cases — same fixture, same practices, same
// threshold. Only the injected agent artifact differs (architecture-reviewer-lite has the
// "cite the specific documented rule per finding" hard rule removed). That is what makes this
// pair a controlled A/B rather than two unrelated evals: pnpm eval:repeat both with labels and
// pnpm eval:delta them to see exactly which practice moved.
// `liteCases` is those same cases with one difference: the pass bar excludes the citation
// practices this variant is DESIGNED to miss (they are still listed and still judged, so the
// per-practice A/B rows survive — see the comment on liteCases). Grading lite at the strict
// variant's threshold 1.0 would paint it permanently red for being lite, measuring nothing.
import { liteCases } from "../architecture-reviewer/architecture-reviewer.cases.js";

describeAgent("architecture-reviewer-lite", () => runAgentCases("architecture-reviewer-lite", liteCases));
