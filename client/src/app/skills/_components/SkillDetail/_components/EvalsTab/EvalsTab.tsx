/* EvalsTab — placeholder. Scoring a skill's recall/precision/citation accuracy
   against saved cases is its own lesson (eval_cases already has an
   owner_kind='skill' column, but no UI or run path exists yet); "Run on
   evals" is hidden until then rather than wired to nothing. */
"use client";

import { useTranslations } from "next-intl";
import { EmptyState } from "@devdigest/ui";

export function EvalsTab() {
  const t = useTranslations("skills");
  return (
    <EmptyState
      icon="FlaskConical"
      title={t("evalsTab.comingSoon.title")}
      body={t("evalsTab.comingSoon.body")}
    />
  );
}
