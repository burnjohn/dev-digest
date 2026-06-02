/* Onboarding wizard — first-run 3-step flow (OpenAI key · GitHub PAT · Add repo).
   Ported from screen_onboarding.jsx; wired to F1 test-connection + add-repo. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import {
  Button,
  Icon,
  Kbd,
  TextInput,
  FormField,
} from "@devdigest/ui";
import { useTestConnection, useAddRepo } from "../../lib/hooks";
import { ApiError } from "../../lib/api";
import type { ConnTestProvider } from "../../lib/types";

const STEPS = ["OpenAI key", "GitHub PAT", "Add repo"];

function Stepper({ step }: { step: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 0, marginBottom: 34 }}>
      {STEPS.map((s, i) => (
        <React.Fragment key={i}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div
              style={{
                width: 26,
                height: 26,
                borderRadius: 99,
                display: "grid",
                placeItems: "center",
                fontSize: 13,
                fontWeight: 700,
                background: i < step ? "var(--ok)" : i === step ? "var(--accent)" : "var(--bg-elevated)",
                color: i <= step ? "#fff" : "var(--text-muted)",
                border: i > step ? "1px solid var(--border-strong)" : "none",
              }}
            >
              {i < step ? <Icon.Check size={14} /> : i + 1}
            </div>
            <span
              style={{
                fontSize: 13,
                fontWeight: i === step ? 600 : 500,
                color: i <= step ? "var(--text-primary)" : "var(--text-muted)",
              }}
            >
              {s}
            </span>
          </div>
          {i < STEPS.length - 1 && (
            <div style={{ width: 40, height: 1, background: "var(--border-strong)", margin: "0 16px" }} />
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

function ConnResult({
  state,
  message,
}: {
  state: "idle" | "ok" | "error" | "testing";
  message?: string;
}) {
  if (state === "idle") return null;
  if (state === "testing")
    return (
      <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 28 }}>Testing connection…</div>
    );
  const ok = state === "ok";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "12px 14px",
        borderRadius: 8,
        background: ok ? "var(--ok-bg)" : "var(--crit-bg)",
        border: `1px solid ${ok ? "rgba(16,185,129,0.25)" : "rgba(239,68,68,0.25)"}`,
        marginBottom: 28,
      }}
    >
      {ok ? (
        <Icon.CheckCircle size={16} style={{ color: "var(--ok)" }} />
      ) : (
        <Icon.XCircle size={16} style={{ color: "var(--crit)" }} />
      )}
      <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>{message}</span>
    </div>
  );
}

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = React.useState(0);
  const [openaiKey, setOpenaiKey] = React.useState("");
  const [pat, setPat] = React.useState("");
  const [repoUrl, setRepoUrl] = React.useState("");
  const [reveal, setReveal] = React.useState(false);

  const test = useTestConnection();
  const addRepo = useAddRepo();

  const [conn, setConn] = React.useState<{ state: "idle" | "ok" | "error" | "testing"; message?: string }>({
    state: "idle",
  });

  const runTest = async (provider: ConnTestProvider) => {
    setConn({ state: "testing" });
    try {
      const res = await test.mutateAsync(provider);
      setConn({ state: res.ok ? "ok" : "error", message: res.message });
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Connection test failed";
      setConn({ state: "error", message: msg });
    }
  };

  const finish = async () => {
    try {
      const repo = await addRepo.mutateAsync(repoUrl);
      router.push(`/repos/${repo.id}/pulls`);
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Could not add repository";
      setConn({ state: "error", message: msg });
    }
  };

  const title = ["Connect your OpenAI account", "Connect GitHub", "Add your first repository"][step]!;
  const blurb = [
    "DevDigest uses your own key for every model call. Nothing runs through our servers.",
    "A fine-grained PAT lets DevDigest clone private repos, import PRs, and post reviews as you.",
    "Paste a GitHub repository URL. DevDigest clones it locally and imports open PRs.",
  ][step]!;

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
        <div
          style={{
            width: 30,
            height: 30,
            borderRadius: 8,
            background: "var(--text-primary)",
            display: "grid",
            placeItems: "center",
          }}
        >
          <Icon.Layers size={17} style={{ color: "var(--bg-primary)" }} />
        </div>
        <span style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-0.02em" }}>DevDigest</span>
      </div>

      <div
        style={{
          width: 520,
          maxWidth: "100%",
          background: "var(--bg-elevated)",
          border: "1px solid var(--border)",
          borderRadius: 14,
          padding: 36,
          boxShadow: "var(--shadow-modal)",
        }}
      >
        <Stepper step={step} />
        <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em" }}>{title}</h1>
        <p style={{ fontSize: 14, color: "var(--text-secondary)", marginTop: 8, marginBottom: 28, lineHeight: 1.5 }}>
          {blurb}
        </p>

        {step === 0 && (
          <FormField
            label="OpenAI API key"
            hint="Stored locally via your environment — never uploaded."
            right={
              <a
                href="https://platform.openai.com/api-keys"
                target="_blank"
                rel="noreferrer"
                style={{ fontSize: 13, color: "var(--accent-text)", display: "inline-flex", alignItems: "center", gap: 4 }}
              >
                Where to get your key
                <Icon.ArrowRight size={11} />
              </a>
            }
          >
            <TextInput
              value={openaiKey}
              onChange={setOpenaiKey}
              mono
              type={reveal ? "text" : "password"}
              placeholder="sk-…"
              suffix={
                <Icon.EyeOff
                  size={14}
                  style={{ color: "var(--text-muted)", cursor: "pointer" }}
                  onClick={() => setReveal((r) => !r)}
                />
              }
            />
          </FormField>
        )}

        {step === 1 && (
          <FormField
            label="GitHub fine-grained PAT"
            hint="Scopes: Contents (read), Pull requests (read+write), Metadata (read), Actions (read)."
          >
            <TextInput value={pat} onChange={setPat} mono type="password" placeholder="github_pat_…" />
          </FormField>
        )}

        {step === 2 && (
          <FormField label="Repository URL" hint="e.g. https://github.com/acme/payments-api">
            <TextInput value={repoUrl} onChange={setRepoUrl} mono placeholder="https://github.com/owner/repo" />
          </FormField>
        )}

        <ConnResult state={conn.state} message={conn.message} />

        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <Button kind="ghost" size="md" disabled={step === 0} onClick={() => setStep((s) => Math.max(0, s - 1))}>
            Back
          </Button>
          <div style={{ flex: 1 }} />
          {step < 2 && (
            <Button
              kind="secondary"
              size="md"
              onClick={() => runTest(step === 0 ? "openai" : "github")}
              disabled={test.isPending}
            >
              Test connection
            </Button>
          )}
          {step < 2 ? (
            <Button kind="primary" size="md" iconRight="ArrowRight" onClick={() => setStep((s) => s + 1)}>
              Continue
            </Button>
          ) : (
            <Button kind="primary" size="md" icon="Plus" onClick={finish} disabled={!repoUrl || addRepo.isPending}>
              {addRepo.isPending ? "Cloning…" : "Add repository"}
            </Button>
          )}
        </div>
      </div>

      <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 24, display: "inline-flex", gap: 8, alignItems: "center" }}>
        <Icon.Lock size={12} /> Step {step + 1} of 3 · You can change keys later in Settings · <Kbd>esc</Kbd>
      </p>
    </div>
  );
}
