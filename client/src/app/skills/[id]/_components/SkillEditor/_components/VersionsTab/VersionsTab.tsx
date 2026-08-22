/* VersionsTab — version history with diff expand and restore. */
"use client";

import React from "react";
import { Button, Badge, Skeleton, ErrorState } from "@devdigest/ui";
import { useSkillVersions, useRestoreSkill } from "@/lib/hooks/skills";
import type { Skill } from "@devdigest/shared";

function formatDate(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

export function VersionsTab({ skill }: { skill: Skill }) {
  const {
    data: versions,
    isLoading,
    isError,
    refetch,
  } = useSkillVersions(skill.id);
  const restore = useRestoreSkill();
  const [expanded, setExpanded] = React.useState<number | null>(null);

  if (isLoading) {
    return (
      <div
        style={{
          padding: 28,
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <Skeleton height={48} />
        <Skeleton height={48} />
      </div>
    );
  }

  if (isError || !versions) {
    return (
      <ErrorState body="Could not load versions." onRetry={() => refetch()} />
    );
  }

  const sorted = [...versions].sort((a, b) => b.version - a.version);
  const maxVersion = sorted[0]?.version ?? skill.version;

  return (
    <div style={{ padding: 28, maxWidth: 720 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 20,
        }}
      >
        <h2 style={{ fontSize: 16, fontWeight: 700 }}>Version history</h2>
        <Badge color="var(--text-secondary)">{sorted.length} versions</Badge>
      </div>
      <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 20 }}>
        Every save snapshots the body so eval runs stay reproducible against the
        exact text they scored.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {sorted.map((v) => {
          const isCurrent = v.version === maxVersion;
          const isExpanded = expanded === v.version;
          return (
            <div
              key={v.version}
              style={{
                border: "1px solid var(--border)",
                borderRadius: 8,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "12px 16px",
                  background: "var(--bg-elevated)",
                }}
              >
                <span
                  style={{
                    fontWeight: 700,
                    fontSize: 13,
                    fontFamily: "monospace",
                  }}
                >
                  v{v.version}
                </span>
                {isCurrent ? (
                  <span
                    style={{
                      fontSize: 11,
                      color: "var(--ok)",
                      fontWeight: 700,
                    }}
                  >
                    ● Current
                  </span>
                ) : (
                  <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                    {formatDate(v.created_at)}
                  </span>
                )}
                <div style={{ flex: 1 }} />
                <Button
                  kind="ghost"
                  size="sm"
                  onClick={() => setExpanded(isExpanded ? null : v.version)}
                >
                  {isExpanded ? "Hide" : "Diff"}
                </Button>
                {!isCurrent && (
                  <Button
                    kind="secondary"
                    size="sm"
                    onClick={() => {
                      if (
                        window.confirm(
                          `Restore to v${v.version}? Current body will be snapshotted first.`,
                        )
                      ) {
                        restore.mutate({
                          skillId: skill.id,
                          version: v.version,
                        });
                      }
                    }}
                    disabled={restore.isPending}
                  >
                    Restore
                  </Button>
                )}
              </div>
              {isExpanded && (
                <pre
                  style={{
                    margin: 0,
                    padding: "12px 16px",
                    fontFamily: "monospace",
                    fontSize: 12,
                    lineHeight: 1.5,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    background: "var(--bg-surface)",
                    borderTop: "1px solid var(--border)",
                    color: "var(--text-primary)",
                  }}
                >
                  {v.body}
                </pre>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
