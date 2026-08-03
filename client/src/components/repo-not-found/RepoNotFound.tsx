/* Shared empty state for repo-scoped pages whose :repoId matches no known repo
   (stale link / no repo selected). Replaces the misleading "Repo not found"
   ErrorState with a friendly prompt to add or pick a repo. */
"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { EmptyState } from "@devdigest/ui";

/** Renders the "no repo selected" empty state. Wrap in the page's <AppShell>. */
export function RepoNotFound() {
  const t = useTranslations("common");
  const router = useRouter();
  return (
    <EmptyState
      icon="GitBranch"
      title={t("repoNotFound.title")}
      body={t("repoNotFound.body")}
      cta={t("repoNotFound.cta")}
      onCta={() => router.push("/onboarding")}
    />
  );
}

