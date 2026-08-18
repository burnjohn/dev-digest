import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Skill } from "@devdigest/shared";
import messages from "../../../../../messages/en/skills.json";
import { ToastProvider } from "../../../../lib/toast";

const updateSkill = vi.fn();
const deleteSkill = vi.fn();
const replace = vi.fn();
let urlParams = new URLSearchParams();

const SKILLS: Skill[] = [
  {
    id: "s1",
    name: "pr-quality-rubric",
    description: "Use when scoring a PR.",
    type: "rubric",
    source: "manual",
    body: "# Rubric\n\nScore honestly.",
    enabled: true,
    version: 1,
    evidence_files: null,
  },
  {
    id: "s2",
    name: "secret-leakage-gate",
    description: "Use when a diff touches config.",
    type: "security",
    source: "community",
    body: "# Gate\n\nFlag credentials.",
    enabled: false,
    version: 3,
    evidence_files: null,
  },
];

vi.mock("../../../../lib/hooks/skills", () => ({
  useSkills: () => ({ data: SKILLS, isLoading: false, isError: false, refetch: vi.fn() }),
  useUpdateSkill: () => ({ mutate: updateSkill, isPending: false }),
  useDeleteSkill: () => ({ mutate: deleteSkill, isPending: false }),
  useCreateSkill: () => ({ mutate: vi.fn(), isPending: false }),
  useImportSkillPreview: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSkillVersions: () => ({ data: [], isLoading: false, isError: false, refetch: vi.fn() }),
  useSkillStats: () => ({ data: undefined, isLoading: true, isError: false, refetch: vi.fn() }),
  useSkillAgentIds: () => ({ data: { agent_ids: [] } }),
}));

vi.mock("../../../../lib/hooks/agents", () => ({
  useAgents: () => ({ data: [] }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace }),
  useSearchParams: () => urlParams,
  usePathname: () => "/skills",
}));

import { SkillsListView } from "./SkillsListView";

afterEach(() => {
  cleanup();
  updateSkill.mockClear();
  deleteSkill.mockClear();
  replace.mockClear();
  urlParams = new URLSearchParams();
});

function renderPage() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      <ToastProvider>
        <SkillsListView />
      </ToastProvider>
    </NextIntlClientProvider>,
  );
}

// AppShell pulls in the whole nav chrome (repos, pulls, theme); the page's own
// behaviour is what is under test here.
vi.mock("../../../../components/app-shell", () => ({
  AppShell: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

describe("SkillsListView", () => {
  it("renders a row per skill", () => {
    renderPage();
    expect(screen.getByText("pr-quality-rubric")).toBeInTheDocument();
    expect(screen.getByText("secret-leakage-gate")).toBeInTheDocument();
  });

  it("badges a skill from an untrusted source as needing vetting", () => {
    renderPage();
    // Only the community-sourced one.
    expect(screen.getAllByText("needs vetting")).toHaveLength(1);
  });

  it("prompts for a selection until the URL names one", () => {
    renderPage();
    expect(screen.getByText("Select a skill")).toBeInTheDocument();
  });

  it("clicking a row navigates to it, defaulting to the config tab", () => {
    renderPage();
    fireEvent.click(screen.getByText("pr-quality-rubric"));
    expect(replace).toHaveBeenCalledWith("/skills?skill=s1&tab=config");
  });

  it("renders the selected skill's detail panel when the URL already names one", () => {
    urlParams = new URLSearchParams("skill=s1&tab=config");
    renderPage();
    expect(screen.queryByText("Select a skill")).not.toBeInTheDocument();
    expect(screen.getByText("Configuration")).toBeInTheDocument();
  });

  it("toggling a row's switch saves the enabled flag", () => {
    renderPage();
    // The fixture has exactly one enabled skill (s1), so this names the row it
    // acts on instead of trusting whichever switch renders first.
    fireEvent.click(screen.getByRole("switch", { checked: true }));
    expect(updateSkill).toHaveBeenCalledWith({ id: "s1", patch: { enabled: false } });
  });

  it("filters the list without touching the URL", () => {
    renderPage();
    fireEvent.change(screen.getByPlaceholderText("Search skills…"), {
      target: { value: "secret" },
    });
    expect(screen.queryByText("pr-quality-rubric")).not.toBeInTheDocument();
    expect(screen.getByText("secret-leakage-gate")).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it("completing a delete from the detail panel clears the URL selection", () => {
    urlParams = new URLSearchParams("skill=s1&tab=config");
    deleteSkill.mockImplementation((_id, opts) => opts?.onSuccess?.());
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderPage();

    fireEvent.click(screen.getByText("Delete skill"));

    expect(deleteSkill).toHaveBeenCalledWith("s1", expect.anything());
    // The `skill` param is dropped; `tab` (an unrelated part of the URL state)
    // is left untouched.
    expect(replace).toHaveBeenCalledWith("/skills?tab=config");
    vi.restoreAllMocks();
  });
});
