import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { EvalCaseRunResult } from "@devdigest/shared";
import evalMessages from "../../../../../messages/en/eval.json";
import { ActualOutput } from "./ActualOutput";
import type { ActualOutputProps } from "./ActualOutput";

afterEach(cleanup);

function renderActualOutput(props: ActualOutputProps) {
  render(
    <NextIntlClientProvider locale="en" messages={{ eval: evalMessages }}>
      <ActualOutput {...props} />
    </NextIntlClientProvider>,
  );
}

function runResult(over: Partial<EvalCaseRunResult> = {}): EvalCaseRunResult {
  return {
    run_id: "run-1",
    case_id: "case-1",
    ran_at: "2026-08-28T00:00:00Z",
    pass: true,
    recall: 1,
    precision: 1,
    citation_accuracy: 1,
    actual_output: { findings: [] },
    ablation: null,
    duration_ms: 1000,
    cost_usd: 0.01,
    ...over,
  };
}

describe("ActualOutput", () => {
  it("shows the empty state when never run", () => {
    renderActualOutput({ run: null, neverRunYetText: "Never run yet" });
    expect(screen.getByText("Never run yet")).toBeInTheDocument();
  });

  it("renders a with-arm-only run's output verbatim, with the run's own metrics", () => {
    renderActualOutput({
      run: runResult({ actual_output: { findings: [{ title: "x" }] } }),
      neverRunYetText: "Never run yet",
    });
    expect(screen.getByText(/"findings"/)).toBeInTheDocument();
    expect(screen.getByText(/recall 100% · precision 100% · citation 100% · 1 finding/)).toBeInTheDocument();
  });

  /* Owner call, 2026-08-29: ONE output BLOCK — the two arms are `"with"` /
     `"without"` sections inside that block's JSON, not two labelled panels
     with a lift row between them. These pin both halves of that: the arms are
     still in the JSON, and the panel chrome around them is gone. */
  it("keeps both arms as sections of the one JSON block, with no per-arm panels or lift row", () => {
    renderActualOutput({
      run: runResult({
        actual_output: {
          with: { recall: 0.8, precision: 0.9, citation_accuracy: 1, findings: [{ title: "leak" }] },
          without: { recall: 0.6, findings: [] },
        },
        ablation: {
          with: { recall: 0.8, precision: 0.9, citation_accuracy: 1, findings: [] },
          without: { recall: 0.6, findings: [] },
        },
      }),
      neverRunYetText: "Never run yet",
    });
    // Mutation this kills: unwrapping to the with arm — the "without" section
    // would vanish from the output the author reads.
    expect(screen.getByText(/"with"/)).toBeInTheDocument();
    expect(screen.getByText(/"without"/)).toBeInTheDocument();
    expect(screen.getByText(/"leak"/)).toBeInTheDocument();
    // The summary line reads the WITH arm — the run the case describes.
    expect(screen.getByText(/recall 80% · precision 90% · citation 100% · 1 finding/)).toBeInTheDocument();

    expect(screen.queryByText("With skill")).not.toBeInTheDocument();
    expect(screen.queryByText("Without skill")).not.toBeInTheDocument();
    expect(screen.queryByText("Lift")).not.toBeInTheDocument();
    expect(screen.queryByText("+20%")).not.toBeInTheDocument();
  });

  it("falls back to the `ablation` object when actual_output is not the envelope, so both arms still show", () => {
    renderActualOutput({
      run: runResult({
        actual_output: { findings: [] },
        ablation: {
          with: { recall: 0.8, precision: 0.9, citation_accuracy: 1, findings: [] },
          without: { unavailable: "errored", reason: "timeout" },
        },
      }),
      neverRunYetText: "Never run yet",
    });
    expect(screen.getByText(/"without"/)).toBeInTheDocument();
    expect(screen.getByText(/timeout/)).toBeInTheDocument();
    expect(screen.getByText(/recall 80%/)).toBeInTheDocument();
  });
});
