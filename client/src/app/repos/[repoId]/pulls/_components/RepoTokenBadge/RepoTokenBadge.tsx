/* RepoTokenBadge — the amber "no token" signal on the PR list header. Renders
   nothing once the repo has a token; the caller passes the repo's own
   `github_token_id` so this stays a pure prop->render component with no
   fetching of its own (the reactive "clears after reassignment" behavior is
   `useAssignRepoToken`'s `["repos"]` invalidation reaching whatever hook
   supplies `githubTokenId`, not this component's concern). */
"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";

export function RepoTokenBadge({
  repoId,
  githubTokenId,
}: {
  repoId: string;
  githubTokenId: string | null | undefined;
}) {
  const t = useTranslations("github-tokens");

  if (githubTokenId) return null;

  return (
    <Link href={`/repos/${repoId}/settings`}>
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "4px 9px",
          borderRadius: 6,
          fontSize: 12,
          color: "var(--warn)",
          border: "1px solid var(--warn)",
        }}
      >
        <Icon.AlertTriangle size={12} />
        {t("repo.badge")}
      </span>
    </Link>
  );
}
