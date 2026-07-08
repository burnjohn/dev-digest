import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { OnboardingTourRunMetadata } from "@devdigest/shared";
import onboardingMessages from "../../../../../../../messages/en/onboarding.json";
import { SectionCard } from "./SectionCard";

afterEach(cleanup);

function renderCard(run: OnboardingTourRunMetadata) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ onboarding: onboardingMessages }}>
      <SectionCard id="section-architecture" title="Architecture overview" icon="Layers" run={run}>
        <div>body content</div>
      </SectionCard>
    </NextIntlClientProvider>,
  );
}

const FULL: OnboardingTourRunMetadata = { status: "full", degraded: false, reason: null, mode: "full", llm_cost_cents: 12 };
const PARTIAL: OnboardingTourRunMetadata = { status: "partial", degraded: false, reason: "Partial scan", mode: "full", llm_cost_cents: 12 };
const DEGRADED: OnboardingTourRunMetadata = { status: "degraded", degraded: true, reason: "ripgrep fallback", mode: "full", llm_cost_cents: null };

describe("SectionCard — AC-11 degraded badge", () => {
  it("does NOT show a degraded badge when run is full and not degraded", () => {
    renderCard(FULL);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it('shows a degraded badge when run.status === "partial"', () => {
    renderCard(PARTIAL);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("shows a degraded badge when run.degraded === true", () => {
    renderCard(DEGRADED);
    const badge = screen.getByRole("status");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveAttribute("title", "ripgrep fallback");
  });

  it("toggles body visibility on header click (collapse/expand)", async () => {
    const user = userEvent.setup();
    renderCard(FULL);
    expect(screen.getByText("body content")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Architecture overview/ }));
    expect(screen.queryByText("body content")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Architecture overview/ }));
    expect(screen.getByText("body content")).toBeInTheDocument();
  });
});
