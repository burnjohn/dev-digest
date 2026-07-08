/* LineChart — multi-series line chart on Recharts. */
import React from "react";
import {
  LineChart as RLineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

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
  showDots = false,
  fill = false,
  onActiveIndexChange,
  renderTooltip,
}: {
  series: ChartSeries[];
  w?: number;
  h?: number;
  yMin?: number;
  yMax?: number;
  /** Stretch to the full width of the parent (drops the `w` max-width cap) so
   *  the plotted lines span the whole block instead of being left-aligned at
   *  `w` px. Default false keeps the capped width for existing consumers. */
  fill?: boolean;
  /** Draw a marker at each data point (off by default to keep existing
   *  consumers unchanged). */
  showDots?: boolean;
  /** Fired with the hovered point's data-index (or null on leave). Lets a
   *  consumer link the chart to an external list. When provided, a vertical
   *  cursor is shown so the hovered x is visible. Off by default. */
  onActiveIndexChange?: (index: number | null) => void;
  /** Custom floating-tooltip content for the hovered point, keyed by its
   *  data-index. When provided, Recharts' native tooltip renders this
   *  content positioned near the cursor automatically. Omitted (default) →
   *  no floating tooltip, matching prior behavior exactly. */
  renderTooltip?: (index: number) => React.ReactNode;
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
    <div style={{ width: "100%", maxWidth: fill ? undefined : w, height: h }}>
      <ResponsiveContainer width="100%" height="100%">
        <RLineChart
          data={rows}
          margin={{ top: 14, right: 14, bottom: 8, left: -10 }}
          onMouseMove={(st: { activeTooltipIndex?: number | null } | null) =>
            onActiveIndexChange?.(typeof st?.activeTooltipIndex === "number" ? st.activeTooltipIndex : null)
          }
          onMouseLeave={() => onActiveIndexChange?.(null)}
        >
          <CartesianGrid stroke="var(--border)" vertical={false} />
          {(onActiveIndexChange || renderTooltip) && (
            <Tooltip
              content={
                renderTooltip
                  ? ({ active, label }: { active?: boolean; label?: number }) =>
                      active && typeof label === "number" ? (
                        <div
                          style={{
                            background: "var(--bg-surface)",
                            border: "1px solid var(--border)",
                            borderRadius: 8,
                            padding: "8px 10px",
                            fontSize: 12,
                          }}
                        >
                          {renderTooltip(label)}
                        </div>
                      ) : null
                  : () => null
              }
              cursor={{ stroke: "var(--text-muted)", strokeDasharray: "3 3" }}
            />
          )}
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
              dot={showDots ? { r: 3, fill: s.color, strokeWidth: 0 } : false}
              isAnimationActive={false}
            />
          ))}
        </RLineChart>
      </ResponsiveContainer>
    </div>
  );
}
