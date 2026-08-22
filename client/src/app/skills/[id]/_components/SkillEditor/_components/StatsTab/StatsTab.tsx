"use client";
import React from "react";
import { useRouter } from "next/navigation";
import { Skeleton } from "@devdigest/ui";
import { useSkillStats } from "../../../../../../../lib/hooks/skills";

function StatCard({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 8,
        padding: "12px 16px",
        minWidth: 110,
        textAlign: "center",
      }}
    >
      <div style={{ fontSize: 26, fontWeight: 700, color: "var(--text-primary)" }}>{value}</div>
      <div
        style={{
          fontSize: 11,
          color: "var(--text-muted)",
          marginTop: 4,
          textTransform: "uppercase",
          letterSpacing: 0.5,
        }}
      >
        {label}
      </div>
    </div>
  );
}

export function StatsTab({ skillId }: { skillId: string }) {
  const { data: stats, isLoading } = useSkillStats(skillId);
  const router = useRouter();

  if (isLoading) return <Skeleton height={200} />;
  if (!stats) return <p style={{ color: "var(--text-muted)", fontSize: 13 }}>No stats available.</p>;

  const categories = Object.entries(stats.findings_by_category ?? {});
  const maxCat = categories.length > 0 ? Math.max(...categories.map(([, v]) => v)) : 1;

  return (
    <div style={{ maxWidth: 580, display: "flex", flexDirection: "column", gap: 24 }}>
      {/* Metric cards */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <StatCard label="Used by" value={stats.used_by_count} />
        <StatCard label="Versions" value={stats.version_count} />
        <StatCard label="Findings (30d)" value={stats.findings_last_30d} />
      </div>

      {/* Agents list */}
      <div>
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: "var(--text-muted)",
            letterSpacing: 0.8,
            marginBottom: 10,
            textTransform: "uppercase",
          }}
        >
          Agents using this skill
        </div>
        {stats.agents.length === 0 ? (
          <p style={{ fontSize: 13, color: "var(--text-muted)" }}>No agents linked yet.</p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 4 }}>
            {stats.agents.map((ag) => (
              <li key={ag.id}>
                <button
                  onClick={() => router.push(`/agents/${ag.id}?tab=skills`)}
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: "var(--accent-text)",
                    fontSize: 13,
                    padding: 0,
                  }}
                >
                  {ag.name} →
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Findings by category */}
      {categories.length > 0 && (
        <div>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: "var(--text-muted)",
              letterSpacing: 0.8,
              marginBottom: 12,
              textTransform: "uppercase",
            }}
          >
            Findings by category
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {categories
              .sort(([, a], [, b]) => b - a)
              .map(([cat, cnt]) => (
                <div key={cat} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 12, color: "var(--text-secondary)", width: 80, flexShrink: 0 }}>
                    {cat}
                  </span>
                  <div
                    style={{
                      flex: 1,
                      background: "var(--bg-hover)",
                      borderRadius: 4,
                      height: 8,
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        width: `${(cnt / maxCat) * 100}%`,
                        height: "100%",
                        background: "var(--accent)",
                        borderRadius: 4,
                      }}
                    />
                  </div>
                  <span style={{ fontSize: 12, color: "var(--text-muted)", width: 24, textAlign: "right" }}>
                    {cnt}
                  </span>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
