/**
 * OverviewTab — PR BRIEF slot state machine (PR Why + Risk Brief, Step 9;
 * generate-to-reveal gating extended in a later step).
 * Covers: the ENTIRE Overview surface is gated on the LLM-derived brief —
 * no brief means ONLY the empty "Generate brief" block renders (no
 * VerdictBanner/IntentCard/BlastRadius/ReviewFocusCard/Description), even
 * when a deterministic review exists (AC-14, cross-model review Blocking
 * Issue #3); clicking Generate calls the mutation; once a brief exists the
 * full layout renders (VerdictBanner + IntentCard + ReviewFocusCard +
 * Description); error state keeps prior content visible; regenerate icon
 * triggers the same mutation.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { PrBrief, ReviewRecord } from "@devdigest/shared";
import blastMessages from "../../../../../../../../messages/en/blast.json";
import briefMessages from "../../../../../../../../messages/en/brief.json";
import prReviewMessages from "../../../../../../../../messages/en/prReview.json";

// ---- Mocks -------------------------------------------------------------------

let briefData: PrBrief | null | undefined;
const generateMutate = vi.fn();
let generateIsPending = false;
let generateIsError = false;
let generateError: { message: string } | null = null;

const clearMutate = vi.fn();
let clearIsPending = false;

vi.mock("@/lib/hooks/reviews", () => ({
  usePrBrief: () => ({ data: briefData }),
  useIntent: () => ({ data: undefined }),
  useGenerateBrief: () => ({
    mutate: generateMutate,
    isPending: generateIsPending,
    isError: generateIsError,
    error: generateError,
  }),
  useClearBrief: () => ({
    mutate: clearMutate,
    isPending: clearIsPending,
  }),
}));

vi.mock("@/lib/hooks/blast", () => ({
  useBlast: () => ({ data: undefined }),
}));

vi.mock("@/lib/diff-nav", () => ({
  useDiffNavigate: () => vi.fn(),
}));

import { OverviewTab } from "./OverviewTab";

afterEach(() => {
  cleanup();
  briefData = undefined;
  generateMutate.mockClear();
  generateIsPending = false;
  generateIsError = false;
  generateError = null;
  clearMutate.mockClear();
  clearIsPending = false;
});

function renderTab(props: Partial<React.ComponentProps<typeof OverviewTab>> = {}) {
  return render(
    <NextIntlClientProvider
      locale="en"
      messages={{ blast: blastMessages, brief: briefMessages, prReview: prReviewMessages }}
    >
      <OverviewTab prBody={null} prId="pr-1" runs={[]} costUsd={null} changedPaths={new Set()} {...props} />
    </NextIntlClientProvider>,
  );
}

const LLM_BRIEF: PrBrief["llm"] = {
  what: "Adds rate limiting middleware.",
  why: "Prevents abuse of public endpoints.",
  risk_level: "medium",
  review_focus: [
    { path: "src/middleware/rateLimit.ts", line: 12, reason: "Core logic", priority: 1, github_link: null },
  ],
  generated_at: new Date().toISOString(),
  cost_usd: 0.01,
  tokens_in: 1000,
  tokens_out: 200,
};

const BRIEF_WITH_LLM: PrBrief = {
  intent: { intent: "Add rate limiting.", in_scope: [], out_of_scope: [] },
  blast: { changed_symbols: [], downstream: [], summary: "" },
  risks: { risks: [] },
  history: { history: [] },
  llm: LLM_BRIEF,
};

function makeReview(overrides: Partial<ReviewRecord> = {}): ReviewRecord {
  return {
    id: "review-1",
    pr_id: "pr-1",
    agent_id: "agent-1",
    run_id: "run-1",
    agent_name: "Security Reviewer",
    kind: "review",
    verdict: "comment",
    summary: "Deterministic summary.",
    score: 70,
    model: "gpt-4",
    created_at: new Date().toISOString(),
    findings: [],
    ...overrides,
  };
}

describe("OverviewTab — generate-to-reveal gating", () => {
  it("zero-review PR with no brief renders ONLY the empty state, never a blank section (AC-14)", () => {
    briefData = null;
    renderTab({ runs: [] });
    expect(screen.getByText("No brief yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Generate brief" })).toBeInTheDocument();
    // Nothing else from the full layout is rendered
    expect(screen.queryByText("Deterministic summary.")).not.toBeInTheDocument();
    expect(screen.queryByText("Intent")).not.toBeInTheDocument();
    expect(screen.queryByText("Blast radius")).not.toBeInTheDocument();
    expect(screen.queryByText("Review Focus — Read These First")).not.toBeInTheDocument();
  });

  it("clicking Generate calls the mutation", async () => {
    briefData = null;
    renderTab({ runs: [] });
    await userEvent.click(screen.getByRole("button", { name: "Generate brief" }));
    expect(generateMutate).toHaveBeenCalledTimes(1);
  });

  it("a deterministic review exists but no LLM brief yet — STILL renders only the empty state (no VerdictBanner)", () => {
    briefData = null;
    renderTab({ runs: [makeReview()] });
    expect(screen.getByText("No brief yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Generate brief" })).toBeInTheDocument();
    // The deterministic verdict banner must NOT leak through before a brief exists
    expect(screen.queryByText("Deterministic summary.")).not.toBeInTheDocument();
    expect(screen.queryByText("Intent")).not.toBeInTheDocument();
    expect(screen.queryByText("Review Focus — Read These First")).not.toBeInTheDocument();
  });

  it("hasBrief PR renders the full layout: VerdictBanner + IntentCard + ReviewFocusCard + Description", () => {
    briefData = BRIEF_WITH_LLM;
    renderTab({ runs: [makeReview()], prBody: "Fixes the thing." });
    expect(screen.getByText(/Adds rate limiting middleware\. Prevents abuse of public endpoints\./)).toBeInTheDocument();
    expect(screen.getByText("Intent")).toBeInTheDocument();
    expect(screen.getByText("Review Focus — Read These First")).toBeInTheDocument();
    expect(screen.getByText("Core logic")).toBeInTheDocument();
    expect(screen.getByText("Fixes the thing.")).toBeInTheDocument();
    // No empty-state CTA once a brief is cached
    expect(screen.queryByText("No brief yet")).not.toBeInTheDocument();
  });

  it("error state (brief exists) keeps prior content visible via VerdictBanner's inline error", () => {
    briefData = BRIEF_WITH_LLM;
    generateIsError = true;
    generateError = { message: "rate limited" };
    renderTab({ runs: [] });
    expect(screen.getByText(/Adds rate limiting middleware/)).toBeInTheDocument();
    expect(screen.getByText(/rate limited/)).toBeInTheDocument();
  });

  it("error state (no brief ever existed) surfaces the error via BriefEmptyState", () => {
    briefData = null;
    generateIsError = true;
    generateError = { message: "generation failed" };
    renderTab({ runs: [] });
    expect(screen.getByText("No brief yet")).toBeInTheDocument();
    expect(screen.getByText(/generation failed/)).toBeInTheDocument();
  });

  it("regenerate icon triggers the same mutation when a brief is cached", async () => {
    briefData = BRIEF_WITH_LLM;
    renderTab({ runs: [] });
    const regenerateBtn = screen.getByRole("button", { name: /Regenerate/ });
    await userEvent.click(regenerateBtn);
    expect(generateMutate).toHaveBeenCalledTimes(1);
  });

  it("clear icon triggers the clear-brief mutation when a brief is cached", async () => {
    briefData = BRIEF_WITH_LLM;
    renderTab({ runs: [] });
    const clearBtn = screen.getByRole("button", { name: /Clear brief/ });
    await userEvent.click(clearBtn);
    expect(clearMutate).toHaveBeenCalledTimes(1);
  });
});
