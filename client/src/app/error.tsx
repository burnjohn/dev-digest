/* Route error boundary — catches render/data errors anywhere under the root
   layout and offers a retry (Next re-renders the segment via reset()). Uses the
   same ErrorState primitive the pages use for fetch failures. */
"use client";

import React from "react";
import { ErrorState } from "@devdigest/ui";

export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    // Surface the real error for debugging — the boundary otherwise swallows it.
    console.error(error);
  }, [error]);

  return (
    <ErrorState
      fullScreen
      title="Something went wrong"
      body={error.message || "An unexpected error occurred while rendering this page."}
      onRetry={reset}
    />
  );
}
