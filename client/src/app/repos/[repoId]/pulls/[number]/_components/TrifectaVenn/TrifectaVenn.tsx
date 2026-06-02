/* TrifectaVenn — Lethal-Trifecta display (ported from findings.jsx TrifectaVenn).
   Three overlapping circles; a filled circle means that component was detected.
   When all 3 are present the center dot lights up = the lethal trifecta. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { TrifectaComponent } from "@devdigest/shared";
import { KEYS, LABEL_KEYS, POSITIONS } from "./constants";
import { s } from "./styles";

export function TrifectaVenn({ components }: { components: TrifectaComponent[] }) {
  const t = useTranslations("prReview");
  const all = KEYS.every((k) => components.includes(k));
  return (
    <div style={s.wrap}>
      <svg width={90} height={70} style={s.svg}>
        {KEYS.map((k, i) => (
          <circle
            key={k}
            cx={POSITIONS[i]!.cx}
            cy={POSITIONS[i]!.cy}
            r={18}
            fill={components.includes(k) ? "rgba(239,68,68,0.22)" : "transparent"}
            stroke={components.includes(k) ? "var(--crit)" : "var(--border-strong)"}
            strokeWidth={1.5}
          />
        ))}
        <circle cx={45} cy={32} r={4} fill={all ? "var(--crit)" : "var(--border-strong)"} />
      </svg>
      <div style={s.legend}>
        <div style={s.heading}>{all ? t("trifecta.lethal") : t("trifecta.components")}</div>
        {KEYS.map((k) => (
          <div key={k} style={s.legendRow(components.includes(k))}>
            {components.includes(k) ? (
              <Icon.Check size={12} style={s.checkIcon} />
            ) : (
              <Icon.Dot size={12} style={s.dotIcon} />
            )}
            {t(`trifecta.${LABEL_KEYS[k]}`)}
          </div>
        ))}
      </div>
    </div>
  );
}
