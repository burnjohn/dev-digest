import { describe, it, expect, afterEach, beforeEach, beforeAll, vi } from "vitest";
import { render, screen, fireEvent, cleanup, act, within, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { FindingRecord, EvalCaseDraft, EvalCaseRecord } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";
import evalMessages from "../../../../../../../../messages/en/eval.json";
import commonMessages from "../../../../../../../../messages/en/common.json";

/* T15 — "Turn into eval case" mocks the SAME module EvalCaseEditor itself
   depends on (`@/lib/hooks/evals`), so every export it needs is stubbed
   here too — not just `useFindingEvalDraft` — or a real `EvalCaseEditor`
   render (opened from REQ-4/5) crashes calling an undefined hook. Mirrors
   `EvalCaseEditor.test.tsx`'s own mock shape; `EvalCaseEditor` is imported
   for real, never forked or stubbed (T15 red flags / binding note). */
const { findingEvalDraftMock, createMutateAsync, updateMutateAsync } = vi.hoisted(() => ({
  findingEvalDraftMock: vi.fn(),
  createMutateAsync: vi.fn(),
  updateMutateAsync: vi.fn(),
}));
vi.mock("@/lib/hooks/evals", () => ({
  useFindingEvalDraft: (...args: unknown[]) => findingEvalDraftMock(...args),
  useCreateEvalCase: () => ({ mutateAsync: createMutateAsync, isPending: false }),
  useUpdateEvalCase: () => ({ mutateAsync: updateMutateAsync, isPending: false }),
  useRunEvalCase: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteEvalCase: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import { FindingCard } from "./FindingCard";

afterEach(cleanup);
beforeEach(() => {
  // Default: no draft fetched yet (undecided finding, or the query hasn't
  // settled) — individual T15 tests override this per scenario.
  findingEvalDraftMock.mockReturnValue({ isSuccess: false, isError: false, data: undefined });
  createMutateAsync.mockReset();
  updateMutateAsync.mockReset();
});

const FINDING: FindingRecord = {
  id: "f1",
  severity: "CRITICAL",
  category: "security",
  title: "Hardcoded Stripe secret key",
  file: "src/config.ts",
  start_line: 11,
  end_line: 11,
  rationale: "A **live** Stripe key is committed in source.",
  suggestion: "Move the key to an environment variable.",
  confidence: 0.95,
  kind: "finding",
  trifecta_components: null,
  evidence: null,
  review_id: "r1",
  accepted_at: null,
  dismissed_at: null,
};

// Hoisted (rather than declared inside the T15 describe below) so the FIX-4
// cache-boundary describe can reuse the exact same fixtures.
const ACCEPTED: FindingRecord = { ...FINDING, accepted_at: "2026-08-28T00:00:00Z" };
const ACCEPTED_DRAFT: EvalCaseDraft = {
  owner_kind: "agent",
  owner_id: "agent-1",
  name: "From finding: Hardcoded Stripe secret key",
  input_diff: "--- a/src/config.ts\n+++ b/src/config.ts\n@@ -10,6 +10,7 @@\n+  stripeKey: \"sk_live_...\"",
  expected_output: [
    {
      severity: "CRITICAL",
      category: "security",
      title: "Hardcoded Stripe secret key",
      start_line: 11,
      end_line: 11,
      file: "src/config.ts",
    },
  ],
  forbidden_regions: null,
};

/* FIX-4: FindingCard no longer creates its own QueryClient (that isolated
   its eval-case mutations from the app-wide cache — see FindingCard.tsx's
   header comment), so every render here needs a real ancestor provider,
   matching how the app actually mounts it (`lib/providers.tsx`). A fresh
   client per render keeps tests isolated from one another. */
function renderWithIntl(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider
        locale="en"
        messages={{ prReview: messages, eval: evalMessages, common: commonMessages }}
      >
        {ui}
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("FindingCard (smoke, both themes)", () => {
  (["dark", "light"] as const).forEach((theme) => {
    it(`renders severity + file:line + rationale in ${theme}`, () => {
      renderWithIntl(
        <div data-theme={theme}>
          <FindingCard f={FINDING} defaultExpanded onAction={() => {}} />
        </div>,
      );
      expect(screen.getByText("Hardcoded Stripe secret key")).toBeInTheDocument();
      expect(screen.getByText("src/config.ts:11")).toBeInTheDocument();
      // category label is shown alongside the severity badge
      expect(screen.getByText("security")).toBeInTheDocument();
    });
  });

  it("fires accept/dismiss actions", () => {
    const onAction = vi.fn();
    renderWithIntl(<FindingCard f={FINDING} defaultExpanded onAction={onAction} />);
    fireEvent.click(screen.getByText("Accept"));
    expect(onAction).toHaveBeenCalledWith("accept");
    fireEvent.click(screen.getByText("Dismiss"));
    expect(onAction).toHaveBeenCalledWith("dismiss");
  });
});

describe("FindingCard highlighted (REQ-18 deep-link landing)", () => {
  // jsdom has no scrollIntoView — the component guards the call itself, but
  // stub it too so a regression that drops the guard fails loudly here
  // instead of crashing every consumer's test suite.
  let scrollIntoViewMock: ReturnType<typeof vi.fn>;
  beforeAll(() => {
    scrollIntoViewMock = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoViewMock;
  });

  // Same stub, cleared between tests so call counts don't leak across cases.
  afterEach(() => {
    scrollIntoViewMock.mockClear();
  });

  it("scrolls its data-finding-id card into view when it becomes the highlight target (REQ-18)", () => {
    renderWithIntl(
      <FindingCard f={FINDING} onAction={() => {}} highlighted highlightNonce={1} />,
    );
    expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);
    expect(scrollIntoViewMock).toHaveBeenCalledWith({ behavior: "smooth", block: "center" });
  });

  it("does not scroll a card that renders normally, not as the highlight target", () => {
    renderWithIntl(<FindingCard f={FINDING} defaultExpanded onAction={() => {}} />);
    expect(scrollIntoViewMock).not.toHaveBeenCalled();
  });

  it("expands on mount when highlighted, then clears the highlight after ~2s without unmounting", () => {
    vi.useFakeTimers();
    try {
      const { container } = renderWithIntl(
        <FindingCard f={FINDING} onAction={() => {}} highlighted highlightNonce={1} />,
      );
      // Collapsed by default (`defaultExpanded` unset) — `highlighted` forces it open.
      // The Accept/Dismiss actions only render once the body is expanded.
      expect(screen.getByRole("button", { name: "Accept" })).toBeInTheDocument();
      const card = container.querySelector('[data-finding-id="f1"]');
      expect(card).toHaveAttribute("data-highlighted", "true");

      act(() => {
        vi.advanceTimersByTime(2100);
      });

      expect(card).not.toHaveAttribute("data-highlighted");
      // The card itself is never removed — only the highlight clears.
      expect(screen.getByText("Hardcoded Stripe secret key")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("REQ-34 — scrolls only once the expanded body has actually rendered, not against the collapsed height", () => {
    // Starts COLLAPSED (`defaultExpanded` unset) and highlighted — the old
    // single-effect code called scrollIntoView in the SAME effect body as
    // `setExpanded(true)`, before the expanded body (Accept/Dismiss) had
    // committed to the DOM. A test that would pass under that ordering must
    // fail here: assert what was actually in the DOM at call-time.
    let sawExpandedContentAtCallTime = false;
    scrollIntoViewMock.mockImplementationOnce(function (this: HTMLElement) {
      sawExpandedContentAtCallTime = screen.queryByRole("button", { name: "Accept" }) !== null;
    });

    renderWithIntl(<FindingCard f={FINDING} onAction={() => {}} highlighted highlightNonce={1} />);

    expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);
    expect(sawExpandedContentAtCallTime).toBe(true);
  });

  it("REQ-34 — repeat clicks on the same chip (highlightNonce bumps) re-scroll exactly once each", () => {
    // `rerender` replaces the WHOLE tree passed to it, so every call below
    // must carry the same QueryClientProvider ancestor the initial render
    // used (FIX-4) — dropping it partway through would unmount the client
    // context out from under an already-expanded TurnIntoCaseAction.
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const tree = (nonce: number) => (
      <QueryClientProvider client={qc}>
        <NextIntlClientProvider
          locale="en"
          messages={{ prReview: messages, eval: evalMessages, common: commonMessages }}
        >
          <FindingCard f={FINDING} onAction={() => {}} highlighted highlightNonce={nonce} />
        </NextIntlClientProvider>
      </QueryClientProvider>
    );
    const { rerender } = render(tree(1));
    expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);

    // Same target, same nonce, another render (e.g. an unrelated parent
    // re-render) — must NOT re-scroll.
    rerender(tree(1));
    expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);

    // The nonce bumps (repeat click on the same chip) — re-scrolls, exactly once.
    rerender(tree(2));
    expect(scrollIntoViewMock).toHaveBeenCalledTimes(2);
  });
});

describe('FindingCard "Turn into eval case" (T15, REQ-1..6)', () => {
  const DISMISSED: FindingRecord = { ...FINDING, dismissed_at: "2026-08-28T00:00:00Z" };

  const DISMISSED_DRAFT: EvalCaseDraft = {
    owner_kind: "agent",
    owner_id: "agent-1",
    name: "From finding: Hardcoded Stripe secret key",
    input_diff: "--- a/src/config.ts\n+++ b/src/config.ts\n@@ -10,6 +10,7 @@\n-  stripeKey: \"sk_live_...\"",
    expected_output: [],
    forbidden_regions: [{ file: "src/config.ts", start_line: 11, end_line: 11 }],
  };

  function turnIntoCaseButton() {
    return screen.getByRole("button", { name: /Turn into eval case/i });
  }

  it("REQ-1: appears in the action row beside Accept/Dismiss on an expanded, decided card", () => {
    renderWithIntl(<FindingCard f={ACCEPTED} defaultExpanded onAction={() => {}} />);
    const actions = turnIntoCaseButton().closest("div")!;
    expect(within(actions).getByRole("button", { name: "Accept" })).toBeInTheDocument();
    // On an ACCEPTED card the sibling is present but locked, so its accessible
    // name now carries the reason (see the decision-lock describe below).
    expect(within(actions).getByRole("button", { name: /^Dismiss/ })).toBeInTheDocument();
  });

  it("does not render at all on a collapsed card", () => {
    renderWithIntl(<FindingCard f={ACCEPTED} onAction={() => {}} />);
    expect(screen.queryByRole("button", { name: /Turn into eval case/i })).not.toBeInTheDocument();
  });

  it("REQ-2: an undecided finding renders it disabled, named for the reason, and activating it opens no editor", () => {
    renderWithIntl(<FindingCard f={FINDING} defaultExpanded onAction={() => {}} />);
    const btn = screen.getByRole("button", {
      name: /Accept or dismiss this finding first to turn it into an eval case/i,
    });
    expect(btn).toBeDisabled();

    fireEvent.click(btn);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    // The draft is never even requested for an undecided finding, and its
    // `decidedAs` is null — a cache key of its own that nothing ever fills.
    expect(findingEvalDraftMock).toHaveBeenCalledWith("f1", {
      enabled: false,
      decidedAs: null,
    });
  });

  it("REQ-3: a decided finding with no stored diff renders it disabled, named for that reason, and activating it opens no editor", () => {
    findingEvalDraftMock.mockReturnValue({ isSuccess: false, isError: true, data: undefined });
    renderWithIntl(<FindingCard f={ACCEPTED} defaultExpanded onAction={() => {}} />);
    const btn = screen.getByRole("button", {
      name: /No stored diff is available for this file/i,
    });
    expect(btn).toBeDisabled();

    fireEvent.click(btn);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("REQ-4: an accepted finding opens the editor pre-filled with the `From finding: <title>` name and one expectation carrying the finding's six fields", () => {
    findingEvalDraftMock.mockReturnValue({ isSuccess: true, isError: false, data: ACCEPTED_DRAFT });
    renderWithIntl(<FindingCard f={ACCEPTED} defaultExpanded onAction={() => {}} />);

    const btn = turnIntoCaseButton();
    expect(btn).toBeEnabled();
    fireEvent.click(btn);

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByLabelText(/^Name/)).toHaveValue("From finding: Hardcoded Stripe secret key");
    // The POSITIVE banner reads the one expectation's six fields.
    expect(within(dialog).getByText("POSITIVE CASE")).toBeInTheDocument();
    expect(
      within(dialog).getByText('MUST find "Hardcoded Stripe secret key" at src/config.ts:11'),
    ).toBeInTheDocument();
  });

  it("REQ-5: a dismissed finding opens with expected_output [] and one forbidden region carried through to Save", () => {
    findingEvalDraftMock.mockReturnValue({ isSuccess: true, isError: false, data: DISMISSED_DRAFT });
    createMutateAsync.mockResolvedValue({ id: "new-case", owner_kind: "agent", owner_id: "agent-1" });
    renderWithIntl(<FindingCard f={DISMISSED} defaultExpanded onAction={() => {}} />);

    fireEvent.click(turnIntoCaseButton());
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("NEGATIVE CASE")).toBeInTheDocument();
    expect(within(dialog).getByText("MUST NOT flag")).toBeInTheDocument();

    // The forbidden region isn't rendered visibly — assert it travelled
    // through to the write payload instead of asserting on internal state.
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(createMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        forbidden_regions: [{ file: "src/config.ts", start_line: 11, end_line: 11 }],
      }),
    );
  });

  it("keys the draft by the decision it was taken from, so a re-decision cannot reuse the old draft", () => {
    // The user-visible defect this closes: accept -> Turn into eval case
    // (POSITIVE) -> revert -> dismiss -> Turn into eval case still opened
    // POSITIVE, because `["eval-draft", id]` re-served the accept-time entry
    // inside the app's 30s staleTime. The round trip itself is proven in
    // `lib/hooks/evals.test.tsx`; this pins the argument FindingCard feeds it.
    findingEvalDraftMock.mockReturnValue({ isSuccess: true, isError: false, data: ACCEPTED_DRAFT });
    renderWithIntl(<FindingCard f={ACCEPTED} defaultExpanded onAction={() => {}} />);
    expect(findingEvalDraftMock).toHaveBeenCalledWith("f1", {
      enabled: true,
      decidedAs: "accepted",
    });

    cleanup();
    findingEvalDraftMock.mockClear();

    renderWithIntl(<FindingCard f={DISMISSED} defaultExpanded onAction={() => {}} />);
    expect(findingEvalDraftMock).toHaveBeenCalledWith("f1", {
      enabled: true,
      decidedAs: "dismissed",
    });
  });

  it("REQ-6: opening the editor issues no write", () => {
    findingEvalDraftMock.mockReturnValue({ isSuccess: true, isError: false, data: ACCEPTED_DRAFT });
    renderWithIntl(<FindingCard f={ACCEPTED} defaultExpanded onAction={() => {}} />);

    fireEvent.click(turnIntoCaseButton());
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(createMutateAsync).not.toHaveBeenCalled();
    expect(updateMutateAsync).not.toHaveBeenCalled();
  });
});

describe("FindingCard eval-case mutations cross into the app-wide cache (FIX-4)", () => {
  // This is the ONE test in the file that does NOT use the module-level
  // `@/lib/hooks/evals` mock — it needs the REAL `useCreateEvalCase` to prove
  // the invalidation actually reaches the QueryClient the app renders
  // FindingCard under, which is exactly the defect FIX-4 exists to close.
  // `@/lib/api` is mocked instead, at the boundary `lib/hooks/*` owns.
  afterEach(() => {
    vi.doUnmock("@/lib/hooks/evals");
    vi.doUnmock("@/lib/api");
    vi.resetModules();
  });

  it('saving a case from the finding card invalidates ["evals","cases",…] in the SAME QueryClient FindingCard renders under', { timeout: 15000 }, async () => {
    vi.resetModules();
    vi.doUnmock("@/lib/hooks/evals");

    const savedRecord: EvalCaseRecord = {
      id: "new-case",
      owner_kind: "agent",
      owner_id: "agent-1",
      name: "From finding: Hardcoded Stripe secret key",
      expectation_kind: "must_find",
      input_diff: ACCEPTED_DRAFT.input_diff,
      input_files: null,
      input_meta: null,
      expected_output: ACCEPTED_DRAFT.expected_output,
      forbidden_regions: null,
      filename: null,
      notes: null,
    };
    vi.doMock("@/lib/api", () => ({
      api: {
        get: vi.fn().mockResolvedValue(ACCEPTED_DRAFT),
        post: vi.fn().mockResolvedValue(savedRecord),
        put: vi.fn(),
        patch: vi.fn(),
        del: vi.fn(),
      },
      ApiError: class ApiError extends Error {
        status = 500;
      },
    }));

    const { FindingCard: RealFindingCard } = await import("./FindingCard");

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    // Seed the exact cache slot the Evals dashboard reads (`useEvalCases`),
    // mirroring an already-mounted dashboard whose list this save must
    // invalidate — the isolated-client bug left this entry stale forever.
    qc.setQueryData(["evals", "cases", "agent", "agent-1"], []);

    render(
      <QueryClientProvider client={qc}>
        <NextIntlClientProvider
          locale="en"
          messages={{ prReview: messages, eval: evalMessages, common: commonMessages }}
        >
          <RealFindingCard f={ACCEPTED} defaultExpanded onAction={() => {}} />
        </NextIntlClientProvider>
      </QueryClientProvider>,
    );

    // The button exists (and is named for the "no diff yet" disabled reason)
    // before the draft query resolves — wait for it to actually ENABLE, or
    // the click below is a no-op and no dialog ever opens.
    const turnIntoCaseBtn = await screen.findByRole("button", { name: /Turn into eval case/i });
    await waitFor(() => expect(turnIntoCaseBtn).toBeEnabled());
    fireEvent.click(turnIntoCaseBtn);
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(qc.getQueryState(["evals", "cases", "agent", "agent-1"])?.isInvalidated).toBe(true);
    });
  });
});

/* A decision LOCKS the opposite action; the only way across is the icon-only
   revert control that appears beside whichever decision stands. The mutation
   each case names is what would break it. */
describe("FindingCard decision lock + revert", () => {
  const DECIDED_DISMISSED: FindingRecord = { ...FINDING, dismissed_at: "2026-08-28T00:00:00Z" };

  function revertButton(name: RegExp) {
    return screen.getByRole("button", { name });
  }

  it("an undecided finding offers both actions and NO revert control", () => {
    renderWithIntl(<FindingCard f={FINDING} defaultExpanded onAction={() => {}} />);

    expect(screen.getByRole("button", { name: "Accept" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeEnabled();
    // Mutation: rendering the revert control unconditionally.
    expect(screen.queryByRole("button", { name: /Revert this/i })).not.toBeInTheDocument();
  });

  it("an accepted finding disables Dismiss and names the reason", () => {
    renderWithIntl(<FindingCard f={ACCEPTED} defaultExpanded onAction={() => {}} />);

    const dismiss = screen.getByRole("button", {
      name: /Dismiss — Revert the acceptance first to dismiss this finding/i,
    });
    // Mutation: dropping `decision.dismissDisabled` from the `disabled` prop.
    expect(dismiss).toBeDisabled();
    expect(dismiss).toHaveAttribute("title", "Revert the acceptance first to dismiss this finding");
    expect(screen.getByRole("button", { name: "Accept" })).toBeEnabled();
  });

  it("a dismissed finding disables Accept and names the reason", () => {
    renderWithIntl(<FindingCard f={DECIDED_DISMISSED} defaultExpanded onAction={() => {}} />);

    const accept = screen.getByRole("button", {
      name: /Accept — Revert the dismissal first to accept this finding/i,
    });
    expect(accept).toBeDisabled();
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeEnabled();
  });

  it("a locked action fires no onAction even when its click handler is invoked", () => {
    const onAction = vi.fn();
    renderWithIntl(<FindingCard f={ACCEPTED} defaultExpanded onAction={onAction} />);

    // `disabled` already stops a real click; this asserts the handler's own
    // guard too, so the lock does not rest solely on the DOM attribute.
    // Mutation: dropping the `if (decision.dismissDisabled) return;` early exit.
    fireEvent.click(screen.getByRole("button", { name: /^Dismiss/ }));
    expect(onAction).not.toHaveBeenCalled();
  });

  it("revert appears beside the standing decision and reports the action it undoes", () => {
    const onAction = vi.fn();
    renderWithIntl(<FindingCard f={ACCEPTED} defaultExpanded onAction={onAction} />);

    const revert = revertButton(/Revert this acceptance/i);
    // Icon-only: the accessible name is the ONLY name it has
    // (client/INSIGHTS.md 2026-08-16). Mutation: dropping the aria-label.
    expect(revert).toHaveTextContent("");
    // It sits immediately after Accept — "next to whichever decision stands".
    expect(screen.getByRole("button", { name: "Accept" }).nextElementSibling).toBe(revert);

    fireEvent.click(revert);
    expect(onAction).toHaveBeenCalledWith("revert");
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it("a dismissed finding's revert is named for the dismissal and sits after Dismiss", () => {
    const onAction = vi.fn();
    renderWithIntl(<FindingCard f={DECIDED_DISMISSED} defaultExpanded onAction={onAction} />);

    const revert = revertButton(/Revert this dismissal/i);
    expect(screen.getByRole("button", { name: "Dismiss" }).nextElementSibling).toBe(revert);

    fireEvent.click(revert);
    expect(onAction).toHaveBeenCalledWith("revert");
  });

  it("exactly ONE revert control renders, whichever decision stands", () => {
    // Mutation: rendering `revertButton` after both Accept and Dismiss without
    // the `accepted` / `dismissed && !accepted` guards, which duplicates it.
    renderWithIntl(<FindingCard f={ACCEPTED} defaultExpanded onAction={() => {}} />);
    expect(screen.getAllByRole("button", { name: /Revert this/i })).toHaveLength(1);
  });

  it("a pending mutation disables revert alongside the decisions", () => {
    renderWithIntl(<FindingCard f={ACCEPTED} defaultExpanded pending onAction={() => {}} />);
    expect(revertButton(/Revert this acceptance/i)).toBeDisabled();
  });
});

describe("decisionState (helpers.ts)", () => {
  it("leaves both actions open and hides revert while undecided", async () => {
    const { decisionState } = await import("./helpers");
    expect(decisionState({ accepted: false, dismissed: false })).toEqual({
      acceptDisabled: false,
      dismissDisabled: false,
      acceptReasonKey: null,
      dismissReasonKey: null,
      revertVisible: false,
    });
  });

  it("locks dismiss while an acceptance stands", async () => {
    const { decisionState } = await import("./helpers");
    expect(decisionState({ accepted: true, dismissed: false })).toEqual({
      acceptDisabled: false,
      dismissDisabled: true,
      acceptReasonKey: null,
      dismissReasonKey: "disabledAccepted",
      revertVisible: true,
    });
  });

  it("locks accept while a dismissal stands", async () => {
    const { decisionState } = await import("./helpers");
    expect(decisionState({ accepted: false, dismissed: true })).toEqual({
      acceptDisabled: true,
      dismissDisabled: false,
      acceptReasonKey: "disabledDismissed",
      dismissReasonKey: null,
      revertVisible: true,
    });
  });

  it("locks BOTH on a drifted payload carrying two timestamps, but still offers revert", async () => {
    // Unreachable from the API (the setters are mutually exclusive), so this
    // pins the fallback rather than a real transition: the user must still
    // have a way out. Mutation: `acceptDisabled: dismissed && !accepted`.
    const { decisionState } = await import("./helpers");
    const state = decisionState({ accepted: true, dismissed: true });
    expect(state.acceptDisabled).toBe(true);
    expect(state.dismissDisabled).toBe(true);
    expect(state.revertVisible).toBe(true);
  });
});

describe("turnIntoCaseState (helpers.ts)", () => {
  it("is disabled with disabledUndecided when neither accepted nor dismissed", async () => {
    const { turnIntoCaseState } = await import("./helpers");
    expect(turnIntoCaseState({ accepted: false, dismissed: false, draftAvailable: false })).toEqual({
      disabled: true,
      reasonKey: "disabledUndecided",
    });
  });

  it("is disabled with disabledNoDiff when decided but the draft never resolved", async () => {
    const { turnIntoCaseState } = await import("./helpers");
    expect(turnIntoCaseState({ accepted: true, dismissed: false, draftAvailable: false })).toEqual({
      disabled: true,
      reasonKey: "disabledNoDiff",
    });
  });

  it("is enabled once decided and the draft is available", async () => {
    const { turnIntoCaseState } = await import("./helpers");
    expect(turnIntoCaseState({ accepted: false, dismissed: true, draftAvailable: true })).toEqual({
      disabled: false,
      reasonKey: null,
    });
  });
});
