/* diff-viewer — unified-diff viewer with optional inline GitHub comments.
   Public surface: the DiffViewer component + the DiffCommentApi contract,
   plus FileCard (the per-file collapsible unit) for SmartDiffViewer, which
   needs to render files grouped by risk rather than as DiffViewer's flat list. */
export { DiffViewer } from "./DiffViewer";
export { FileCard } from "./FileCard";
export type { DiffCommentApi } from "./comments";
export { parseMultiFileDiff, type ParsedDiffFile } from "./helpers";
