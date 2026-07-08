/* SectionCard — shared chrome for every onboarding-tour section: header with
   title + icon + collapse/expand toggle + degraded/lite badge, sourced from
   OnboardingTour.run. Visual pattern (Icon.AlertTriangle, role="status")
   mirrors BlastRadiusCard.tsx's degradedBadge exactly. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, type IconName } from "@devdigest/ui";
import type { OnboardingTourRunMetadata } from "@devdigest/shared";
import { s } from "./styles";

interface SectionCardProps {
  id: string;
  title: string;
  icon: IconName;
  run: OnboardingTourRunMetadata;
  children: React.ReactNode;
}

export function SectionCard({ id, title, icon, run, children }: SectionCardProps) {
  const t = useTranslations("onboarding");
  const [open, setOpen] = React.useState(true);
  const Icon_ = Icon[icon];

  const showDegradedBadge = run.degraded || run.status === "partial" || run.mode === "lite";
  const degradedReason = run.reason
    ? run.reason
    : run.mode === "lite"
      ? t("degraded.lite")
      : run.status === "partial"
        ? t("degraded.partial")
        : t("degraded.noIndex");

  return (
    <section id={id} style={s.card}>
      <button type="button" style={s.cardHeader} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <Icon_ size={13} />
        <span style={s.title}>{title}</span>
        {showDegradedBadge && (
          <span
            style={s.degradedBadge}
            title={degradedReason}
            role="status"
            aria-label={`${t("degraded.badge")}: ${degradedReason}`}
          >
            <Icon.AlertTriangle size={9} />
            {t("degraded.badge")}
          </span>
        )}
        <Icon.ChevronDown
          size={14}
          style={{
            marginLeft: showDegradedBadge ? 8 : "auto",
            transform: open ? "rotate(180deg)" : "none",
            transition: "transform .15s",
          }}
        />
      </button>
      {open && <div style={s.cardBody}>{children}</div>}
    </section>
  );
}
