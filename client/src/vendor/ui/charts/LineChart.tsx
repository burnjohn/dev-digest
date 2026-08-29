/* LineChart — multi-series line chart on Recharts. */
import React from "react";
import {
  LineChart as RLineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
} from "recharts";

export interface ChartSeries {
  name: string;
  color: string;
  /** `null` (or a missing index) means "not measured" — it renders as a gap,
      never as `0`. Only a real measurement of zero renders at the axis. */
  data: (number | null)[];
  /** Recharts `strokeDasharray` (e.g. `"4 4"`). Lets two series stay
      distinguishable without relying on color alone. Omit for a solid line. */
  dash?: string;
}

export function LineChart({
  series,
  w,
  h = 200,
  yMin = 0.6,
  yMax = 1.0,
}: {
  series: ChartSeries[];
  /** Optional width CAP. Omit for a chart that fills its container — the
      default used to be 620, which silently pinned every consumer to that
      width even inside a fluid page. */
  w?: number;
  h?: number;
  yMin?: number;
  yMax?: number;
}) {
  const n = series[0]?.data.length ?? 0;
  const rows = Array.from({ length: n }, (_, i) => {
    const row: Record<string, number | null> = { i };
    series.forEach((s) => {
      // `??`, not a truthiness check — a real `0` measurement must survive.
      row[s.name] = s.data[i] ?? null;
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
              strokeDasharray={s.dash}
              connectNulls={false}
              dot={false}
              isAnimationActive={false}
            />
          ))}
        </RLineChart>
      </ResponsiveContainer>
    </div>
  );
}
