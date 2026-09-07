import { describeSkill, runSkillCases } from "../../src/index.js";
import { cases } from "./pr-self-review.cases.js";

describeSkill("pr-self-review", () => runSkillCases("pr-self-review", cases));
