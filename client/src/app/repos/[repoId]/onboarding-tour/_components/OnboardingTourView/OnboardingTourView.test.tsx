import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { OnboardingTour } from "@devdigest/shared";
import onboardingMessages from "../../../../../../../messages/en/onboarding.json";
import { ApiError } from "@/lib/api";

// ---- Mocks -----------------------------------------------------------------

vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/repo-not-found", () => ({
  RepoNotFound: () => <div>Repo not found</div>,
}));

vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({
    activeRepo: { id: "repo1", full_name: "acme/widgets" },
    repos: [{ id: "repo1", full_name: "acme/widgets" }],
    reposLoaded: true,
  }),
  useRepoNotFound: () => false,
}));

let tourData: OnboardingTour | undefined;
let isLoading = false;
let isError = false;
const refetch = vi.fn();
const generateMutate = vi.fn();
let generateIsPending = false;
let generateIsError = false;
let generateError: unknown = null;
const resyncMutate = vi.fn();
let resyncIsPending = false;

vi.mock("@/lib/hooks/onboarding", async () => {
  const actual = await vi.importActual<typeof import("@/lib/hooks/onboarding")>("@/lib/hooks/onboarding");
  return {
    ...actual,
    useOnboardingTour: () => ({ data: tourData, isLoading, isError, refetch }),
    useGenerateOnboardingTour: () => ({
      mutate: generateMutate,
      isPending: generateIsPending,
      isError: generateIsError,
      error: generateError,
    }),
  };
});

vi.mock("@/lib/hooks/repo-intel", () => ({
  useResyncRepoIntel: () => ({ mutate: resyncMutate, isPending: resyncIsPending }),
}));

const writeText = vi.fn().mockResolvedValue(undefined);

import { OnboardingTourView } from "./OnboardingTourView";

beforeEach(() => {
  if (!navigator.clipboard) {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
  } else {
    vi.spyOn(navigator.clipboard, "writeText").mockImplementation(writeText);
  }
});

afterEach(() => {
  cleanup();
  tourData = undefined;
  isLoading = false;
  isError = false;
  refetch.mockClear();
  generateMutate.mockClear();
  generateIsPending = false;
  generateIsError = false;
  generateError = null;
  resyncMutate.mockClear();
  resyncIsPending = false;
  writeText.mockClear();
});

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ onboarding: onboardingMessages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

function section(kind: OnboardingTour["sections"][number]["kind"], overrides: Partial<OnboardingTour["sections"][number]> = {}): OnboardingTour["sections"][number] {
  return {
    kind,
    title: kind,
    body: `body for ${kind}`,
    diagram: null,
    entries: [],
    tasks: [],
    links: [],
    ...overrides,
  };
}

function tour(overrides: Partial<OnboardingTour> = {}): OnboardingTour {
  return {
    repo_id: "11111111-1111-1111-1111-111111111111",
    generated_at: "2026-07-03T12:00:00.000Z",
    run: { status: "full", degraded: false, reason: null, mode: "full", llm_cost_cents: 12 },
    sections: [
      section("architecture"),
      section("critical_paths"),
      section("how_to_run"),
      section("reading_path"),
      section("first_tasks"),
    ],
    ...overrides,
  };
}

describe("OnboardingTourView", () => {
  it("renders 5 sections in TOC + body order (AC-1)", () => {
    tourData = tour();
    renderWithIntl(<OnboardingTourView repoId="repo1" />);

    const tocLinks = screen.getAllByRole("link").filter((l) => l.getAttribute("href")?.startsWith("#section-"));
    expect(tocLinks.map((l) => l.getAttribute("href"))).toEqual([
      "#section-architecture",
      "#section-critical_paths",
      "#section-how_to_run",
      "#section-reading_path",
      "#section-first_tasks",
    ]);

    // Body order: 5 SectionCard headers present, in DOM order.
    const headers = screen.getAllByRole("button", {
      name: /Architecture overview|Critical paths|How to run locally|Guided reading path|First tasks/,
    });
    expect(headers).toHaveLength(5);
    expect(headers.map((h) => h.textContent)).toEqual([
      expect.stringContaining("Architecture overview"),
      expect.stringContaining("Critical paths"),
      expect.stringContaining("How to run locally"),
      expect.stringContaining("Guided reading path"),
      expect.stringContaining("First tasks"),
    ]);
  });

  it("persisted tour on mount does NOT call the generate mutation (AC-2)", () => {
    tourData = tour();
    renderWithIntl(<OnboardingTourView repoId="repo1" />);
    expect(generateMutate).not.toHaveBeenCalled();
  });

  it("Regenerate click calls the generate mutation (AC-3)", async () => {
    tourData = tour();
    const user = userEvent.setup();
    renderWithIntl(<OnboardingTourView repoId="repo1" />);
    await user.click(screen.getByRole("button", { name: "Regenerate" }));
    expect(generateMutate).toHaveBeenCalledTimes(1);
  });

  it("shows a non-blocking in-progress indicator while the generate mutation is pending, keeping stale data visible", () => {
    tourData = tour();
    generateIsPending = true;
    renderWithIntl(<OnboardingTourView repoId="repo1" />);
    expect(screen.getByText("Generating…")).toBeInTheDocument();
    // Previously loaded data stays rendered.
    expect(screen.getByText("body for architecture")).toBeInTheDocument();
  });

  it("lite/no-index state shows the Clone & index CTA, which posts to /resync (AC-10)", async () => {
    tourData = tour({
      generated_at: null,
      run: { status: "degraded", degraded: true, reason: null, mode: "lite", llm_cost_cents: null },
    });
    const user = userEvent.setup();
    renderWithIntl(<OnboardingTourView repoId="repo1" />);
    const cta = screen.getByRole("button", { name: "Clone & index for full tour" });
    await user.click(cta);
    expect(resyncMutate).toHaveBeenCalledTimes(1);
  });

  it("Share link calls the clipboard with the current URL (AC-15)", async () => {
    tourData = tour();
    const user = userEvent.setup();
    renderWithIntl(<OnboardingTourView repoId="repo1" />);
    await user.click(screen.getByRole("button", { name: "Share link" }));
    expect(writeText).toHaveBeenCalledWith(window.location.href);
  });

  it('shows a distinct "please wait" message on a 429 generate error (AC-16)', () => {
    tourData = tour();
    generateIsError = true;
    generateError = new ApiError("Too many requests", 429);
    renderWithIntl(<OnboardingTourView repoId="repo1" />);
    expect(screen.getByText(/generating tours too quickly/)).toBeInTheDocument();
  });

  it("mutation error keeps last-good data + shows retry, retry re-invokes mutate (AC-18)", async () => {
    tourData = tour();
    generateIsError = true;
    generateError = new ApiError("Internal error", 500);
    const user = userEvent.setup();
    renderWithIntl(<OnboardingTourView repoId="repo1" />);

    // Last-good data still rendered.
    expect(screen.getByText("body for architecture")).toBeInTheDocument();
    // Generic error banner (not the 429 message) + Retry button.
    expect(screen.getByText("Couldn’t regenerate the onboarding tour")).toBeInTheDocument();
    const retryBtn = screen.getByRole("button", { name: "Retry" });
    await user.click(retryBtn);
    expect(generateMutate).toHaveBeenCalledTimes(1);
  });

  it("shows the load-error state with retry when the initial fetch fails", async () => {
    isError = true;
    const user = userEvent.setup();
    renderWithIntl(<OnboardingTourView repoId="repo1" />);
    expect(screen.getByText("Couldn’t load the onboarding tour")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Retry/ }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
