import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { OnboardingTourSection } from "@devdigest/shared";
import onboardingMessages from "../../../../../../../messages/en/onboarding.json";
import { CriticalPathsSection } from "./CriticalPathsSection";

afterEach(cleanup);

function section(entries: OnboardingTourSection["entries"]): OnboardingTourSection {
  return {
    kind: "critical_paths",
    title: "Critical paths",
    body: "",
    diagram: null,
    entries,
    tasks: [],
    links: [],
  };
}

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ onboarding: onboardingMessages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("CriticalPathsSection — AC-8/AC-9 Open action gating", () => {
  it("renders the Open action when github_link is non-null", () => {
    const entries: OnboardingTourSection["entries"] = [
      { path: "src/checkout.ts", rationale: "handles payment flow", rank: null, github_link: "https://github.com/acme/app/blob/sha/src/checkout.ts" },
    ];
    renderWithIntl(<CriticalPathsSection section={section(entries)} />);
    const link = screen.getByRole("link", { name: /Open/ });
    expect(link).toHaveAttribute("href", "https://github.com/acme/app/blob/sha/src/checkout.ts");
  });

  it("does NOT render the Open action when github_link is null", () => {
    const entries: OnboardingTourSection["entries"] = [
      { path: "src/unresolvable.ts", rationale: "no blob url available", rank: null, github_link: null },
    ];
    renderWithIntl(<CriticalPathsSection section={section(entries)} />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("renders path and rationale for every entry", () => {
    const entries: OnboardingTourSection["entries"] = [
      { path: "src/a.ts", rationale: "rationale A", rank: null, github_link: null },
      { path: "src/b.ts", rationale: "rationale B", rank: null, github_link: "https://github.com/acme/app/blob/sha/src/b.ts" },
    ];
    renderWithIntl(<CriticalPathsSection section={section(entries)} />);
    expect(screen.getByText("src/a.ts")).toBeInTheDocument();
    expect(screen.getByText("rationale A")).toBeInTheDocument();
    expect(screen.getByText("src/b.ts")).toBeInTheDocument();
    expect(screen.getByText("rationale B")).toBeInTheDocument();
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });
});
