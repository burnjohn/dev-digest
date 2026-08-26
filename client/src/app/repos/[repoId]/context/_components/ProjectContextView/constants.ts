/** Skeleton rows shown while the document list is loading — mirrors
    ConventionsView's SKELETON_CARDS. */
export const SKELETON_ROWS = 4;

/** How often the footer's `refreshed … ago` re-derives. One minute is the
    resolution `lib/format`'s `relativeTime` itself has ("5m", "3h", "2d"), so
    a faster tick would render the same string. */
export const FRESHNESS_TICK_MS = 60_000;
