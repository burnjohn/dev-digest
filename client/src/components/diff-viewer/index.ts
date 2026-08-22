/* diff-viewer — unified-diff viewer with optional inline GitHub comments and
   optional Smart Diff finding annotations.
   Public surface: the DiffViewer component + the DiffCommentApi and
   DiffAnnotationApi contracts. */
export { DiffViewer } from "./DiffViewer";
export type { DiffCommentApi } from "./comments";
export type { DiffAnnotationApi, DiffLineAnnotation } from "./annotations";
