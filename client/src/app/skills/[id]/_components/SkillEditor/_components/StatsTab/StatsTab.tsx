/* StatsTab — usage stats: agent count, pull frequency, accept rate, findings. */
"use client";

import React from "react";
import { Skeleton, ErrorState } from "@devdigest/ui";
import { useRouter } from "next/navigation";
import { useSkillStats } from "@/lib/hooks/skills";

const CATEGORY_COLORS = [
  "#6366f1",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#06b6d4",
];

function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: React.ReactNode;
  sub?: string;
}) {
  return (
    <div
      style={{
        padding: "16px 20px",
        background: "var(--bg-elevated)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        display: "flex",
        flexDirection: "column",
        gap: 4,
        flex: 1,
        minWidth: 120,
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: "var(--text-muted)",
          letterSpacing: 1,
          textTransform: "uppercase",
        }}
      >
        {label}
      </div>
      <div
        style={{ fontSize: 22, fontWeight: 700, color: "var(--text-primary)" }}
      >
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{sub}</div>
      )}
    </div>
  );
}

export function StatsTab({ skillId }: { skillId: string }) {
  const router = useRouter();
  const { data: stats, isLoading, isError, refetch } = useSkillStats(skillId);

  if (isLoading) {
    return (
      <div
        style={{
          padding: 28,
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        <Skeleton height={90} />
        <Skeleton height={200} />
      </div>
    );
  }

  if (isError || !stats) {
    return (
      <ErrorState body="Could not load stats." onRetry={() => refetch()} />
    );
  }

  const categoryEntries = Object.entries(stats.findings_by_category);
  const categoryTotal = categoryEntries.reduce((s, [, n]) => s + n, 0);

  // Build conic-gradient for donut
  let cumulative = 0;
  const segments = categoryEntries.map(([cat, count], i) => {
    const pct = categoryTotal > 0 ? (count / categoryTotal) * 100 : 0;
    const start = cumulative;
    cumulative += pct;
    return {
      cat,
      count,
      pct,
      start,
      color: CATEGORY_COLORS[i % CATEGORY_COLORS.length],
    };
  });

  const gradient =
    categoryTotal > 0
      ? segments
          .map(
            (s) =>
              `${s.color} ${s.start.toFixed(1)}% ${(s.start + s.pct).toFixed(1)}%`,
          )
          .join(", ")
      : "var(--border) 0% 100%";

  return (
    <div
      style={{
        padding: 28,
        display: "flex",
        flexDirection: "column",
        gap: 24,
        maxWidth: 720,
      }}
    >
      <h2 style={{ fontSize: 16, fontWeight: 700 }}>Stats</h2>

      {/* Top stat cards */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <StatCard label="Used by" value={stats.agent_count} sub="agents" />
        <StatCard
          label="Pull frequency"
          value={`${stats.pull_frequency_pct}%`}
        />
        <StatCard
          label="Accept rate"
          value={
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {stats.accept_rate_pct}%
              <svg
                width={36}
                height={36}
                viewBox="0 0 36 36"
                style={{ transform: "rotate(-90deg)" }}
              >
                <circle
                  cx={18}
                  cy={18}
                  r={14}
                  fill="none"
                  stroke="var(--border)"
                  strokeWidth={4}
                />
                <circle
                  cx={18}
                  cy={18}
                  r={14}
                  fill="none"
                  stroke="var(--ok)"
                  strokeWidth={4}
                  strokeDasharray={`${(stats.accept_rate_pct / 100) * 87.96} 87.96`}
                />
              </svg>
            </div>
          }
        />
        <StatCard label="Findings (30d)" value={stats.findings_30d} />
      </div>

      {/* Bottom: agents list + findings by category */}
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        {/* Agents using this skill */}
        <div
          style={{
            flex: 1,
            minWidth: 200,
            background: "var(--bg-elevated)",
            border: "1px solid var(--border)",
            borderRadius: 10,
            padding: 16,
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: "var(--text-muted)",
              letterSpacing: 1,
              textTransform: "uppercase",
              marginBottom: 12,
            }}
          >
            Agents using this skill
          </div>
          {stats.agents.length === 0 && (
            <p style={{ fontSize: 13, color: "var(--text-muted)" }}>None yet</p>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {stats.agents.map((a) => (
              <div
                key={a.id}
                style={{ display: "flex", alignItems: "center", gap: 8 }}
              >
                <span style={{ fontSize: 13, flex: 1 }}>{a.name}</span>
                <button
                  onClick={() => router.push(`/agents/${a.id}`)}
                  style={{
                    fontSize: 12,
                    color: "var(--accent)",
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    padding: 0,
                  }}
                >
                  Open →
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Findings by category donut */}
        <div
          style={{
            flex: 1,
            minWidth: 200,
            background: "var(--bg-elevated)",
            border: "1px solid var(--border)",
            borderRadius: 10,
            padding: 16,
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: "var(--text-muted)",
              letterSpacing: 1,
              textTransform: "uppercase",
              marginBottom: 12,
            }}
          >
            Findings by category
          </div>
          {categoryTotal === 0 ? (
            <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
              No findings yet
            </p>
          ) : (
            <div
              style={{
                display: "flex",
                gap: 20,
                alignItems: "center",
                flexWrap: "wrap",
              }}
            >
              <div
                style={{
                  width: 80,
                  height: 80,
                  borderRadius: "50%",
                  background: `conic-gradient(${gradient})`,
                  flexShrink: 0,
                }}
              />
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {segments.map((s) => (
                  <div
                    key={s.cat}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      fontSize: 12,
                    }}
                  >
                    <span
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: 2,
                        background: s.color,
                        flexShrink: 0,
                      }}
                    />
                    <span style={{ color: "var(--text-secondary)" }}>
                      {s.cat}
                    </span>
                    <span style={{ fontWeight: 600 }}>{s.count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
