/**
 * The PR body is markdown and must render as markdown — it used to be dumped as
 * pre-wrapped text, so a description full of `##`, tables and fenced code read
 * as source.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../../messages/en/prReview.json";
import { OverviewTab } from "./OverviewTab";

afterEach(cleanup);

function renderBody(prBody: string | null) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      <OverviewTab prBody={prBody} />
    </NextIntlClientProvider>,
  );
}

describe("OverviewTab — description", () => {
  it("renders markdown structure, not the source text", () => {
    const { container } = renderBody("## Heading\n\nSome **bold** text.\n\n- one\n- two");

    expect(screen.getByRole("heading", { name: "Heading" })).toBeInTheDocument();
    expect(container.querySelector("strong")).toHaveTextContent("bold");
    expect(container.querySelectorAll("li")).toHaveLength(2);
    // The literal markers must be gone, not merely styled.
    expect(screen.queryByText(/## Heading/)).not.toBeInTheDocument();
  });

  it("renders GFM tables and fenced code", () => {
    const { container } = renderBody(
      "| A | B |\n|---|---|\n| 1 | 2 |\n\n```js\nconst x = 1;\n```",
    );

    expect(container.querySelector("table")).toBeInTheDocument();
    expect(container.querySelectorAll("th")).toHaveLength(2);
    expect(container.querySelector("pre code")).toHaveTextContent("const x = 1;");
  });

  it("renders nothing when the PR has no body", () => {
    const { container } = renderBody(null);
    expect(container).toBeEmptyDOMElement();
  });
});
