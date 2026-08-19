"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SectionLabel, Button, Toggle } from "@devdigest/ui";
import { DiffViewer, type DiffCommentApi } from "@/components/diff-viewer";
import { SmartDiffViewer } from "../SmartDiffViewer";
import { usePrComments, useCreatePrComment } from "@/lib/hooks/reviews";
import { notify } from "@/lib/toast";
import type { PrFile } from "@devdigest/shared";

interface DiffTabProps {
  prId: string | null;
  filesCount: number;
  files: PrFile[];
  /** Inline commenting is offered only on open PRs (GitHub rejects otherwise). */
  canComment?: boolean;
}

export function DiffTab({ prId, filesCount, files, canComment }: DiffTabProps) {
  const t = useTranslations("smartDiff");
  const { data: comments } = usePrComments(prId);
  const create = useCreatePrComment(prId);
  // Comments start hidden so the diff is clean by default — toggle to reveal.
  const [showComments, setShowComments] = React.useState(false);
  // Decision: default view is Smart order (grouped by role), not GitHub's
  // original file order.
  const [smartOrder, setSmartOrder] = React.useState(true);

  const commentCount = comments?.length ?? 0;

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
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
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
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
              <span style={{ color: smartOrder ? "var(--text-muted)" : "var(--text-primary)" }}>
                {t("toggle.originalOrder")}
              </span>
              <Toggle on={smartOrder} onChange={setSmartOrder} size={16} />
              <span style={{ color: smartOrder ? "var(--text-primary)" : "var(--text-muted)" }}>
                {t("toggle.smartOrder")}
              </span>
            </div>
          </div>
        }
      >
        Files changed · {filesCount} files
      </SectionLabel>
      {smartOrder ? (
        <SmartDiffViewer prId={prId} files={files} commenting={commenting} />
      ) : (
        <DiffViewer files={files} commenting={commenting} />
      )}
    </section>
  );
}
