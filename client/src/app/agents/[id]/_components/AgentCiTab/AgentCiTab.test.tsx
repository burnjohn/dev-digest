import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../messages/en/ci.json";

vi.mock("../../../../ci-runs/_components/ExportWizard", () => ({
  ExportWizard: () => <div>export-wizard</div>,
}));

vi.mock("../../../../../lib/hooks/ci", () => ({
  useCiInstallations: () => ({ data: [] }),
}));

import { AgentCiTab } from "./AgentCiTab";

afterEach(cleanup);

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ ci: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("AgentCiTab (smoke)", () => {
  it("renders the CI heading + empty state", () => {
    renderWithIntl(<AgentCiTab agentId="a1" />);
    expect(screen.getByText("Continuous Integration")).toBeInTheDocument();
    expect(screen.getByText("Export to CI")).toBeInTheDocument();
  });
});
