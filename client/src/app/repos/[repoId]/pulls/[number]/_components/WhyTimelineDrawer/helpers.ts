import type { WhyTimeline, WhyEvent } from "@devdigest/shared/contracts/why";

/** The non-blame events to render, excluding the blame head (already shown). */
export function nonBlameEvents(data: WhyTimeline): WhyEvent[] {
  return data.events.filter((e) => !data.blame || e.sha !== data.blame.sha);
}

/** True when there is neither a blame head nor any commit events to show. */
export function hasNoHistory(data: WhyTimeline): boolean {
  return !data.blame && data.events.length === 0;
}
