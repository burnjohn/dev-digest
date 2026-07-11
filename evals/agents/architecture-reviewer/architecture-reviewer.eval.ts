import { describeAgent, runAgentCases } from "../../src/index.js";
import { cases } from "./architecture-reviewer.cases.js";

describeAgent("architecture-reviewer", () => runAgentCases("architecture-reviewer", cases));
