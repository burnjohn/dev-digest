/**
 * Shared contract types re-exported from @devdigest/shared (single source of
 * truth). F2 imports these rather than redefining them.
 *
 * F1 (@devdigest/shared) currently exports all the platform/findings/brief/
 * knowledge/trace contracts we need for the scaffolding screens, so there are
 * NO local placeholders required at this time. If a feature agent's contract is
 * not yet exported, add a placeholder below marked
 * `// TODO: reconcile with @devdigest/shared`.
 */
export type {
  Settings,
  SettingsUpdate,
  ConnTestProvider,
  ConnTestResult,
  SecretsStatus,
  FeatureModelId,
  FeatureModelChoice,
  FeatureModelDef,
  Provider,
  ModelInfo,
  Repo,
  RepoInput,
  PrMeta,
  PrDetail,
  PrFile,
  PrCommit,
  PrReviewComment,
  PrStatus,
  SpecFile,
  IndexStatus,
} from "@devdigest/shared";

export type { Review, Finding, Severity, Verdict } from "@devdigest/shared";
export type { PrBrief, SmartDiff } from "@devdigest/shared";

/** SPEC-01 Project Context — the document-list, preview and attachment shapes
 * `lib/hooks/context.ts` and `components/context-docs/**` build on. */
export type {
  ContextDocType,
  ContextDocSource,
  ContextDocument,
  ContextDocumentList,
  ContextPreviewResponse,
  ContextAttachRequest,
  ContextAttachResponse,
  ContextUploadRequest,
} from "@devdigest/shared";

/** SPEC-03 Eval Pipeline — case/batch/dashboard contracts `lib/hooks/evals.ts`
 * and every eval-domain component build on. Supersedes `EvalCaseInput` /
 * `EvalRunRecord` / `EvalDashboard` / `EvalTrendPoint` (`contracts/eval-ci.ts`)
 * for this feature's endpoints — those stay unedited for their existing callers
 * (see `contracts/eval-batch.ts`'s file header). */
export type {
  EvalOwnerKind,
  EvalExpectationKind,
  EvalExpectedFinding,
  EvalForbiddenRegion,
  EvalCaseSource,
  EvalCaseRecord,
  EvalCaseDraft,
  EvalCaseWrite,
  EvalAblationWithArm,
  EvalAblationUnavailable,
  EvalAblationWithoutArm,
  EvalAblationOutput,
  EvalCaseRunResult,
  EvalBatchStatus,
  EvalBatchRecord,
  EvalBatchCaseResult,
  EvalBatchDetail,
  EvalPromptDiffLine,
  EvalMetricDelta,
  EvalBatchComparison,
  EvalTrendMetric,
  EvalTrendSeriesPoint,
  EvalOwnerDashboard,
} from "@devdigest/shared";

/** UI-only view model for a PR list row (derives display fields from PrMeta). */
export interface PrRowView {
  number: number;
  title: string;
  author: string;
  size: "S" | "M" | "L";
  sizeLines: string;
  score: number;
  findings: { CRITICAL: number; WARNING: number; SUGGESTION: number };
  status: "needs_review" | "reviewed" | "stale";
  updated: string;
}
