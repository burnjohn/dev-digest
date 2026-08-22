"use client";

import React from "react";
import { createPortal } from "react-dom";
import { Icon, SEV } from "@devdigest/ui";
import type { ReviewRecord } from "@devdigest/shared";

// ── Skeleton ────────────────────────────────────────────────────────────────

function SkeletonRow() {
  return (
    <div style={{ padding: "10px 16px", display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ height: 13, width: "70%", borderRadius: 4, background: "var(--bg-hover)" }} />
      <div style={{ height: 11, width: "45%", borderRadius: 4, background: "var(--bg-hover)" }} />
    </div>
  );
}

function PopoverSkeleton() {
  return (
    <>
      <div style={{ padding: "8px 16px 10px", borderBottom: "1px solid var(--border)", fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", color: "var(--text-muted)" }}>
        LOADING…
      </div>
      <SkeletonRow />
      <SkeletonRow />
      <SkeletonRow />
    </>
  );
}

// ── Content ─────────────────────────────────────────────────────────────────

function PopoverContent({ review }: { review: ReviewRecord | undefined }) {
  if (!review || review.findings.length === 0) {
    return (
      <div style={{ padding: "16px", fontSize: 13, color: "var(--text-muted)", textAlign: "center" }}>
        No findings in this run
      </div>
    );
  }

  return (
    <>
      <div style={{
        padding: "8px 16px 10px",
        borderBottom: "1px solid var(--border)",
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: "0.06em",
        color: "var(--text-muted)",
        display: "flex",
        alignItems: "center",
        gap: 6,
      }}>
        <Icon.FileText size={12} />
        {review.findings.length} FINDINGS IN THIS RUN
      </div>

      {review.findings.map((f) => {
        const meta = SEV[f.severity];
        const SIcon = Icon[meta.icon];
        return (
          <div key={f.id} style={{
            padding: "10px 16px",
            borderBottom: "1px solid var(--border)",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
              <SIcon size={13} style={{ color: meta.c, flexShrink: 0 }} />
              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {f.title}
              </span>
              <span style={{ fontSize: 11, color: "var(--text-muted)", background: "var(--bg-hover)", padding: "1px 6px", borderRadius: 4, flexShrink: 0 }}>
                {f.category}
              </span>
            </div>
            <div style={{ fontSize: 11, color: "var(--accent)", marginBottom: 4 }} className="mono">
              {f.file}:{f.start_line}
              <span style={{ marginLeft: 8, color: "var(--text-muted)" }}>
                ● {Math.round(f.confidence * 100)}% conf
              </span>
            </div>
            <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.5, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
              {f.rationale}
            </div>
          </div>
        );
      })}
    </>
  );
}

// ── Public component ─────────────────────────────────────────────────────────

export function FindingsPopover({
  review,
  isLoading,
  anchorRect,
}: {
  review: ReviewRecord | undefined;
  isLoading: boolean;
  anchorRect: DOMRect;
}) {
  const top = anchorRect.bottom + 6;
  const left = anchorRect.left;

  return createPortal(
    <div style={{
      position: "fixed",
      top,
      left,
      zIndex: 9999,
      width: 380,
      maxHeight: 420,
      overflowY: "auto",
      background: "var(--bg-elevated)",
      border: "1px solid var(--border)",
      borderRadius: 10,
      boxShadow: "0 8px 32px rgba(0,0,0,.5)",
    }}>
      {isLoading ? <PopoverSkeleton /> : <PopoverContent review={review} />}
    </div>,
    document.body,
  );
}
