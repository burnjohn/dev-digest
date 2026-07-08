/* Sparkline — lightweight inline-SVG trend line (no Recharts; trivial + perf).

   Two width modes:
   - fixed (default): renders at exactly `w` px.
   - `fill`: stretches to the full width of its flex/grid container. The
     drawing geometry is computed at the container's REAL measured pixel width
     (via ResizeObserver) so the end dot stays perfectly round — as opposed to
     an SVG `width="100%"` + `preserveAspectRatio="none"` stretch, which would
     squash the dot into an ellipse. Falls back to `w` before the first
     measurement and in environments without ResizeObserver (jsdom tests).

   Points are chronological (oldest → newest); the newest sits at the right
   edge, so a freshly appended run always extends the line rightward. Degenerate
   series render sensibly: 1 point → a single right-aligned dot, 0 points →
   nothing (the caller decides whether to show a "—" placeholder instead). */
import React from "react";

export function Sparkline({
  data,
  color = "var(--accent)",
  w = 80,
  h = 24,
  fill = false,
}: {
  data: number[];
  color?: string;
  w?: number;
  h?: number;
  /** Stretch to the full width of the parent container (measured px). */
  fill?: boolean;
}) {
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const [measured, setMeasured] = React.useState<number | null>(null);

  React.useEffect(() => {
    if (!fill) return;
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const update = () => setMeasured(el.clientWidth || null);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [fill]);

  if (!data.length) return null;

  // Pixel width the geometry is computed at (round dot, correct spacing).
  const W = fill ? measured ?? Math.max(w, 200) : w;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  // Safe denominator: a single-point series must not divide by zero (0/0 =
  // NaN), which produced broken SVG geometry ("MNaN,NaN", cx=NaN).
  const xStep = Math.max(data.length - 1, 1);
  const pts = data.map((v, i) => {
    // A lone point pins to the right edge — it's the newest run, and new
    // points always extend rightward. Multi-point series spread evenly 0..W.
    const x = data.length === 1 ? W - 3 : (i / xStep) * W;
    const y = h - ((v - min) / span) * (h - 4) - 2;
    return [x, y] as const;
  });
  const d = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" ");
  const last = pts[pts.length - 1]!;

  const svg = (
    <svg width={W} height={h} viewBox={`0 0 ${W} ${h}`} style={{ display: "block", overflow: "visible" }}>
      {data.length > 1 && (
        <path d={d} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      )}
      <circle cx={last[0]} cy={last[1]} r={2} fill={color} />
    </svg>
  );

  if (!fill) return svg;
  return (
    <div ref={wrapRef} style={{ width: "100%" }}>
      {svg}
    </div>
  );
}
