/* AddRepoView — add-repository screen body. URL, plus which GitHub token this
   repo authenticates with (optional — same picker RepoSettingsView uses, so
   the two don't diverge). Model/LLM API keys (OpenAI / Anthropic /
   OpenRouter) are NOT entered here; they live in Settings → API Keys and
   don't change per repo. Escapable: Esc or the close button returns to the
   app. */
"use client";

import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Icon, IconBtn, Kbd, TextInput, FormField } from "@devdigest/ui";
import { useAddRepo } from "@/lib/hooks";
import { ApiError } from "@/lib/api";
import { GitHubTokenPicker } from "@/components/github-token-picker";

export function AddRepoView() {
  const router = useRouter();
  const [repoUrl, setRepoUrl] = React.useState("");
  const [githubTokenId, setGithubTokenId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const addRepo = useAddRepo();

  const close = React.useCallback(() => router.push("/"), [router]);

  // Escapable (the footer advertises Esc — make it real).
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  const submit = async () => {
    if (!repoUrl.trim()) return;
    setError(null);
    try {
      const repo = await addRepo.mutateAsync({ url: repoUrl.trim(), githubTokenId });
      router.push(`/repos/${repo.id}/pulls`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not add repository");
    }
  };

  return (
    <div
      style={{
        width: "100%",
        minHeight: "100vh",
        background: "var(--bg-primary)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "44px 28px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 32 }}>
        <div style={{ width: 30, height: 30, borderRadius: 8, background: "var(--text-primary)", display: "grid", placeItems: "center" }}>
          <Icon.Layers size={17} style={{ color: "var(--bg-primary)" }} />
        </div>
        <span style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-0.02em" }}>DevDigest</span>
      </div>

      <div
        style={{
          position: "relative",
          width: 520,
          maxWidth: "100%",
          background: "var(--bg-elevated)",
          border: "1px solid var(--border)",
          borderRadius: 14,
          padding: 36,
          boxShadow: "var(--shadow-modal)",
        }}
      >
        <div style={{ position: "absolute", top: 16, right: 16 }}>
          <IconBtn icon="X" label="Close" onClick={close} />
        </div>

        <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em" }}>Add a repository</h1>
        <p style={{ fontSize: 14, color: "var(--text-secondary)", marginTop: 8, marginBottom: 28, lineHeight: 1.5 }}>
          Paste a GitHub repository URL — DevDigest clones it locally and imports open PRs.
          Model API keys (OpenAI / Anthropic / OpenRouter) aren’t needed here; set them once in{" "}
          <Link href="/settings/api-keys" style={{ color: "var(--accent-text)" }}>
            Settings → API Keys
          </Link>
          .
        </p>

        <FormField label="Repository URL" hint="e.g. https://github.com/acme/payments-api">
          <TextInput
            value={repoUrl}
            onChange={setRepoUrl}
            mono
            placeholder="https://github.com/owner/repo"
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
          />
        </FormField>

        <FormField
          label="GitHub token"
          hint="Which saved token DevDigest uses to read this repo. Optional — pick one later from the repo's settings."
        >
          <GitHubTokenPicker value={githubTokenId} onChange={setGithubTokenId} />
        </FormField>

        {error && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "12px 14px",
              borderRadius: 8,
              background: "var(--crit-bg)",
              border: "1px solid rgba(239,68,68,0.25)",
              marginTop: 16,
            }}
          >
            <Icon.XCircle size={16} style={{ color: "var(--crit)" }} />
            <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>{error}</span>
          </div>
        )}

        <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 24 }}>
          <Button kind="ghost" size="md" onClick={close}>
            Cancel
          </Button>
          <div style={{ flex: 1 }} />
          <Button
            kind="primary"
            size="md"
            icon="Plus"
            onClick={submit}
            disabled={!repoUrl.trim() || addRepo.isPending}
          >
            {addRepo.isPending ? "Cloning…" : "Add repository"}
          </Button>
        </div>
      </div>

      <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 24, display: "inline-flex", gap: 8, alignItems: "center" }}>
        <Icon.Lock size={12} /> API keys live in Settings · <Kbd>esc</Kbd> to close
      </p>
    </div>
  );
}
