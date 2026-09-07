/* LineChart — multi-series line chart on Recharts. */
import React from "react";
import {
  LineChart as RLineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  type TooltipProps,
} from "recharts";

export interface ChartSeries {
  name: string;
  color: string;
  data: number[];
}

/** Per-point context shown in the tooltip alongside each series' value —
 *  e.g. the run's artifact version and cost, neither of which is itself a
 *  plotted series. Parallel-indexed to each series' `data`. */
export interface ChartPointMeta {
  version: number | null;
  cost: number | null;
}

type Row = Record<string, number> & { i: number; __version: number | null; __cost: number | null };

function formatChartCost(usd: number | null): string {
  return usd == null ? "—" : `$${usd.toFixed(3)}`;
}

/** Exported for direct unit testing — Recharts only renders a `<Tooltip>`'s
 *  content on a hover interaction jsdom can't simulate (it drives Recharts'
 *  own mouse-tracking over a measured SVG canvas), so the formatting logic
 *  is tested by rendering this piece standalone with a synthetic payload
 *  instead of relying on a real hover. */
export function ChartTooltip({ active, payload }: TooltipProps<number, string>) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0]!.payload as Row;
  return (
    <div
      style={{
        background: "var(--bg-elevated)",
        border: "1px solid var(--border)",
        borderRadius: 6,
        padding: "8px 10px",
        fontSize: 12,
        color: "var(--text-primary)",
      }}
    >
      <div style={{ color: "var(--text-muted)", marginBottom: 4 }}>
        {row.__version != null ? `v${row.__version}` : "—"} · {formatChartCost(row.__cost)}
      </div>
      {payload.map((p) => (
        <div key={p.name} style={{ color: p.color }}>
          {p.name}: {typeof p.value === "number" ? `${Math.round(p.value * 100)}%` : "—"}
        </div>
      ))}
    </div>
  );
}

export function LineChart({
  series,
  points,
  w = 620,
  h = 200,
  yMin = 0.6,
  yMax = 1.0,
}: {
  series: ChartSeries[];
  /** One entry per data point (same length/order as each series' `data`).
   *  Omit to render without a tooltip — points are click-invisible dots
   *  otherwise, so a chart with no metadata to show stays tooltip-free
   *  rather than showing an empty box on hover. */
  points?: ChartPointMeta[];
  w?: number;
  h?: number;
  yMin?: number;
  yMax?: number;
}) {
  const n = series[0]?.data.length ?? 0;
  const rows: Row[] = Array.from({ length: n }, (_, i) => {
    const row = { i, __version: points?.[i]?.version ?? null, __cost: points?.[i]?.cost ?? null } as Row;
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
          {points && <Tooltip content={<ChartTooltip />} />}
          {series.map((s) => (
            <Line
              key={s.name}
              type="monotone"
              dataKey={s.name}
              stroke={s.color}
              strokeWidth={2}
              dot={points ? { r: 3, fill: s.color, strokeWidth: 0 } : false}
              activeDot={points ? { r: 5 } : false}
              isAnimationActive={false}
            />
          ))}
        </RLineChart>
      </ResponsiveContainer>
    </div>
  );
}
