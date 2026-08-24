/**
 * BlastCard — Tree view + `useBlastRadius` (docs/plans/06-blast-radius.md T4).
 *
 * Per client INSIGHTS (2026-08-09 seed / 2026-08-18) the mock point is the
 * hook boundary, not global fetch — `useBlastRadius` is mocked, matching the
 * pattern in IntentCard.test.tsx.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { BlastRadiusResponse, BlastSymbolImpact } from "@devdigest/shared";
import { githubBlobUrl } from "@/lib/github-urls";
import messages from "../../../../../../../../messages/en/blast.json";

const useBlastRadiusSpy = vi.fn();
const refetch = vi.fn();

vi.mock("@/lib/hooks/blast", () => ({
  useBlastRadius: (prId: string | null) => useBlastRadiusSpy(prId),
}));

// T8: PriorPrs reads `repoId` from the route, not a prop — mock the App
// Router param the way ConventionsView.test.tsx does.
vi.mock("next/navigation", () => ({
  useParams: () => ({ repoId: "r1" }),
}));

import { BlastCard } from "./BlastCard";

afterEach(() => {
  cleanup();
  useBlastRadiusSpy.mockReset();
  refetch.mockClear();
});

const REPO_FULL_NAME = "acme/payments-api";
const HEAD_SHA = "abc123";

const BLAST: BlastRadiusResponse = {
  status: "ok",
  status_reason: "",
  coverage: {
    callers_available: true,
    endpoints_available: true,
    crons_available: true,
    imports_available: true,
    prior_prs_available: true,
    files_indexed: 40,
    files_skipped: 0,
    index_truncated: false,
  },
  changed_file_count: 2,
  totals: { symbols: 2, callers: 6, endpoints: 3, crons: 1 },
  symbols: [
    {
      name: "rateLimit",
      file: "src/lib/rate-limit.ts",
      kind: "function",
      callers: [
        { file: "src/api/public/index.ts", symbol: "handler", line: 23, rank: 3 },
        { file: "src/api/public/webhooks.ts", symbol: "webhookHandler", line: 45, rank: 2 },
      ],
      caller_count: 4,
      chips: [
        { label: "GET /api/public/items", kind: "endpoint", file: "src/api/public/index.ts" },
        { label: "reset-rate-buckets (hourly)", kind: "cron", file: "src/jobs/reset.ts" },
      ],
    },
    {
      name: "bucketKey",
      file: "src/lib/rate-limit.ts",
      kind: "function",
      callers: [{ file: "src/lib/rate-limit.ts", symbol: "rateLimit", line: 12, rank: 1 }],
      caller_count: 2,
      chips: [],
    },
  ],
  // A1: still feeds the server-computed count-strip totals but renders
  // nowhere in the UI — the Graph view that once consumed it is gone.
  file_impact: [{ file: "src/server-impact-only.ts", depth: 2, chips: [] }],
  prior_prs: [
    {
      number: 471,
      title: "Tighten public API rate limits",
      status: "merged",
      overlap_count: 2,
      overlapping_files: ["src/lib/rate-limit.ts", "src/api/public/index.ts"],
      updated_at: "2026-08-20T10:00:00.000Z",
    },
  ],
  narrative: null,
};

function renderCard(prId: string | null = "pr-1") {
  return render(
    <NextIntlClientProvider locale="en" messages={{ blast: messages }}>
      <BlastCard prId={prId} repoFullName={REPO_FULL_NAME} headSha={HEAD_SHA} />
    </NextIntlClientProvider>,
  );
}

describe("BlastCard — loading and error states", () => {
  it("shows a loading placeholder, then an error state with a working retry", () => {
    useBlastRadiusSpy.mockReturnValue({ data: undefined, isLoading: true, isError: false, refetch });
    const { unmount } = renderCard();
    expect(screen.getByText("Blast Radius")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    unmount();

    useBlastRadiusSpy.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch });
    renderCard();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});

describe("BlastCard — Tree body (REQ-11, REQ-12, A1)", () => {
  it("renders the count strip and, once a symbol row is expanded, caller links and chips — file_impact renders nowhere in the card", () => {
    useBlastRadiusSpy.mockReturnValue({ data: BLAST, isLoading: false, isError: false, refetch });
    renderCard();

    // Count strip (REQ-11). Scoped to the "symbols" group — T8's Prior PRs
    // accordion also renders a bare "1" badge (its own count) elsewhere on
    // the card, so an unscoped getByText("1") is now ambiguous.
    const statsRow = screen.getByText("symbols").closest("div")!.parentElement!;
    expect(within(statsRow).getByText("2")).toBeInTheDocument(); // symbols
    expect(within(statsRow).getByText("6")).toBeInTheDocument(); // callers
    expect(within(statsRow).getByText("3")).toBeInTheDocument(); // endpoints
    expect(within(statsRow).getByText("1")).toBeInTheDocument(); // crons

    // A1: file_impact is never rendered anywhere in this card — there is no
    // Graph view left to consume it — even though it's part of the mocked
    // response and still feeds the server-computed totals above.
    expect(screen.queryByText("src/server-impact-only.ts")).not.toBeInTheDocument();

    // Collapsed by default — no caller rows visible yet.
    expect(screen.queryByText(/src\/api\/public\/index\.ts:23/)).not.toBeInTheDocument();

    // Expand the first symbol row.
    fireEvent.click(screen.getByRole("button", { name: /rateLimit/ }));

    const callerLink = screen.getByRole("link", { name: "src/api/public/index.ts:23" });
    expect(callerLink).toHaveAttribute(
      "href",
      githubBlobUrl(REPO_FULL_NAME, HEAD_SHA, "src/api/public/index.ts", 23),
    );

    expect(screen.getByText("GET /api/public/items")).toBeInTheDocument();
    expect(screen.getByText("reset-rate-buckets (hourly)")).toBeInTheDocument();
    // Heuristic chips are never presented as certainty (REQ-16).
    expect(
      screen.getByText(/pattern matching.*incomplete or wrong/),
    ).toBeInTheDocument();
  });
});

describe("BlastCard — symbol list bound + caller-truncation disclosure (blast radius wave 4)", () => {
  it("renders only the first SYMBOL_PAGE rows by default, reveals the rest via the expander with the true total, and discloses caller truncation on an over-cap symbol", () => {
    // 366 symbols, matching the measured live-PR shape from the plan's
    // Context section — only the first two carry callers/chips so the count
    // strip and per-row assertions stay simple; the rest are inert filler,
    // matching the "324 inert rows" finding.
    const manySymbols: BlastSymbolImpact[] = [
      {
        name: "heavilyCalledFn",
        file: "src/lib/hot.ts",
        kind: "function",
        // Server caps callers per symbol at 20 — this row's `callers` is
        // exactly that prefix, while `caller_count` (47) is the honest
        // pre-cap total (blast-api.ts's `caller_count` doc comment).
        callers: Array.from({ length: 20 }, (_, i) => ({
          file: `src/callers/c${i}.ts`,
          symbol: "caller",
          line: i + 1,
          rank: 20 - i,
        })),
        caller_count: 47,
        chips: [],
      },
      ...Array.from({ length: 365 }, (_, i) => ({
        name: `inertSymbol${i}`,
        file: "src/lib/inert.ts",
        kind: "function",
        callers: [],
        caller_count: 0,
        chips: [],
      })),
    ];
    const bigBlast: BlastRadiusResponse = {
      ...BLAST,
      totals: { symbols: 366, callers: 47, endpoints: 0, crons: 0 },
      symbols: manySymbols,
    };
    useBlastRadiusSpy.mockReturnValue({ data: bigBlast, isLoading: false, isError: false, refetch });
    renderCard();

    // Only the first 25 rows render — the first (useful) row is present, the
    // 26th (index 25, the first of the inert filler) is not.
    expect(screen.getByRole("button", { name: /heavilyCalledFn/ })).toBeInTheDocument();
    expect(screen.getByText("inertSymbol0")).toBeInTheDocument();
    expect(screen.getByText("inertSymbol23")).toBeInTheDocument();
    expect(screen.queryByText("inertSymbol24")).not.toBeInTheDocument();
    expect(screen.queryByText("inertSymbol364")).not.toBeInTheDocument();

    // The expander carries the TRUE total (366), not the page size.
    const showAll = screen.getByRole("button", { name: "Show all 366 symbols" });
    fireEvent.click(showAll);

    // The rest of the list is now reachable.
    expect(screen.getByText("inertSymbol24")).toBeInTheDocument();
    expect(screen.getByText("inertSymbol364")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Show all/ })).not.toBeInTheDocument();

    // Expand the over-cap symbol: 20 caller rows render, plus a note
    // disclosing the missing 27.
    fireEvent.click(screen.getByRole("button", { name: /heavilyCalledFn/ }));
    expect(screen.getByRole("link", { name: "src/callers/c0.ts:1" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "src/callers/c19.ts:20" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "src/callers/c20.ts:21" })).not.toBeInTheDocument();
    expect(screen.getByText("Showing 20 of 47 callers")).toBeInTheDocument();
  });

  it("does not show a truncation note or an expander when nothing is truncated", () => {
    // BLAST's own `rateLimit` symbol has `caller_count` (4) > `callers.length`
    // (2) — a deliberate REQ-3 fixture, so it is NOT a valid "not truncated"
    // case. Build one here where `caller_count` equals `callers.length`.
    const notTruncated: BlastRadiusResponse = {
      ...BLAST,
      totals: { symbols: 1, callers: 1, endpoints: 0, crons: 0 },
      symbols: [
        {
          name: "onceCalledFn",
          file: "src/lib/rare.ts",
          kind: "function",
          callers: [{ file: "src/callers/only.ts", symbol: "caller", line: 5, rank: 1 }],
          caller_count: 1,
          chips: [],
        },
      ],
    };
    useBlastRadiusSpy.mockReturnValue({ data: notTruncated, isLoading: false, isError: false, refetch });
    renderCard();

    expect(screen.queryByRole("button", { name: /Show all/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /onceCalledFn/ }));
    expect(screen.getByRole("link", { name: "src/callers/only.ts:5" })).toBeInTheDocument();
    expect(screen.queryByText(/Showing \d+ of \d+ callers/)).not.toBeInTheDocument();
  });
});

describe("BlastCard — bug fix: symbol rows must render when totals.callers is 0 (REQ-5, G1)", () => {
  it("shows every symbol row and its own endpoint/cron chips, with the caller note demoted alongside them, even when totals.callers is 0", () => {
    // Reported shape: many symbols, zero callers overall, but symbols still
    // declare their own endpoint/cron chips — those are unrelated to the
    // caller graph and must stay visible.
    const zeroCallers: BlastRadiusResponse = {
      ...BLAST,
      totals: { symbols: 3, callers: 0, endpoints: 1, crons: 1 },
      symbols: [
        {
          name: "handleWebhook",
          file: "src/api/webhook.ts",
          kind: "function",
          callers: [],
          caller_count: 0,
          chips: [{ label: "POST /api/webhook", kind: "endpoint", file: "src/api/webhook.ts" }],
        },
        {
          name: "nightlySync",
          file: "src/jobs/sync.ts",
          kind: "function",
          callers: [],
          caller_count: 0,
          chips: [{ label: "nightly-sync (daily)", kind: "cron", file: "src/jobs/sync.ts" }],
        },
        {
          name: "internalHelper",
          file: "src/lib/helper.ts",
          kind: "function",
          callers: [],
          caller_count: 0,
          chips: [],
        },
      ],
    };
    useBlastRadiusSpy.mockReturnValue({ data: zeroCallers, isLoading: false, isError: false, refetch });
    renderCard();

    // The bug: this branch used to replace the whole symbol list with a
    // single "no downstream callers" message, hiding every row.
    expect(screen.getByRole("button", { name: /handleWebhook/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /nightlySync/ })).toBeInTheDocument();
    expect(screen.getByText("internalHelper")).toBeInTheDocument();

    // The "no downstream callers" fact is demoted to a note, not dropped.
    expect(
      screen.getByText(/3 changed symbol\(s\), no downstream callers found\./),
    ).toBeInTheDocument();

    // A symbol's own chips have nothing to do with the caller graph —
    // expanding reveals them even though totals.callers is 0.
    fireEvent.click(screen.getByRole("button", { name: /handleWebhook/ }));
    expect(screen.getByText("POST /api/webhook")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /nightlySync/ }));
    expect(screen.getByText("nightly-sync (daily)")).toBeInTheDocument();

    // A symbol with no callers AND no chips degrades to a non-interactive
    // row — no expand affordance that would open onto an empty void.
    const helperRow = screen.getByText("internalHelper").closest("button")!;
    expect(helperRow).toBeDisabled();
    expect(helperRow).not.toHaveAttribute("aria-expanded");
  });
});

describe("BlastCard — degraded status (REQ-16, REQ-7)", () => {
  it("shows the status_reason banner and never renders an unavailable cron figure as zero", () => {
    const degraded: BlastRadiusResponse = {
      ...BLAST,
      status: "degraded",
      status_reason: "the index is unavailable, so cron and scheduled-job impact could not be determined",
      coverage: { ...BLAST.coverage, crons_available: false },
    };
    useBlastRadiusSpy.mockReturnValue({ data: degraded, isLoading: false, isError: false, refetch });
    renderCard();

    const banner = screen.getByRole("status");
    expect(within(banner).getByText(/cron and scheduled-job impact could not be determined/)).toBeInTheDocument();

    // The cron stat must read as unknown ("—"), never "0" — an unavailable
    // fact must never look like a real zero.
    expect(screen.queryByText("0")).not.toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});

describe("BlastCard — Prior PRs accordion (T8, REQ-15, A2)", () => {
  it("stays collapsed by default, expands on click, and links each row to the internal PR page", () => {
    useBlastRadiusSpy.mockReturnValue({ data: BLAST, isLoading: false, isError: false, refetch });
    renderCard();

    const header = screen.getByRole("button", { name: /Prior PRs touching these files/ });
    expect(header).toHaveAccessibleName();
    expect(header).toHaveAttribute("aria-expanded", "false");

    // Collapsed: the count is visible (scoped to the header — the top stats
    // row also has a "1", for totals.crons), but no row is rendered yet.
    expect(within(header).getByText("1")).toBeInTheDocument();
    expect(screen.queryByText("Tighten public API rate limits")).not.toBeInTheDocument();

    fireEvent.click(header);
    expect(header).toHaveAttribute("aria-expanded", "true");

    const row = screen.getByRole("link", { name: /Tighten public API rate limits/ });
    expect(row).toHaveAttribute("href", "/repos/r1/pulls/471");
    expect(screen.getByText(/2 files in common/)).toBeInTheDocument();

    // A2: the link is internal, never a github.com URL.
    expect(screen.queryByText(/github\.com/)).not.toBeInTheDocument();
    expect(document.body.innerHTML).not.toMatch(/github\.com/);

    // Keyboard-reachable: a native <button> is in the tab order and has no
    // interactive descendant while collapsed.
    header.focus();
    expect(header).toHaveFocus();
  });

  it("shows an explanatory label instead of a bare 0 when prior_prs_available is false", () => {
    const noPriorPrData: BlastRadiusResponse = {
      ...BLAST,
      prior_prs: [],
      coverage: { ...BLAST.coverage, prior_prs_available: false },
    };
    useBlastRadiusSpy.mockReturnValue({
      data: noPriorPrData,
      isLoading: false,
      isError: false,
      refetch,
    });
    renderCard();

    const header = screen.getByRole("button", { name: /Prior PRs touching these files/ });
    // Never rendered as a bare "[0]" — the label reads "not available".
    expect(screen.getByText("not available")).toBeInTheDocument();

    fireEvent.click(header);
    expect(
      screen.getByText(/Prior PR overlap could not be determined for this repository/),
    ).toBeInTheDocument();
  });
});

describe("BlastCard — narration (T10, REQ-19)", () => {
  it("renders nothing when narrative is null — the default — no placeholder, no skeleton", () => {
    // BLAST's narrative is null, matching the flag-off default (REQ-20).
    useBlastRadiusSpy.mockReturnValue({ data: BLAST, isLoading: false, isError: false, refetch });
    renderCard();

    expect(screen.queryByText("AI-generated summary")).not.toBeInTheDocument();
    expect(screen.queryByText(/generating/i)).not.toBeInTheDocument();
  });

  it("renders a non-null narrative once, as plain text, labelled as AI-generated", () => {
    const withNarrative: BlastRadiusResponse = {
      ...BLAST,
      narrative:
        "rateLimit is called from two public endpoints and an hourly cron; <script>alert(1)</script> stays inert here.",
    };
    useBlastRadiusSpy.mockReturnValue({
      data: withNarrative,
      isLoading: false,
      isError: false,
      refetch,
    });
    renderCard();

    // Labelled as AI-generated (OWASP "label AI-generated content").
    expect(screen.getByText("AI-generated summary")).toBeInTheDocument();

    // Rendered once, as a paragraph.
    const matches = screen.getAllByText(/rateLimit is called from two public endpoints/);
    expect(matches).toHaveLength(1);
    const paragraph = matches[0]!;
    expect(paragraph.tagName).toBe("P");

    // Rendered as TEXT — never dangerouslySetInnerHTML — so a literal "<script>"
    // in the model output survives as a string and is never parsed as an element.
    expect(paragraph).toHaveTextContent(
      "rateLimit is called from two public endpoints and an hourly cron; <script>alert(1)</script> stays inert here.",
    );
    expect(document.querySelector("script")).not.toBeInTheDocument();
  });
});

describe("BlastCard — dependency guard (REQ-14, the Graph view is gone)", () => {
  it("no graph/layout library is present at all — the Graph view and its d3-force dependency were removed, not swapped", () => {
    // REQ-14 originally forbade any new client dependency; a later owner
    // amendment approved `d3-force` for the (now-removed) Graph view. The
    // Graph view is gone, so the guard inverts back to its original shape:
    // assert the ABSENCE of every graph/layout library, `d3-force` included,
    // rather than deleting the tripwire — that would quietly re-open the
    // door to the same dependency creep this test exists to catch.
    const pkg = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const banned of ["d3", "d3-force", "reactflow", "elkjs", "dagre"]) {
      expect(allDeps[banned]).toBeUndefined();
    }
    expect(pkg.devDependencies?.["@types/d3-force"]).toBeUndefined();
  });
});
