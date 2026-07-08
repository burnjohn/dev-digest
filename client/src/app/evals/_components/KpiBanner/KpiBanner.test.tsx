import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { EvalKpiDeltaResponse } from "@devdigest/shared";
import evalsMessages from "../../../../../messages/en/evals.json";

import { KpiBanner } from "./KpiBanner";

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ evals: evalsMessages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

afterEach(() => {
  cleanup();
});

describe("KpiBanner", () => {
  it("renders nothing when delta is null (agent's first run, AC-15)", () => {
    const { container } = renderWithIntl(<KpiBanner delta={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when delta is undefined (loading)", () => {
    const { container } = renderWithIntl(<KpiBanner delta={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when all three deltas are exactly zero", () => {
    const delta: EvalKpiDeltaResponse = { recall: 0, precision: 0, citation_accuracy: 0 };
    const { container } = renderWithIntl(<KpiBanner delta={delta} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the largest-magnitude metric's direction/label when recall has the biggest change", () => {
    const delta: EvalKpiDeltaResponse = { recall: -0.3, precision: 0.1, citation_accuracy: 0.05 };
    renderWithIntl(<KpiBanner delta={delta} />);

    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByText(/Recall changed ▼/)).toBeInTheDocument();
    expect(screen.getByText("-30%")).toBeInTheDocument();
  });

  it("renders precision's direction/label when precision has the biggest change", () => {
    const delta: EvalKpiDeltaResponse = { recall: 0.05, precision: 0.4, citation_accuracy: -0.1 };
    renderWithIntl(<KpiBanner delta={delta} />);

    expect(screen.getByText(/Precision changed ▲/)).toBeInTheDocument();
    expect(screen.getByText("+40%")).toBeInTheDocument();
  });

  it("renders citation accuracy's direction/label when it has the biggest change", () => {
    const delta: EvalKpiDeltaResponse = { recall: 0.02, precision: -0.03, citation_accuracy: -0.5 };
    renderWithIntl(<KpiBanner delta={delta} />);

    expect(screen.getByText(/Citation accuracy changed ▼/)).toBeInTheDocument();
    expect(screen.getByText("-50%")).toBeInTheDocument();
  });
});
