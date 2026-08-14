/* CategoryDonut — findings-by-category ring for the Stats tab.
   NOT the vendored `Donut`: that component hardcodes a "$" value prefix and
   `.toFixed(2)`, both built for a cost breakdown — a finding COUNT rendered
   through it would read "96.00". This is the same ring built directly on
   recharts (already a dependency) for integer counts instead. */
"use client";

import { PieChart, Pie, Cell } from "recharts";
import { CategoryTag, type Category } from "@devdigest/ui";
import type { SkillCategoryTally } from "@devdigest/shared";

/**
 * Chart colors, not theme colors — hardcoded to specific CSS variables rather
 * than derived, because five categories need five distinguishable hues and
 * this app's semantic palette only has ~6 (two of which, --sugg and --accent,
 * are the identical blue in dark mode). Picked for maximum contrast, not for
 * matching each category's "meaning".
 */
const CATEGORY_COLOR: Record<string, string> = {
  security: "var(--crit)",
  bug: "var(--warn)",
  perf: "var(--accent)",
  style: "var(--ok)",
  test: "var(--info)",
};
const FALLBACK_COLOR = "var(--text-muted)";

export function CategoryDonut({
  tally,
  size = 120,
  stroke = 20,
}: {
  tally: SkillCategoryTally[];
  size?: number;
  stroke?: number;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
      <PieChart width={size} height={size}>
        <Pie
          data={tally}
          dataKey="count"
          nameKey="category"
          cx="50%"
          cy="50%"
          innerRadius={(size - stroke) / 2 - stroke / 2}
          outerRadius={(size - stroke) / 2 + stroke / 2}
          startAngle={90}
          endAngle={-270}
          isAnimationActive={false}
          stroke="none"
        >
          {tally.map((c, i) => (
            <Cell key={i} fill={CATEGORY_COLOR[c.category] ?? FALLBACK_COLOR} />
          ))}
        </Pie>
      </PieChart>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {tally.map((c, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span
              style={{
                width: 9,
                height: 9,
                borderRadius: 2,
                background: CATEGORY_COLOR[c.category] ?? FALLBACK_COLOR,
                flexShrink: 0,
              }}
            />
            <span style={{ flex: 1 }}>
              <CategoryTag category={c.category as Category} />
            </span>
            <span className="mono tnum" style={{ color: "var(--text-primary)", fontWeight: 600 }}>
              {c.count}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
