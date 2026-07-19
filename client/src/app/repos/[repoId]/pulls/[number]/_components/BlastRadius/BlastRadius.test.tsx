import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { BlastRadius as BlastRadiusSchema, type BlastRadius } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/blast.json";
import { BlastRadiusView } from "./BlastRadius";

afterEach(cleanup);

/** Build a valid BlastRadius from a partial fixture — zod fills the new
    enrichment defaults (role, in_loop, unguarded, finding fields, breaking, …). */
function blast(over: Record<string, unknown>): BlastRadius {
  return BlastRadiusSchema.parse({
    changed_symbols: [{ name: "rateLimit", file: "src/mw/ratelimit.ts", kind: "function" }],
    downstream: [],
    summary: "1 changed symbol.",
    ...over,
  });
}

const BLAST = blast({
  downstream: [
    {
      symbol: "rateLimit",
      file: "src/mw/ratelimit.ts",
      callers: [
        { name: "handler", file: "src/api/public.ts", line: 23, role: "business" },
        { name: "boot", file: "src/server.ts", line: 88 },
      ],
      endpoints_affected: ["GET /public/data"],
      crons_affected: ["reset-buckets (hourly)"],
    },
  ],
  findings_available: true,
  summary: "1 changed symbol · 2 downstream callers · 1 endpoint affected.",
});

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
    expect(screen.getByText("src/api/public.ts:23")).toBeInTheDocument();
    expect(screen.getByText("src/server.ts:88")).toBeInTheDocument();
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
      <BlastRadiusView blast={blast({ changed_symbols: [], downstream: [], summary: "No top-level symbols changed in this PR." })} />,
    );
    expect(screen.getByText("No top-level symbols changed in this PR.")).toBeInTheDocument();
    expect(screen.queryByText("Graph")).not.toBeInTheDocument();
  });

  it("V.P1.2 — shows a usage hint + a per-stat tooltip so the map is self-explanatory", () => {
    renderWithIntl(<BlastRadiusView blast={BLAST} />);
    expect(screen.getByText(/click a symbol to expand/i)).toBeInTheDocument();
    expect(screen.getByTitle(/functions\/classes changed/i)).toBeInTheDocument();
  });
});

describe("E — enrichment signals (deterministic, no model)", () => {
  it("E.P0.1 — classifies a caller as `business` with a role tag", () => {
    renderWithIntl(<BlastRadiusView blast={BLAST} />);
    // role tag shown for the business caller
    expect(screen.getByText("business")).toBeInTheDocument();
  });

  it("E.P0.2 — cross-references an EXISTING critical finding onto the changed symbol", () => {
    const b = blast({
      downstream: [
        {
          symbol: "rateLimit",
          file: "src/mw/ratelimit.ts",
          callers: [{ name: "h", file: "src/api/public.ts", line: 3, role: "business" }],
          endpoints_affected: [],
          crons_affected: [],
          finding_severity: "CRITICAL",
          finding_count: 2,
        },
      ],
      findings_available: true,
    });
    renderWithIntl(<BlastRadiusView blast={b} />);
    expect(screen.getByText("2 findings")).toBeInTheDocument();
  });

  it("E.P0.3 — flags a breaking API change (signature edited)", () => {
    const b = blast({
      downstream: [
        {
          symbol: "charge",
          file: "src/pay.ts",
          callers: [{ name: "checkout", file: "src/api/pay.ts", line: 9, role: "business" }],
          endpoints_affected: ["POST /api/charge"],
          crons_affected: [],
          breaking: true,
        },
      ],
      findings_available: true,
    });
    renderWithIntl(<BlastRadiusView blast={b} />);
    expect(screen.getByText("breaking API")).toBeInTheDocument();
  });

  it("E.P0.4 — shows perf (in-loop) and stability (unguarded) call-site risks", () => {
    const b = blast({
      downstream: [
        {
          symbol: "rateLimit",
          file: "src/mw/ratelimit.ts",
          callers: [{ name: "loopCaller", file: "src/api/public.ts", line: 5, in_loop: true, unguarded: true }],
          endpoints_affected: [],
          crons_affected: [],
          may_throw: true, // makes the unguarded chip relevant
        },
      ],
      findings_available: true,
    });
    renderWithIntl(<BlastRadiusView blast={b} />);
    expect(screen.getByText("in loop")).toBeInTheDocument();
    expect(screen.getByText("unguarded")).toBeInTheDocument();
    expect(screen.getByText("throws")).toBeInTheDocument();
  });

  it("E.P1.1 — surfaces dead/uncalled changed symbols in their own section", () => {
    const b = blast({
      changed_symbols: [
        { name: "used", file: "src/x.ts", kind: "function" },
        { name: "orphan", file: "src/x.ts", kind: "function" },
      ],
      downstream: [
        { symbol: "used", file: "src/x.ts", callers: [{ name: "c", file: "src/api/y.ts", line: 1 }], endpoints_affected: [], crons_affected: [] },
      ],
      dead_symbols: [{ name: "orphan", file: "src/x.ts", kind: "function" }],
      findings_available: true,
    });
    renderWithIntl(<BlastRadiusView blast={b} />);
    expect(screen.getByText("orphan()")).toBeInTheDocument();
    expect(screen.getByText("no external callers")).toBeInTheDocument();
  });

  it("E.P1.2 — lists prior PRs touching these files (collapsible)", () => {
    const b = blast({
      downstream: [
        { symbol: "rateLimit", file: "src/mw/ratelimit.ts", callers: [{ name: "c", file: "src/api/y.ts", line: 1 }], endpoints_affected: [], crons_affected: [] },
      ],
      related_prs: [{ id: "p9", number: 9, title: "earlier limiter tweak" }],
      findings_available: true,
    });
    renderWithIntl(<BlastRadiusView blast={b} />);
    fireEvent.click(screen.getByText(/prior prs touching/i));
    expect(screen.getByText("earlier limiter tweak")).toBeInTheDocument();
    expect(screen.getByText("#9")).toBeInTheDocument();
  });

  it("E.P1.3 — prompts to run an agent when no review exists yet", () => {
    renderWithIntl(<BlastRadiusView blast={blast({ downstream: BLAST.downstream, findings_available: false })} />);
    expect(screen.getByText(/no agent has reviewed/i)).toBeInTheDocument();
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
    fireEvent.click(header);
    expect(screen.queryByText("src/api/public.ts:23")).not.toBeInTheDocument();
    fireEvent.click(header);
    expect(screen.getByText("src/api/public.ts:23")).toBeInTheDocument();
  });

  it("K.P1.2 — Expand all / Collapse all toggles every node at once", () => {
    const two = blast({
      changed_symbols: [
        { name: "rateLimit", file: "src/mw/ratelimit.ts", kind: "function" },
        { name: "authGuard", file: "src/mw/auth.ts", kind: "function" },
      ],
      downstream: [
        { symbol: "rateLimit", file: "src/mw/ratelimit.ts", callers: [{ name: "handler", file: "src/api/public.ts", line: 23 }], endpoints_affected: [], crons_affected: [] },
        { symbol: "authGuard", file: "src/mw/auth.ts", callers: [{ name: "login", file: "src/api/session.ts", line: 9 }], endpoints_affected: [], crons_affected: [] },
      ],
      findings_available: true,
    });
    renderWithIntl(<BlastRadiusView blast={two} />);
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
    expect(within(svg).getAllByText("rateLimit()").length).toBeGreaterThan(0);
    expect(within(svg).getAllByText("handler").length).toBeGreaterThan(0);
    expect(screen.getByText("changed symbol")).toBeInTheDocument();
  });

  it("G.P1.1 — graph view with no downstream callers shows an empty-state, not a broken SVG", () => {
    const noCallers = blast({
      changed_symbols: [{ name: "helper", file: "src/lib/x.ts", kind: "function" }],
      downstream: [{ symbol: "helper", file: "src/lib/x.ts", callers: [], endpoints_affected: [], crons_affected: [] }],
      summary: "1 changed symbol · 0 downstream callers.",
      findings_available: true,
    });
    renderWithIntl(<BlastRadiusView blast={noCallers} />);
    fireEvent.click(screen.getByText("Graph"));
    expect(screen.getByText("No downstream callers to graph.")).toBeInTheDocument();
  });
});
