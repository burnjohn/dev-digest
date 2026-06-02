/**
 * Resolve how long ago a memory was last used into an i18n key + params, so the
 * component can render it via next-intl (no hardcoded strings).
 */
export function lastUsedKey(iso: string | null): { key: string; values?: Record<string, number> } {
  if (!iso) return { key: "card.neverUsed" };
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return { key: "card.usedToday" };
  if (days === 1) return { key: "card.usedDayAgo" };
  return { key: "card.usedDaysAgo", values: { days } };
}
