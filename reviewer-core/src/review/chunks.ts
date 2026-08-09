import type { ReviewDiff as UnifiedDiff } from '../grounding.js';

export const DEFAULT_MAX_PROMPT_TOKENS = 16_000;
export const DEFAULT_MIN_DIFF_TOKENS = 512;

export interface ReviewChunk {
  label: string;
  diffText: string;
  files: string[];
  /** Conservative total: fixed prompt overhead plus this chunk's diff. */
  estimatedTokens: number;
}

export interface PlanReviewChunksInput {
  diff: UnifiedDiff;
  promptOverheadTokens: number;
  maxPromptTokens?: number;
  minDiffTokens?: number;
}

interface HunkBlock {
  header: string;
  lines: string[];
}

interface FileBlock {
  path: string;
  headerLines: string[];
  hunks: HunkBlock[];
  raw: string;
}

interface ChunkPart {
  path: string;
  text: string;
}

export class PromptBudgetExceededError extends Error {
  constructor(overhead: number, maximum: number, minimumDiff: number) {
    super(
      `Fixed review prompt uses ${overhead} estimated tokens; ` +
        `the ${maximum}-token budget must leave at least ${minimumDiff} tokens for diff content`,
    );
    this.name = 'PromptBudgetExceededError';
  }
}

/** Conservative tokenizer-free estimate that handles non-ASCII input by bytes. */
export function estimateTokens(text: string): number {
  return Math.ceil(new TextEncoder().encode(text).byteLength / 3);
}

function parseFileBlocks(diff: UnifiedDiff): FileBlock[] {
  const lines = diff.raw.split('\n');
  const starts: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.startsWith('diff --git ')) starts.push(i);
  }

  if (starts.length === 0) {
    const path = diff.files[0]?.path ?? 'diff';
    return [{ path, headerLines: [], hunks: [], raw: diff.raw }];
  }

  return starts.map((start, fileIndex) => {
    const end = starts[fileIndex + 1] ?? lines.length;
    const blockLines = lines.slice(start, end);
    const path =
      diff.files[fileIndex]?.path ??
      blockLines.find((line) => line.startsWith('+++ b/'))?.slice('+++ b/'.length) ??
      `file-${fileIndex + 1}`;
    const firstHunk = blockLines.findIndex((line) => line.startsWith('@@ '));
    if (firstHunk === -1) {
      return { path, headerLines: blockLines, hunks: [], raw: blockLines.join('\n') };
    }

    const headerLines = blockLines.slice(0, firstHunk);
    const hunks: HunkBlock[] = [];
    for (let i = firstHunk; i < blockLines.length; ) {
      const header = blockLines[i]!;
      let next = i + 1;
      while (next < blockLines.length && !blockLines[next]!.startsWith('@@ ')) next++;
      hunks.push({ header, lines: blockLines.slice(i + 1, next) });
      i = next;
    }
    return { path, headerLines, hunks, raw: blockLines.join('\n') };
  });
}

function hunkCoordinates(header: string): {
  oldStart: number;
  newStart: number;
  suffix: string;
} {
  const match = header.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/);
  if (!match) throw new Error(`Cannot split malformed unified-diff hunk header: ${header}`);
  return { oldStart: Number(match[1]), newStart: Number(match[2]), suffix: match[3] ?? '' };
}

function lineDelta(line: string): { old: number; next: number } {
  if (line.startsWith('\\')) return { old: 0, next: 0 };
  if (line.startsWith('+')) return { old: 0, next: 1 };
  if (line.startsWith('-')) return { old: 1, next: 0 };
  return { old: 1, next: 1 };
}

function syntheticHunk(
  oldStart: number,
  newStart: number,
  suffix: string,
  lines: readonly string[],
): string {
  let oldCount = 0;
  let newCount = 0;
  for (const line of lines) {
    const delta = lineDelta(line);
    oldCount += delta.old;
    newCount += delta.next;
  }
  return `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@${suffix}`;
}

function renderHunk(headerLines: readonly string[], header: string, lines: readonly string[]): string {
  return [...headerLines, header, ...lines].join('\n');
}

function splitTextToFit(
  text: string,
  diffTokenBudget: number,
  render: (fragment: string) => string,
): string[] {
  const characters = Array.from(text);
  if (characters.length === 0) {
    if (estimateTokens(render('')) > diffTokenBudget) {
      throw new Error(`Diff framing alone exceeds the ${diffTokenBudget}-token diff budget`);
    }
    return [''];
  }
  const fragments: string[] = [];
  let start = 0;

  while (start < characters.length) {
    let low = start + 1;
    let high = characters.length;
    let best = start;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      const fragment = characters.slice(start, middle).join('');
      if (estimateTokens(render(fragment)) <= diffTokenBudget) {
        best = middle;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    if (best === start) {
      throw new Error(`Diff framing alone exceeds the ${diffTokenBudget}-token diff budget`);
    }
    fragments.push(characters.slice(start, best).join(''));
    start = best;
  }
  return fragments;
}

function splitOversizedLine(
  file: FileBlock,
  hunk: HunkBlock,
  line: string,
  oldStart: number,
  newStart: number,
  diffTokenBudget: number,
): ChunkPart[] {
  const prefix =
    line.startsWith('+') || line.startsWith('-') || line.startsWith(' ') ? line[0]! : '';
  const content = prefix ? line.slice(1) : line;
  const suffix = hunkCoordinates(hunk.header).suffix;
  const render = (fragment: string) => {
    const fragmentLine = `${prefix}${fragment}`;
    return renderHunk(
      file.headerLines,
      syntheticHunk(oldStart, newStart, suffix, [fragmentLine]),
      [fragmentLine],
    );
  };
  return splitTextToFit(content, diffTokenBudget, render).map((fragment) => ({
    path: file.path,
    text: render(fragment),
  }));
}

function splitOversizedHunk(
  file: FileBlock,
  hunk: HunkBlock,
  diffTokenBudget: number,
): ChunkPart[] {
  const coordinates = hunkCoordinates(hunk.header);
  const parts: ChunkPart[] = [];
  let oldCursor = coordinates.oldStart;
  let newCursor = coordinates.newStart;
  let segmentOldStart = oldCursor;
  let segmentNewStart = newCursor;
  let segmentLines: string[] = [];

  const render = (lines: readonly string[], oldStart: number, newStart: number) =>
    renderHunk(
      file.headerLines,
      syntheticHunk(oldStart, newStart, coordinates.suffix, lines),
      lines,
    );

  const flush = () => {
    if (segmentLines.length === 0) return;
    parts.push({ path: file.path, text: render(segmentLines, segmentOldStart, segmentNewStart) });
    segmentLines = [];
    segmentOldStart = oldCursor;
    segmentNewStart = newCursor;
  };

  for (const line of hunk.lines) {
    if (estimateTokens(render([line], oldCursor, newCursor)) > diffTokenBudget) {
      flush();
      parts.push(...splitOversizedLine(file, hunk, line, oldCursor, newCursor, diffTokenBudget));
      const delta = lineDelta(line);
      oldCursor += delta.old;
      newCursor += delta.next;
      segmentOldStart = oldCursor;
      segmentNewStart = newCursor;
      continue;
    }

    const candidate = [...segmentLines, line];
    if (
      segmentLines.length > 0 &&
      estimateTokens(render(candidate, segmentOldStart, segmentNewStart)) > diffTokenBudget
    ) {
      flush();
    }

    segmentLines.push(line);
    const delta = lineDelta(line);
    oldCursor += delta.old;
    newCursor += delta.next;
  }
  flush();
  return parts;
}

function splitHunklessFile(file: FileBlock, diffTokenBudget: number): ChunkPart[] {
  const lines = file.raw.split('\n');
  let contextLength = Math.min(3, lines.length);
  while (
    contextLength > 1 &&
    estimateTokens(lines.slice(0, contextLength).join('\n')) > diffTokenBudget
  ) {
    contextLength--;
  }
  const context = lines.slice(0, contextLength);
  const body = lines.slice(contextLength);
  const render = (content: readonly string[]) => [...context, ...content].join('\n');
  if (estimateTokens(render([])) > diffTokenBudget) {
    throw new Error(
      `Diff framing for ${file.path} exceeds the ${diffTokenBudget}-token diff budget`,
    );
  }

  const parts: ChunkPart[] = [];
  let current: string[] = [];
  const flush = () => {
    if (current.length === 0) return;
    parts.push({ path: file.path, text: render(current) });
    current = [];
  };

  for (const line of body) {
    if (estimateTokens(render([line])) > diffTokenBudget) {
      flush();
      for (const fragment of splitTextToFit(line, diffTokenBudget, (value) => render([value]))) {
        parts.push({ path: file.path, text: render([fragment]) });
      }
      continue;
    }
    if (current.length > 0 && estimateTokens(render([...current, line])) > diffTokenBudget) {
      flush();
    }
    current.push(line);
  }
  flush();
  return parts.length > 0 ? parts : [{ path: file.path, text: render([]) }];
}

function splitFile(file: FileBlock, diffTokenBudget: number): ChunkPart[] {
  if (estimateTokens(file.raw) <= diffTokenBudget) {
    return [{ path: file.path, text: file.raw }];
  }
  if (file.hunks.length === 0) return splitHunklessFile(file, diffTokenBudget);

  const parts: ChunkPart[] = [];
  let currentHunks: HunkBlock[] = [];
  const render = (hunks: readonly HunkBlock[]) =>
    [
      ...file.headerLines,
      ...hunks.flatMap((hunk) => [hunk.header, ...hunk.lines]),
    ].join('\n');

  const flush = () => {
    if (currentHunks.length === 0) return;
    parts.push({ path: file.path, text: render(currentHunks) });
    currentHunks = [];
  };

  for (const hunk of file.hunks) {
    const hunkText = renderHunk(file.headerLines, hunk.header, hunk.lines);
    if (estimateTokens(hunkText) > diffTokenBudget) {
      flush();
      parts.push(...splitOversizedHunk(file, hunk, diffTokenBudget));
      continue;
    }
    const candidate = [...currentHunks, hunk];
    if (currentHunks.length > 0 && estimateTokens(render(candidate)) > diffTokenBudget) flush();
    currentHunks.push(hunk);
  }
  flush();
  return parts;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function labelChunks(partsByChunk: readonly ChunkPart[][]): string[] {
  const totalPerFile = new Map<string, number>();
  for (const parts of partsByChunk) {
    const files = unique(parts.map((part) => part.path));
    if (files.length === 1) totalPerFile.set(files[0]!, (totalPerFile.get(files[0]!) ?? 0) + 1);
  }
  const seenPerFile = new Map<string, number>();

  return partsByChunk.map((parts) => {
    const files = unique(parts.map((part) => part.path));
    if (partsByChunk.length === 1) return 'all files';
    if (files.length > 1) return `${files[0]} + ${files.length - 1} more`;
    const path = files[0] ?? 'diff';
    if ((totalPerFile.get(path) ?? 0) === 1) return path;
    const ordinal = (seenPerFile.get(path) ?? 0) + 1;
    seenPerFile.set(path, ordinal);
    return `${path}#${ordinal}`;
  });
}

export function planReviewChunks(input: PlanReviewChunksInput): ReviewChunk[] {
  const maximum = input.maxPromptTokens ?? DEFAULT_MAX_PROMPT_TOKENS;
  const minimumDiff = input.minDiffTokens ?? DEFAULT_MIN_DIFF_TOKENS;
  const diffTokenBudget = maximum - input.promptOverheadTokens;
  if (diffTokenBudget < minimumDiff) {
    throw new PromptBudgetExceededError(input.promptOverheadTokens, maximum, minimumDiff);
  }

  const parts = parseFileBlocks(input.diff).flatMap((file) => splitFile(file, diffTokenBudget));
  const packed: ChunkPart[][] = [];
  let current: ChunkPart[] = [];
  for (const part of parts) {
    const candidate = [...current, part];
    const candidateText = candidate.map((item) => item.text).join('\n');
    if (current.length > 0 && estimateTokens(candidateText) > diffTokenBudget) {
      packed.push(current);
      current = [];
    }
    current.push(part);
  }
  if (current.length > 0) packed.push(current);
  if (packed.length === 0) packed.push([{ path: input.diff.files[0]?.path ?? 'diff', text: input.diff.raw }]);

  const labels = labelChunks(packed);
  return packed.map((chunkParts, index) => {
    const diffText = chunkParts.map((part) => part.text).join('\n');
    return {
      label: labels[index]!,
      diffText,
      files: unique(chunkParts.map((part) => part.path)),
      estimatedTokens: input.promptOverheadTokens + estimateTokens(diffText),
    };
  });
}
