"use client";

import React from "react";
import { Markdown } from "@devdigest/ui";

/** Read-only markdown render — the extracted "Preview mode" half of DocDetail.
    Pure presentational: takes `content`, does no data fetching. Consumed by
    DocDetail's Preview mode AND the ContextDocsList picker's preview control
    (replaces the retired PreviewModal's rendering). */
export function DocPreviewPane({ content }: { content: string }) {
  return <Markdown>{content}</Markdown>;
}
