import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { FindingRecord } from "@devdigest/shared";
import messages from "../../../../../../../../../messages/en/prReview.json";
import { FindingCard } from "./FindingCard";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BASE_FINDING: FindingRecord = {
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

const ACCEPTED_FINDING: FindingRecord = {
  ...BASE_FINDING,
  id: "f-accepted",
  accepted_at: "2026-07-12T00:00:00Z",
  dismissed_at: null,
};

const DISMISSED_FINDING: FindingRecord = {
  ...BASE_FINDING,
  id: "f-dismissed",
  accepted_at: null,
  dismissed_at: "2026-07-12T00:00:00Z",
};

// ---------------------------------------------------------------------------
// Render helper
// ---------------------------------------------------------------------------

function renderWithProviders(ui: React.ReactElement) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
        {ui}
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Existing smoke tests (regression-guard)
// ---------------------------------------------------------------------------

describe("FindingCard (smoke, both themes)", () => {
  (["dark", "light"] as const).forEach((theme) => {
    it(`renders severity + file:line + rationale in ${theme}`, () => {
      renderWithProviders(
        <div data-theme={theme}>
          <FindingCard f={BASE_FINDING} defaultExpanded onAction={() => {}} />
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
    renderWithProviders(<FindingCard f={BASE_FINDING} defaultExpanded onAction={onAction} />);
    fireEvent.click(screen.getByText("Accept"));
    expect(onAction).toHaveBeenCalledWith("accept");
    fireEvent.click(screen.getByText("Dismiss"));
    expect(onAction).toHaveBeenCalledWith("dismiss");
  });
});

// ---------------------------------------------------------------------------
// T8 — "Turn into eval case" one-click action (AC-1 / AC-2 / AC-4)
// ---------------------------------------------------------------------------

describe('FindingCard "Turn into eval case" (T8)', () => {
  // The button is only shown when the finding has been accepted/dismissed (AC-4)
  // AND an agentId is supplied.

  it("does NOT show the eval button for an un-actioned finding", () => {
    renderWithProviders(
      <FindingCard f={BASE_FINDING} defaultExpanded agentId="agent-1" />,
    );
    expect(screen.queryByText("Turn into eval case")).not.toBeInTheDocument();
  });

  it("does NOT show the eval button when agentId is absent", () => {
    renderWithProviders(
      <FindingCard f={ACCEPTED_FINDING} defaultExpanded />,
    );
    expect(screen.queryByText("Turn into eval case")).not.toBeInTheDocument();
  });

  it("shows the eval button for an accepted finding when agentId is provided", () => {
    renderWithProviders(
      <FindingCard f={ACCEPTED_FINDING} defaultExpanded agentId="agent-1" />,
    );
    expect(screen.getByText("Turn into eval case")).toBeInTheDocument();
  });

  it("shows the eval button for a dismissed finding when agentId is provided", () => {
    renderWithProviders(
      <FindingCard f={DISMISSED_FINDING} defaultExpanded agentId="agent-1" />,
    );
    expect(screen.getByText("Turn into eval case")).toBeInTheDocument();
  });

  it("POSTs the one-click ACCEPT shape (AC-1) — action='accept', no expected_output prompt", async () => {
    // Arrange: mock fetch to capture the outgoing request body.
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "ec-1", owner_kind: "agent", owner_id: "agent-1", name: "Hardcoded Stripe secret key", input_diff: "", input_files: null, input_meta: null, expected_output: {} }), {
        status: 201,
        headers: { "content-type": "application/json" },
      }),
    );

    renderWithProviders(
      <FindingCard f={ACCEPTED_FINDING} defaultExpanded agentId="agent-1" />,
    );

    // Act: one click — no type prompt (AC-4).
    fireEvent.click(screen.getByText("Turn into eval case"));

    // Assert: exactly one POST to /agents/agent-1/eval-cases with action='accept'.
    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledOnce();
    });
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toContain("/agents/agent-1/eval-cases");
    const body = JSON.parse(init?.body as string) as Record<string, unknown>;
    // One-click shape: `action` field present, NOT owner_kind/owner_id (AC-4).
    expect(body.action).toBe("accept");
    expect(body.finding).toBeDefined();
    // The accepted finding's file+line are preserved in the finding payload (AC-1).
    const finding = body.finding as { file: string; start_line: number; end_line: number };
    expect(finding.file).toBe("src/config.ts");
    expect(finding.start_line).toBe(11);
    expect(finding.end_line).toBe(11);
    // No extra expectation-type prompt in the body (AC-4).
    expect(body).not.toHaveProperty("owner_kind");
    expect(body).not.toHaveProperty("owner_id");
    expect(body).not.toHaveProperty("expected_output");
  });

  it("POSTs the one-click DISMISS shape (AC-2) — action='dismiss', no expected_output prompt", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "ec-2", owner_kind: "agent", owner_id: "agent-1", name: "Hardcoded Stripe secret key", input_diff: "", input_files: null, input_meta: null, expected_output: {} }), {
        status: 201,
        headers: { "content-type": "application/json" },
      }),
    );

    renderWithProviders(
      <FindingCard f={DISMISSED_FINDING} defaultExpanded agentId="agent-1" />,
    );

    fireEvent.click(screen.getByText("Turn into eval case"));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledOnce();
    });
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toContain("/agents/agent-1/eval-cases");
    const body = JSON.parse(init?.body as string) as Record<string, unknown>;
    // One-click dismiss shape: action='dismiss' (AC-2).
    expect(body.action).toBe("dismiss");
    expect(body.finding).toBeDefined();
    // No expected_output prompt — the backend derives must_not_flag (AC-4).
    expect(body).not.toHaveProperty("expected_output");
  });

  it("one click only — no extra type-selection UI is rendered", () => {
    renderWithProviders(
      <FindingCard f={ACCEPTED_FINDING} defaultExpanded agentId="agent-1" />,
    );
    // There must be no radio / select / prompt about 'must_find' vs 'must_not_flag'.
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    // The button is present and is a single, direct action trigger.
    expect(screen.getByText("Turn into eval case")).toBeInTheDocument();
  });
});
