import { describeWorkflow, runWorkflowCases } from "../src/index.js";
import { cases } from "./review-workflow.cases.js";

describeWorkflow("review", () => runWorkflowCases(cases));
