/* ReviewFocusCard — "read these files first" (server/specs/SPEC-02-pr-risk-brief.md).
   A full-width BAND rendered below the two-column card grid (T9's placement,
   never a grid cell — OverviewTab.tsx `cardGrid`): one row per `review_focus[]`
   entry, in payload order, each a `file` — `reason` pair. `file` links to
   `githubBlobUrl(repoFullName, headSha, file)` with NO line fragment (REQ-13);
   when either input is missing, the row degrades to plain text rather than a
   broken github.com URL (client/INSIGHTS.md 2026-08-17).

   Shares `usePrBrief`'s `["pr-brief", prId]` query with `PrBriefCard` — see
   that hook's own doc comment (lib/hooks/brief.ts) for why mounting either
   card is what makes the brief exist, and why this is a POST inside a
   `queryFn`. This card's own error branch covers transport failures only — a
   malformed payload throws during render and is caught by the `ErrorBoundary`
   OverviewTab/T9 wraps it in, not here (client/INSIGHTS.md 2026-08-25). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, EmptyState, SectionLabel, Skeleton } from "@devdigest/ui";
import { usePrBrief } from "@/lib/hooks/brief";
import { reviewFocusHref } from "./helpers";
import { s } from "./styles";

export interface ReviewFocusCardProps {
  prId: string | null;
  repoFullName?: string | null;
  headSha?: string | null;
}

/** One `review_focus[]` row. A separate component (not inlined in a `.map`)
    because it needs its own hover state — inline styles can't express
    `:hover` (see `styles.ts`). */
function FocusRow({
  file,
  reason,
  href,
}: {
  file: string;
  reason: string;
  href: string | undefined;
}) {
  const [hovered, setHovered] = React.useState(false);
  return (
    <li style={s.row}>
      {href ? (
        <a
          className="mono"
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          title={file}
          translate="no"
          style={s.fileLink(hovered)}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
        >
          {file}
        </a>
      ) : (
        <span className="mono" style={s.filePlain} title={file} translate="no">
          {file}
        </span>
      )}
      <span style={s.dash} aria-hidden="true">
        —
      </span>
      <span style={s.reason}>{reason}</span>
    </li>
  );
}

export function ReviewFocusCard({ prId, repoFullName, headSha }: ReviewFocusCardProps) {
  const t = useTranslations("riskBrief");
  const { data: brief, isLoading, isError, refetch } = usePrBrief(prId);

  if (!prId) return null;

  if (isLoading) {
    return (
      <section style={s.section}>
        <SectionLabel icon="Eye">{t("reviewFocus.title")}</SectionLabel>
        <div style={s.card}>
          {/* "Generating risk brief…" already ends in "…" — no new key. */}
          <span style={s.loadingText}>{t("loading")}</span>
          <Skeleton height={13} width="88%" style={{ marginTop: 10 }} />
          <Skeleton height={13} width="64%" style={{ marginTop: 6 }} />
        </div>
      </section>
    );
  }

  if (isError || !brief) {
    return (
      <section style={s.section}>
        <SectionLabel icon="Eye">{t("reviewFocus.title")}</SectionLabel>
        <div role="alert" style={s.errorCard}>
          <span>{t("error")}</span>
          <button type="button" style={s.retryButton} onClick={() => refetch()}>
            {t("retry")}
          </button>
        </div>
      </section>
    );
  }

  // Rendered exactly in payload order (REQ-15) — never re-sorted, never
  // re-ranked. `file` is the React key: AC-36 dedupes `review_focus[]` by
  // `file` server-side before this ever reaches the client, so it is unique.
  const items = brief.review_focus;

  return (
    <section style={s.section}>
      <SectionLabel icon="Eye" right={<Badge>{items.length}</Badge>}>
        {t("reviewFocus.title")}
      </SectionLabel>
      <div style={s.card}>
        {items.length === 0 ? (
          <EmptyState icon="Eye" title={t("reviewFocus.empty")} />
        ) : (
          <ul style={s.list}>
            {items.map((item) => (
              <FocusRow
                key={item.file}
                file={item.file}
                reason={item.reason}
                href={reviewFocusHref(repoFullName, headSha, item.file)}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
