/* components/context-docs — the presentational document-row set shared by the
   Project Context page and both agent/skill `Context` tabs (SPEC-01). Three
   consumers are known by construction, which is what makes promoting this out
   of any one route's `_components/` correct rather than speculative. */
export { DocumentRow } from "./DocumentRow";
export type { DocumentRowProps, DocumentRowDragProps } from "./DocumentRow";
export { TypeBadge } from "./TypeBadge";
export { TokenEstimate } from "./TokenEstimate";
export { OversizedMarker } from "./OversizedMarker";
export { TYPE_COLOR } from "./styles";
export {
  move,
  shiftPath,
  filterByPath,
  orderForDisplay,
  reconcileOrder,
  samePaths,
  splitDocPath,
} from "./helpers";
