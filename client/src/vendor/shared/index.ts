/**
 * @devdigest/shared — single source of truth for cross-package contracts.
 *
 * Exports (Zod schemas + inferred TS types):
 *  - contracts/findings   Review, Finding, Severity, Verdict, FindingAction, trifecta
 *  - contracts/brief      Intent, BlastRadius, Risks, PrHistory, SmartDiff, PrBrief
 *  - contracts/knowledge  Conformance, Onboarding, EvalRun/EvalCase, MemoryItem,
 *                         Skill/CommunitySkill, ConventionCandidate, Agent
 *  - contracts/trace      RunTrace, RunEvent, RunLogLine (single-document trace)
 *  - contracts/platform   Settings, ConnTestResult, Repo, PrMeta/PrDetail, SpecFile, …
 *  - adapters             adapter interfaces + ModelInfo
 *
 * Feature agents (A1–A6) and F2 import everything from here. The barrel is
 * stable — feature agents EXTEND with new files, they do not edit existing ones.
 */

export * from './contracts/findings';
export * from './contracts/review-api';
export * from './contracts/brief';
export * from './contracts/knowledge';
export * from './contracts/trace';
export * from './contracts/platform';
export * from './contracts/why';
export * from './contracts/eval-ci';
export * from './contracts/observability';
export * from './contracts/productionize';
export * from './adapters';
