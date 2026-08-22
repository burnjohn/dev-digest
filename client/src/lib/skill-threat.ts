/**
 * Centralized threat-level logic for skills.
 *
 * Single source of truth for all UI that needs to know whether a skill
 * is flagged, blocked, or still being scanned — used by SkillCard,
 * SkillEditor, and SkillsTab (agent editor).
 */

import type { Skill, SkillThreatLevel } from "@devdigest/shared";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Named constants — never compare against raw string literals. */
export const THREAT_LEVEL = {
  UNKNOWN: "unknown",
  SAFE: "safe",
  SUSPICIOUS: "suspicious",
  DANGEROUS: "dangerous",
} as const satisfies Record<string, SkillThreatLevel>;

/** Sources that are considered external / untrusted origin. */
const EXTERNAL_SOURCES = new Set<string>(["imported_url", "community"]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ThreatBadge {
  text: string;
  /** CSS color value for text and border accents. */
  color: string;
  bg: string;
  border: string;
  title: string;
}

export interface SkillThreatState {
  level: SkillThreatLevel;
  /** True when an injection pattern has been confirmed. Toggle is blocked. */
  isDangerous: boolean;
  /** True when suspicious content was found. Toggle is blocked. */
  isSuspicious: boolean;
  /** True when scan is still running (unknown level on an external skill). */
  isScanning: boolean;
  /** True when the toggle/link action should be blocked (dangerous | suspicious). */
  isBlocked: boolean;
  /** Badge to render; null when the skill is confirmed safe. */
  badge: ThreatBadge | null;
}

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

/**
 * Derives all threat-related UI state from a skill object.
 * Call once per component render; destructure what you need.
 */
export function resolveSkillThreat(
  skill: Pick<Skill, "threat_level" | "source">,
): SkillThreatState {
  const level = skill.threat_level ?? THREAT_LEVEL.UNKNOWN;
  const isExternal = EXTERNAL_SOURCES.has(skill.source ?? "");

  const isDangerous = level === THREAT_LEVEL.DANGEROUS;
  const isSuspicious = level === THREAT_LEVEL.SUSPICIOUS;
  const isScanning = level === THREAT_LEVEL.UNKNOWN && isExternal;
  const isBlocked = isDangerous || isSuspicious;

  const badge: ThreatBadge | null = isDangerous
    ? {
        text: "🚨 Injection detected",
        color: "var(--crit)",
        bg: "color-mix(in srgb, var(--crit) 12%, transparent)",
        border: "color-mix(in srgb, var(--crit) 30%, transparent)",
        title: "Injection pattern found. Do not enable.",
      }
    : isSuspicious
      ? {
          text: "⚠️ Suspicious",
          color: "var(--warn)",
          bg: "color-mix(in srgb, var(--warn) 12%, transparent)",
          border: "color-mix(in srgb, var(--warn) 30%, transparent)",
          title: "Suspicious content — review body before enabling.",
        }
      : isScanning
        ? {
            text: "🔍 Scanning…",
            color: "var(--text-muted)",
            bg: "color-mix(in srgb, var(--text-muted) 10%, transparent)",
            border: "color-mix(in srgb, var(--text-muted) 20%, transparent)",
            title: "Security scan in progress — check back soon.",
          }
        : null;

  return { level, isDangerous, isSuspicious, isScanning, isBlocked, badge };
}
