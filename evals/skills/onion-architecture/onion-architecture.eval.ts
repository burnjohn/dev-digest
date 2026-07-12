import { describeSkill, runSkillCases } from "../../src/index.js";
import { cases } from "./onion-architecture.cases.js";

describeSkill("onion-architecture", () => runSkillCases("onion-architecture", cases));
