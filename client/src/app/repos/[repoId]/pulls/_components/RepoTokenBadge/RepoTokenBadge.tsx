/* RepoTokenBadge — the amber "no token" signal on the PR list header. Renders
   nothing once the repo has a USABLE token — that needs both an assignment
   (`github_token_id`) AND a stored value behind it (`github_token_configured`):
   a repo can be assigned to a token with no PAT (deleted, or never given one —
   e.g. the seeded `demo` token), which is exactly as broken as no assignment
   at all, and every GitHub call for it fails the same way. The caller passes
   both fields so this stays a pure prop->render component with no fetching of
   its own (the reactive "clears after reassignment" behavior is
   `useAssignRepoToken`'s `["repos"]` invalidation reaching whatever hook
   supplies these fields, not this component's concern). */
"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";

export function RepoTokenBadge({
  repoId,
  githubTokenId,
  githubTokenConfigured,
}: {
  repoId: string;
  githubTokenId: string | null | undefined;
  githubTokenConfigured: boolean | undefined;
}) {
  const t = useTranslations("github-tokens");

  if (githubTokenId && githubTokenConfigured) return null;

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
