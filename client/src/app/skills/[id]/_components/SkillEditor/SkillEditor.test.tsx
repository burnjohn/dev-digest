import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, within, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Skill } from "@devdigest/shared";
import messages from "../../../../../../messages/en/skills.json";
import { ToastProvider } from "../../../../../lib/toast";

const updateMutate = vi.fn();
const versions = vi.fn(() => ({
  data: [
    { skill_id: "sk1", version: 2, body: "second body", created_at: "2026-08-16T10:00:00.000Z" },
    { skill_id: "sk1", version: 1, body: "first body", created_at: "2026-08-15T10:00:00.000Z" },
  ],
  isLoading: false,
  isError: false,
  refetch: vi.fn(),
}));

// The app router is not mounted under jsdom; the editor only uses it to
// navigate away after a delete.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

// Mock at the hook boundary, as AgentEditor.test.tsx does — no query client,
// no network.
vi.mock("../../../../../lib/hooks/skills", () => ({
  useUpdateSkill: () => ({ mutate: updateMutate, mutateAsync: vi.fn(), isPending: false }),
  useDeleteSkill: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSkillVersions: () => versions(),
}));

import { SkillEditor } from "./SkillEditor";

afterEach(() => {
  cleanup();
  updateMutate.mockClear();
});

const SKILL: Skill = {
  id: "sk1",
  name: "uncovered-branch-gate",
  description: "Flags a new branch with no test",
  type: "rubric",
  source: "manual",
  body: "# Uncovered branch gate\n\nEvery new branch needs a test.",
  enabled: true,
  version: 2,
  evidence_files: null,
};

function renderEditor(tab: string, skill: Skill = SKILL, usedBy = 1) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      <ToastProvider>
        <SkillEditor skill={skill} usedBy={usedBy} tab={tab} onTab={() => {}} />
      </ToastProvider>
    </NextIntlClientProvider>,
  );
}

describe("SkillEditor — Config tab", () => {
  it("renders the fields and the body editor's filename strip", () => {
    renderEditor("config");
    expect(screen.getByText("Configuration")).toBeInTheDocument();
    expect(screen.getByDisplayValue("uncovered-branch-gate")).toBeInTheDocument();
    expect(screen.getByText("uncovered-branch-gate.md")).toBeInTheDocument();
  });

  it("disables Save until something changes, then enables it", () => {
    renderEditor("config");
    const save = screen.getByRole("button", { name: "Save skill" });
    expect(save).toBeDisabled();

    fireEvent.change(screen.getByDisplayValue("uncovered-branch-gate"), {
      target: { value: "uncovered-branch-gate-v2" },
    });
    expect(save).toBeEnabled();
  });

  it("keeps Save disabled when the name is cleared — name is required", () => {
    renderEditor("config");
    fireEvent.change(screen.getByDisplayValue("uncovered-branch-gate"), {
      target: { value: "   " },
    });
    expect(screen.getByRole("button", { name: "Save skill" })).toBeDisabled();
  });

  it("shows the unsaved chip only after the BODY is edited", () => {
    renderEditor("config");
    // A name edit is dirty, but it is not a body edit — no chip.
    fireEvent.change(screen.getByDisplayValue("uncovered-branch-gate"), {
      target: { value: "renamed" },
    });
    expect(screen.queryByText("unsaved")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Skill body"), {
      target: { value: SKILL.body + " more" },
    });
    expect(screen.getByText("unsaved")).toBeInTheDocument();
  });

  it("blocks Save when the body exceeds the 8000-char cap", () => {
    renderEditor("config");
    fireEvent.change(screen.getByLabelText("Skill body"), {
      target: { value: "a".repeat(8_001) },
    });
    expect(screen.getByRole("button", { name: "Save skill" })).toBeDisabled();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("toggling Enabled saves immediately without touching the version", () => {
    renderEditor("config");
    fireEvent.click(screen.getByRole("switch", { name: "Enabled" }));
    expect(updateMutate).toHaveBeenCalledWith({ id: "sk1", patch: { enabled: false } });
  });

  it("warns how many agents lose the skill before deleting it", () => {
    renderEditor("config", SKILL, 3);
    fireEvent.click(screen.getByRole("button", { name: "Delete skill" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/3 agents/)).toBeInTheDocument();
  });

  it("omits the unlink warning when nothing links the skill", () => {
    renderEditor("config", SKILL, 0);
    fireEvent.click(screen.getByRole("button", { name: "Delete skill" }));
    expect(screen.queryByText(/will be unlinked/)).not.toBeInTheDocument();
  });
});

describe("SkillEditor — Preview tab", () => {
  it("renders the body as markdown, not as source", () => {
    renderEditor("preview");
    expect(
      screen.getByRole("heading", { name: "Uncovered branch gate" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Rendered as the reviewing agent receives it.")).toBeInTheDocument();
  });

  it("shows an empty note rather than a blank card", () => {
    renderEditor("preview", { ...SKILL, body: "   " });
    expect(screen.getByText("This skill has no body yet.")).toBeInTheDocument();
  });
});

describe("SkillEditor — Versions tab", () => {
  it("lists snapshots newest-first and marks the current one", () => {
    renderEditor("versions");
    const items = screen.getAllByRole("listitem");
    expect(within(items[0]!).getByText("v2")).toBeInTheDocument();
    expect(within(items[0]!).getByText("current")).toBeInTheDocument();
    expect(within(items[1]!).getByText("v1")).toBeInTheDocument();
  });

  it("expands the current version by default and collapses on click", () => {
    renderEditor("versions");
    expect(screen.getByText("second body")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { expanded: true }));
    expect(screen.queryByText("second body")).not.toBeInTheDocument();
  });
});
