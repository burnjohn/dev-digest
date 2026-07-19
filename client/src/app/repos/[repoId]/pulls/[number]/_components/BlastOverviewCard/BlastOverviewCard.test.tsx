import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { BlastRadius as BlastRadiusSchema } from "@devdigest/shared";
import blastMessages from "../../../../../../../../messages/en/blast.json";
import { BlastOverviewCard } from "./BlastOverviewCard";

const useBlast = vi.fn();
vi.mock("@/lib/hooks/blast", () => ({ useBlast: (id: string | null) => useBlast(id) }));

afterEach(() => {
  cleanup();
  useBlast.mockReset();
});

const BLAST = BlastRadiusSchema.parse({
  changed_symbols: [{ name: "rateLimit", file: "src/mw/ratelimit.ts", kind: "function" }],
  downstream: [
    {
      symbol: "rateLimit",
      file: "src/mw/ratelimit.ts",
      callers: [{ name: "h", file: "src/api/public.ts", line: 3 }],
      endpoints_affected: ["GET /x"],
      crons_affected: [],
      breaking: true,
    },
  ],
  findings_available: true,
  summary: "1 changed symbol.",
});

function renderCard(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ blast: blastMessages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("BlastOverviewCard — compact Overview preview", () => {
  it("O.P0.1 — renders the compact map (top symbol + breaking marker) and a View-full link", () => {
    useBlast.mockReturnValue({ data: BLAST });
    const onOpen = vi.fn();
    renderCard(<BlastOverviewCard prId="pr-1" onOpen={onOpen} />);
    expect(screen.getByText("rateLimit()")).toBeInTheDocument();
    expect(screen.getByText("breaking API")).toBeInTheDocument();
    fireEvent.click(screen.getByText(/view full blast radius/i));
    expect(onOpen).toHaveBeenCalled();
  });

  it("O.P1.1 — renders nothing when there's no blast data (keeps Overview clean)", () => {
    useBlast.mockReturnValue({ data: undefined });
    const { container } = renderCard(<BlastOverviewCard prId="pr-1" onOpen={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});
