/* Route: /repos/:repoId/settings. Thin wrapper — matches how the sibling
   pulls/page.tsx and pulls/[number]/page.tsx read :repoId via useParams()
   (client components) rather than an async server-component `params` prop;
   no page in this app currently uses the latter. */
"use client";

import { useParams } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { RepoNotFound } from "@/components/repo-not-found";
import { useActiveRepo, useRepoNotFound } from "@/lib/repo-context";
import { RepoSettingsView } from "./_components/RepoSettingsView";

export default function RepoSettingsPage() {
  const params = useParams<{ repoId: string }>();
  const repoId = params.repoId;
  const { activeRepo } = useActiveRepo();
  const repoNotFound = useRepoNotFound(repoId);
  const repoName = activeRepo?.full_name ?? repoId;
  const crumb = [
    { label: repoName, mono: true, href: `/repos/${repoId}/pulls` },
    { label: "Repository" },
  ];

  if (repoNotFound) {
    return (
      <AppShell crumb={crumb}>
        <RepoNotFound />
      </AppShell>
    );
  }

  return (
    <AppShell crumb={crumb}>
      <div style={{ padding: "24px 32px 44px", maxWidth: 1080, margin: "0 auto" }}>
        <RepoSettingsView repoId={repoId} />
      </div>
    </AppShell>
  );
}
