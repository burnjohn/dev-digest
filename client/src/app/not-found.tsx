/* 404 — unknown routes (and notFound() calls). Renders inside the root layout,
   so the design tokens and vendored primitives are available. */
"use client";

import { useRouter } from "next/navigation";
import { EmptyState } from "@devdigest/ui";

export default function NotFound() {
  const router = useRouter();
  return (
    <div style={{ minHeight: "60vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <EmptyState
        icon="Search"
        title="Page not found"
        body="This page doesn't exist — the link may be stale or the resource was removed."
        cta="Go to DevDigest home"
        onCta={() => router.push("/")}
      />
    </div>
  );
}
