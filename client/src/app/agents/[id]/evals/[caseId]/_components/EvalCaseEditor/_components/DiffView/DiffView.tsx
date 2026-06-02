import React from "react";
import { isHunkHeader, lineBackground } from "./helpers";
import { s } from "./styles";

/** Read-only unified-diff preview with add/del/hunk highlighting. */
export function DiffView({ text }: { text: string }) {
  return (
    <pre className="mono" style={s.pre}>
      {(text || " ").split("\n").map((l, i) => (
        <div key={i} style={s.line(lineBackground(l), isHunkHeader(l))}>
          {l || " "}
        </div>
      ))}
    </pre>
  );
}

export default DiffView;
