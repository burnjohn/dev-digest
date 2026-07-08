/* MermaidDiagram — renders a mermaid flowchart string to an inline SVG on the
   client. Mermaid is browser-only and heavy, so it's dynamically imported inside
   an effect (never in SSR). On any parse/render failure the diagram degrades to
   the raw mermaid source in a <pre> — a malformed diagram never breaks the page. */
"use client";

import { useEffect, useRef, useState } from "react";
import { s } from "./styles";

export function MermaidDiagram({ chart }: { chart: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);

    void (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          theme: "dark",
          securityLevel: "loose",
          fontFamily: "inherit",
        });
        const id = `mmd-${Math.random().toString(36).slice(2)}`;
        const { svg } = await mermaid.render(id, chart);
        if (cancelled || !ref.current) return;
        ref.current.innerHTML = svg;
        // Mermaid emits a fixed intrinsic width/height + its own max-width style,
        // which makes the SVG render at full natural size. Strip those so the
        // viewBox drives responsive scaling — the diagram then fits the card width.
        const svgEl = ref.current.querySelector("svg");
        if (svgEl) {
          svgEl.removeAttribute("height");
          svgEl.setAttribute("width", "100%");
          svgEl.style.width = "100%";
          svgEl.style.maxWidth = "100%";
          svgEl.style.height = "auto";
        }
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [chart]);

  if (failed) {
    return <pre style={s.diagramPre}>{chart}</pre>;
  }

  return <div ref={ref} style={s.diagramSvg} role="img" aria-label="Architecture diagram" />;
}
