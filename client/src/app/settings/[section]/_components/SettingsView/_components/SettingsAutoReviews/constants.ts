/** Default polling interval (minutes) when settings are unset. */
export const DEFAULT_POLLING_INTERVAL_MIN = 5;

/** Polling interval option values (minutes) → label keys. */
export interface IntervalOption {
  value: string;
  labelKey: string;
}

export const INTERVAL_OPTIONS: readonly IntervalOption[] = [
  { value: "1", labelKey: "autoReviews.every1" },
  { value: "5", labelKey: "autoReviews.every5" },
  { value: "15", labelKey: "autoReviews.every15" },
  { value: "30", labelKey: "autoReviews.every30" },
];
