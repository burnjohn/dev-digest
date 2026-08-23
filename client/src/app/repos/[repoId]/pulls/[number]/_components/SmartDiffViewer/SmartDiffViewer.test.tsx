/**
 * SmartDiffViewer — the reviewer-ordered diff (REQ-1/3/5/14/15/16/17/20/25/27/28/29).
 *
 * The fixture below is deliberately dense: one file exercises REQ-15's
 * on-line collapse plus a line:0 orphan (REQ-16), one exercises a finding
 * whose line is absent from the rendered patch (REQ-16's other case), one
 * carries the REQ-14/17 on-line chip under test, one has no findings at
 * all, and the two Boilerplate files cover REQ-3/29 (collapsed-but-visible)
 * and REQ-16's `has_patch: false` case. Every finding id and line number is
 * chosen so each row/file can be located unambiguously via its own
 * unique code text or path, per client insight 2026-08-18 (verify through
 * RTL, not the Browser pane).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrFile, SmartDiff } from "@devdigest/shared";
import prReviewMessages from "../../../../../../../../messages/en/prReview.json";
import shellMessages from "../../../../../../../../messages/en/shell.json";
import { SmartDiffViewer } from "./SmartDiffViewer";

afterEach(cleanup);

const PATCH_A = "@@ -24,1 +24,3 @@\n bucketKeyCtx\n+rateLimitAdd1\n+rateLimitAdd2";
const PATCH_B = "@@ -60,1 +60,2 @@\n webhookCtx\n+webhookAdd1";
const PATCH_C = "@@ -10,1 +10,2 @@\n configCtx\n+stripeKeyAdd";
const PATCH_D = "@@ -1,1 +1,1 @@\n serverCtx";
const PATCH_E = "@@ -1,1 +1,2 @@\n lockCtx\n+lockAdd1";

const FILES: PrFile[] = [
  { path: "src/middleware/ratelimit.ts", additions: 2, deletions: 0, patch: PATCH_A },
  { path: "src/api/public/webhooks.ts", additions: 1, deletions: 0, patch: PATCH_B },
  { path: "src/config.ts", additions: 1, deletions: 0, patch: PATCH_C },
  { path: "src/server.ts", additions: 0, deletions: 0, patch: PATCH_D },
  { path: "package-lock.json", additions: 1, deletions: 0, patch: PATCH_E },
];

function buildResponse(overrides: Partial<SmartDiff> = {}): SmartDiff {
  return {
    groups: [
      {
        role: "core",
        file_count: 2,
        files: [
          {
            path: "src/middleware/ratelimit.ts",
            pseudocode_summary: null,
            additions: 2,
            deletions: 0,
            changed_lines: 2,
            large: false,
            has_patch: true,
            default_open: true,
            findings: [
              { id: "f-a-warn", line: 25, severity: "WARNING" },
              { id: "f-a-sugg", line: 25, severity: "SUGGESTION" },
              { id: "f-a-orphan-crit", line: 0, severity: "CRITICAL" },
              // Two CRITICAL findings on the SAME line, deliberately inserted
              // out of id order — exercises REQ-15's total order (severity
              // desc, then id asc) tiebreak on line 26 ("rateLimitAdd2").
              { id: "f-a-crit-2", line: 26, severity: "CRITICAL" },
              { id: "f-a-crit-1", line: 26, severity: "CRITICAL" },
            ],
            finding_lines: [0, 25, 26],
          },
          {
            path: "src/api/public/webhooks.ts",
            pseudocode_summary: null,
            additions: 1,
            deletions: 0,
            changed_lines: 1,
            large: true,
            has_patch: true,
            default_open: true,
            findings: [{ id: "f-b-orphan-99", line: 99, severity: "CRITICAL" }],
            finding_lines: [99],
          },
        ],
      },
      {
        role: "wiring",
        file_count: 2,
        files: [
          {
            path: "src/config.ts",
            pseudocode_summary: null,
            additions: 1,
            deletions: 0,
            changed_lines: 1,
            large: false,
            has_patch: true,
            default_open: true,
            findings: [{ id: "f-config-crit", line: 11, severity: "CRITICAL" }],
            finding_lines: [11],
          },
          {
            path: "src/server.ts",
            pseudocode_summary: null,
            additions: 0,
            deletions: 0,
            changed_lines: 0,
            large: false,
            has_patch: true,
            default_open: false,
            findings: [],
            finding_lines: [],
          },
        ],
      },
      {
        role: "boilerplate",
        file_count: 2,
        files: [
          {
            path: "package-lock.json",
            pseudocode_summary: null,
            additions: 1,
            deletions: 0,
            changed_lines: 1,
            large: false,
            has_patch: true,
            default_open: false,
            findings: [{ id: "f-lock-crit", line: 2, severity: "CRITICAL" }],
            finding_lines: [2],
          },
          {
            path: "vendor/generated.js",
            pseudocode_summary: null,
            additions: 0,
            deletions: 0,
            changed_lines: 0,
            large: false,
            has_patch: false,
            default_open: false,
            findings: [{ id: "f-nopatch-warn", line: 5, severity: "WARNING" }],
            finding_lines: [5],
          },
        ],
      },
    ],
    total_files: 6,
    total_lines: 5,
    unmatched_finding_count: 0,
    split_suggestion: { too_big: false, total_lines: 5, proposed_splits: [] },
    ...overrides,
  };
}

/** Scopes queries to one file's header row (path + REQ-29 indicator only —
 *  excludes the file's body and orphan list, both siblings one level up). */
function headerScope(path: string) {
  return screen.getByText(path).parentElement!;
}

/** Scopes queries to one file's whole card (header + orphan list + body). */
function fileCardScope(path: string) {
  return screen.getByText(path).parentElement!.parentElement!.parentElement!;
}

function renderViewer(props: Partial<React.ComponentProps<typeof SmartDiffViewer>> = {}) {
  const onOpenFinding = props.onOpenFinding ?? vi.fn();
  const result = render(
    <NextIntlClientProvider locale="en" messages={{ prReview: prReviewMessages, shell: shellMessages }}>
      <SmartDiffViewer response={buildResponse()} files={FILES} onOpenFinding={onOpenFinding} {...props} />
    </NextIntlClientProvider>,
  );
  return { ...result, onOpenFinding };
}

describe("SmartDiffViewer", () => {
  it("REQ-28 — renders all three sections expanded, with no clickable group header", () => {
    renderViewer();
    expect(screen.getByText(prReviewMessages.smartDiff.groupTitleCore)).toBeInTheDocument();
    expect(screen.getByText(prReviewMessages.smartDiff.groupSubtitleCore)).toBeInTheDocument();
    expect(screen.getByText(prReviewMessages.smartDiff.groupTitleWiring)).toBeInTheDocument();
    expect(screen.getByText(prReviewMessages.smartDiff.groupTitleBoilerplate)).toBeInTheDocument();
    // Bodies are rendered unconditionally next to their headers — no chevron, no toggle.
    expect(screen.getByText("src/config.ts")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /core logic|wiring|boilerplate/i }),
    ).not.toBeInTheDocument();
  });

  it("REQ-1 — a group with zero files still renders its header and count", () => {
    const response = buildResponse();
    response.groups[1] = { role: "wiring", file_count: 0, files: [] };
    renderViewer({ response });
    expect(screen.getByText(prReviewMessages.smartDiff.groupTitleWiring)).toBeInTheDocument();
    expect(screen.getByText("0 files")).toBeInTheDocument();
  });

  it("REQ-14/REQ-17 — a finding renders as a clickable chip on its exact line, never a github.com link", () => {
    const { onOpenFinding, container } = renderViewer();
    const row = screen.getByText("stripeKeyAdd").parentElement!;
    const chip = within(row).getByRole("button", { name: /blocker/i });

    fireEvent.click(chip);
    expect(onOpenFinding).toHaveBeenCalledWith("f-config-crit");
    expect(container.querySelector('a[href*="github.com"]')).not.toBeInTheDocument();
    expect(container.querySelector('[role="dialog"]')).not.toBeInTheDocument();
  });

  it("REQ-15 (rewritten) — two findings of DIFFERENT severity on one line render two chips, each linking to its own finding", () => {
    const { onOpenFinding } = renderViewer();
    const row = screen.getByText("rateLimitAdd1").parentElement!;
    const chips = within(row).getAllByRole("button");
    expect(chips).toHaveLength(2);

    fireEvent.click(within(row).getByRole("button", { name: /warning/i }));
    expect(onOpenFinding).toHaveBeenCalledWith("f-a-warn");
    fireEvent.click(within(row).getByRole("button", { name: /suggestion/i }));
    expect(onOpenFinding).toHaveBeenCalledWith("f-a-sugg");
  });

  it("REQ-15 (rewritten) — two findings of the SAME severity on one line render two chips, both clickable, ordered by id ascending", () => {
    const { onOpenFinding } = renderViewer();
    const row = screen.getByText("rateLimitAdd2").parentElement!;
    const chips = within(row).getAllByRole("button", { name: /blocker/i });
    expect(chips).toHaveLength(2);

    // "f-a-crit-1" and "f-a-crit-2" tie on severity, so the total order
    // (severity desc, id asc) puts the lower id first.
    fireEvent.click(chips[0]!);
    expect(onOpenFinding).toHaveBeenNthCalledWith(1, "f-a-crit-1");
    fireEvent.click(chips[1]!);
    expect(onOpenFinding).toHaveBeenNthCalledWith(2, "f-a-crit-2");
  });

  it("REQ-15 (rewritten) — no ×N count marker appears on any on-line chip", () => {
    renderViewer();
    const warnLine = screen.getByText("rateLimitAdd1").parentElement!;
    const critLine = screen.getByText("rateLimitAdd2").parentElement!;
    for (const chip of [...within(warnLine).getAllByRole("button"), ...within(critLine).getAllByRole("button")]) {
      expect(chip).not.toHaveTextContent("×");
    }
  });

  it("REQ-15 (rewritten) — chip order is stable: the same payload rendered twice yields the same left-to-right order", () => {
    const firstOpen = vi.fn();
    renderViewer({ onOpenFinding: firstOpen });
    const critLine = screen.getByText("rateLimitAdd2").parentElement!;
    const [firstChip, secondChip] = within(critLine).getAllByRole("button");
    fireEvent.click(firstChip!);
    fireEvent.click(secondChip!);
    const firstRenderOrder = [firstOpen.mock.calls[0]![0], firstOpen.mock.calls[1]![0]];
    cleanup();

    const secondOpen = vi.fn();
    renderViewer({ onOpenFinding: secondOpen });
    const critLineAgain = screen.getByText("rateLimitAdd2").parentElement!;
    const [firstChipAgain, secondChipAgain] = within(critLineAgain).getAllByRole("button");
    fireEvent.click(firstChipAgain!);
    fireEvent.click(secondChipAgain!);
    const secondRenderOrder = [secondOpen.mock.calls[0]![0], secondOpen.mock.calls[1]![0]];

    expect(secondRenderOrder).toEqual(firstRenderOrder);
    expect(firstRenderOrder).toEqual(["f-a-crit-1", "f-a-crit-2"]);
  });

  it("REQ-16 — a line:0 finding and one whose line is absent from the patch both land in the orphan list, and both are clickable", () => {
    const { onOpenFinding } = renderViewer();

    const aOrphans = within(fileCardScope("src/middleware/ratelimit.ts")).getAllByRole("button", {
      name: /not on a visible line/i,
    });
    expect(aOrphans).toHaveLength(1);
    fireEvent.click(aOrphans[0]!);
    expect(onOpenFinding).toHaveBeenCalledWith("f-a-orphan-crit");

    const bOrphans = within(fileCardScope("src/api/public/webhooks.ts")).getAllByRole("button", {
      name: /not on a visible line/i,
    });
    expect(bOrphans).toHaveLength(1);
    fireEvent.click(bOrphans[0]!);
    expect(onOpenFinding).toHaveBeenCalledWith("f-b-orphan-99");
  });

  it("REQ-16 — a finding on a file with no patch at all (has_patch: false) also lands in the orphan list", () => {
    const { onOpenFinding } = renderViewer();
    const orphans = within(fileCardScope("vendor/generated.js")).getAllByRole("button", {
      name: /not on a visible line/i,
    });
    expect(orphans).toHaveLength(1);
    fireEvent.click(orphans[0]!);
    expect(onOpenFinding).toHaveBeenCalledWith("f-nopatch-warn");
  });

  it("REQ-3 — default_open comes from the wire: a Boilerplate file with a CRITICAL finding still renders collapsed", () => {
    renderViewer();
    // Collapsed: the body's own line text never renders, even though the
    // file carries a CRITICAL finding (the mutation REQ-3 guards against is
    // computing `open = findings.length > 0` instead of reading the flag).
    expect(screen.queryByText("lockAdd1")).not.toBeInTheDocument();
  });

  it("REQ-29 — that same collapsed file still shows the dot and a blocker indicator on its header", () => {
    const { onOpenFinding } = renderViewer();
    const chip = within(headerScope("package-lock.json")).getByRole("button", { name: /blocker/i });
    fireEvent.click(chip);
    expect(onOpenFinding).toHaveBeenCalledWith("f-lock-crit");
  });

  it("REQ-5 — a large file renders a visible large-file flag", () => {
    renderViewer();
    expect(screen.getByText(prReviewMessages.smartDiff.largeFileBadge)).toBeInTheDocument();
  });

  it("REQ-25 (render half) — a re-run that mints a new id updates the chip; a re-run that drops the finding removes it", () => {
    const onOpenFinding = vi.fn();
    const { rerender } = render(
      <NextIntlClientProvider locale="en" messages={{ prReview: prReviewMessages, shell: shellMessages }}>
        <SmartDiffViewer response={buildResponse()} files={FILES} onOpenFinding={onOpenFinding} />
      </NextIntlClientProvider>,
    );

    const flipped = buildResponse();
    flipped.groups[1]!.files[0]!.findings = [{ id: "f-config-crit-v2", line: 11, severity: "CRITICAL" }];
    rerender(
      <NextIntlClientProvider locale="en" messages={{ prReview: prReviewMessages, shell: shellMessages }}>
        <SmartDiffViewer response={flipped} files={FILES} onOpenFinding={onOpenFinding} />
      </NextIntlClientProvider>,
    );
    fireEvent.click(within(screen.getByText("stripeKeyAdd").parentElement!).getByRole("button", { name: /blocker/i }));
    expect(onOpenFinding).toHaveBeenCalledWith("f-config-crit-v2");
    expect(onOpenFinding).not.toHaveBeenCalledWith("f-config-crit");

    const cleared = buildResponse();
    cleared.groups[1]!.files[0]!.findings = [];
    cleared.groups[1]!.files[0]!.default_open = false;
    rerender(
      <NextIntlClientProvider locale="en" messages={{ prReview: prReviewMessages, shell: shellMessages }}>
        <SmartDiffViewer response={cleared} files={FILES} onOpenFinding={onOpenFinding} />
      </NextIntlClientProvider>,
    );
    expect(within(headerScope("src/config.ts")).queryByRole("button")).not.toBeInTheDocument();
  });

  it("REQ-27 — nothing renders for pseudocode_summary, present or absent", () => {
    const withSummary = buildResponse();
    withSummary.groups[0]!.files[0]!.pseudocode_summary =
      "New token-bucket limiter: read bucketKey → Redis INCR → if over limit return 429, else next().";
    renderViewer({ response: withSummary });

    expect(screen.queryByText(/what this does/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/token-bucket limiter/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^summary$/i)).not.toBeInTheDocument();
  });

  it("REQ-20 — an empty response under a degraded diffSource renders no empty-state text (the caller's notice already explains it)", () => {
    const empty = buildResponse({
      groups: [
        { role: "core", file_count: 0, files: [] },
        { role: "wiring", file_count: 0, files: [] },
        { role: "boilerplate", file_count: 0, files: [] },
      ],
      total_files: 0,
      total_lines: 0,
    });
    renderViewer({ response: empty, files: [], diffSource: "unavailable", diffReason: "unavailable" });
    expect(screen.queryByText(shellMessages.diffViewer.noChangedFiles)).not.toBeInTheDocument();
  });

  it("REQ-20 — a genuinely empty, live PR renders the no-changed-files state", () => {
    const empty = buildResponse({
      groups: [
        { role: "core", file_count: 0, files: [] },
        { role: "wiring", file_count: 0, files: [] },
        { role: "boilerplate", file_count: 0, files: [] },
      ],
      total_files: 0,
      total_lines: 0,
    });
    renderViewer({ response: empty, files: [], diffSource: "github" });
    expect(screen.getByText(shellMessages.diffViewer.noChangedFiles)).toBeInTheDocument();
  });
});
