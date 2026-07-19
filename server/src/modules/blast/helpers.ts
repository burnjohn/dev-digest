/**
 * A3 — pure helpers for the blast-radius service (extracted from service.ts; no
 * behaviour change). Side-effect free; operate purely on their arguments.
 */
import type { ChangedSymbol, CodeReference, CodeSymbol, DownstreamImpact } from '@devdigest/shared';
import { NO_SYMBOLS_SUMMARY } from './constants.js';

/** Best-effort: name the enclosing symbol of a caller line, else "<module>". */
export function callerName(allSymbols: CodeSymbol[], r: CodeReference): string {
  const inFile = allSymbols
    .filter((s) => s.path === r.fromPath && s.line <= r.line && !s.name.includes('.'))
    .sort((a, b) => b.line - a.line);
  return inFile[0]?.name ?? r.fromPath.split('/').pop() ?? r.fromPath;
}

/** Compose the one-line blast-radius summary from changed symbols + downstream. */
export function summarizeBlast(symbols: ChangedSymbol[], downstream: DownstreamImpact[]): string {
  const callers = downstream.reduce((n, d) => n + d.callers.length, 0);
  const endpoints = new Set(downstream.flatMap((d) => d.endpoints_affected)).size;
  const crons = new Set(downstream.flatMap((d) => d.crons_affected)).size;
  if (symbols.length === 0) return NO_SYMBOLS_SUMMARY;
  const parts = [
    `${symbols.length} changed symbol${symbols.length === 1 ? '' : 's'}`,
    `${callers} downstream caller${callers === 1 ? '' : 's'}`,
  ];
  if (endpoints) parts.push(`${endpoints} endpoint${endpoints === 1 ? '' : 's'}`);
  if (crons) parts.push(`${crons} cron/job${crons === 1 ? '' : 's'}`);
  return `${parts.join(' · ')} affected.`;
}
