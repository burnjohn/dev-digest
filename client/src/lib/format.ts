/** Formats a USD cost value for display. Returns "—" when cost is unknown. */
export function formatCost(usd: number | null | undefined): string {
  if (usd == null) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(usd);
}
