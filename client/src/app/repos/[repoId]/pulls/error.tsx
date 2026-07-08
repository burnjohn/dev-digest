"use client";

import React from "react";
import { ErrorState } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";

export default function PullsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <AppShell crumb={[{ label: "Pull Requests" }]}>
      <ErrorState
        fullScreen
        title="Something went wrong"
        body={error.message || "An unexpected error occurred loading pull requests."}
        onRetry={reset}
      />
    </AppShell>
  );
}
