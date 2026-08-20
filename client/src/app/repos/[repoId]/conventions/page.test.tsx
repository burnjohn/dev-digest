import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ConventionCandidate, ConventionExtractResult } from "@devdigest/shared";
import messages from "../../../../../messages/en/conventions.json";

const extract = vi.fn();
const update = vi.fn();
const remove = vi.fn();
const draftSkill = vi.fn();
let candidates: ConventionCandidate[] = [];

vi.mock("next/navigation", () => ({
  useParams: () => ({ repoId: "r1" }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("../../../../components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("../../../../lib/repo-context", () => ({
  useActiveRepo: () => ({
    activeRepo: { id: "r1", full_name: "acme/payments-api", default_branch: "main" },
  }),
  useRepoNotFound: () => false,
}));

vi.mock("../../../../lib/hooks", () => ({
  useConventions: () => ({ data: candidates, isLoading: false, isError: false, refetch: vi.fn() }),
  useExtractConventions: () => ({ mutateAsync: extract, isPending: false }),
  useUpdateConvention: () => ({ mutate: update, isPending: false }),
  useDeleteConvention: () => ({ mutate: remove, isPending: false }),
  useConventionSkillDraft: () => ({ mutateAsync: draftSkill, isPending: false }),
}));

// The modal has its own hook graph; this page test only asserts that it opens.
vi.mock("./_components/CreateSkillModal", () => ({
  CreateSkillModal: ({ acceptedCount }: { acceptedCount: number }) => (
    <div>modal open · {acceptedCount} accepted</div>
  ),
}));

import ConventionsPage from "./page";
import { ToastProvider } from "../../../../lib/toast";

const candidate = (
  id: string,
  status: ConventionCandidate["status"],
  confidence = 0.8,
): ConventionCandidate => ({
  id,
  repo_id: "r1",
  category: "errors",
  rule: `rule ${id}`,
  rationale: null,
  evidence_path: "src/api/users.ts",
  evidence_line: 3,
  evidence_snippet: "throw new NotFoundError();",
  confidence,
  status,
  created_at: null,
});

const SCAN: ConventionExtractResult = {
  candidates: [candidate("a", "pending")],
  sampled_files: ["package.json", "src/api/users.ts"],
  proposed: 5,
  dropped_ungrounded: 3,
  dropped_duplicate: 1,
  model: "gpt-4.1",
  cost_usd: 0.004,
};

function renderPage() {
  render(
    <NextIntlClientProvider locale="en" messages={{ conventions: messages }}>
      <ToastProvider>
        <ConventionsPage />
      </ToastProvider>
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  candidates = [];
  extract.mockReset();
  update.mockReset();
  draftSkill.mockReset();
});
afterEach(cleanup);

describe("ConventionsPage", () => {
  it("offers a first scan when the repo has no candidates yet", () => {
    renderPage();
    expect(screen.getByText("No conventions extracted yet")).toBeInTheDocument();
    // Two entry points on purpose: the header button and the empty-state CTA.
    expect(screen.getAllByText("Run extraction")).toHaveLength(2);
  });

  it("reports what the evidence gate dropped, so a thin result reads as the gate working", async () => {
    extract.mockResolvedValue(SCAN);
    renderPage();
    fireEvent.click(screen.getAllByText("Run extraction")[0]!);
    await waitFor(() => expect(extract).toHaveBeenCalledWith("r1"));
    expect(
      await screen.findByText(/3 dropped without evidence, 1 already decided/),
    ).toBeInTheDocument();
  });

  it("filters by triage state and counts each one", () => {
    candidates = [candidate("a", "pending"), candidate("b", "accepted", 0.9), candidate("c", "rejected")];
    renderPage();

    // Pending is the default view: one card, and the accepted one is not shown.
    expect(screen.getByText("rule a")).toBeInTheDocument();
    expect(screen.queryByText("rule b")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Accepted"));
    expect(screen.getByText("rule b")).toBeInTheDocument();
    expect(screen.queryByText("rule a")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("All"));
    expect(screen.getByText("rule c")).toBeInTheDocument();
  });

  it("accepting a candidate patches only that row", () => {
    candidates = [candidate("a", "pending")];
    renderPage();
    fireEvent.click(screen.getByText("Accept"));
    expect(update).toHaveBeenCalledWith({ repoId: "r1", id: "a", patch: { status: "accepted" } });
  });

  it("cannot create a skill until something is accepted", () => {
    candidates = [candidate("a", "pending")];
    renderPage();
    expect(screen.getByText("Create skill").closest("button")).toBeDisabled();
  });

  it("opens the skill modal with the accepted count once one is accepted", async () => {
    candidates = [candidate("a", "accepted")];
    draftSkill.mockResolvedValue({
      name: "payments-api-conventions",
      description: "1 house convention",
      type: "convention",
      body: "# body",
      evidence_files: ["src/api/users.ts"],
      convention_ids: ["a"],
    });
    renderPage();

    fireEvent.click(screen.getByText("Create skill"));
    await waitFor(() =>
      expect(draftSkill).toHaveBeenCalledWith({ repoId: "r1", conventionIds: ["a"] }),
    );
    expect(await screen.findByText(/modal open · 1 accepted/)).toBeInTheDocument();
  });

  it("builds the skill from the SELECTED accepted subset, so one board can yield several skills", async () => {
    candidates = [candidate("a", "accepted", 0.9), candidate("b", "accepted", 0.8)];
    draftSkill.mockResolvedValue({ name: "x", description: "", type: "convention", body: "#", evidence_files: [], convention_ids: ["a"] });
    renderPage();
    fireEvent.click(screen.getByText("Accepted"));

    // Both start selected; dropping one leaves the other as the skill's content.
    expect(screen.getByText("2 of 2 accepted selected")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("checkbox")[1]!);
    expect(screen.getByText("1 of 2 accepted selected")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Create skill"));
    await waitFor(() =>
      expect(draftSkill).toHaveBeenCalledWith({ repoId: "r1", conventionIds: ["a"] }),
    );
  });

  it("Deselect all disables Create skill — an empty skill is not a skill", () => {
    candidates = [candidate("a", "accepted"), candidate("b", "accepted")];
    renderPage();
    fireEvent.click(screen.getByText("Deselect all"));
    expect(screen.getByText("0 of 2 accepted selected")).toBeInTheDocument();
    expect(screen.getByText("Create skill").closest("button")).toBeDisabled();
  });

  it("links each candidate's evidence to the real file on GitHub", () => {
    candidates = [candidate("a", "pending")];
    renderPage();
    expect(screen.getByRole("link", { name: /src\/api\/users\.ts:3/ })).toHaveAttribute(
      "href",
      "https://github.com/acme/payments-api/blob/main/src/api/users.ts#L3",
    );
  });
});
