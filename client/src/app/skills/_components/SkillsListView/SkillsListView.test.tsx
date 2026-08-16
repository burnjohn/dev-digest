import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { SkillListItem } from "@devdigest/shared";
import messages from "../../../../../messages/en/skills.json";
import shellMessages from "../../../../../messages/en/shell.json";
import { ToastProvider } from "../../../../lib/toast";

const push = vi.fn();
const updateMutate = vi.fn();
let listState: {
  data?: SkillListItem[];
  isLoading: boolean;
  isError: boolean;
} = { data: [], isLoading: false, isError: false };

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  usePathname: () => "/skills",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("../../../../lib/hooks/skills", () => ({
  useSkills: () => ({ ...listState, refetch: vi.fn() }),
  useUpdateSkill: () => ({ mutate: updateMutate, isPending: false }),
  useCreateSkill: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

// The shell pulls repo/context data we don't care about here.
vi.mock("../../../../components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { SkillsListView } from "./SkillsListView";

const skill = (id: string, name: string, over: Partial<SkillListItem> = {}): SkillListItem => ({
  id,
  name,
  description: `desc for ${name}`,
  type: "rubric",
  source: "manual",
  body: "body",
  enabled: true,
  version: 1,
  evidence_files: null,
  used_by: 2,
  ...over,
});

afterEach(() => {
  cleanup();
  push.mockClear();
  updateMutate.mockClear();
  listState = { data: [], isLoading: false, isError: false };
});

function renderList() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages, shell: shellMessages }}>
      <ToastProvider>
        <SkillsListView />
      </ToastProvider>
    </NextIntlClientProvider>,
  );
}

describe("SkillsListView", () => {
  it("renders a card per skill with its type, source and usage", () => {
    listState = {
      data: [skill("s1", "uncovered-branch-gate"), skill("s2", "flaky-test-patterns")],
      isLoading: false,
      isError: false,
    };
    renderList();
    expect(screen.getByText("uncovered-branch-gate")).toBeInTheDocument();
    expect(screen.getByText("flaky-test-patterns")).toBeInTheDocument();
    expect(screen.getAllByText("2 agents")).toHaveLength(2);
    expect(screen.getAllByText("Manual")).toHaveLength(2);
  });

  it("labels an imported skill as File and nudges the user to read it", () => {
    listState = {
      data: [skill("s1", "imported-rule", { source: "imported_file", enabled: false })],
      isLoading: false,
      isError: false,
    };
    renderList();
    expect(screen.getByText("File")).toBeInTheDocument();
    expect(screen.getByText("unread")).toBeInTheDocument();
  });

  it("does not nudge for a workspace-authored skill", () => {
    listState = { data: [skill("s1", "local-rule")], isLoading: false, isError: false };
    renderList();
    expect(screen.queryByText("unread")).not.toBeInTheDocument();
  });

  it("shows the empty state only when the workspace has no skills", () => {
    renderList();
    expect(screen.getByText("No skills yet")).toBeInTheDocument();
  });

  it("distinguishes 'no match' from 'no skills'", () => {
    listState = { data: [skill("s1", "alpha")], isLoading: false, isError: false };
    renderList();

    fireEvent.change(screen.getByLabelText("Search skills…"), { target: { value: "zzz" } });
    expect(screen.getByText("No matching skills")).toBeInTheDocument();
    expect(screen.queryByText("No skills yet")).not.toBeInTheDocument();
  });

  it("filters on name", () => {
    listState = {
      data: [skill("s1", "alpha-rule"), skill("s2", "bravo-rule")],
      isLoading: false,
      isError: false,
    };
    renderList();
    fireEvent.change(screen.getByLabelText("Search skills…"), { target: { value: "bravo" } });
    expect(screen.queryByText("alpha-rule")).not.toBeInTheDocument();
    expect(screen.getByText("bravo-rule")).toBeInTheDocument();
  });

  it("links each card to the editor's config tab", () => {
    listState = { data: [skill("s1", "alpha-rule")], isLoading: false, isError: false };
    renderList();
    // A real <a href>, not a scripted click: middle-click, ⌘-click and "copy
    // link" all have to work, which router.push in an onClick breaks.
    expect(screen.getByRole("link", { name: "alpha-rule" })).toHaveAttribute(
      "href",
      "/skills/s1?tab=config",
    );
  });

  it("keeps the toggle OUT of the link, so it is separately reachable", () => {
    listState = { data: [skill("s1", "alpha-rule")], isLoading: false, isError: false };
    renderList();
    const toggle = screen.getByRole("switch", { name: /alpha-rule/ });
    expect(toggle.closest("a")).toBeNull();

    fireEvent.click(toggle);
    expect(updateMutate).toHaveBeenCalledWith({ id: "s1", patch: { enabled: false } });
    expect(push).not.toHaveBeenCalled();
  });

  it("surfaces a load failure instead of an empty state", () => {
    listState = { data: undefined, isLoading: false, isError: true };
    renderList();
    expect(screen.getByText("Could not load skills.")).toBeInTheDocument();
    expect(screen.queryByText("No skills yet")).not.toBeInTheDocument();
  });
});
