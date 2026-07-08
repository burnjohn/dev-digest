/**
 * @devdigest/shared — single source of truth for cross-package contracts.
 *
 * Exports (Zod schemas + inferred TS types):
 *  - contracts/findings   Review, Finding, Severity, Verdict, FindingAction, trifecta
 *  - contracts/brief      Intent, BlastRadius, Risks, PrHistory, SmartDiff, PrBrief
 *  - contracts/knowledge  Conformance, Onboarding, EvalRun/EvalCase, MemoryItem,
 *                         Skill/CommunitySkill, ConventionCandidate, Agent
 *  - contracts/trace      RunTrace, RunEvent, RunLogLine, RunTraceContextDoc (single-document trace)
 *  - contracts/platform   Settings, ConnTestResult, Repo, PrMeta/PrDetail, …
 *  - contracts/context-docs ContextDocument, ContextDocContent, ContextFolders,
 *                         ContextDocAttachment, SaveContextDocBody, DeleteContextDocBody,
 *                         AgentContextDocLink, SkillContextDocLink
 *  - adapters             adapter interfaces + ModelInfo
 *
 * Feature agents (A1–A6) and F2 import everything from here. The barrel is
 * stable — feature agents EXTEND with new files, they do not edit existing ones.
 */

export * from './contracts/findings.js';
export * from './contracts/review-api.js';
export * from './contracts/brief.js';
export * from './contracts/blast.js';
export * from './contracts/onboarding-tour.js';
export * from './contracts/knowledge.js';
export * from './contracts/trace.js';
export * from './contracts/platform.js';
export * from './contracts/context-docs.js';
export * from './contracts/why.js';
export * from './contracts/eval-ci.js';
export * from './contracts/eval-batch.js';
export * from './contracts/skill-eval.js';
export * from './contracts/observability.js';
export * from './contracts/productionize.js';
export * from './adapters.js';
