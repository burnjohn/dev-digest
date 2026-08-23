/* CodeLine — one rendered diff line: gutter number, +/- sign, text, plus the
   hover "+" affordance, any anchored comment threads, and an inline composer. */
"use client";

import React from "react";
import { commentTargetFor, type CommentThread, type DiffCommentApi, cs } from "../comments";
import { type Line } from "../helpers";
import { type DiffAnnotationApi } from "../annotations";
import { s, lineRowFor, lineSignFor, annotationChip, annotationChipSlot, severityColor } from "../styles";
import { CommentThreadView } from "../CommentThreadView";
import { InlineComposer } from "../InlineComposer";

export function CodeLine({
  ln,
  path,
  threads,
  commenting,
  annotations,
}: {
  ln: Line;
  path: string;
  threads: CommentThread[];
  commenting?: DiffCommentApi;
  annotations?: DiffAnnotationApi;
}) {
  const [hover, setHover] = React.useState(false);
  const [composing, setComposing] = React.useState(false);

  if (ln.kind === "hunk") {
    return (
      <div className="mono" style={s.hunk}>
        {ln.text}
      </div>
    );
  }

  const sign = ln.kind === "add" ? "+" : ln.kind === "del" ? "−" : "";
  const target = commenting?.canComment ? commentTargetFor(ln) : null;
  const showAdd = hover && !!target && !composing;
  // REQ-14: matched by `finding.start_line === Line.newNo` — only lines that
  // carry a new-file line number (add/ctx) can host an annotation. REQ-15
  // (rewritten): every finding on the line gets its own chip, already
  // ordered severity descending then id ascending by the caller.
  const lineAnnotations = annotations && ln.newNo != null ? annotations.forLine(path, ln.newNo) : [];
  // The left-bar accent stands for the whole line, so it takes the
  // highest-severity chip — the first entry, given the caller's total order.
  const accentSeverity = lineAnnotations[0]?.severity;

  return (
    <div
      style={cs.rowWrap}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div style={lineRowFor(ln.kind, accentSeverity ? severityColor(accentSeverity) : undefined)}>
        <span className="mono tnum" style={{ ...s.lineNo, position: "relative" }}>
          {showAdd && target && (
            <button
              type="button"
              title="Add a comment on this line"
              aria-label="Add a comment on this line"
              onClick={() => setComposing(true)}
              style={cs.addBtn}
            >
              +
            </button>
          )}
          {ln.newNo ?? ln.oldNo ?? ""}
        </span>
        <span className="mono" style={lineSignFor(ln.kind)}>
          {sign}
        </span>
        <span className="mono" style={s.lineText}>
          {ln.text || " "}
        </span>
        {lineAnnotations.length > 0 && (
          <span style={annotationChipSlot}>
            {lineAnnotations.map((annotation) => (
              <button
                key={annotation.key}
                type="button"
                style={annotationChip(annotation.severity)}
                aria-label={annotation.title}
                title={annotation.title}
                onClick={annotation.onClick}
              >
                {annotation.label}
              </button>
            ))}
          </span>
        )}
      </div>

      {commenting &&
        commenting.showComments &&
        threads.map((th) => (
          <CommentThreadView key={th.rootId} thread={th} commenting={commenting} path={path} />
        ))}

      {commenting && composing && target && (
        <InlineComposer
          commenting={commenting}
          path={path}
          line={target.line}
          side={target.side}
          onClose={() => setComposing(false)}
        />
      )}
    </div>
  );
}
