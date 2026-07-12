import { describeSkill, runSkillCases } from "../../src/index.js";
import { cases } from "./zod.cases.js";

describeSkill("zod", () => runSkillCases("zod", cases));
