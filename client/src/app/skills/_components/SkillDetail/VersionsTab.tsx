"use client";

import React, { useState } from "react";
import { Button, Badge, Icon, Skeleton } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { useSkillVersions, useRestoreSkillVersion } from "../../../../lib/hooks/skills";

type DiffLine = { type: "add" | "remove" | "context"; text: string };

function computeDiff(oldText: string | undefined, newText: string): DiffLine[] {
  if (!oldText) {
    // Initial version — show everything as added
    return newText.split("\n").map((text) => ({ type: "add" as const, text }));
  }

  const a = oldText.split("\n");
  const b = newText.split("\n");
  const m = a.length;
  const n = b.length;

  // LCS DP — O(mn), fine for short skill bodies
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0) as number[]);
  for (let i = 1; i <= m; i++) {
    const prev = dp[i - 1]!;
    const curr = dp[i]!;
    for (let j = 1; j <= n; j++) {
      curr[j] = a[i - 1] === b[j - 1]
        ? prev[j - 1]! + 1
        : Math.max(prev[j]!, curr[j - 1]!);
    }
  }

  // Backtrack to produce diff lines
  const result: DiffLine[] = [];
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    const row = dp[i]!;
    const prevRow = dp[i - 1];
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      result.unshift({ type: "context", text: a[i - 1]! });
      i--; j--;
    } else if (j > 0 && (i === 0 || row[j - 1]! >= (prevRow?.[j] ?? 0))) {
      result.unshift({ type: "add", text: b[j - 1]! });
      j--;
    } else {
      result.unshift({ type: "remove", text: a[i - 1]! });
      i--;
    }
  }
  return result;
}

function simpleDiffLabel(prev: string | undefined, curr: string): string {
  if (!prev) return "Initial version";
  const delta = curr.split("\n").length - prev.split("\n").length;
  if (delta === 0) return "Edited content";
  return delta > 0 ? `Edited content (+${delta} lines)` : `Edited content (${delta} lines)`;
}

function DiffView({ lines }: { lines: DiffLine[] }) {
  return (
    <div
      style={{
        fontFamily: "monospace",
        fontSize: 12,
        lineHeight: "20px",
        background: "var(--bg-primary)",
        border: "1px solid var(--border)",
        borderTop: "none",
        borderRadius: "0 0 8px 8px",
        overflow: "auto",
        maxHeight: 340,
      }}
    >
      {lines.map((line, idx) => {
        const isAdd = line.type === "add";
        const isRem = line.type === "remove";
        return (
          <div
            key={idx}
            style={{
              display: "flex",
              alignItems: "baseline",
              background: isAdd
                ? "rgba(34,197,94,0.10)"
                : isRem
                ? "rgba(239,68,68,0.10)"
                : "transparent",
              padding: "1px 16px",
            }}
          >
            <span
              style={{
                width: 14,
                flexShrink: 0,
                fontWeight: 700,
                color: isAdd ? "#4ade80" : isRem ? "#f87171" : "transparent",
                userSelect: "none",
                marginRight: 10,
              }}
            >
              {isAdd ? "+" : isRem ? "-" : " "}
            </span>
            <span
              style={{
                whiteSpace: "pre",
                color: isAdd
                  ? "#4ade80"
                  : isRem
                  ? "#f87171"
                  : "var(--text-secondary)",
              }}
            >
              {line.text || " "}
            </span>
          </div>
        );
      })}
    </div>
  );
}

interface VersionsTabProps {
  skill: Skill;
  onRestore: () => void;
}

export function VersionsTab({ skill, onRestore }: VersionsTabProps) {
  const { data: versions, isLoading } = useSkillVersions(skill.id);
  const restore = useRestoreSkillVersion();
  const [diffOpen, setDiffOpen] = useState<number | null>(null);

  if (isLoading) {
    return (
      <div style={{ padding: "24px 28px" }}>
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} height={56} style={{ marginBottom: 8 }} />
        ))}
      </div>
    );
  }

  const versionList = versions ?? [];

  return (
    <div style={{ padding: "24px 28px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <h2 style={{ fontSize: 15, fontWeight: 700 }}>Version history</h2>
        {versionList.length > 0 && (
          <Badge color="var(--text-muted)">{versionList.length} versions</Badge>
        )}
      </div>
      <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 20 }}>
        Every save snapshots the body so eval runs stay reproducible against the exact text they scored.
      </p>

      {versionList.length === 0 && (
        <div style={{ color: "var(--text-muted)", fontSize: 13 }}>No version history yet.</div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {versionList.map((v, i) => {
          const isCurrent = v.version === skill.version;
          const prevBody = versionList[i + 1]?.body;
          const label = simpleDiffLabel(prevBody, v.body);
          const isOpen = diffOpen === v.version;
          const diffLines = isOpen ? computeDiff(prevBody, v.body) : null;

          return (
            <div key={v.version}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "12px 16px",
                  background: "var(--bg-surface)",
                  border: "1px solid var(--border)",
                  borderRadius: isOpen ? "8px 8px 0 0" : 8,
                }}
              >
                <Badge color={isCurrent ? "var(--accent)" : "var(--text-muted)"} mono>
                  v{v.version}
                </Badge>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{label}</div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                    {new Date(v.created_at).toLocaleDateString()}
                  </div>
                </div>
                {isCurrent && (
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 5,
                      fontSize: 12,
                      fontWeight: 600,
                      color: "#4ade80",
                    }}
                  >
                    <span style={{ fontSize: 8, lineHeight: 1 }}>●</span>
                    Current
                  </span>
                )}
                <Button
                  kind={isOpen ? "primary" : "secondary"}
                  size="sm"
                  icon="Eye"
                  onClick={() => setDiffOpen(isOpen ? null : v.version)}
                >
                  Diff
                </Button>
                {!isCurrent && (
                  <Button
                    kind="secondary"
                    size="sm"
                    icon="RefreshCw"
                    disabled={restore.isPending}
                    onClick={() =>
                      restore.mutate(
                        { skillId: skill.id, version: v.version },
                        { onSuccess: () => onRestore() },
                      )
                    }
                  >
                    Restore
                  </Button>
                )}
              </div>
              {isOpen && diffLines && <DiffView lines={diffLines} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}
