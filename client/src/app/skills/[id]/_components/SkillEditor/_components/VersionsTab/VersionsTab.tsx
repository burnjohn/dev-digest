"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, ErrorState, Skeleton } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { useSkillVersions } from "../../../../../../../lib/hooks/skills";
import { s } from "./styles";

/**
 * Versions tab — the immutable body snapshots, newest first.
 *
 * Only a BODY change creates one. Renaming, re-typing or toggling `enabled`
 * deliberately do not, because a version is a record of the text the model was
 * sent — bumping it for a rename would make the history lie.
 */
export function VersionsTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  const { data: versions, isLoading, isError, refetch } = useSkillVersions(skill.id);
  const [open, setOpen] = React.useState<number | null>(skill.version);
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  if (isLoading) {
    return (
      <div style={s.wrap}>
        <Skeleton height={64} />
        <Skeleton height={64} />
      </div>
    );
  }
  if (isError) {
    return (
      <div style={s.wrap}>
        <ErrorState body={t("editor.versions.loadError")} onRetry={() => refetch()} />
      </div>
    );
  }

  const list = versions ?? [];

  return (
    <div style={s.wrap}>
      <h2 style={s.h2}>{t("editor.versions.heading")}</h2>
      <p style={s.subtitle}>{t("editor.versions.subtitle")}</p>

      {list.length === 0 && <p style={s.empty}>{t("editor.versions.empty")}</p>}

      <ol style={s.list}>
        {list.map((v) => {
          const expanded = open === v.version;
          return (
            <li key={v.version} style={s.item}>
              <button
                type="button"
                onClick={() => setOpen(expanded ? null : v.version)}
                aria-expanded={expanded}
                style={s.itemHeader}
              >
                <span className="mono" style={s.version}>
                  {t("preview.version", { version: v.version })}
                </span>
                {v.version === skill.version && (
                  <Badge color="var(--accent)">{t("editor.versions.current")}</Badge>
                )}
                {/* Rendered only after mount. `toLocaleString()` resolves
                    against the runtime's locale and timezone, so formatting it
                    during SSR and again on the client produces a hydration
                    mismatch on any machine whose TZ differs from the server's.
                    The machine-readable value stays in `dateTime` regardless. */}
                <time dateTime={v.created_at} style={s.date}>
                  {mounted ? new Date(v.created_at).toLocaleString() : ""}
                </time>
                <span style={s.chars}>{v.body.length}</span>
              </button>
              {expanded && (
                <pre className="mono" style={s.body}>
                  {v.body}
                </pre>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
