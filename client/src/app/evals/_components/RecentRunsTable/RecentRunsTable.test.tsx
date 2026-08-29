import React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { EvalBatchRecord } from "@devdigest/shared";
import evalMessages from "../../../../../messages/en/eval.json";
import skillsMessages from "../../../../../messages/en/skills.json";
import { RecentRunsTable } from "./RecentRunsTable";
import type { RecentRunRow } from "./helpers";

function batch(over: Partial<EvalBatchRecord> = {}): EvalBatchRecord {
  return {
    id: "b1",
    owner_kind: "agent",
    owner_id: "a1",
    owner_version: 7,
    runner_agent_id: null,
    runner_agent_version: null,
    started_at: "2026-05-29T09:14:00.000Z",
    finished_at: "2026-05-29T09:15:00.000Z",
    status: "succeeded",
    recall: 0.82,
    precision: 0.91,
    citation_accuracy: 0.95,
    cases_passed: 17,
    cases_total: 20,
    cost_usd: 0.23,
    ...over,
  };
}

function row(over: Partial<RecentRunRow> = {}): RecentRunRow {
  return { batch: batch(), agentId: "a1", agentName: "Security Reviewer", ...over };
}

function renderTable(rows: RecentRunRow[]) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: evalMessages, skills: skillsMessages }}>
      <RecentRunsTable rows={rows} />
    </NextIntlClientProvider>,
  );
}

/** The metric `<td>`s, in header order: recall, precision, citation. */
function metricCells(container: HTMLElement): HTMLTableCellElement[] {
  const cells = Array.from(container.querySelectorAll("tbody tr td"));
  return cells.slice(3, 6) as HTMLTableCellElement[];
}

afterEach(cleanup);

describe("RecentRunsTable", () => {
  it("renders the agent, date, version, three metrics and the pass ratio for a run", () => {
    renderTable([row()]);

    expect(screen.getByText("Security Reviewer")).toBeInTheDocument();
    expect(screen.getByText("2026-05-29 09:14")).toBeInTheDocument();
    expect(screen.getByText("v7")).toBeInTheDocument();
    expect(screen.getByText("82%")).toBeInTheDocument();
    expect(screen.getByText("91%")).toBeInTheDocument();
    expect(screen.getByText("95%")).toBeInTheDocument();
    expect(screen.getByText("17/20")).toBeInTheDocument();
  });

  it("links the agent cell to that agent's drill-in", () => {
    renderTable([row({ agentId: "a-42" })]);

    expect(screen.getByRole("link", { name: "Security Reviewer" })).toHaveAttribute(
      "href",
      "/evals/a-42",
    );
  });

  it("draws a bar whose width is the metric, in the metric's own colour", () => {
    const { container } = renderTable([row()]);
    const fill = metricCells(container)[0]!.querySelector("span > span") as HTMLElement;

    expect(fill.style.width).toBe("82%");
    expect(fill.style.background).toBe("var(--accent)");
  });

  it("renders an em dash and NO bar fill for a null metric, never a 0% bar", () => {
    // A null metric drawn as a zero-width fill is indistinguishable from a
    // measured 0% — the track must stay empty.
    const { container } = renderTable([
      row({ batch: batch({ recall: null, precision: 0, citation_accuracy: 0.5 }) }),
    ]);
    const [recall, precision] = metricCells(container);

    expect(recall!.textContent).toBe("—");
    expect(recall!.querySelector("span > span")).toBeNull();

    // A REAL zero still draws its (zero-width) fill element.
    expect(precision!.textContent).toBe("0%");
    expect(precision!.querySelector("span > span")).not.toBeNull();
  });

  it("renders one row per run, newest-first order preserved from the caller", () => {
    const { container } = renderTable([
      row({ batch: batch({ id: "b1", started_at: "2026-05-29T09:14:00.000Z" }) }),
      row({
        batch: batch({ id: "b2", started_at: "2026-05-28T13:20:00.000Z" }),
        agentId: "a2",
        agentName: "Perf Reviewer",
      }),
    ]);

    const names = Array.from(container.querySelectorAll("tbody tr td:first-child")).map(
      (td) => td.textContent,
    );
    expect(names).toEqual(["Security Reviewer", "Perf Reviewer"]);
  });

  it("renders the no-runs copy instead of an empty table when there are no runs", () => {
    const { container } = renderTable([]);

    expect(screen.getByText(evalMessages.dashboard.noRuns)).toBeInTheDocument();
    expect(container.querySelector("table")).toBeNull();
  });
});
