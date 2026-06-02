import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Onboarding } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/onboarding.json";

const ONBOARDING: Onboarding = {
  sections: [
    { kind: "overview", title: "Overview", body: "What it does.", diagram: null, links: [] },
    { kind: "architecture", title: "Architecture", body: "How it fits.", diagram: null, links: [] },
  ],
};

vi.mock("next/navigation", () => ({
  useParams: () => ({ repoId: "r1" }),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
}));
vi.mock("../../../../../../components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("../../../../../../lib/repo-context", () => ({
  useActiveRepo: () => ({ activeRepo: { full_name: "octo/repo" } }),
}));
vi.mock("../../../../../../lib/hooks/onboarding", () => ({
  useOnboarding: () => ({ data: ONBOARDING, isLoading: false, isError: false, error: undefined }),
  useGenerateOnboarding: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { OnboardingTourView } from "./OnboardingTourView";

afterEach(cleanup);

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ onboarding: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("OnboardingTourView (smoke)", () => {
  it("renders translated title, section count + section cards", () => {
    renderWithIntl(<OnboardingTourView />);
    expect(screen.getAllByText("Onboarding Tour").length).toBeGreaterThan(0);
    expect(screen.getByText("2 sections")).toBeInTheDocument();
    expect(screen.getAllByText("Overview").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Architecture").length).toBeGreaterThan(0);
  });
});
