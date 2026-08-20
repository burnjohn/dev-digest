/**
 * The badge's job is to be honest about missing data in two different layouts.
 * `compact` must show "—" rather than a made-up zero; `withTokens` must drop the
 * cost segment entirely when the model is unpriced, instead of printing "· —"
 * on every such row.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../messages/en/runs.json";
import { RunCostBadge } from "./RunCostBadge";

afterEach(cleanup);

function renderBadge(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ runs: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("RunCostBadge — compact (PR list column)", () => {
  it("shows the cost", () => {
    renderBadge(<RunCostBadge cost={0.014} />);
    expect(screen.getByText("$0.014")).toBeInTheDocument();
  });

  it("shows an em dash when there is no cost", () => {
    renderBadge(<RunCostBadge cost={null} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});

describe("RunCostBadge — withTokens (PR detail timeline)", () => {
  it("pairs the token count with the cost", () => {
    const { container } = renderBadge(
      <RunCostBadge variant="withTokens" tokens={9119} cost={0.0013} />,
    );
    expect(container.textContent).toBe("9 119 tok · $0.0013");
  });

  it("omits the cost segment when the model is unpriced", () => {
    const { container } = renderBadge(
      <RunCostBadge variant="withTokens" tokens={9119} cost={null} />,
    );
    expect(container.textContent).toBe("9 119 tok");
    expect(container.textContent).not.toContain("—");
  });

  it("renders nothing when there is neither tokens nor cost", () => {
    const { container } = renderBadge(
      <RunCostBadge variant="withTokens" tokens={0} cost={null} />,
    );
    expect(container.textContent).toBe("");
  });
});
