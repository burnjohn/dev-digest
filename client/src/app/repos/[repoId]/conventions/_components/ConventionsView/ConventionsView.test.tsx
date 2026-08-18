import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type {
  ConventionCandidate,
  ConventionListResult,
  ConventionSkillDraft,
} from "@devdigest/shared";
import messages from "../../../../../../../messages/en/conventions.json";
import skillsMessages from "../../../../../../../messages/en/skills.json";

const push = vi.fn();
const extractMutate = vi.fn();
const updateMutate = vi.fn();
const patchMutateAsync = vi.fn().mockResolvedValue({});
const createMutateAsync = vi.fn().mockResolvedValue({ id: "new-skill-id" });
const linkMutateAsync = vi.fn().mockResolvedValue({ ok: true });

let listState: {
  data?: ConventionListResult;
  isLoading: boolean;
  isError: boolean;
} = { data: { candidates: [], last_scan: null }, isLoading: false, isError: false };
let draftState: { data?: ConventionSkillDraft; isLoading: boolean } = {
  data: undefined,
  isLoading: true,
};

vi.mock("next/navigation", () => ({
  useParams: () => ({ repoId: "r1" }),
  useRouter: () => ({ push, replace: vi.fn() }),
  usePathname: () => "/repos/r1/conventions",
  useSearchParams: () => new URLSearchParams(),
}));

// The hook boundary is the mock point, never global fetch (client/INSIGHTS.md).
vi.mock("../../../../../../lib/hooks/conventions", () => ({
  useConventions: () => ({ ...listState, error: undefined, refetch: vi.fn() }),
  useExtractConventions: () => ({ mutate: extractMutate, isPending: false }),
  useUpdateConvention: () => ({
    mutate: updateMutate,
    mutateAsync: patchMutateAsync,
    isPending: false,
  }),
  useSkillDraft: () => draftState,
  useLinkConventionsToSkill: () => ({ mutateAsync: linkMutateAsync, isPending: false }),
}));

vi.mock("../../../../../../lib/hooks/skills", () => ({
  useCreateSkill: () => ({ mutateAsync: createMutateAsync, isPending: false }),
}));

vi.mock("../../../../../../components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("../../../../../../lib/repo-context", () => ({
  useActiveRepo: () => ({ activeRepo: { id: "r1", full_name: "acme/payments-api" } }),
  useRepoNotFound: () => false,
}));

import { ConventionsView } from "./ConventionsView";

const candidate = (over: Partial<ConventionCandidate> = {}): ConventionCandidate => ({
  id: "c1",
  category: "async",
  rule: "Always use async/await instead of .then() chains",
  rationale: null,
  evidence_path: "src/api/users.ts",
  evidence_snippet: "const user = await db.users.find(id);",
  evidence_start_line: 23,
  evidence_end_line: 31,
  support_count: 6,
  support_files: ["src/api/users.ts"],
  confidence: 0.91,
  status: "pending",
  skill_id: null,
  ...over,
});

const draft: ConventionSkillDraft = {
  name: "payments-api-conventions",
  description: "2 house conventions extracted from payments-api",
  type: "convention",
  body:
    "# payments-api-conventions\n\n## async-await-then-chains\nAlways use async/await.\n\n" +
    "## redis-singleton\nRedis access goes through the singleton.\n",
  evidence_files: ["src/api/users.ts", "src/lib/redis.ts"],
};

afterEach(() => {
  cleanup();
  push.mockClear();
  extractMutate.mockClear();
  updateMutate.mockClear();
  createMutateAsync.mockClear();
  linkMutateAsync.mockClear();
  listState = { data: { candidates: [], last_scan: null }, isLoading: false, isError: false };
  draftState = { data: undefined, isLoading: true };
});

function renderView() {
  return render(
    <NextIntlClientProvider
      locale="en"
      messages={{ conventions: messages, skills: skillsMessages }}
    >
      <ConventionsView />
    </NextIntlClientProvider>,
  );
}

describe("ConventionsView", () => {
  it("shows the empty state, and its CTA starts a scan", () => {
    renderView();
    expect(screen.getByText("No conventions extracted yet")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Run extraction" }));
    expect(extractMutate).toHaveBeenCalledTimes(1);
  });

  it("surfaces a load failure instead of an empty state", () => {
    listState = { data: undefined, isLoading: false, isError: true };
    renderView();
    expect(screen.getByText("Could not load conventions.")).toBeInTheDocument();
    expect(screen.queryByText("No conventions extracted yet")).not.toBeInTheDocument();
  });

  it("ranks candidates by confidence regardless of category, and reports the last scan", () => {
    listState = {
      data: {
        candidates: [
          // Deliberately weakest-first AND in the old fixed category order, so a
          // regression back to category grouping would render these unchanged.
          candidate({ confidence: 0.4 }),
          candidate({
            id: "c2",
            category: "structure",
            rule: "Redis goes through the singleton",
            confidence: 0.93,
          }),
        ],
        last_scan: {
          sampled_files: 84,
          selected_files: 8,
          raw_candidates: 9,
          dropped_ungrounded: 2,
          dropped_unsupported: 3,
          dropped_duplicate: 1,
          counted_files: 200,
          counted_symbols: 1840,
          model: "openai/gpt-4o-mini",
          cost_usd: 0.004,
          created_at: new Date(Date.now() - 3_600_000).toISOString(),
        },
      },
      isLoading: false,
      isError: false,
    };
    renderView();

    // The category survives as a chip on each card, not as a section heading.
    expect(screen.getByText("Async")).toBeInTheDocument();
    expect(screen.getByText("Structure")).toBeInTheDocument();

    // 93% outranks 40% even though `naming`/`async` used to sort above `structure`.
    const rules = screen.getAllByText(/Redis goes through the singleton|Always use async\/await/);
    expect(rules[0]).toHaveTextContent("Redis goes through the singleton");

    expect(screen.getByText("Detected from 84 sample files · last scan 1h ago")).toBeInTheDocument();
    // All three gates' drop counts are stated, not hidden behind the surviving count.
    expect(
      // "already on the list", not "dropped": a re-scan merges into the existing
      // list, so a duplicate is a rule we already have — not one thrown away.
      screen.getByText("2 dropped as ungrounded · 3 dropped as unsupported · 1 already on the list"),
    ).toBeInTheDocument();
  });

  it("accepts and rejects through the update hook", () => {
    listState = {
      data: { candidates: [candidate()], last_scan: null },
      isLoading: false,
      isError: false,
    };
    renderView();

    fireEvent.click(screen.getByRole("button", { name: /^Accept — / }));
    expect(updateMutate).toHaveBeenCalledWith({ id: "c1", patch: { status: "accepted" } });

    fireEvent.click(screen.getByRole("button", { name: /^Reject — / }));
    expect(updateMutate).toHaveBeenCalledWith({ id: "c1", patch: { status: "rejected" } });
  });

  it("counts accepted over the un-rejected total, excluding rejects", () => {
    listState = {
      data: {
        candidates: [
          candidate({ id: "c1", status: "accepted" }),
          candidate({ id: "c2", status: "pending" }),
          candidate({ id: "c3", status: "rejected" }),
        ],
        last_scan: null,
      },
      isLoading: false,
      isError: false,
    };
    renderView();
    expect(screen.getByText("1 of 2 accepted")).toBeInTheDocument();
  });

  it("deselect-all returns accepted rows to pending, never to rejected", () => {
    listState = {
      data: {
        candidates: [
          candidate({ id: "c1", status: "accepted" }),
          candidate({ id: "c2", status: "accepted" }),
        ],
        last_scan: null,
      },
      isLoading: false,
      isError: false,
    };
    renderView();

    fireEvent.click(screen.getByRole("button", { name: "Deselect all" }));
    expect(updateMutate).toHaveBeenCalledTimes(2);
    expect(updateMutate).toHaveBeenCalledWith({ id: "c1", patch: { status: "pending" } });
    expect(updateMutate).toHaveBeenCalledWith({ id: "c2", patch: { status: "pending" } });
  });

  it("cannot open the modal with nothing accepted", () => {
    listState = {
      data: { candidates: [candidate()], last_scan: null },
      isLoading: false,
      isError: false,
    };
    renderView();
    expect(screen.getByRole("button", { name: "Create skill" })).toBeDisabled();
  });

  it("opens the modal with the server-composed merged body", async () => {
    listState = {
      data: { candidates: [candidate({ status: "accepted" })], last_scan: null },
      isLoading: false,
      isError: false,
    };
    draftState = { data: draft, isLoading: false };
    renderView();

    fireEvent.click(screen.getByRole("button", { name: "Create skill" }));

    expect(await screen.findByText("Create skill from conventions")).toBeInTheDocument();
    expect(screen.getByLabelText(/^Name/)).toHaveValue("payments-api-conventions");
    // The merged body is what the user edits — one section per accepted rule.
    const body = screen.getByLabelText(/^Skill body/) as HTMLTextAreaElement;
    expect(body.value).toContain("## async-await-then-chains");
    expect(body.value).toContain("## redis-singleton");
  });

  it("saving creates the skill, stamps provenance, then lands on its Config tab", async () => {
    listState = {
      data: { candidates: [candidate({ status: "accepted" })], last_scan: null },
      isLoading: false,
      isError: false,
    };
    draftState = { data: draft, isLoading: false };
    renderView();
    fireEvent.click(screen.getByRole("button", { name: "Create skill" }));
    await screen.findByText("Create skill from conventions");

    // The modal's own submit, not the toolbar button that opened it.
    fireEvent.click(screen.getAllByRole("button", { name: "Create skill" })[1]!);

    await waitFor(() =>
      expect(createMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "payments-api-conventions",
          type: "convention",
          // The existing skills endpoint, flagged as extracted — not a new one.
          source: "extracted",
          evidence_files: draft.evidence_files,
        }),
      ),
    );
    await waitFor(() =>
      expect(linkMutateAsync).toHaveBeenCalledWith({ ids: ["c1"], skill_id: "new-skill-id" }),
    );
    // Same destination as the from-scratch create path, so both behave alike.
    await waitFor(() => expect(push).toHaveBeenCalledWith("/skills/new-skill-id?tab=config"));
  });

  it("still navigates when the provenance stamp fails — the skill is already saved", async () => {
    linkMutateAsync.mockRejectedValueOnce(new Error("boom"));
    listState = {
      data: { candidates: [candidate({ status: "accepted" })], last_scan: null },
      isLoading: false,
      isError: false,
    };
    draftState = { data: draft, isLoading: false };
    renderView();
    fireEvent.click(screen.getByRole("button", { name: "Create skill" }));
    await screen.findByText("Create skill from conventions");
    fireEvent.click(screen.getAllByRole("button", { name: "Create skill" })[1]!);

    await waitFor(() => expect(push).toHaveBeenCalledWith("/skills/new-skill-id?tab=config"));
  });
});
