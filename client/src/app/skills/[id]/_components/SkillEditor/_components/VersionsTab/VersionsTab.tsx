"use client";
import React from "react";
import { Button, Badge, Skeleton } from "@devdigest/ui";
import { useSkillVersions, useRestoreSkillVersion, useSkill } from "../../../../../../../lib/hooks/skills";

function SimpleDiff({ oldText, newText }: { oldText: string; newText: string }) {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  const maxLines = Math.max(oldLines.length, newLines.length);
  const lines: { kind: "added" | "removed" | "context"; text: string }[] = [];
  for (let i = 0; i < Math.min(maxLines, 40); i++) {
    const o = oldLines[i] ?? "";
    const n = newLines[i] ?? "";
    if (o !== n) {
      if (o) lines.push({ kind: "removed", text: o });
      if (n) lines.push({ kind: "added", text: n });
    } else {
      lines.push({ kind: "context", text: o });
    }
  }
  return (
    <pre style={{ fontSize: 11, overflow: "auto", maxHeight: 200, margin: 0, lineHeight: 1.6 }}>
      {lines.map((l, i) => (
        <div
          key={i}
          style={{
            background:
              l.kind === "added"
                ? "rgba(0,200,100,0.12)"
                : l.kind === "removed"
                  ? "rgba(255,80,80,0.12)"
                  : "transparent",
            color:
              l.kind === "added"
                ? "var(--success-text, #34d399)"
                : l.kind === "removed"
                  ? "var(--error-text, #f87171)"
                  : "var(--text-secondary)",
            paddingLeft: 4,
          }}
        >
          {l.kind === "added" ? "+ " : l.kind === "removed" ? "- " : "  "}
          {l.text}
        </div>
      ))}
    </pre>
  );
}

export function VersionsTab({ skillId }: { skillId: string }) {
  const { data: versions, isLoading } = useSkillVersions(skillId);
  const { data: skill } = useSkill(skillId);
  const restore = useRestoreSkillVersion();
  const [diffOpen, setDiffOpen] = React.useState<number | null>(null);

  if (isLoading) return <Skeleton height={200} />;
  if (!versions || versions.length === 0) {
    return <p style={{ color: "var(--text-muted)", fontSize: 13 }}>No version history yet.</p>;
  }

  const currentVersion = skill?.version;

  return (
    <div style={{ maxWidth: 680 }}>
      <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 16 }}>
        Version history · {versions.length} versions
      </p>
      <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 20 }}>
        Every save snapshots the body so eval runs stay reproducible.
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {versions.map((v, idx) => {
          const prev = versions[idx + 1];
          return (
            <div
              key={v.version}
              style={{ borderRadius: 6, border: "1px solid var(--border)", padding: "10px 14px" }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontWeight: 700, fontSize: 13, minWidth: 28 }}>v{v.version}</span>
                <span style={{ flex: 1, fontSize: 13, color: "var(--text-secondary)" }}>
                  {v.message ?? "—"}
                </span>
                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                  {new Date(v.created_at).toLocaleDateString()}
                </span>
                {v.version === currentVersion && (
                  <Badge color="var(--accent-text)">Current</Badge>
                )}
                {prev && (
                  <Button
                    kind="secondary"
                    size="sm"
                    onClick={() => setDiffOpen(diffOpen === v.version ? null : v.version)}
                  >
                    Diff
                  </Button>
                )}
                {v.version !== currentVersion && (
                  <Button
                    kind="secondary"
                    size="sm"
                    onClick={() => {
                      if (window.confirm(`Restore v${v.version}? This creates a new version with the old body.`)) {
                        restore.mutate({ id: skillId, version: v.version });
                      }
                    }}
                    disabled={restore.isPending}
                  >
                    Restore
                  </Button>
                )}
              </div>
              {diffOpen === v.version && prev && (
                <div
                  style={{
                    marginTop: 10,
                    background: "var(--bg-hover)",
                    borderRadius: 4,
                    padding: "8px 10px",
                  }}
                >
                  <SimpleDiff oldText={prev.body} newText={v.body} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
