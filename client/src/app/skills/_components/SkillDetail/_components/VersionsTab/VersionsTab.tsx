/* VersionsTab — body history, newest first. Restoring an old body is a normal
   update (see specs/02-skill-detail-tabs.md): it creates a NEW version rather
   than rewriting history, so the timeline only ever grows. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, EmptyState, ErrorState, Icon, Markdown, Skeleton } from "@devdigest/ui";
import type { Skill, SkillVersion } from "@devdigest/shared";
import { useSkillVersions, useUpdateSkill } from "../../../../../../lib/hooks/skills";
import { useToast } from "../../../../../../lib/toast";
import { s } from "./styles";

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

function VersionRow({
  version,
  isCurrent,
  onRestore,
  restoring,
}: {
  version: SkillVersion;
  isCurrent: boolean;
  onRestore: (v: SkillVersion) => void;
  restoring: boolean;
}) {
  const t = useTranslations("skills");
  const [open, setOpen] = React.useState(false);

  return (
    <div style={s.row}>
      <button style={s.rowHeader} onClick={() => setOpen((v) => !v)}>
        <Icon.ChevronRight
          size={14}
          style={{ transform: open ? "rotate(90deg)" : undefined, transition: "transform .1s" }}
        />
        <Badge color="var(--text-muted)" mono>
          {t("preview.version", { version: version.version })}
        </Badge>
        {isCurrent && <Badge color="var(--ok)">{t("versionsTab.current")}</Badge>}
        <span className="tnum" style={s.when}>
          {formatWhen(version.created_at)}
        </span>
      </button>
      {open && (
        <div style={s.body}>
          <div style={s.bodyBox}>
            <Markdown>{version.body}</Markdown>
          </div>
          {!isCurrent && (
            <Button
              kind="secondary"
              size="sm"
              icon="RefreshCw"
              onClick={() => onRestore(version)}
              disabled={restoring}
            >
              {restoring ? t("versionsTab.restoring") : t("versionsTab.restore")}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

export function VersionsTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  const toast = useToast();
  const { data: versions, isLoading, isError, refetch } = useSkillVersions(skill.id);
  const update = useUpdateSkill();

  const restore = (version: SkillVersion) => {
    const confirmed = window.confirm(t("versionsTab.restoreConfirm", { version: version.version }));
    if (!confirmed) return;
    update.mutate(
      { id: skill.id, patch: { body: version.body } },
      {
        onSuccess: (data) =>
          toast.success(
            t("versionsTab.restoredToast", { version: version.version, newVersion: data.version }),
          ),
      },
    );
  };

  return (
    <div>
      <h2 style={s.title}>{t("versionsTab.title")}</h2>

      {isLoading && (
        <div style={s.list}>
          <Skeleton height={44} />
          <Skeleton height={44} />
        </div>
      )}
      {isError && <ErrorState body={t("versionsTab.loadError")} onRetry={() => refetch()} />}
      {!isLoading && !isError && (versions ?? []).length === 0 && (
        <EmptyState
          icon="History"
          title={t("versionsTab.empty.title")}
          body={t("versionsTab.empty.body")}
        />
      )}
      {(versions ?? []).length > 0 && (
        <div style={s.list}>
          {(versions ?? []).map((v) => (
            <VersionRow
              key={v.version}
              version={v}
              isCurrent={v.version === skill.version}
              onRestore={restore}
              restoring={update.isPending}
            />
          ))}
        </div>
      )}
    </div>
  );
}
