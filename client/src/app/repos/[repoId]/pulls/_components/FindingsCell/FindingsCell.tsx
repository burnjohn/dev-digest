/* FindingsCell — the PR list's FINDINGS column: one compact severity badge per
   non-zero severity, previewing the latest review's findings on hover.

   The findings ride along on the list payload (`PrMeta.findings`), so the popup
   opens with no fetch and no loading state.

   POSITIONING, and why it looks over-engineered: the popup is rendered into a
   zero-sized `position: fixed` wrapper. Every row lives inside `s.tableCard`,
   which sets `overflow: hidden` for its rounded corners — a plain absolutely
   positioned popup is clipped dead, both below and to the right. `fixed`
   escapes ancestor overflow (there is no transform/filter/will-change on the
   chain to hijack the containing block), and keeping the wrapper zero-sized
   means the card's own `top: calc(100% + 8px)` resolves against a zero height,
   landing at the same 8px gap it uses on the PR detail page. Do not "simplify"
   this back to `absolute`; do not flip tableCard to `overflow: visible` either,
   which un-clips the last row's border from the card's rounded corners. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SeverityBadge } from "@devdigest/ui";
import type { PrMeta } from "@devdigest/shared";
import {
  FindingsHoverCard,
  FINDINGS_HOVER_CARD_WIDTH,
} from "@/components/findings-hover-card";
import { severityCounts, hiddenFindingsCount } from "../../helpers";
import { s } from "../../styles";

/** Hover open delay (ms) — matches the PR timeline's cluster. Long enough to
 *  survive a mouse pass-through, short enough to feel responsive. */
const HOVER_DELAY_MS = 150;
/** Gap kept between the card and the viewport edges. */
const VIEWPORT_MARGIN = 16;
/** The card's own offset from the wrapper (`top: calc(100% + 8px)` against a
 *  zero-height wrapper). Needed to place the card when flipping it above. */
const CARD_GAP = 8;

export function FindingsCell({
  pr,
  repoFullName,
}: {
  pr: PrMeta;
  repoFullName?: string | null;
}) {
  const t = useTranslations("prReview");
  // `below`/`above` are the trigger's edges; which one the card hangs off is
  // resolved after render, once its real height is known.
  const [rect, setRect] = React.useState<{
    below: number;
    above: number;
    left: number;
  } | null>(null);
  const triggerRef = React.useRef<HTMLDivElement>(null);
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const counts = severityCounts(pr);
  const findings = pr.findings ?? [];
  const hidden = hiddenFindingsCount(pr);
  // A never-reviewed PR and a reviewed-but-clean one both render "—"; the
  // adjacent SCORE cell is what tells them apart.
  const hasFindings = findings.length > 0;

  const show = () => {
    if (!hasFindings) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const el = triggerRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setRect({
        below: r.bottom,
        above: r.top,
        // Clamp so the 380px card cannot run off the right edge — FINDINGS is
        // the 5th of 8 columns, so on a narrow viewport it otherwise would.
        left: Math.max(
          VIEWPORT_MARGIN,
          Math.min(r.left, window.innerWidth - FINDINGS_HOVER_CARD_WIDTH - VIEWPORT_MARGIN),
        ),
      });
    }, HOVER_DELAY_MS);
  };

  const hide = React.useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setRect(null);
  }, []);

  React.useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  // Flip above the trigger when the card would not fit below it. Without this
  // the LAST row of a full table opens a 420px card straight off the bottom of
  // the viewport. Measured after render because the card's height depends on
  // how many findings it lists; useLayoutEffect so it never paints misplaced.
  React.useLayoutEffect(() => {
    const wrap = wrapRef.current;
    const card = wrap?.firstElementChild as HTMLElement | null;
    if (!rect || !wrap || !card) return;
    const h = card.getBoundingClientRect().height;
    const fitsBelow = rect.below + CARD_GAP + h <= window.innerHeight - VIEWPORT_MARGIN;
    // The card sits CARD_GAP below the wrapper, so placing it above means
    // pulling the wrapper up by the card's height plus both gaps.
    wrap.style.top = fitsBelow
      ? `${rect.below}px`
      : `${Math.max(VIEWPORT_MARGIN, rect.above - h - CARD_GAP * 2)}px`;
  }, [rect]);

  // A fixed-position card does not follow the scroll container, and the app
  // scrolls <main>, not the window — so close rather than let it drift.
  React.useEffect(() => {
    if (!rect) return;
    window.addEventListener("scroll", hide, true); // capture: catches <main>
    window.addEventListener("resize", hide);
    return () => {
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, [rect, hide]);

  if (!counts || !hasFindings) return <span style={s.muted}>—</span>;

  return (
    <div
      ref={triggerRef}
      style={s.findingsCell}
      tabIndex={0}
      role="button"
      aria-expanded={rect != null}
      aria-label={t("timeline.findingsHoverTitle", { count: findings.length })}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      onKeyDown={(e) => {
        if (e.key === "Escape") hide();
      }}
      /* Deliberately no stopPropagation on the trigger: every other cell in the
         row navigates on click, so this one should too. The popup itself stops
         propagation internally, which is what keeps a click inside it from
         routing away. */
    >
      {(["CRITICAL", "WARNING", "SUGGESTION"] as const).map((sev) =>
        counts[sev] ? <SeverityBadge key={sev} severity={sev} count={counts[sev]} compact /> : null,
      )}
      {hidden > 0 && <span>{t("list.findingsMore", { count: hidden })}</span>}
      {rect && (
        <div
          ref={wrapRef}
          style={{
            position: "fixed",
            top: rect.below,
            left: rect.left,
            width: 0,
            height: 0,
            zIndex: 50,
          }}
        >
          <FindingsHoverCard
            findings={findings}
            repoFullName={repoFullName}
            headSha={pr.head_sha}
          />
        </div>
      )}
    </div>
  );
}
