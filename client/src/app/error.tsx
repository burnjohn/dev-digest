/* Route-level error boundary for the whole App Router tree.

   Before this existed, every route hand-rolled `isError ? <ErrorState/>` for
   fetch failures — but a throw during RENDER had nothing to catch it and blanked
   the screen. Next renders this file in place of the failing segment, inside the
   root layout, so the chrome and the i18n provider stay mounted. */
"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { EmptyState } from "@devdigest/ui";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("common");

  useEffect(() => {
    // The browser console is the only place this is visible in the starter;
    // `digest` is the id that ties it to the server-side log entry.
    console.error(error);
  }, [error]);

  return (
    <EmptyState
      icon="AlertTriangle"
      title={t("states.error")}
      body={error.message}
      cta={t("actions.retry")}
      onCta={reset}
    />
  );
}
