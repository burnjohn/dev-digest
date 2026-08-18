"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, ErrorState, Modal, Skeleton } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import {
  useRestoreSkillVersion,
  useSkillVersions,
} from "../../../../../../../lib/hooks/skills";
import { useToast } from "../../../../../../../lib/toast";
import { s } from "./styles";

/**
 * Versions tab — the immutable body snapshots, newest first.
 *
 * Only a BODY change creates one. Renaming, re-typing or toggling `enabled`
 * deliberately do not, because a version is a record of the text the model was
 * sent — bumping it for a rename would make the history lie.
 *
 * Restoring goes through `POST /skills/:id/restore` with a version NUMBER, never
 * a body: the server re-reads the snapshot under the same lock a save takes, and
 * authors the audit note itself. Doing it here — a `PUT` carrying `body` from
 * this cache plus a translated note — would write history in the reader's locale
 * and could push forward a body the user never saw.
 */
export function VersionsTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  const toast = useToast();
  const { data: versions, isLoading, isError, refetch } = useSkillVersions(skill.id);
  const restore = useRestoreSkillVersion();
  const [open, setOpen] = React.useState<number | null>(skill.version);
  const [confirming, setConfirming] = React.useState<number | null>(null);
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  const doRestore = async (from: number) => {
    const saved = await restore.mutateAsync({ id: skill.id, version: from });
    setConfirming(null);
    // The server no-ops when the restored body already equals the current one,
    // rather than writing an empty-diff version. Say so instead of claiming a
    // version that was never created.
    if (saved.version === skill.version) {
      toast.info(t("editor.versions.restore.noop"));
      return;
    }
    toast.success(t("editor.versions.restore.success", { from, version: saved.version }));
  };

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
          const isCurrent = v.version === skill.version;
          return (
            <li key={v.version} style={s.item}>
              {/* The flex row is a plain <div>, and the accordion toggle is a
                  button INSIDE it. Styling the toggle as the whole row instead
                  would nest the Restore button inside a button — invalid HTML
                  and a hydration error. `aria-expanded` stays on the toggle
                  alone so it remains the only element with that state. */}
              <div style={s.row}>
                <button
                  type="button"
                  onClick={() => setOpen(expanded ? null : v.version)}
                  aria-expanded={expanded}
                  style={s.toggle}
                >
                  <span className="mono" style={s.version}>
                    {t("preview.version", { version: v.version })}
                  </span>
                  {isCurrent && <Badge color="var(--accent)">{t("editor.versions.current")}</Badge>}
                  {/* Stored text, rendered verbatim — never an i18n key. The
                      server owns this string precisely so it does not move with
                      the reader's locale. */}
                  {v.message !== null && <span style={s.message}>{v.message}</span>}
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
                {/* Restoring the current version is a server-side no-op anyway;
                    hiding the button is polish on top of that contract. */}
                {!isCurrent && (
                  <Button
                    kind="ghost"
                    size="sm"
                    icon="History"
                    onClick={() => setConfirming(v.version)}
                  >
                    {t("editor.versions.restore.action")}
                  </Button>
                )}
              </div>
              {expanded && (
                <pre className="mono" style={s.body}>
                  {v.body}
                </pre>
              )}
            </li>
          );
        })}
      </ol>

      {confirming !== null && (
        <Modal
          width={440}
          title={t("editor.versions.restore.title", { version: confirming })}
          onClose={() => setConfirming(null)}
          footer={
            <div style={s.modalFooter}>
              <Button kind="ghost" onClick={() => setConfirming(null)}>
                {t("editor.versions.restore.cancel")}
              </Button>
              <Button
                kind="primary"
                icon="History"
                onClick={() => doRestore(confirming)}
                disabled={restore.isPending}
              >
                {t("editor.versions.restore.confirm")}
              </Button>
            </div>
          }
        >
          <p style={s.modalBody}>{t("editor.versions.restore.body")}</p>
        </Modal>
      )}
    </div>
  );
}
