import type { CiTarget } from "@devdigest/shared/contracts/eval-ci";

/** CI export targets shown in step 1. `nameKey`/`descKey` resolve under the `ci` namespace. */
export const TARGETS: {
  key: CiTarget;
  nameKey: string;
  descKey: string;
  icon: "Workflow" | "RefreshCw" | "Settings" | "Command";
  rec?: boolean;
}[] = [
  { key: "gha", nameKey: "exportWizard.targets.gha", descKey: "exportWizard.targets.ghaDesc", icon: "Workflow", rec: true },
  { key: "circle", nameKey: "exportWizard.targets.circle", descKey: "exportWizard.targets.circleDesc", icon: "RefreshCw" },
  { key: "jenkins", nameKey: "exportWizard.targets.jenkins", descKey: "exportWizard.targets.jenkinsDesc", icon: "Settings" },
  { key: "cli", nameKey: "exportWizard.targets.cli", descKey: "exportWizard.targets.cliDesc", icon: "Command" },
];

/** Wizard step labels — i18n keys under the `ci` namespace. */
export const STEP_LABEL_KEYS = [
  "exportWizard.steps.target",
  "exportWizard.steps.preview",
  "exportWizard.steps.configure",
  "exportWizard.steps.install",
] as const;

export const TOTAL_STEPS = 4;

/** Trigger event chips shown in the Configure step. */
export const TRIGGERS = [
  "pull_request:opened",
  "pull_request:synchronize",
  "pull_request:reopened",
] as const;

/** "Post results as" radio options — labelKey resolves under the `ci` namespace. */
export const POST_AS_OPTIONS: {
  key: "github_review" | "pr_comment" | "none";
  labelKey: string;
  recommended?: boolean;
}[] = [
  { key: "github_review", labelKey: "exportWizard.postAs.githubReview", recommended: true },
  { key: "pr_comment", labelKey: "exportWizard.postAs.prComment" },
  { key: "none", labelKey: "exportWizard.postAs.none" },
];

/** Number of files surfaced in the install card when a preview hasn't loaded. */
export const FALLBACK_FILE_COUNT = 5;

/** Repo secret callout key. */
export const OPENAI_KEY = "OPENAI_API_KEY";
