import type { SmartDiff } from '../../../vendor/shared/contracts/brief.js';
import { classifyFile } from './classifier.js';
import { SPLIT_CHUNK_SIZE, SPLIT_THRESHOLD_LINES } from './constants.js';

const ROLES = ['core', 'wiring', 'boilerplate'] as const;

export function buildSmartDiff(
  files: Array<{ path: string; additions: number; deletions: number; patch: string | null }>,
  findings: Array<{ file: string; start_line: number | null; end_line: number | null }>,
): SmartDiff {
  const totalLines = files.reduce((sum, f) => sum + f.additions + f.deletions, 0);
  const tooBig = totalLines > SPLIT_THRESHOLD_LINES;

  const grouped: Record<'core' | 'wiring' | 'boilerplate', SmartDiff['groups']> = {
    core: [],
    wiring: [],
    boilerplate: [],
  };

  for (const file of files) {
    const role = classifyFile(file.path);
    const findingLines = [
      ...new Set(
        findings
          .filter((f) => f.file === file.path && f.start_line !== null)
          .map((f) => f.start_line as number),
      ),
    ];
    grouped[role].push({
      role,
      files: [
        {
          path: file.path,
          pseudocode_summary: null,
          additions: file.additions,
          deletions: file.deletions,
          finding_lines: findingLines,
        },
      ],
    });
  }

  const groups: SmartDiff['groups'] = ROLES.map((role) => ({
    role,
    files: grouped[role].flatMap((g) => g.files),
  }));

  let proposedSplits: SmartDiff['split_suggestion']['proposed_splits'] = [];

  if (tooBig) {
    const coreFiles = groups.find((g) => g.role === 'core')?.files ?? [];
    const parts: Array<{ name: string; files: string[] }> = [];
    let currentFiles: string[] = [];
    let accumulated = 0;

    for (const [i, f] of coreFiles.entries()) {
      currentFiles.push(f.path);
      accumulated += f.additions + f.deletions;

      const isLast = i === coreFiles.length - 1;
      if (accumulated >= SPLIT_CHUNK_SIZE || isLast) {
        parts.push({ name: `Part ${parts.length + 1}`, files: currentFiles });
        currentFiles = [];
        accumulated = 0;
      }
    }

    proposedSplits = parts;
  }

  return {
    groups,
    split_suggestion: {
      too_big: tooBig,
      total_lines: totalLines,
      proposed_splits: proposedSplits,
    },
  };
}
