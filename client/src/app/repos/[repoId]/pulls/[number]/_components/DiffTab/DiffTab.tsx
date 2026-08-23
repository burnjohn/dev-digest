"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SectionLabel, Button, Chip, Icon } from "@devdigest/ui";
import { DiffViewer, type DiffCommentApi } from "@/components/diff-viewer";
import { usePrComments, useCreatePrComment, useSmartDiff } from "@/lib/hooks/reviews";
import { notify } from "@/lib/toast";
import type { PrFile, PrDiffSource, PrDiffSourceReason } from "@devdigest/shared";
import { SmartDiffViewer } from "../SmartDiffViewer";
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
  /** Smart Diff mode (REQ-13). Optional so this task typechecks before T9
   *  wires the URL `?order=` param through page.tsx — `undefined`/`null`
   *  both render the original, un-annotated `DiffViewer`. */
  order?: "smart" | null;
  onOrderChange?: (order: "smart" | null) => void;
  /** Called with a finding id when a Smart Diff chip is clicked (REQ-17).
   *  Optional for the same reason as `order` — T9 wires the route
   *  transition to `?tab=findings&finding=<id>`. */
  onOpenFinding?: (id: string) => void;
}

export function DiffTab({
  prId,
  filesCount,
  files,
  canComment,
  diffSource,
  diffReason,
  onRetry,
  order,
  onOrderChange,
  onOpenFinding,
}: DiffTabProps) {
  const t = useTranslations("shell");
  const tPr = useTranslations("prReview");
  const { data: comments } = usePrComments(prId);
  const create = useCreatePrComment(prId);
  const isSmart = order === "smart";
  // Only fetched once the user switches to Smart order — passing `null` when
  // not needed leans on `useSmartDiff`'s own `enabled: !!prId` guard rather
  // than adding a second enabled flag to a hook T4 owns.
  const { data: smartDiff } = useSmartDiff(isSmart ? prId : null);
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
          <div style={s.headerRight}>
            {/* REQ-13: writes/clears `order` via the caller's own `?order=`
                param wiring (T9) — this component holds no order state of
                its own. Two plain Chips, not a single control, so each
                segment's own accessible name is its visible label. */}
            <div style={s.toggleRow}>
              <Chip active={isSmart} onClick={() => onOrderChange?.("smart")}>
                {tPr("smartDiff.orderSmart")}
              </Chip>
              <Chip active={!isSmart} onClick={() => onOrderChange?.(null)}>
                {tPr("smartDiff.orderOriginal")}
              </Chip>
            </div>
            {commentCount > 0 && (
              <Button
                kind="ghost"
                size="sm"
                icon={showComments ? "EyeOff" : "Eye"}
                onClick={() => setShowComments((v) => !v)}
              >
                {showComments ? "Hide comments" : "Show comments"} ({commentCount})
              </Button>
            )}
          </div>
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
      {isSmart ? (
        smartDiff && (
          <SmartDiffViewer
            response={smartDiff}
            files={files}
            diffSource={diffSource}
            diffReason={diffReason}
            onOpenFinding={onOpenFinding ?? (() => {})}
          />
        )
      ) : (
        <DiffViewer files={files} commenting={commenting} />
      )}
    </section>
  );
}
