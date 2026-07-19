import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { BlastRadius } from "@devdigest/shared";
import blastMessages from "../../../../../../../../messages/en/blast.json";
import { BlastTab } from "./BlastTab";

// Mock the data hook so the tab is exercised without a QueryClient / network.
const useBlast = vi.fn();
vi.mock("@/lib/hooks/blast", () => ({ useBlast: (id: string | null) => useBlast(id) }));

afterEach(() => {
  cleanup();
  useBlast.mockReset();
});

const BLAST: BlastRadius = {
  changed_symbols: [{ name: "rateLimit", file: "src/mw/ratelimit.ts", kind: "function" }],
  downstream: [
    {
      symbol: "rateLimit",
      callers: [{ name: "handler", file: "src/api/public.ts", line: 23 }],
      endpoints_affected: ["GET /public/data"],
      crons_affected: [],
    },
  ],
  summary: "1 changed symbol · 1 downstream caller · 1 endpoint affected.",
};

function renderTab(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ blast: blastMessages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("I — BlastTab integration (data shell → impact map)", () => {
  it("I.P0.1 — success: renders the section + the impact tree from the hook data", () => {
    useBlast.mockReturnValue({ data: BLAST, isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
    renderTab(<BlastTab prId="pr-1" />);
    expect(screen.getByText("Blast radius")).toBeInTheDocument();
    expect(screen.getByText("rateLimit()")).toBeInTheDocument();
    expect(screen.getByText("src/api/public.ts:23")).toBeInTheDocument();
  });

  it("I.P0.2 — a visible Refresh control re-fetches the impact map on demand", () => {
    const refetch = vi.fn();
    useBlast.mockReturnValue({ data: BLAST, isLoading: false, isFetching: false, error: null, refetch });
    renderTab(<BlastTab prId="pr-1" />);
    fireEvent.click(screen.getByTitle("Refresh"));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("I.P1.1 — error: shows a retryable error state, not a blank tab", () => {
    useBlast.mockReturnValue({
      data: undefined,
      isLoading: false,
      isFetching: false,
      error: new Error("index not ready"),
      refetch: vi.fn(),
    });
    renderTab(<BlastTab prId="pr-1" />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("index not ready")).toBeInTheDocument();
  });
});
