"use client";

import { Icon } from "@devdigest/ui";
import { useTranslations } from "next-intl";
import type { ReviewFocusItem } from "@devdigest/shared";
import { useDiffNavigate } from "@/lib/diff-nav";
import { s } from "./styles";

interface ReviewFocusCardProps {
  items: ReviewFocusItem[];
  /** Files touched by this PR's diff — determines internal vs external nav for path:line links. */
  changedPaths?: Set<string>;
}

export function ReviewFocusCard({ items, changedPaths = new Set() }: ReviewFocusCardProps) {
  const t = useTranslations("brief");
  const navigate = useDiffNavigate();
  const ordered = [...items].sort((a, b) => a.priority - b.priority);
  return (
    <section style={s.reviewFocusCard}>
      <div style={s.reviewFocusHeader}>
        <Icon.ListChecks size={12} />
        {t("reviewFocus.header")}
        <span style={s.reviewFocusCountBadge}>{ordered.length}</span>
      </div>
      <div style={s.reviewFocusBody}>
        {ordered.map((item, i) => {
          const isChanged = changedPaths.has(item.path);
          const clickable = isChanged || !!item.github_link;
          const pathLabel = `${item.path}${item.line != null ? `:${item.line}` : ""}`;
          return (
            <div key={i} style={s.reviewFocusRow}>
              {clickable ? (
                <button
                  type="button"
                  style={s.reviewFocusPathLink}
                  title={`Open ${pathLabel}`}
                  onClick={() => navigate(item.path, item.line ?? null, item.github_link ?? null, isChanged)}
                >
                  {pathLabel}
                </button>
              ) : (
                <span style={s.reviewFocusPathPlain}>{pathLabel}</span>
              )}
              <span style={s.reviewFocusDash}>—</span>
              <span style={s.reviewFocusReason}>{item.reason}</span>
            </div>
          );
        })}
        {ordered.length === 0 && (
          <div style={s.reviewFocusEmpty}>{t("reviewFocus.empty")}</div>
        )}
      </div>
    </section>
  );
}
