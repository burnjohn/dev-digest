import { describe, it, expect, afterEach, beforeEach, beforeAll, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { FindingRecord } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";

// `mutate` is shared across renders via vi.hoisted (not re-created per call
// like an inline `() => vi.fn()` factory would) — T14's REQ-33 test needs to
// assert on the SAME mock the a/d shortcut ends up calling after the panel's
// keydown effect has re-attached across the deep-link's re-renders.
const { mutate } = vi.hoisted(() => ({ mutate: vi.fn() }));
vi.mock("../../../../../../../lib/hooks/reviews", () => ({
  useFindingAction: () => ({ mutate, isPending: false }),
}));

import { FindingsPanel } from "./FindingsPanel";
import { TargetFindingContext, type TargetFindingSignal } from "../target-finding-context";

afterEach(cleanup);
beforeEach(() => mutate.mockClear());

// jsdom has no scrollIntoView; the REQ-18 highlight effect guards its own
// call, but stub it anyway so a regression there fails loudly here.
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

const FINDINGS: FindingRecord[] = [
  {
    id: "f1",
    severity: "CRITICAL",
    category: "security",
    title: "Hardcoded secret",
    file: "src/config.ts",
    start_line: 11,
    end_line: 11,
    rationale: "A secret is committed.",
    suggestion: null,
    confidence: 0.95,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    review_id: "r1",
    accepted_at: null,
    dismissed_at: null,
  },
];

/** Build a finding off the CRITICAL fixture, overriding only what a test cares about. */
function mk(o: Partial<FindingRecord>): FindingRecord {
  return { ...FINDINGS[0]!, ...o };
}

// Mixed-severity set. `w2` sits below the 0.65 confidence threshold, so it is
// dropped once "Hide low confidence" is on.
const MIXED: FindingRecord[] = [
  mk({ id: "c1", severity: "CRITICAL", title: "Hardcoded secret", confidence: 0.95 }),
  mk({ id: "w1", severity: "WARNING", title: "Unused variable", confidence: 0.9 }),
  mk({ id: "w2", severity: "WARNING", title: "Shadowed name", confidence: 0.5 }),
  mk({ id: "s1", severity: "SUGGESTION", title: "Rename for clarity", confidence: 0.8 }),
];

// Deliberately NOT in severity order: `visibleFindings` sorts CRITICAL <
// WARNING < SUGGESTION, so `shown` = [c1, w1, s1] while `findings` stays
// [s1, c1, w1]. Target "w1" then sits at `shown` index 1 but `findings`
// index 2 — the exact split T14's red flags warn about, so a focus index
// computed against `findings` instead of `shown` would land on the wrong card.
const REORDERED: FindingRecord[] = [
  mk({ id: "s1", severity: "SUGGESTION", title: "Rename for clarity", confidence: 0.8 }),
  mk({ id: "c1", severity: "CRITICAL", title: "Hardcoded secret", confidence: 0.95 }),
  mk({ id: "w1", severity: "WARNING", title: "Unused variable", confidence: 0.9 }),
];

/** The card's root element carries `data-finding-id` (FindingCard.tsx). */
function cardFor(title: string): HTMLElement {
  const el = screen.getByText(title).closest("[data-finding-id]");
  if (!el) throw new Error(`no card root found for "${title}"`);
  return el as HTMLElement;
}

// FIX-4: FindingCard (mounted for every finding here) now runs its eval-case
// query against a real ancestor QueryClient rather than one it creates
// itself — every finding below is undecided (`accepted_at`/`dismissed_at`
// both null), so that query stays `enabled: false` and never fetches, but
// `useQuery` still requires a QueryClientProvider ancestor to exist at all.
function newQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <QueryClientProvider client={newQueryClient()}>
      <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
        {ui}
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

/** REQ-18 tree: FindingsPanel under a controllable `TargetFindingContext`. */
function panelTree(findings: FindingRecord[], target: TargetFindingSignal | null) {
  return (
    <QueryClientProvider client={newQueryClient()}>
      <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
        <TargetFindingContext.Provider value={target}>
          <FindingsPanel findings={findings} prId="pr1" />
        </TargetFindingContext.Provider>
      </NextIntlClientProvider>
    </QueryClientProvider>
  );
}

describe("FindingsPanel (smoke)", () => {
  it("renders the toolbar + a finding card", () => {
    renderWithIntl(<FindingsPanel findings={FINDINGS} prId="pr1" />);
    expect(screen.getByText("Hide low confidence")).toBeInTheDocument();
    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
  });

  it("shows the empty state when nothing matches", () => {
    renderWithIntl(<FindingsPanel findings={[]} prId="pr1" />);
    expect(screen.getByText("No findings match")).toBeInTheDocument();
  });
});

describe("FindingsPanel severity chips", () => {
  it("renders one chip per present severity with the right count", () => {
    renderWithIntl(<FindingsPanel findings={MIXED} prId="pr1" />);
    // aria-labels come from the shared indicator i18n keys (icon-only chips).
    expect(screen.getByRole("button", { name: /1 critical finding/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /2 warning findings/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /1 suggestion finding/i })).toBeInTheDocument();
  });

  it("clicking CRITICAL filters the list to critical findings", () => {
    renderWithIntl(<FindingsPanel findings={MIXED} prId="pr1" />);
    fireEvent.click(screen.getByRole("button", { name: /1 critical finding/i }));
    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
    expect(screen.queryByText("Unused variable")).not.toBeInTheDocument();
    expect(screen.queryByText("Rename for clarity")).not.toBeInTheDocument();
  });

  it("clicking the active chip again restores all findings (toggle off)", () => {
    renderWithIntl(<FindingsPanel findings={MIXED} prId="pr1" />);
    const critChip = screen.getByRole("button", { name: /1 critical finding/i });
    fireEvent.click(critChip);
    expect(screen.queryByText("Unused variable")).not.toBeInTheDocument();
    fireEvent.click(critChip);
    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
    expect(screen.getByText("Unused variable")).toBeInTheDocument();
    expect(screen.getByText("Rename for clarity")).toBeInTheDocument();
  });

  it("combines the severity filter with Hide low confidence", () => {
    renderWithIntl(<FindingsPanel findings={MIXED} prId="pr1" />);
    // Turn on hide-low: the 0.5-confidence warning drops, so WARNING count → 1.
    fireEvent.click(screen.getByRole("switch"));
    expect(screen.queryByText("Shadowed name")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /1 warning finding/i }));
    expect(screen.getByText("Unused variable")).toBeInTheDocument();
    expect(screen.queryByText("Shadowed name")).not.toBeInTheDocument();
    expect(screen.queryByText("Hardcoded secret")).not.toBeInTheDocument();
  });
});

describe("FindingsPanel + TargetFindingContext (REQ-18)", () => {
  it("clears an active severity filter that would hide the deep-link target", () => {
    const { rerender } = render(panelTree(MIXED, null));
    // Pre-filter to CRITICAL, which hides the WARNING target we're about to name.
    fireEvent.click(screen.getByRole("button", { name: /1 critical finding/i }));
    expect(screen.queryByText("Unused variable")).not.toBeInTheDocument();

    rerender(panelTree(MIXED, { id: "w1", n: 1 }));

    // The filter is CLEARED (not bypassed): the target is visible again.
    expect(screen.getByText("Unused variable")).toBeInTheDocument();

    // REQ-33: the keyboard cursor followed the target to its post-clear
    // position in `shown`, not left behind at whatever card 0 was. Read
    // `borderTopColor` (the `focused` ring, s.card in FindingCard/styles.ts)
    // rather than `boxShadow` — the target is ALSO the REQ-18 highlight
    // target here, and its ~2s highlight overlay overwrites `boxShadow`
    // (FindingCard.tsx's `showHighlight` branch) without touching border color.
    expect(cardFor("Unused variable")).toHaveStyle({ borderTopColor: "var(--warn)" });
    expect(cardFor("Hardcoded secret")).toHaveStyle({ borderTopColor: "var(--border)" });
  });

  it("clears Hide low confidence when the target is a low-confidence finding", () => {
    const { rerender } = render(panelTree(MIXED, null));
    fireEvent.click(screen.getByRole("switch"));
    expect(screen.queryByText("Shadowed name")).not.toBeInTheDocument();

    // w2 is the 0.5-confidence WARNING dropped by "Hide low confidence".
    rerender(panelTree(MIXED, { id: "w2", n: 1 }));

    expect(screen.getByText("Shadowed name")).toBeInTheDocument();
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "false");
  });

  it("leaves an unrelated panel's filters untouched when the target belongs to a different set of findings", () => {
    const { rerender } = render(panelTree(MIXED, null));
    fireEvent.click(screen.getByRole("button", { name: /1 critical finding/i }));
    expect(screen.queryByText("Unused variable")).not.toBeInTheDocument();

    // "elsewhere" isn't among THIS panel's findings — the filter must stay put.
    rerender(panelTree(MIXED, { id: "elsewhere", n: 1 }));

    expect(screen.queryByText("Unused variable")).not.toBeInTheDocument();
    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();

    // REQ-33 guard: a context-wide target that belongs to a DIFFERENT panel
    // must not suppress THIS panel's own "first card opens" default — using
    // the raw context `target` (rather than this panel's resolved
    // `targetFinding`) for `defaultExpanded` would close every card here.
    expect(within(cardFor("Hardcoded secret")).getByRole("button", { name: "Accept" })).toBeInTheDocument();
  });
});

describe("FindingsPanel + TargetFindingContext (REQ-33)", () => {
  it("puts the focus ring on the target, not on card 0, when the target is not first in `shown`", () => {
    // REORDERED sorts to shown = [c1, w1, s1]; target "w1" is shown-index 1.
    render(panelTree(REORDERED, { id: "w1", n: 1 }));

    // `borderTopColor`, not `boxShadow` — the target's own REQ-18 highlight
    // overlay overwrites `boxShadow` (see the note in the REQ-18 test above).
    expect(cardFor("Unused variable")).toHaveStyle({ borderTopColor: "var(--warn)" });
    // Card 0 (Hardcoded secret, CRITICAL) must NOT carry the ring instead.
    expect(cardFor("Hardcoded secret")).toHaveStyle({ borderTopColor: "var(--border)" });
  });

  it("expands only the target card, not card 0, when a target is present", () => {
    render(panelTree(REORDERED, { id: "w1", n: 1 }));

    // The target is open (its Accept/Dismiss actions are rendered).
    expect(within(cardFor("Unused variable")).getByRole("button", { name: "Accept" })).toBeInTheDocument();
    // Card 0 is NOT expanded just because it's first.
    expect(within(cardFor("Hardcoded secret")).queryByRole("button", { name: "Accept" })).not.toBeInTheDocument();
  });

  it("fires the a/d shortcut on the deep-link TARGET's finding, not on card 0 — the destructive-action bug", () => {
    render(panelTree(REORDERED, { id: "w1", n: 1 }));

    // Sanity: card 0 is genuinely a different finding than the target.
    expect(cardFor("Hardcoded secret")).not.toBe(cardFor("Unused variable"));

    fireEvent.keyDown(window, { key: "a" });

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate).toHaveBeenCalledWith({ findingId: "w1", action: "accept", prId: "pr1" });
  });

  it("with no target, behaviour is unchanged: card 0 is focused and expanded", () => {
    renderWithIntl(<FindingsPanel findings={REORDERED} prId="pr1" />);

    // Card 0 of `shown` (sorted) is the CRITICAL finding.
    expect(cardFor("Hardcoded secret")).toHaveStyle({ borderTopColor: "var(--crit)" });
    expect(within(cardFor("Hardcoded secret")).getByRole("button", { name: "Accept" })).toBeInTheDocument();
    expect(within(cardFor("Unused variable")).queryByRole("button", { name: "Accept" })).not.toBeInTheDocument();

    fireEvent.keyDown(window, { key: "a" });
    expect(mutate).toHaveBeenCalledWith({ findingId: "c1", action: "accept", prId: "pr1" });
  });
});

/* The a/d/r shortcuts obey the same lock the buttons do — a keypress must not
   reach a transition the card renders as disabled. */
describe("FindingsPanel keyboard shortcuts respect the decision lock", () => {
  const ACCEPTED_ONLY = [mk({ id: "c1", title: "Hardcoded secret", accepted_at: "2026-08-28T00:00:00Z" })];
  const DISMISSED_ONLY = [mk({ id: "c1", title: "Hardcoded secret", dismissed_at: "2026-08-28T00:00:00Z" })];

  it("`d` on an accepted finding fires nothing", () => {
    renderWithIntl(<FindingsPanel findings={ACCEPTED_ONLY} prId="pr1" />);

    // Mutation: dropping the `decision.dismissDisabled` guard from the handler
    // — the keypress would then dismiss a finding whose Dismiss button is
    // rendered disabled.
    fireEvent.keyDown(window, { key: "d" });
    expect(mutate).not.toHaveBeenCalled();
  });

  it("`a` on a dismissed finding fires nothing", () => {
    renderWithIntl(<FindingsPanel findings={DISMISSED_ONLY} prId="pr1" />);

    fireEvent.keyDown(window, { key: "a" });
    expect(mutate).not.toHaveBeenCalled();
  });

  it("`r` reverts a decided finding", () => {
    renderWithIntl(<FindingsPanel findings={ACCEPTED_ONLY} prId="pr1" />);

    fireEvent.keyDown(window, { key: "r" });
    expect(mutate).toHaveBeenCalledWith({ findingId: "c1", action: "revert", prId: "pr1" });
  });

  it("`r` on an undecided finding fires nothing — there is no decision to undo", () => {
    renderWithIntl(<FindingsPanel findings={FINDINGS} prId="pr1" />);

    fireEvent.keyDown(window, { key: "r" });
    expect(mutate).not.toHaveBeenCalled();
  });

  it("the repeatable action still works: `a` on an undecided finding accepts it", () => {
    renderWithIntl(<FindingsPanel findings={FINDINGS} prId="pr1" />);

    fireEvent.keyDown(window, { key: "a" });
    expect(mutate).toHaveBeenCalledWith({ findingId: "f1", action: "accept", prId: "pr1" });
  });
});

