"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { EmptyState } from "@devdigest/ui";
import { s } from "./styles";

/** Placeholder tab body rendered while the owning feature agent fills the tab. */
export function MountPoint({
  title,
  owner,
  icon,
}: {
  title: string;
  owner: string;
  icon: "FlaskConical" | "BarChart" | "Workflow";
}) {
  const t = useTranslations("agents");
  return (
    <div style={s.wrap}>
      <EmptyState icon={icon} title={title} body={t("mount.body", { owner })} />
    </div>
  );
}
