"use client";

import React, { useState } from "react";
import Link from "next/link";
import { Skeleton, Icon } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { useSkillStats } from "../../../../lib/hooks/skills";

interface StatsTabProps {
  skill: Skill;
}

function StatCard({ label, value, unit }: { label: string; value: string | number; unit?: string }) {
  return (
    <div
      style={{
        background: "var(--bg-surface)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        padding: "16px 20px",
        flex: 1,
        minWidth: 120,
      }}
    >
      <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
        {label}
      </div>
      <div style={{ fontSize: 28, fontWeight: 700 }}>
        {value}
        {unit && <span style={{ fontSize: 16, marginLeft: 2, color: "var(--text-secondary)" }}>{unit}</span>}
      </div>
    </div>
  );
}

const DONUT_COLORS = ["#ef4444", "#f59e0b", "#3b82f6", "#8b5cf6", "#10b981", "#6366f1"];

function DonutChart({ data }: { data: Array<{ category: string; count: number }> }) {
  const total = data.reduce((s, d) => s + d.count, 0);
  if (total === 0) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 120, color: "var(--text-muted)", fontSize: 12 }}>
        No findings yet
      </div>
    );
  }

  const R = 46;
  const cx = 60;
  const cy = 60;
  let angle = -90;

  const slices = data.slice(0, 6).map((d, i) => {
    const sweep = (d.count / total) * 360;
    const start = angle;
    angle += sweep;
    const startRad = (start * Math.PI) / 180;
    const endRad = ((start + sweep) * Math.PI) / 180;
    const x1 = cx + R * Math.cos(startRad);
    const y1 = cy + R * Math.sin(startRad);
    const x2 = cx + R * Math.cos(endRad);
    const y2 = cy + R * Math.sin(endRad);
    const large = sweep > 180 ? 1 : 0;
    return { d: `M${cx},${cy} L${x1},${y1} A${R},${R} 0 ${large} 1 ${x2},${y2} Z`, color: DONUT_COLORS[i % DONUT_COLORS.length], ...d };
  });

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
      <svg width={120} height={120}>
        {slices.map((s, i) => <path key={i} d={s.d} fill={s.color} />)}
        <circle cx={cx} cy={cy} r={28} fill="var(--bg-primary)" />
      </svg>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {slices.map((s, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: s.color, flexShrink: 0 }} />
            <span style={{ color: "var(--text-secondary)" }}>{s.category}</span>
            <span style={{ fontWeight: 600, marginLeft: "auto" }}>{s.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function AgentRow({ agent, divider }: { agent: { id: string; name: string }; divider: boolean }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 0",
        borderBottom: divider ? "1px solid var(--border)" : "none",
      }}
    >
      <div
        style={{
          width: 26,
          height: 26,
          borderRadius: 6,
          background: "var(--accent-bg)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <Icon.Settings size={13} style={{ color: "var(--accent)" }} />
      </div>
      <span style={{ flex: 1, fontSize: 13, fontWeight: 500 }}>{agent.name}</span>
      <Link
        href={`/agents/${agent.id}`}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          fontSize: 12,
          color: hovered ? "var(--accent)" : "var(--text-muted)",
          fontWeight: 500,
          textDecoration: "none",
          flexShrink: 0,
          transition: "color 120ms",
        }}
      >
        Open
      </Link>
    </div>
  );
}

export function StatsTab({ skill }: StatsTabProps) {
  const { data: stats, isLoading } = useSkillStats(skill.id);

  if (isLoading) {
    return (
      <div style={{ padding: "24px 28px" }}>
        <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} height={80} style={{ flex: 1 }} />)}
        </div>
        <Skeleton height={180} />
      </div>
    );
  }

  if (!stats) return null;

  return (
    <div style={{ padding: "24px 28px" }}>
      {/* 4 stat cards */}
      <div style={{ display: "flex", gap: 12, marginBottom: 24, flexWrap: "wrap" }}>
        <StatCard label="Used by" value={stats.used_by} unit="agents" />
        <StatCard label="Pull frequency" value={stats.pull_frequency_pct} unit="%" />
        <StatCard label="Accept rate" value={stats.accept_rate_pct} unit="%" />
        <StatCard label="Findings (30d)" value={stats.findings_30d} />
      </div>

      <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
        {/* Agents using this skill */}
        <div
          style={{
            flex: 1,
            minWidth: 200,
            background: "var(--bg-surface)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: "16px 20px",
          }}
        >
          <div
            style={{
              fontSize: 11,
              color: "var(--text-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              marginBottom: 12,
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <Icon.Cpu size={13} />
            Agents using this skill
          </div>
          {stats.agents.length === 0 ? (
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Not linked to any agent yet.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column" }}>
              {stats.agents.map((a, i) => (
                <AgentRow
                  key={a.id}
                  agent={a}
                  divider={i < stats.agents.length - 1}
                />
              ))}
            </div>
          )}
        </div>

        {/* Findings by category donut */}
        <div
          style={{
            flex: 1,
            minWidth: 240,
            background: "var(--bg-surface)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: "16px 20px",
          }}
        >
          <div
            style={{
              fontSize: 11,
              color: "var(--text-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              marginBottom: 12,
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <Icon.Tag size={13} />
            Findings by category
          </div>
          <DonutChart data={stats.findings_by_category} />
        </div>
      </div>
    </div>
  );
}
