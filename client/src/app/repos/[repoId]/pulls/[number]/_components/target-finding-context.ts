/**
 * REQ-18/26 landing target, provided by `FindingsTab` above `ReviewRunAccordion`
 * (unedited — §5.4/T8's red flags forbid touching it). Context is the bridge:
 * it crosses that unowned component transparently, so only the ONE panel whose
 * own `findings` actually contains `id` reacts — every other panel ignores it.
 * `n` is a nonce that re-fires the highlight even when the same id repeats.
 *
 * Shared by `FindingsPanel` and `FindingsTab` — the nearest common ancestor
 * (REQ-31, `frontend-ui-architecture` §3: two consumers → promote).
 */
import React from "react";

export interface TargetFindingSignal {
  id: string;
  n: number;
}

export const TargetFindingContext = React.createContext<TargetFindingSignal | null>(null);
