import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { BlastRadius } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/blast.json";
import { BlastRadiusView } from "./BlastRadius";

afterEach(cleanup);

/** A blast with 1 changed symbol → 2 callers, one endpoint + one cron. */
const BLAST: BlastRadius = {
  changed_symbols: [{ name: "rateLimit", file: "src/mw/ratelimit.ts", kind: "function" }],
  downstream: [
    {
      symbol: "rateLimit",
      callers: [
        { name: "handler", file: "src/api/public.ts", line: 23 },
        { name: "boot", file: "src/server.ts", line: 88 },
      ],
      endpoints_affected: ["GET /public/data"],
      crons_affected: ["reset-buckets (hourly)"],
    },
  ],
  summary: "1 changed symbol · 2 downstream callers · 1 endpoint affected.",
};

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ blast: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("V — Blast Radius tree view", () => {
  it("V.P0.1 — renders the impact tree: changed symbol, callers, endpoint & cron (first node open)", () => {
    renderWithIntl(<BlastRadiusView blast={BLAST} />);
    expect(screen.getByText("rateLimit()")).toBeInTheDocument();
    // first node open by default → both callers + their locations visible
    expect(screen.getByText("src/api/public.ts:23")).toBeInTheDocument();
    expect(screen.getByText("src/server.ts:88")).toBeInTheDocument();
    // impacted endpoint + cron rendered as badges
    expect(screen.getByText("GET /public/data")).toBeInTheDocument();
    expect(screen.getByText("reset-buckets (hourly)")).toBeInTheDocument();
  });

  it("V.P0.2 — renders the deterministic one-line summary from the server (no recompute)", () => {
    renderWithIntl(<BlastRadiusView blast={BLAST} />);
    expect(
      screen.getByText("1 changed symbol · 2 downstream callers · 1 endpoint affected."),
    ).toBeInTheDocument();
  });

  it("V.P1.1 — empty blast → shows the explanatory summary, not a blank panel", () => {
    renderWithIntl(
      <BlastRadiusView
        blast={{ changed_symbols: [], downstream: [], summary: "No top-level symbols changed in this PR." }}
      />,
    );
    expect(screen.getByText("No top-level symbols changed in this PR.")).toBeInTheDocument();
    // no tree/graph toggle when there's nothing to show
    expect(screen.queryByText("Graph")).not.toBeInTheDocument();
  });

  it("V.P1.2 — shows a usage hint + a per-stat tooltip so the map is self-explanatory", () => {
    renderWithIntl(<BlastRadiusView blast={BLAST} />);
    expect(screen.getByText(/click a symbol to expand/i)).toBeInTheDocument();
    // headline stats carry hover help (title attr)
    expect(screen.getByTitle(/functions\/classes changed/i)).toBeInTheDocument();
  });
});

describe("K — click a caller location → jump to code (git-why hook)", () => {
  it("K.P0.1 — clicking a caller location fires onWhy(file, line)", () => {
    const onWhy = vi.fn();
    renderWithIntl(<BlastRadiusView blast={BLAST} onWhy={onWhy} />);
    fireEvent.click(screen.getByText("src/server.ts:88"));
    expect(onWhy).toHaveBeenCalledWith("src/server.ts", 88);
  });

  it("K.P1.1 — a node collapses & re-expands (progressive disclosure)", () => {
    renderWithIntl(<BlastRadiusView blast={BLAST} />);
    const header = screen.getByText("rateLimit()");
    fireEvent.click(header); // collapse
    expect(screen.queryByText("src/api/public.ts:23")).not.toBeInTheDocument();
    fireEvent.click(header); // re-expand
    expect(screen.getByText("src/api/public.ts:23")).toBeInTheDocument();
  });

  it("K.P1.2 — Expand all / Collapse all toggles every node at once", () => {
    // Two changed symbols → only the first is open by default.
    const two: BlastRadius = {
      changed_symbols: [
        { name: "rateLimit", file: "src/mw/ratelimit.ts", kind: "function" },
        { name: "authGuard", file: "src/mw/auth.ts", kind: "function" },
      ],
      downstream: [
        { symbol: "rateLimit", callers: [{ name: "handler", file: "src/api/public.ts", line: 23 }], endpoints_affected: [], crons_affected: [] },
        { symbol: "authGuard", callers: [{ name: "login", file: "src/api/session.ts", line: 9 }], endpoints_affected: [], crons_affected: [] },
      ],
      summary: "2 changed symbols · 2 downstream callers.",
    };
    renderWithIntl(<BlastRadiusView blast={two} />);
    // second node starts collapsed
    expect(screen.queryByText("src/api/session.ts:9")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTitle("Expand all"));
    expect(screen.getByText("src/api/session.ts:9")).toBeInTheDocument();
    fireEvent.click(screen.getByTitle("Collapse all"));
    expect(screen.queryByText("src/api/public.ts:23")).not.toBeInTheDocument();
  });
});

describe("G — node-link graph view", () => {
  it("G.P0.1 — toggling to graph renders an accessible SVG impact graph + legend", () => {
    renderWithIntl(<BlastRadiusView blast={BLAST} />);
    fireEvent.click(screen.getByText("Graph"));
    const svg = screen.getByLabelText("Blast radius graph");
    expect(svg).toBeInTheDocument();
    // root symbol + both callers appear as graph nodes (label text + hover <title>)
    expect(within(svg).getAllByText("rateLimit()").length).toBeGreaterThan(0);
    expect(within(svg).getAllByText("handler").length).toBeGreaterThan(0);
    // a legend explains the node colors
    expect(screen.getByText("changed symbol")).toBeInTheDocument();
  });

  it("G.P1.1 — graph view with no downstream callers shows an empty-state, not a broken SVG", () => {
    const noCallers: BlastRadius = {
      changed_symbols: [{ name: "helper", file: "src/lib/x.ts", kind: "function" }],
      downstream: [{ symbol: "helper", callers: [], endpoints_affected: [], crons_affected: [] }],
      summary: "1 changed symbol · 0 downstream callers.",
    };
    renderWithIntl(<BlastRadiusView blast={noCallers} />);
    fireEvent.click(screen.getByText("Graph"));
    expect(screen.getByText("No downstream callers to graph.")).toBeInTheDocument();
  });
});
