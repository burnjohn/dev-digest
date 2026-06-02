import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../../messages/en/eval.json";

vi.mock("../../../../../../../lib/hooks/eval", () => ({
  useEvalCase: () => ({ data: undefined }),
  useCreateEvalCase: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateEvalCase: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRunEvalCase: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import { EvalCaseEditor } from "./EvalCaseEditor";

afterEach(cleanup);

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("EvalCaseEditor (smoke)", () => {
  it("renders the new-case header + expected-output validity", () => {
    renderWithIntl(<EvalCaseEditor agentId="a1" caseId="new" />);
    expect(screen.getByText("New eval case")).toBeInTheDocument();
    expect(screen.getByText("Expected output")).toBeInTheDocument();
    expect(screen.getByText("valid JSON")).toBeInTheDocument();
  });
});
