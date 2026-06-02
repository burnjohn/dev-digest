import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../messages/en/ci.json";
import { ExportWizard } from "./ExportWizard";

// The wizard previews generated files via the API on step 2; stub fetch so the
// smoke test never touches the network.
vi.spyOn(global, "fetch").mockResolvedValue(
  new Response(JSON.stringify({ installation: {}, files: [], pr_url: null }), {
    status: 200,
    headers: { "content-type": "application/json" },
  }),
);

afterEach(cleanup);

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <NextIntlClientProvider locale="en" messages={{ ci: messages }}>
      <QueryClientProvider client={qc}>{ui}</QueryClientProvider>
    </NextIntlClientProvider>
  );
}

describe("A4 ExportWizard (smoke)", () => {
  it("renders the 4-step wizard with the Target step and CI targets", () => {
    render(wrap(<ExportWizard agentId="a1" agentName="Security Reviewer" onClose={() => {}} />));
    expect(screen.getByText("Export to CI")).toBeInTheDocument();
    // step labels from ExportWizardSteps
    expect(screen.getByText("Target")).toBeInTheDocument();
    expect(screen.getByText("Configure")).toBeInTheDocument();
    expect(screen.getByText("Install")).toBeInTheDocument();
    // target cards
    expect(screen.getByText("GitHub Actions")).toBeInTheDocument();
    expect(screen.getByText("CircleCI")).toBeInTheDocument();
  });

  it("advances to the Preview step after entering a repo", () => {
    render(wrap(<ExportWizard agentId="a1" defaultRepo="acme/payments-api" onClose={() => {}} />));
    fireEvent.click(screen.getByText("Continue"));
    expect(screen.getByText("FILES TO CREATE")).toBeInTheDocument();
  });
});
