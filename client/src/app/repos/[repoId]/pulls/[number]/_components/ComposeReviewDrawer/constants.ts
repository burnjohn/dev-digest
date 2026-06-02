import type { Verdict } from "@devdigest/shared";

/** Verdict options for the compose drawer. `labelKey` resolves under the `compose` namespace. */
export const VERDICTS: { key: Verdict; labelKey: string; color: string }[] = [
  { key: "approve", labelKey: "reviewDrawer.verdicts.approve", color: "var(--ok)" },
  { key: "comment", labelKey: "reviewDrawer.verdicts.comment", color: "var(--text-secondary)" },
  { key: "request_changes", labelKey: "reviewDrawer.verdicts.requestChanges", color: "var(--crit)" },
];

/** Fallback body seeded into the editor when the preview request fails. */
export const FALLBACK_BODY = "## DevDigest Review\n\n";
