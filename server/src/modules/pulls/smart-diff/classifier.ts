import type { SmartDiffRole } from '../../../vendor/shared/contracts/brief.js';
import {
  BOILERPLATE_PATTERNS,
  BOILERPLATE_SEGMENT_PATTERNS,
  BOILERPLATE_SUFFIX_PATTERNS,
  WIRING_FILENAMES,
  WIRING_PREFIX_PATTERNS,
  WIRING_SEGMENT_PATTERNS,
  WIRING_SUFFIX_PATTERNS,
} from './constants.js';

function filename(path: string): string {
  return path.split('/').pop() ?? path;
}

function isBoilerplate(path: string): boolean {
  const name = filename(path);

  // Exact filename match (lock files and known boilerplate names)
  if ((BOILERPLATE_PATTERNS as readonly string[]).includes(name)) return true;

  // Suffix match
  for (const suffix of BOILERPLATE_SUFFIX_PATTERNS) {
    if (name.endsWith(suffix)) return true;
  }

  // Segment match (directory in path)
  for (const segment of BOILERPLATE_SEGMENT_PATTERNS) {
    if (path.includes(segment)) return true;
  }

  return false;
}

function isWiring(path: string): boolean {
  const name = filename(path);

  // Exact filename match
  if ((WIRING_FILENAMES as readonly string[]).includes(name)) return true;

  // Prefix match (path starts with pattern)
  for (const prefix of WIRING_PREFIX_PATTERNS) {
    if (path.startsWith(prefix) || name.startsWith(prefix)) return true;
  }

  // Suffix match
  for (const suffix of WIRING_SUFFIX_PATTERNS) {
    if (name.endsWith(suffix)) return true;
  }

  // Segment match
  for (const segment of WIRING_SEGMENT_PATTERNS) {
    if (path.includes(segment)) return true;
  }

  return false;
}

export function classifyFile(path: string): SmartDiffRole {
  if (isBoilerplate(path)) return 'boilerplate';
  if (isWiring(path)) return 'wiring';
  return 'core';
}
