/* diff-viewer — unified-diff viewer with optional inline GitHub comments.
   Public surface: the DiffViewer component + the DiffCommentApi contract +
   rawDiffToPrFiles (splits a raw multi-file diff string into per-file
   PrFile chunks for a live preview of a hand-typed/pasted fixture). */
export { DiffViewer } from "./DiffViewer";
export type { DiffCommentApi } from "./comments";
export { rawDiffToPrFiles } from "./helpers";
