/**
 * Offline heuristic review used by the pre-push CLI. Kept in its own module
 * (no engine/SDK/shared imports) so it is unit-testable without installs.
 */
export interface LocalFinding {
  severity: 'high' | 'medium' | 'low';
  title: string;
  file: string;
  line: number;
  hint: string;
}

/** Heuristic review over a unified diff's added lines. */
export function heuristicReview(diff: string): LocalFinding[] {
  const findings: LocalFinding[] = [];
  let file = '';
  let newLine = 0;
  for (const raw of diff.split('\n')) {
    if (raw.startsWith('+++ b/')) {
      file = raw.slice(6);
      continue;
    }
    const hunk = raw.match(/^@@ -\d+(?:,\d+)? \+(\d+)/);
    if (hunk) {
      newLine = Number(hunk[1]) - 1;
      continue;
    }
    if (raw.startsWith('+') && !raw.startsWith('+++')) {
      newLine++;
      const text = raw.slice(1);
      if (
        /\b(sk_live_[A-Za-z0-9]+|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----)\b/.test(text) ||
        /(api[_-]?key|secret|password|token)\s*[:=]\s*['"][^'"]{8,}['"]/i.test(text)
      ) {
        findings.push({ severity: 'high', title: 'Possible hard-coded secret', file, line: newLine, hint: 'Move to an env var / secret store before pushing.' });
      }
      if (/\bdebugger\b|console\.log\(|System\.out\.println|binding\.pry/.test(text)) {
        findings.push({ severity: 'low', title: 'Debug statement left in', file, line: newLine, hint: 'Remove debug output before pushing.' });
      }
      if (/\bTODO\b.*\b(security|auth|secret)\b/i.test(text)) {
        findings.push({ severity: 'medium', title: 'Unresolved security TODO', file, line: newLine, hint: 'Resolve or file a ticket before merging.' });
      }
    } else if (!raw.startsWith('-')) {
      if (!raw.startsWith('diff ') && !raw.startsWith('--- ') && !raw.startsWith('index ')) newLine++;
    }
  }
  const added = diff.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++')).length;
  if (added > 400) {
    findings.push({ severity: 'low', title: `Large diff (${added} added lines)`, file: '(whole PR)', line: 0, hint: 'Consider splitting for safer review.' });
  }
  return findings;
}
