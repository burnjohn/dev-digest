"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SectionLabel, Button, Icon } from "@devdigest/ui";
import { DiffViewer, type DiffCommentApi } from "@/components/diff-viewer";
import { usePrComments, useCreatePrComment } from "@/lib/hooks/reviews";
import { notify } from "@/lib/toast";
import type { PrFile, PrDiffSource, PrDiffSourceReason } from "@devdigest/shared";
import { s } from "./styles";

interface DiffTabProps {
  prId: string | null;
  filesCount: number;
  files: PrFile[];
  /** Inline commenting is offered only on open PRs (GitHub rejects otherwise). */
  canComment?: boolean;
  /**
   * Where `files` came from. The detail endpoint degrades to the local cache and
   * still answers 200, so without this an unreachable GitHub is indistinguishable
   * from a PR that genuinely changed nothing. Absent = legacy payload, assume live.
   */
  diffSource?: PrDiffSource | null;
  diffReason?: PrDiffSourceReason | null;
  onRetry?: () => void;
}

export function DiffTab({
  prId,
  filesCount,
  files,
  canComment,
  diffSource,
  diffReason,
  onRetry,
}: DiffTabProps) {
  const t = useTranslations("shell");
  const { data: comments } = usePrComments(prId);
  const create = useCreatePrComment(prId);
  // Comments start hidden so the diff is clean by default — toggle to reveal.
  const [showComments, setShowComments] = React.useState(false);

  const commentCount = comments?.length ?? 0;
  const stale = diffSource != null && diffSource !== "github";
  const noticeKey =
    diffSource === "cache"
      ? "diffViewer.staleCache"
      : diffReason === "auth"
        ? "diffViewer.staleAuth"
        : "diffViewer.staleUnavailable";
  // `filesCount` still reflects GitHub's real `changed_files`, so printing it above
  // zero rendered files would read as "we lost 4 of your 4 files". Drop it instead.
  const showCount = !(diffSource === "unavailable" && files.length === 0);

  const commenting: DiffCommentApi = {
    comments: comments ?? [],
    canComment: !!canComment && !!prId,
    showComments,
    posting: create.isPending,
    onSubmit: async (input) => {
      try {
        const res = await create.mutateAsync(input);
        setShowComments(true); // a just-posted comment shouldn't stay hidden
        return res;
      } catch (err) {
        notify.error(err instanceof Error ? err.message : "Couldn't post the comment to GitHub.");
        throw err;
      }
    },
  };

  return (
    <section>
      <SectionLabel
        icon="Code"
        right={
          commentCount > 0 ? (
            <Button
              kind="ghost"
              size="sm"
              icon={showComments ? "EyeOff" : "Eye"}
              onClick={() => setShowComments((v) => !v)}
            >
              {showComments ? "Hide comments" : "Show comments"} ({commentCount})
            </Button>
          ) : undefined
        }
      >
        {showCount ? `Files changed · ${filesCount} files` : "Files changed"}
      </SectionLabel>
      {stale && (
        <div role="status" style={s.notice}>
          <Icon.AlertTriangle size={14} style={s.noticeIcon} />
          <span style={s.noticeText}>{t(noticeKey)}</span>
          {onRetry && (
            <Button kind="ghost" size="sm" icon="RefreshCw" onClick={onRetry}>
              {t("diffViewer.retry")}
            </Button>
          )}
        </div>
      )}
      <DiffViewer files={files} commenting={commenting} />
    </section>
  );
}
