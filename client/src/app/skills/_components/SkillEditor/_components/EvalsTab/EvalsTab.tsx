/* EvalsTab — placeholder. Scoring a skill against saved cases needs the eval
   module (the `eval_cases` / `eval_runs` tables exist but nothing writes them),
   which arrives with its own lesson. Shown rather than hidden so the tab order
   matches the agent editor. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { EmptyState } from "@devdigest/ui";

export function EvalsTab() {
  const t = useTranslations("skills");
  return (
    <EmptyState icon="FlaskConical" title={t("evals.title")} body={t("evals.body")} />
  );
}
