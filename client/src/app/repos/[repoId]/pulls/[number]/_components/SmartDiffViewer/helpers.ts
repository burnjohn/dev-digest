import type { PrFile, SmartDiffFile } from "@devdigest/shared";

/** Index PR files by path for quick lookup. */
export function indexByPath(files: PrFile[]): Map<string, PrFile> {
  const m = new Map<string, PrFile>();
  for (const f of files) m.set(f.path, f);
  return m;
}

/** Resolve a group's SmartDiffFiles to full PrFiles, dropping any missing. */
export function resolveGroupFiles(
  groupFiles: SmartDiffFile[],
  byPath: Map<string, PrFile>,
): PrFile[] {
  return groupFiles.map((g) => byPath.get(g.path)).filter((f): f is PrFile => !!f);
}

/** Total finding-lines across a group's files. */
export function totalFindingLines(groupFiles: SmartDiffFile[]): number {
  return groupFiles.reduce((n, f) => n + f.finding_lines.length, 0);
}
