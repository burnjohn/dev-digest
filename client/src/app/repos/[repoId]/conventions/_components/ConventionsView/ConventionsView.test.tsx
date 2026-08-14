import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ConventionCandidate, ConventionScan } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/conventions.json";

const extractMutate = vi.fn();
const updateMutate = vi.fn();
let scan: ConventionScan | undefined;

const CANDIDATE_PENDING: ConventionCandidate = {
  id: "c1",
  category: "naming",
  rule: "Always use async/await instead of .then() chains.",
  evidence_path: "src/api/users.ts",
  evidence_start_line: 23,
  evidence_end_line: 31,
  evidence_snippet: "const user = await db.users.find(id);",
  confidence: 0.91,
  accepted: false,
};

const CANDIDATE_ACCEPTED: ConventionCandidate = {
  ...CANDIDATE_PENDING,
  id: "c2",
  rule: "Redis access goes through src/lib/redis.ts singleton.",
  accepted: true,
};

vi.mock("@/lib/hooks", () => ({
  useConventions: () => ({ data: scan, isLoading: false, isError: false, refetch: vi.fn() }),
  useExtractConventions: () => ({ mutate: extractMutate, isPending: false, isError: false }),
  useUpdateConvention: () => ({ mutate: updateMutate, isPending: false, variables: undefined }),
}));

vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({ activeRepo: { full_name: "acme/payments-api" } }),
  useRepoNotFound: () => false,
}));

vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("./CreateSkillModal", () => ({
  CreateSkillModal: ({ candidates }: { candidates: ConventionCandidate[] }) => (
    <div data-testid="create-skill-modal">{candidates.map((c) => c.rule).join(",")}</div>
  ),
}));

import { ConventionsView } from "./ConventionsView";

afterEach(() => {
  cleanup();
  extractMutate.mockClear();
  updateMutate.mockClear();
  scan = undefined;
});

function renderView() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ conventions: messages }}>
      <ConventionsView repoId="repo-1" />
    </NextIntlClientProvider>,
  );
}

describe("ConventionsView", () => {
  it("shows the empty state and triggers extraction from its CTA when never scanned", () => {
    scan = { sampled_files: 0, scanned_at: null, candidates: [] };
    renderView();
    expect(screen.getByText("No conventions extracted yet")).toBeInTheDocument();
    // "Run extraction" appears twice while empty: the header button and the
    // empty-state's own CTA. Either one triggers the same mutation.
    fireEvent.click(screen.getAllByText("Run extraction")[1]!);
    expect(extractMutate).toHaveBeenCalledTimes(1);
  });

  it("renders a card per candidate and the repo name in the heading", () => {
    scan = { sampled_files: 13, scanned_at: "2026-08-01T00:00:00.000Z", candidates: [CANDIDATE_PENDING, CANDIDATE_ACCEPTED] };
    renderView();
    expect(screen.getByText("payments-api")).toBeInTheDocument();
    expect(screen.getByText(CANDIDATE_PENDING.rule)).toBeInTheDocument();
    expect(screen.getByText(CANDIDATE_ACCEPTED.rule)).toBeInTheDocument();
  });

  it("only shows the bundle toolbar once at least one candidate is accepted", () => {
    scan = { sampled_files: 1, scanned_at: null, candidates: [CANDIDATE_PENDING] };
    renderView();
    expect(screen.queryByText("Deselect all")).not.toBeInTheDocument();

    scan = { sampled_files: 1, scanned_at: null, candidates: [CANDIDATE_ACCEPTED] };
    cleanup();
    renderView();
    expect(screen.getByText("Deselect all")).toBeInTheDocument();
    expect(screen.getByText("1 of 1 accepted")).toBeInTheDocument();
  });

  it("Deselect all empties the bundle and disables Create skill", () => {
    scan = { sampled_files: 1, scanned_at: null, candidates: [CANDIDATE_ACCEPTED] };
    renderView();
    fireEvent.click(screen.getByText("Deselect all"));
    expect(screen.getByText("0 of 1 accepted")).toBeInTheDocument();
    expect(screen.getByText("Create skill").closest("button")).toBeDisabled();
  });

  it("opens the create-skill modal with only the bundle-selected accepted candidates", () => {
    const secondAccepted: ConventionCandidate = { ...CANDIDATE_ACCEPTED, id: "c3", rule: "Second accepted rule." };
    scan = { sampled_files: 2, scanned_at: null, candidates: [CANDIDATE_ACCEPTED, secondAccepted] };
    renderView();

    // Deselect the second accepted candidate's bundle checkbox, keep the first.
    fireEvent.click(screen.getAllByRole("checkbox")[1]!);
    fireEvent.click(screen.getByText("Create skill"));

    const modal = screen.getByTestId("create-skill-modal");
    expect(modal.textContent).toBe(CANDIDATE_ACCEPTED.rule);
  });

  it("accepting a candidate calls update with accepted: true", () => {
    scan = { sampled_files: 1, scanned_at: null, candidates: [CANDIDATE_PENDING] };
    renderView();
    fireEvent.click(screen.getByText("Accept"));
    expect(updateMutate).toHaveBeenCalledWith({ id: CANDIDATE_PENDING.id, patch: { accepted: true } });
  });

  it("re-scan re-triggers extraction once candidates already exist", () => {
    scan = { sampled_files: 1, scanned_at: null, candidates: [CANDIDATE_PENDING] };
    renderView();
    fireEvent.click(screen.getByText("Re-scan"));
    expect(extractMutate).toHaveBeenCalledTimes(1);
  });
});
