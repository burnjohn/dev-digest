/* /_showcase — renders the full component gallery in BOTH themes side-by-side
   for visual verification (DoD). The two columns force data-theme locally so
   tokens resolve per-column regardless of the global theme. */
"use client";

import React from "react";
import { Gallery } from "../../components/showcase";

export default function ShowcasePage() {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", minHeight: "100vh" }}>
      <div data-theme="dark" style={{ background: "var(--bg-primary)", borderRight: "1px solid var(--border)" }}>
        <div style={{ padding: "18px 32px 0", fontWeight: 700, fontSize: 14, letterSpacing: "0.06em", color: "var(--text-muted)" }}>
          DARK THEME
        </div>
        <Gallery />
      </div>
      <div data-theme="light" style={{ background: "var(--bg-primary)" }}>
        <div style={{ padding: "18px 32px 0", fontWeight: 700, fontSize: 14, letterSpacing: "0.06em", color: "var(--text-muted)" }}>
          LIGHT THEME
        </div>
        <Gallery />
      </div>
    </div>
  );
}
