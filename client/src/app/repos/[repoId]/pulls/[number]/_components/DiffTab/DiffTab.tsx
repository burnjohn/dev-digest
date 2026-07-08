"use client";

import React from "react";
import { Button } from "@devdigest/ui";
import { DiffViewer, type DiffCommentApi } from "@/components/diff-viewer";
import { usePrComments, useCreatePrComment, useSmartDiff, usePrRuns } from "@/lib/hooks/reviews";
import { notify } from "@/lib/toast";
import type { PrFile } from "@devdigest/shared";
import { SmartDiffViewer } from "./SmartDiffViewer";

interface DiffTabProps {
  prId: string | null;
  filesCount: number;
  files: PrFile[];
  /** Inline commenting is offered only on open PRs (GitHub rejects otherwise). */
  canComment?: boolean;
}

const pillStyle = (active: boolean): React.CSSProperties => ({
  borderRadius: 20,
  border: `1px solid ${active ? 'var(--text-primary)' : 'var(--border)'}`,
  background: active ? 'var(--bg-hover)' : 'transparent',
  color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
  fontSize: 12,
  fontWeight: 600,
  padding: '3px 12px',
  cursor: 'pointer',
});

export function DiffTab({ prId, filesCount, files, canComment }: DiffTabProps) {
  const { data: comments } = usePrComments(prId);
  const create = useCreatePrComment(prId);
  // Comments start hidden so the diff is clean by default — toggle to reveal.
  const [showComments, setShowComments] = React.useState(false);
  const [mode, setMode] = React.useState<'smart' | 'original'>('smart');
  const { data: smartDiff, isLoading } = useSmartDiff(prId);
  const { data: runs } = usePrRuns(prId);

  // Total tokens consumed by the last review batch (the cost that produced the findings
  // Smart Diff overlays). Smart Diff itself adds 0 tokens on top.
  const lastReviewTokens = React.useMemo(() => {
    const done = (runs ?? []).filter((r) => r.status === 'done');
    if (done.length === 0) return null;
    return done.reduce((sum, r) => sum + (r.tokens_in ?? 0) + (r.tokens_out ?? 0), 0);
  }, [runs]);

  const patches = Object.fromEntries(files.map((f) => [f.path, f.patch]));

  const totalAdditions = files.reduce((sum, f) => sum + (f.additions ?? 0), 0);
  const totalDeletions = files.reduce((sum, f) => sum + (f.deletions ?? 0), 0);

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
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          {filesCount} files
          {' · '}
          <span style={{ color: '#4caf50' }}>+{totalAdditions}</span>
          {' '}
          <span style={{ color: '#f44336' }}>-{totalDeletions}</span>
        </span>
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
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <button
          type="button"
          onClick={() => setMode('smart')}
          style={pillStyle(mode === 'smart')}
        >
          Smart order
        </button>
        <button
          type="button"
          onClick={() => setMode('original')}
          style={pillStyle(mode === 'original')}
        >
          Original order
        </button>
      </div>
      {mode === 'smart' ? (
        isLoading ? (
          <div style={{ color: 'var(--text-muted)', padding: 16 }}>Loading smart diff…</div>
        ) : smartDiff ? (
          <>
            {/* Zero-cost indicator — Smart Diff is deterministic, no LLM call */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                marginBottom: 12,
                fontSize: 12,
                color: 'var(--text-muted)',
              }}
            >
              <span>⚡</span>
              <span>
                <strong style={{ color: 'var(--text-primary)' }}>0 new tokens</strong>
                {lastReviewTokens !== null
                  ? ` · built on ${lastReviewTokens.toLocaleString()} from last review`
                  : ' · deterministic — no LLM call'}
              </span>
            </div>
            <SmartDiffViewer smartDiff={smartDiff} prId={prId ?? ''} patches={patches} />
          </>
        ) : (
          <DiffViewer files={files} commenting={commenting} />
        )
      ) : (
        <DiffViewer files={files} commenting={commenting} />
      )}
    </section>
  );
}
