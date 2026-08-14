/* hooks/ barrel — every React Query hook over the F1/feature APIs.
   Import from "@/lib/hooks" for the platform hooks (settings/repos/pulls/context)
   or from a domain file directly (e.g. "@/lib/hooks/reviews") — both resolve here. */
export {
  useSettings,
  useUpdateSettings,
  useTestConnection,
  useSecretsStatus,
  useRepos,
  useAddRepo,
  useRefreshRepo,
  useDeleteRepo,
  usePulls,
  usePullDetail,
  useContextFiles,
  useReindexContext,
} from "./core";

export {
  useAgents,
  useAgent,
  useCreateAgent,
  useUpdateAgent,
  useDeleteAgent,
  useProviderModels,
} from "./agents";
export type { CreateAgentInput, UpdateAgentInput } from "./agents";

export {
  useSkills,
  useSkill,
  useCreateSkill,
  useUpdateSkill,
  useDeleteSkill,
  useImportSkillPreview,
  useAgentSkills,
  useSetAgentSkills,
  useSkillAgentIds,
  useSkillVersions,
  useSkillStats,
} from "./skills";
export type { CreateSkillInput, UpdateSkillInput } from "./skills";

export {
  usePrActiveRuns,
  usePrRuns,
  usePrReviews,
  useDeleteRun,
  useCancelRun,
  useDeleteReview,
  usePrComments,
  useCreatePrComment,
  useRunReview,
  useFindingAction,
  useRunEvents,
} from "./reviews";
export type { ActiveRun, CreateCommentInput, RunReviewInput } from "./reviews";

export { useRunTrace } from "./trace";

export { useRepoIntelStatus, useResyncRepoIntel } from "./repo-intel";
export type { RepoIntelState } from "./repo-intel";
