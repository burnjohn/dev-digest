import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { RunTrace } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/runs.json"; // apps/web/messages/en/runs.json

// Mock the trace hooks so the drawer renders without a query client / SSE.
const BASE_TRACE: RunTrace = {
  config: { agent: "Security", version: "1", provider: "openai", model: "gpt-4.1", pr: 482, source: "local" },
  stats: { duration_ms: 8200, tokens_in: 12000, tokens_out: 1500, findings: 2, grounding: "2/2 passed", cost_usd: 0.0013 },
  prompt_assembly: { system: "You are a reviewer.", skills: "### skill", memory: null, specs: null, user: "Review PR #482" },
  tool_calls: [{ tool: "review_file", args: "src/config.ts", meta: "single-pass", ms: 1200 }],
  raw_output: '{"verdict":"request_changes"}',
  memory_pulled: [{ pr: 471, text: "rate-limit public endpoints" }],
  specs_read: [],
  log: [
    { t: "00.10", kind: "info", msg: "Starting review with agent Security" },
    { t: "00.90", kind: "result", msg: "Citation grounding: 2/2 passed" },
  ],
};

// A mutable indirection so individual tests can swap in a variant trace
// without touching the module-level mock registration below (vi.mock's
// factory is hoisted, so it can only close over a variable, never a
// per-test value passed at call time).
let currentTrace: RunTrace = BASE_TRACE;

vi.mock("../../../../../../../lib/hooks/trace", () => ({
  useRunTrace: () => ({ data: currentTrace, isLoading: false }),
}));
vi.mock("../../../../../../../lib/hooks/reviews", () => ({
  useRunEvents: () => ({ events: [], running: false }),
}));

import RunTraceDrawer from "./RunTraceDrawer";

afterEach(() => {
  cleanup();
  currentTrace = BASE_TRACE;
});

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ runs: messages }}>
      <div data-theme="dark">{ui}</div>
    </NextIntlClientProvider>,
  );
}

describe("A5 Run Trace drawer (smoke)", () => {
  it("renders the trace tabs and stats", () => {
    renderWithIntl(<RunTraceDrawer runId="r1" agentName="Security" prNumber={482} onClose={() => {}} />);
    expect(screen.getByText("Configuration")).toBeInTheDocument();
    expect(screen.getByText("Stats")).toBeInTheDocument();
    expect(screen.getByText("2/2 passed")).toBeInTheDocument();
    expect(screen.getByText("Tool calls")).toBeInTheDocument();
  });

  it("renders the COST stat tile between tokens and findings", () => {
    renderWithIntl(<RunTraceDrawer runId="r1" agentName="Security" prNumber={482} onClose={() => {}} />);
    expect(screen.getByText("COST")).toBeInTheDocument();
    expect(screen.getByText("$0.0013")).toBeInTheDocument();
  });

  it("switches to the live log tab", () => {
    renderWithIntl(<RunTraceDrawer runId="r1" agentName="Security" prNumber={482} onClose={() => {}} />);
    fireEvent.click(screen.getByText("log"));
    // LiveLogStream renders its filter input
    expect(screen.getByPlaceholderText("Filter log…")).toBeInTheDocument();
  });
});

describe("T11 — project context manifest, missing paths, prompt-assembly row order", () => {
  const SPECS_LABEL = "Project context — attached specs (untrusted)";
  const REPO_MAP_LABEL = "Repo skeleton — repo-intel (dynamic)";

  it("REQ-28: renders the labelled prompt-assembly row with byte-identical expanded content", () => {
    const specsText = "  ## leading/trailing whitespace preserved\nline two\t\n";
    currentTrace = { ...BASE_TRACE, prompt_assembly: { ...BASE_TRACE.prompt_assembly, specs: specsText } };
    renderWithIntl(<RunTraceDrawer runId="r1" agentName="Security" prNumber={482} onClose={() => {}} />);

    // Open the (defaultOpen=false) "Prompt assembly" section, then the specs block itself.
    fireEvent.click(screen.getByText("Prompt assembly"));
    const label = screen.getByText(SPECS_LABEL);
    fireEvent.click(label);

    const promptRow = label.closest("div")?.parentElement;
    expect(promptRow).not.toBeNull();
    const pre = promptRow!.querySelector("pre");
    expect(pre).not.toBeNull();
    expect(pre!.textContent).toBe(specsText);
  });

  it("REQ-28 / null-guard: a run with no prompt_assembly.specs renders no prompt-assembly row for it", () => {
    currentTrace = { ...BASE_TRACE, prompt_assembly: { ...BASE_TRACE.prompt_assembly, specs: null } };
    renderWithIntl(<RunTraceDrawer runId="r1" agentName="Security" prNumber={482} onClose={() => {}} />);
    fireEvent.click(screen.getByText("Prompt assembly"));
    expect(screen.queryByText(SPECS_LABEL)).not.toBeInTheDocument();
  });

  it("REQ-29: a `missing` specs_manifest entry renders distinctly from a `read` path", () => {
    currentTrace = {
      ...BASE_TRACE,
      specs_read: ["docs/onboarding.md"],
      specs_manifest: [
        { path: "docs/onboarding.md", status: "read", sha256: "abc123", chars: 340 },
        { path: "docs/removed.md", status: "missing", sha256: null, chars: null },
      ],
    };
    renderWithIntl(<RunTraceDrawer runId="r1" agentName="Security" prNumber={482} onClose={() => {}} />);

    const readEl = screen.getByText("docs/onboarding.md");
    const missingEl = screen.getByText("docs/removed.md");
    expect(readEl).toBeInTheDocument();
    expect(missingEl).toBeInTheDocument();
    // Distinct visual treatment: the missing path carries the warn color; the
    // read path does not.
    expect(missingEl).toHaveStyle({ color: "var(--warn)" });
    expect(readEl).not.toHaveStyle({ color: "var(--warn)" });
  });

  it("REQ-27: a trace with specs_manifest absent or null renders unchanged and does not throw", () => {
    currentTrace = { ...BASE_TRACE, specs_manifest: null };
    expect(() =>
      renderWithIntl(<RunTraceDrawer runId="r1" agentName="Security" prNumber={482} onClose={() => {}} />),
    ).not.toThrow();
    // No specs were read and none are reported missing — the row falls back
    // to the pre-existing "none" placeholder, exactly as before this field existed.
    expect(screen.getByText("none")).toBeInTheDocument();

    cleanup();
    // `specs_manifest` entirely absent from the object (older persisted trace).
    const { specs_manifest: _drop, ...withoutManifest } = currentTrace;
    currentTrace = withoutManifest as RunTrace;
    expect(() =>
      renderWithIntl(<RunTraceDrawer runId="r1" agentName="Security" prNumber={482} onClose={() => {}} />),
    ).not.toThrow();
    expect(screen.getByText("none")).toBeInTheDocument();
  });

  it("REQ-33: expanded assembled text renders as literal preformatted text, never as markup", () => {
    const raw = "<b>bold</b>\n# heading\n<script>alert(1)</script>";
    currentTrace = { ...BASE_TRACE, prompt_assembly: { ...BASE_TRACE.prompt_assembly, specs: raw } };
    const { container } = renderWithIntl(
      <RunTraceDrawer runId="r1" agentName="Security" prNumber={482} onClose={() => {}} />,
    );

    fireEvent.click(screen.getByText("Prompt assembly"));
    fireEvent.click(screen.getByText(SPECS_LABEL));

    // No live <b>, heading, or <script> element was created from the text.
    expect(container.querySelector("b")).toBeNull();
    expect(container.querySelector("h1,h2,h3,h4,h5,h6")).toBeNull();
    expect(container.querySelector("script")).toBeNull();

    // The characters themselves are present, rendered literally inside a <pre>.
    const pres = Array.from(container.querySelectorAll("pre"));
    const specsPre = pres.find((p) => p.textContent === raw);
    expect(specsPre).toBeDefined();
    expect(specsPre?.tagName).toBe("PRE");
  });

  it("REQ-46: the repo-skeleton block renders above the project-context block", () => {
    currentTrace = {
      ...BASE_TRACE,
      prompt_assembly: {
        ...BASE_TRACE.prompt_assembly,
        repo_map: "function foo(): void",
        specs: "## spec content",
      },
    };
    renderWithIntl(<RunTraceDrawer runId="r1" agentName="Security" prNumber={482} onClose={() => {}} />);
    fireEvent.click(screen.getByText("Prompt assembly"));

    const repoMapLabel = screen.getByText(REPO_MAP_LABEL);
    const specsLabel = screen.getByText(SPECS_LABEL);
    // DOCUMENT_POSITION_FOLLOWING (4) set on specsLabel means repoMapLabel
    // precedes it in document order.
    const position = repoMapLabel.compareDocumentPosition(specsLabel);
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
