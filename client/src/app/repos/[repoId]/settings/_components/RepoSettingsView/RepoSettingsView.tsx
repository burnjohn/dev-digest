/* RepoSettingsView — per-repo settings. Today it exists to answer one
   question: which GitHub token does this repo authenticate with. Repo removal
   deliberately stays in the RepoSwitcher; two homes for a destructive action
   is how the wrong repo gets deleted. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Card, Icon } from "@devdigest/ui";
import { useRepos, useGitHubTokens, useAssignRepoToken, useTestRepoAccess } from "@/lib/hooks";
import { GitHubTokenPicker } from "@/components/github-token-picker";
import { ApiError } from "@/lib/api";

export function RepoSettingsView({ repoId }: { repoId: string }) {
  const t = useTranslations("github-tokens");
  const { data: repos } = useRepos();
  // Only fetched here for the selected token's @login on the header line
  // below (server: github_token_label already travels on the repo row; the
  // login does not, since GitHubToken is a separate resource — GitHubTokenPicker
  // fetches this same list independently for its dropdown).
  const { data: tokens } = useGitHubTokens();
  const assign = useAssignRepoToken();
  // Resolves the repo's OWN stored token server-side — a value never
  // originates in the browser for this probe (see useTestRepoAccess's docblock).
  const test = useTestRepoAccess();
  const repo = repos?.find((r) => r.id === repoId) ?? null;
  const [probe, setProbe] = React.useState<{ ok: boolean; message: string } | null>(null);

  if (!repo) return null;

  const selectedToken = tokens?.find((tk) => tk.id === repo.github_token_id) ?? null;
  // Assigned to a token AND that token's value actually resolves — both are
  // needed, because a repo can be assigned to a token with no stored PAT
  // (deleted, or never given one — e.g. the seeded `demo` token), which is
  // exactly as broken as no assignment at all.
  const isBroken = !repo.github_token_id || !repo.github_token_configured;

  return (
    <div style={{ display: "grid", gap: 20, maxWidth: 720 }}>
      <div>
        <h1 className="mono" style={{ fontSize: 22, fontWeight: 700 }}>
          {repo.full_name}
        </h1>
        <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4 }}>
          {repo.default_branch}
          {repo.clone_path ? ` · ${repo.clone_path}` : " · not cloned"}
          {repo.last_polled_at ? ` · synced ${repo.last_polled_at}` : " · never synced"}
          {repo.github_token_label
            ? ` · ${t("repo.tokenLine", { label: repo.github_token_label })}`
            : ""}
          {selectedToken?.github_login ? ` (@${selectedToken.github_login})` : ""}
        </div>
      </div>

      {isBroken && (
        <Card>
          <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
            <Icon.AlertTriangle size={16} style={{ color: "var(--warn)", flexShrink: 0 }} />
            <div>
              <div style={{ fontWeight: 600, marginBottom: 2 }}>{t("repo.brokenTitle")}</div>
              <div style={{ fontSize: 13, color: "var(--text-muted)" }}>{t("repo.brokenBody")}</div>
            </div>
          </div>
        </Card>
      )}

      <Card>
        <div style={{ fontWeight: 600, marginBottom: 2 }}>{t("repo.sectionTitle")}</div>
        <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 12 }}>
          {t("repo.sectionBody")}
        </div>

        <GitHubTokenPicker
          value={repo.github_token_id}
          fullName={repo.full_name}
          onChange={(githubTokenId) => {
            setProbe(null);
            assign.mutate({ repoId, githubTokenId });
          }}
        />

        {assign.isError && (
          <div style={{ marginTop: 8, fontSize: 12, color: "var(--crit)" }}>
            {assign.error instanceof ApiError ? assign.error.message : t("picker.saveFailed")}
          </div>
        )}

        {repo.github_token_id && (
          <div style={{ marginTop: 12 }}>
            <Button
              kind="secondary"
              size="md"
              disabled={test.isPending}
              onClick={async () => {
                try {
                  // Proves this token can read THIS repo, not merely that it
                  // authenticates — the distinction that costs a failed clone.
                  const r = await test.mutateAsync(repoId);
                  setProbe({ ok: r.ok, message: r.message });
                } catch (e) {
                  setProbe({
                    ok: false,
                    message: e instanceof ApiError ? e.message : t("picker.testFailed"),
                  });
                }
              }}
            >
              {t("repo.testAccess")}
            </Button>
            {probe && (
              <div
                style={{
                  marginTop: 8,
                  fontSize: 12,
                  color: probe.ok ? "var(--ok)" : "var(--crit)",
                }}
              >
                {probe.message}
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
