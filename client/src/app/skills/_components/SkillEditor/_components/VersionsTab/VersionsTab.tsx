/* VersionsTab — every save snapshots the body, so a past run can be read against
   the exact text it scored. Restoring writes the old body forward as a NEW
   version rather than rewinding: the history stays append-only. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, ErrorState, Skeleton } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { useSkillVersions, useUpdateSkill } from "../../../../../../lib/hooks/skills";
import { useToast } from "../../../../../../lib/toast";
import { diffLines, versionDeltas } from "../../../../helpers";
import { s } from "../../../../styles";

export function VersionsTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  const toast = useToast();
  const { data: versions, isLoading, isError, refetch } = useSkillVersions(skill.id);
  const update = useUpdateSkill();
  const [openDiff, setOpenDiff] = React.useState<number | null>(null);

  if (isError) return <ErrorState body={t("versions.loadError")} onRetry={() => void refetch()} />;
  if (isLoading || !versions) return <Skeleton height={220} />;

  const rows = versionDeltas(versions);
  const byVersion = new Map(versions.map((v) => [v.version, v]));

  const restore = async (version: number) => {
    const target = byVersion.get(version);
    if (!target) return;
    if (!window.confirm(t("versions.restoreConfirm", { version }))) return;
    const saved = await update.mutateAsync({
      id: skill.id,
      // A restore writes its own note, so the history says where the text came
      // from rather than showing an unexplained diff.
      patch: { body: target.body, version_message: t("versions.restoreMessage", { version }) },
    });
    toast.success(t("versions.restored", { from: version, version: saved.version }));
  };

  return (
    <div>
      <div style={s.sectionRow}>
        <h2 style={s.sectionTitle}>{t("versions.title")}</h2>
        <Badge color="var(--text-secondary)">
          {t("versions.count", { count: versions.length })}
        </Badge>
      </div>
      <p style={{ ...s.emptyNote, marginBottom: 18 }}>{t("versions.subtitle")}</p>

      {rows.map(({ version, previous, added, removed, isFirst }) => {
        const isCurrent = version.version === skill.version;
        return (
          <div key={version.version}>
            <div style={s.versionRow(isCurrent)}>
              <span className="mono" style={s.versionBadge}>
                v{version.version}
              </span>
              <div style={s.versionText}>
                {/* The author's note when they left one; otherwise a summary
                    derived from the diff, so a row is never blank. */}
                <div style={s.versionSummary}>
                  {version.message ||
                    (isFirst
                      ? t("versions.initial", { lines: added })
                      : t("versions.delta", { added, removed }))}
                </div>
                <div style={s.versionDate}>
                  {new Date(version.created_at).toLocaleString()}
                  {version.message && !isFirst && (
                    <> · {t("versions.delta", { added, removed })}</>
                  )}
                </div>
              </div>
              {isCurrent && (
                <Badge color="var(--ok, #3fb950)" dot>
                  {t("versions.current")}
                </Badge>
              )}
              {/* Available on every row, the current one included — "what did the
                  latest save change?" is the question asked most often. The very
                  first version has no predecessor, so it diffs against nothing
                  and reads as all-additions. */}
              <Button
                kind="ghost"
                size="sm"
                icon="Eye"
                onClick={() => setOpenDiff(openDiff === version.version ? null : version.version)}
              >
                {t("versions.diff")}
              </Button>
              {!isCurrent && (
                <Button
                  kind="secondary"
                  size="sm"
                  icon="History"
                  onClick={() => void restore(version.version)}
                  disabled={update.isPending}
                >
                  {t("versions.restore")}
                </Button>
              )}
            </div>

            {openDiff === version.version && (
              <div className="mono" style={s.diffBlock}>
                {diffLines(previous?.body ?? "", version.body).map((line, i) => (
                  <div key={i} style={s.diffLine(line.kind)}>
                    {line.kind === "add" ? "+" : line.kind === "remove" ? "−" : " "} {line.text}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
