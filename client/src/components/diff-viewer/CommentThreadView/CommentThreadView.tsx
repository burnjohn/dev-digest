/* CommentThreadView — a single thread (root comment + replies) with an inline
   reply composer. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button } from "@devdigest/ui";
import { type CommentThread, type DiffCommentApi, cs } from "../comments";
import { CommentCard } from "../CommentCard";
import { InlineComposer } from "../InlineComposer";

export function CommentThreadView({
  thread,
  commenting,
  path,
}: {
  thread: CommentThread;
  commenting: DiffCommentApi;
  path: string;
}) {
  const t = useTranslations("shell");
  const [replying, setReplying] = React.useState(false);
  // Only threads anchored to a rendered line get here (partitionThreads sends
  // the rest to OutdatedComments), but the type allows null and a reply has to
  // be posted against a line — so an unanchored thread renders read-only
  // instead of asserting the line away.
  const { line } = thread;
  return (
    <div style={cs.thread}>
      {thread.comments.map((c) => (
        <CommentCard key={c.id} c={c} />
      ))}
      {commenting.canComment &&
        line != null &&
        (replying ? (
          <InlineComposer
            commenting={commenting}
            path={path}
            line={line}
            side={thread.side}
            inReplyTo={thread.rootId}
            onClose={() => setReplying(false)}
          />
        ) : (
          <div>
            <Button
              kind="ghost"
              size="sm"
              icon="CornerDownRight"
              onClick={() => setReplying(true)}
            >
              {t("diffViewer.reply")}
            </Button>
          </div>
        ))}
    </div>
  );
}
