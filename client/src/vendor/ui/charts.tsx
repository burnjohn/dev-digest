/* charts.tsx — charts ported to Recharts (spec §3: Recharts).
   Sparkline + BarRow stay as lightweight inline SVG (trivial, perf);
   LineChart + Donut use Recharts. MetricCard composes them. */
import React from "react";
import {
  LineChart as RLineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { Icon } from "./icons";

export function Sparkline({
  data,
  color = "var(--accent)",
  w = 80,
  h = 24,
}: {
  data: number[];
  color?: string;
  w?: number;
  h?: number;
}) {
  if (!data.length) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const pts = data.map((v, i) => [(i / (data.length - 1)) * w, h - ((v - min) / span) * (h - 4) - 2]);
  const d = pts.map((p, i) => (i ? "L" : "M") + p[0]!.toFixed(1) + "," + p[1]!.toFixed(1)).join(" ");
  const last = pts[pts.length - 1]!;
  return (
    <svg width={w} height={h} style={{ display: "block", overflow: "visible" }}>
      <path d={d} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last[0]} cy={last[1]} r={2} fill={color} />
    </svg>
  );
}

export interface ChartSeries {
  name: string;
  color: string;
  data: number[];
}

export function LineChart({
  series,
  w = 620,
  h = 200,
  yMin = 0.6,
  yMax = 1.0,
}: {
  series: ChartSeries[];
  w?: number;
  h?: number;
  yMin?: number;
  yMax?: number;
}) {
  const n = series[0]?.data.length ?? 0;
  const rows = Array.from({ length: n }, (_, i) => {
    const row: Record<string, number> = { i };
    series.forEach((s) => {
      row[s.name] = s.data[i] ?? 0;
    });
    return row;
  });
  return (
    <div style={{ width: "100%", maxWidth: w, height: h }}>
      <ResponsiveContainer width="100%" height="100%">
        <RLineChart data={rows} margin={{ top: 14, right: 14, bottom: 8, left: -10 }}>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <XAxis dataKey="i" hide />
          <YAxis
            domain={[yMin, yMax]}
            tick={{ fontSize: 12, fill: "var(--text-muted)" }}
            tickFormatter={(v: number) => v.toFixed(1)}
            axisLine={false}
            tickLine={false}
            width={38}
          />
          {series.map((s) => (
            <Line
              key={s.name}
              type="monotone"
              dataKey={s.name}
              stroke={s.color}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          ))}
        </RLineChart>
      </ResponsiveContainer>
    </div>
  );
}

export interface DonutSegment {
  label: string;
  value: number;
  color: string;
}

export function Donut({
  segments,
  size = 130,
  stroke = 22,
  valuePrefix = "$",
}: {
  segments: DonutSegment[];
  size?: number;
  stroke?: number;
  valuePrefix?: string;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
      <PieChart width={size} height={size}>
        <Pie
          data={segments}
          dataKey="value"
          nameKey="label"
          cx="50%"
          cy="50%"
          innerRadius={(size - stroke) / 2 - stroke / 2}
          outerRadius={(size - stroke) / 2 + stroke / 2}
          startAngle={90}
          endAngle={-270}
          isAnimationActive={false}
          stroke="none"
        >
          {segments.map((s, i) => (
            <Cell key={i} fill={s.color} />
          ))}
        </Pie>
      </PieChart>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {segments.map((s, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13 }}>
            <span style={{ width: 9, height: 9, borderRadius: 2, background: s.color }} />
            <span style={{ color: "var(--text-secondary)", flex: 1 }}>{s.label}</span>
            <span className="mono tnum" style={{ color: "var(--text-primary)", fontWeight: 600 }}>
              {valuePrefix}
              {s.value.toFixed(2)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function BarRow({
  label,
  value,
  max,
  color = "var(--accent)",
  suffix,
}: {
  label: string;
  value: number;
  max: number;
  color?: string;
  suffix?: string;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "150px 1fr 70px",
        alignItems: "center",
        gap: 14,
        padding: "6px 0",
      }}
    >
      <span
        className="mono"
        style={{
          fontSize: 13,
          color: "var(--text-secondary)",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {label}
      </span>
      <div style={{ height: 10, background: "var(--bg-hover)", borderRadius: 3, overflow: "hidden" }}>
        <div style={{ width: (value / max) * 100 + "%", height: "100%", background: color, borderRadius: 3 }} />
      </div>
      <span className="mono tnum" style={{ fontSize: 13, textAlign: "right", fontWeight: 600 }}>
        {suffix || ""}
      </span>
    </div>
  );
}

export function MetricCard({
  label,
  value,
  delta,
  color,
  trend,
  suffix,
}: {
  label: string;
  value: React.ReactNode;
  delta?: number;
  color?: string;
  trend?: number[];
  suffix?: string;
}) {
  const up = (delta ?? 0) > 0;
  const flat = delta === 0;
  const dc = flat ? "var(--text-muted)" : up ? "var(--ok)" : "var(--crit)";
  const DeltaIcon = flat ? Icon.Slash : up ? Icon.ArrowUp : Icon.ArrowDown;
  return (
    <div
      style={{
        flex: 1,
        background: "var(--bg-elevated)",
        border: "1px solid var(--border)",
        borderRadius: 9,
        padding: 18,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: "var(--text-muted)",
            letterSpacing: "0.03em",
          }}
        >
          {label}
        </span>
        {trend && <Sparkline data={trend} color={color || "var(--accent)"} w={56} h={20} />}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 12 }}>
        <span className="tnum" style={{ fontSize: 32, fontWeight: 700, letterSpacing: "-0.02em" }}>
          {value}
          {suffix && <span style={{ fontSize: 18, color: "var(--text-muted)" }}>{suffix}</span>}
        </span>
        {delta != null && (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 2,
              fontSize: 13,
              fontWeight: 600,
              color: dc,
            }}
          >
            <DeltaIcon size={12} />
            <span className="tnum">{Math.abs(delta).toFixed(2)}</span>
          </span>
        )}
      </div>
    </div>
  );
}
