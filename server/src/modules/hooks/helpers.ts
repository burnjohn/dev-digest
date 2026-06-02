import type { Finding } from '@devdigest/shared';

/** Human-readable summary of detector finding kinds (e.g. "2 secret leaks, 1 phantom API"). */
export function summarizeKinds(findings: Finding[]): string {
  const secret = findings.filter((f) => f.kind === 'secret_leak').length;
  const phantom = findings.filter((f) => f.kind === 'phantom').length;
  const parts: string[] = [];
  if (secret) parts.push(`${secret} secret leak${secret === 1 ? '' : 's'}`);
  if (phantom) parts.push(`${phantom} phantom API${phantom === 1 ? '' : 's'}`);
  return parts.join(', ') || 'none';
}
