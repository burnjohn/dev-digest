/** A4 CI module constants. */

/** Source tag persisted on ingested CI runs. */
export const CI_RUN_SOURCE = 'github_actions';

/** Generated workflow path added by the export. */
export const WORKFLOW_PATH = '.github/workflows/devdigest-review.yml';

/** Default PR title used when opening the export PR. */
export const EXPORT_PR_TITLE = 'Add DevDigest CI review';

/** Run-status buckets derived from an Actions conclusion. */
export const RUN_STATUS = {
  succeeded: 'succeeded',
  noFindings: 'no_findings',
  failed: 'failed',
  running: 'running',
} as const;
