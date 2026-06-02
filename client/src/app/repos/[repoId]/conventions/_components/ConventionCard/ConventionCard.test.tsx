import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ConventionCandidate } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/conventions.json";
import { ConventionCard } from "./ConventionCard";

afterEach(cleanup);

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ conventions: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

const CANDIDATE: ConventionCandidate = {
  id: "c1",
  rule: "Wrap fetch calls in withTimeout",
  evidence_path: "src/platform/resilience.ts",
  evidence_snippet: "export function withTimeout(...)",
  confidence: 0.9,
  accepted: false,
};

describe("ConventionCard (smoke)", () => {
  it("renders the rule, evidence and Accept action", () => {
    const onAccept = vi.fn();
    renderWithIntl(<ConventionCard c={CANDIDATE} onAccept={onAccept} accepting={false} />);
    expect(screen.getByText("Wrap fetch calls in withTimeout")).toBeInTheDocument();
    expect(screen.getByText("src/platform/resilience.ts")).toBeInTheDocument();
    const btn = screen.getByText("Accept as Skill");
    fireEvent.click(btn);
    expect(onAccept).toHaveBeenCalled();
  });

  it("shows the accepted state", () => {
    renderWithIntl(<ConventionCard c={{ ...CANDIDATE, accepted: true }} onAccept={() => {}} accepting={false} />);
    expect(screen.getByText("Accepted")).toBeInTheDocument();
  });
});
