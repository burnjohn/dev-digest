"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button } from "@devdigest/ui";
import type { EvalSkillOffer } from "@devdigest/shared/contracts/eval-ci";
import { s } from "./styles";

/**
 * specs/15-skill-eval-cases.md AC-1, AC-2, D10 — the finding → skill-case
 * entry point. Offers only the skills the finding's own review actually
 * injected, with D10's "present, not causal" caption always shown (never
 * only on a non-empty list — an empty offer list is a STATED empty state,
 * not a hidden action). `offers` is `undefined` until the caller's GET
 * resolves (fetched lazily via `onOpen`, only once this menu is opened).
 */
export function SkillEvalMenu({
  offers,
  loading,
  disabled,
  onOpen,
  onSelect,
}: {
  offers: EvalSkillOffer[] | undefined;
  loading: boolean;
  disabled?: boolean;
  onOpen: () => void;
  onSelect: (skillId: string) => void;
}) {
  const t = useTranslations("prReview");
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const toggle = () => {
    setOpen((cur) => {
      const next = !cur;
      if (next) onOpen();
      return next;
    });
  };

  return (
    <div ref={ref} style={s.skillMenuWrap}>
      <Button kind="ghost" size="sm" icon="ListChecks" disabled={disabled} onClick={toggle}>
        {t("finding.turnIntoSkillEvalCase")}
      </Button>
      {open && (
        <div style={s.skillMenu} role="menu" aria-label={t("finding.turnIntoSkillEvalCase")}>
          <p style={s.skillMenuCaption}>{t("finding.skillEvalCaption")}</p>
          {loading || offers === undefined ? (
            <p style={s.skillMenuHint}>{t("finding.skillEvalLoading")}</p>
          ) : offers.length === 0 ? (
            <p style={s.skillMenuHint}>{t("finding.skillEvalEmpty")}</p>
          ) : (
            offers.map((o) => (
              <button
                key={o.skill_id}
                type="button"
                role="menuitem"
                style={s.skillMenuItem}
                onClick={() => {
                  onSelect(o.skill_id);
                  setOpen(false);
                }}
              >
                <span>{o.skill_name}</span>
                {o.has_case && <span style={s.skillMenuHint}>{t("finding.skillEvalHasCase")}</span>}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
