import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Skill, SkillVersion } from "@devdigest/shared";
import messages from "../../../../../messages/en/skills.json";
import { ToastProvider } from "../../../../lib/toast";

const updateSkill = vi.fn();
const updateSkillAsync = vi.fn();
const deleteSkill = vi.fn();
let versions: SkillVersion[] = [];
let agents: Array<{ id: string; name: string }> = [];

vi.mock("../../../../lib/hooks/skills", () => ({
  useUpdateSkill: () => ({ mutate: updateSkill, mutateAsync: updateSkillAsync, isPending: false }),
  useDeleteSkill: () => ({ mutateAsync: deleteSkill, isPending: false }),
  useSkillVersions: () => ({ data: versions, isLoading: false, isError: false, refetch: vi.fn() }),
  useSkillAgents: () => ({ data: agents, isLoading: false }),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { SkillEditor } from "./SkillEditor";

const SKILL: Skill = {
  id: "s1",
  name: "pr-quality-rubric",
  description: "When judging overall PR quality, score it against these dimensions.",
  type: "rubric",
  source: "manual",
  body: "# PR Quality Rubric\n\nEvaluate the pull request.\n\n## Correctness\n- Does it do what it claims?",
  enabled: true,
  version: 3,
  evidence_files: null,
};

const version = (v: number, body: string): SkillVersion => ({
  skill_id: "s1",
  version: v,
  body,
  created_at: "2026-08-05T10:00:00.000Z",
});

function renderEditor(tab: string, skill: Skill = SKILL) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      <ToastProvider>
        <SkillEditor skill={skill} tab={tab} onTab={() => {}} />
      </ToastProvider>
    </NextIntlClientProvider>,
  );
}

afterEach(cleanup);
beforeEach(() => {
  updateSkill.mockClear();
  updateSkillAsync.mockClear().mockResolvedValue({ ...SKILL, version: 4 });
  deleteSkill.mockClear();
  versions = [
    version(1, "# PR Quality Rubric"),
    version(2, "# PR Quality Rubric\n\nEvaluate the pull request."),
    version(3, SKILL.body),
  ];
  agents = [{ id: "a1", name: "Security Reviewer" }];
});

describe("SkillEditor header", () => {
  it("shows the skill name, type and current version on every tab", () => {
    renderEditor("preview");
    expect(screen.getByRole("heading", { name: "pr-quality-rubric" })).toBeInTheDocument();
    expect(screen.getByText("rubric")).toBeInTheDocument();
    expect(screen.getByText("v3")).toBeInTheDocument();
  });

  it("marks a globally disabled skill in the header", () => {
    renderEditor("preview", { ...SKILL, enabled: false });
    expect(screen.getByText("Disabled")).toBeInTheDocument();
  });
});

describe("Config tab", () => {
  it("renders the fields, a line-numbered body and a token estimate", () => {
    const { container } = renderEditor("config");
    expect(screen.getByDisplayValue("pr-quality-rubric")).toBeInTheDocument();
    expect(screen.getByLabelText<HTMLTextAreaElement>("Skill body").value).toBe(SKILL.body);
    expect(screen.getByText("pr-quality-rubric.md")).toBeInTheDocument();
    // One gutter entry per body line.
    const gutter = container.querySelector('[aria-hidden="true"]');
    expect(gutter?.children).toHaveLength(SKILL.body.split("\n").length);
    expect(screen.getByText(/~\d+ tokens/)).toBeInTheDocument();
  });

  it("keeps Save disabled until something actually changes, then saves every field", async () => {
    renderEditor("config");
    const save = () => screen.getByText("Save skill").closest("button")!;
    expect(save()).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Skill body"), { target: { value: "# Rewritten" } });
    expect(save()).not.toBeDisabled();
    fireEvent.click(save());

    await waitFor(() => expect(updateSkillAsync).toHaveBeenCalledTimes(1));
    expect(updateSkillAsync.mock.calls[0]![0]).toEqual({
      id: "s1",
      patch: {
        name: SKILL.name,
        description: SKILL.description,
        type: SKILL.type,
        body: "# Rewritten",
      },
    });
  });

  it("sends the version message with the save and clears it afterwards", async () => {
    renderEditor("config");
    fireEvent.change(screen.getByLabelText("Skill body"), { target: { value: "# Rewritten" } });
    const note = screen.getByPlaceholderText("Added the async/concurrency section");
    fireEvent.change(note, { target: { value: "  Tightened the scope rule  " } });

    fireEvent.click(screen.getByText("Save skill").closest("button")!);

    await waitFor(() => expect(updateSkillAsync).toHaveBeenCalledTimes(1));
    // Trimmed, and only sent when the author typed something.
    expect(updateSkillAsync.mock.calls[0]![0].patch.version_message).toBe("Tightened the scope rule");
    await waitFor(() => expect((note as HTMLInputElement).value).toBe(""));
  });

  it("omits the version message entirely when it is left blank", async () => {
    renderEditor("config");
    fireEvent.change(screen.getByLabelText("Skill body"), { target: { value: "# Rewritten" } });
    fireEvent.change(screen.getByPlaceholderText("Added the async/concurrency section"), {
      target: { value: "   " },
    });

    fireEvent.click(screen.getByText("Save skill").closest("button")!);

    await waitFor(() => expect(updateSkillAsync).toHaveBeenCalledTimes(1));
    expect(updateSkillAsync.mock.calls[0]![0].patch).not.toHaveProperty("version_message");
  });

  it("a version message alone does not enable Save — the skill itself must change", () => {
    renderEditor("config");
    fireEvent.change(screen.getByPlaceholderText("Added the async/concurrency section"), {
      target: { value: "just a note" },
    });
    expect(screen.getByText("Save skill").closest("button")).toBeDisabled();
  });

  it("flags unsaved edits", () => {
    renderEditor("config");
    expect(screen.queryByText("unsaved")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Skill body"), { target: { value: "changed" } });
    expect(screen.getByText("unsaved")).toBeInTheDocument();
  });

  it("toggling Enabled patches only that field — it must not bump the version", () => {
    renderEditor("config");
    fireEvent.click(screen.getByRole("switch"));
    expect(updateSkill).toHaveBeenCalledWith({ id: "s1", patch: { enabled: false } });
  });
});

describe("Preview tab", () => {
  it("renders the body as markdown, framed as what the agent receives", () => {
    renderEditor("preview");
    expect(screen.getByText("Rendered as the reviewing agent receives it.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "PR Quality Rubric" })).toBeInTheDocument();
    expect(screen.getByText("Does it do what it claims?")).toBeInTheDocument();
  });

  it("warns on an imported skill that its text is prompt instructions", () => {
    renderEditor("preview", { ...SKILL, source: "imported_url" });
    expect(screen.getByText(/exactly like a skill you wrote yourself/i)).toBeInTheDocument();
  });
});

describe("Stats tab", () => {
  it("shows the agents that use the skill", () => {
    renderEditor("stats");
    expect(screen.getByText("Security Reviewer")).toBeInTheDocument();
    expect(screen.getByText("Used by")).toBeInTheDocument();
  });

  it("marks the metrics with no source as untracked rather than showing a number", () => {
    renderEditor("stats");
    expect(screen.getByText("Accept rate")).toBeInTheDocument();
    expect(screen.getAllByText("—")).toHaveLength(3);
    expect(screen.getAllByText(/Not tracked yet/)).toHaveLength(3);
  });

  it("tells the user where to attach an unused skill", () => {
    agents = [];
    renderEditor("stats");
    expect(screen.getByText(/Attach it from an agent's Skills tab/)).toBeInTheDocument();
  });
});

describe("Versions tab", () => {
  it("lists every version newest-first and marks the current one", () => {
    renderEditor("versions");
    expect(screen.getByText("3 versions")).toBeInTheDocument();
    expect(screen.getByText("Current")).toBeInTheDocument();
    expect(screen.getByText("Initial body — 1 lines")).toBeInTheDocument();
  });

  it("shows the author's message when a save recorded one, with the diff alongside", () => {
    versions = [
      version(1, "# PR Quality Rubric"),
      { ...version(2, "# PR Quality Rubric\n\nEvaluate the pull request."), message: "Added the intro" },
      version(3, SKILL.body),
    ];
    renderEditor("versions");

    expect(screen.getByText("Added the intro")).toBeInTheDocument();
    // The derived delta moves to the meta line rather than being replaced.
    expect(screen.getByText(/\+2 −0 lines/)).toBeInTheDocument();
  });

  it("falls back to the derived summary for a version saved without a message", () => {
    renderEditor("versions");
    expect(screen.getAllByText(/lines/).length).toBeGreaterThan(0);
    expect(screen.queryByText("Added the intro")).not.toBeInTheDocument();
  });

  it("shows a line diff against the previous version on demand", () => {
    renderEditor("versions");
    expect(screen.queryByText(/## Correctness/)).not.toBeInTheDocument();

    // Row 0 is the current version — its diff answers "what did the last save do?".
    fireEvent.click(screen.getAllByText("Diff")[0]!);
    expect(screen.getByText(/## Correctness/)).toBeInTheDocument();
  });

  it("offers a diff on every row, including the current one", () => {
    renderEditor("versions");
    expect(screen.getAllByText("Diff")).toHaveLength(3);
    expect(screen.getAllByText("Diff").every((el) => !el.closest("button")!.disabled)).toBe(true);
    // Restore is the one action the current version does not get.
    expect(screen.getAllByText("Restore")).toHaveLength(2);
  });

  it("a two-version skill can still be diffed — the current row is not diff-less", () => {
    versions = [version(1, "one"), version(2, "one\ntwo")];
    renderEditor("versions", { ...SKILL, version: 2 });

    const diffs = screen.getAllByText("Diff");
    expect(diffs).toHaveLength(2);
    fireEvent.click(diffs[0]!);
    expect(screen.getByText(/two/)).toBeInTheDocument();
  });

  it("the first version diffs against nothing and reads as all additions", () => {
    versions = [version(1, "alpha\nbeta")];
    renderEditor("versions", { ...SKILL, version: 1 });

    fireEvent.click(screen.getByText("Diff"));
    expect(screen.getByText("+ alpha")).toBeInTheDocument();
    expect(screen.getByText("+ beta")).toBeInTheDocument();
  });

  it("restores an old body forward as a new version", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderEditor("versions");

    fireEvent.click(screen.getAllByText("Restore")[0]!);
    await waitFor(() => expect(updateSkillAsync).toHaveBeenCalledTimes(1));
    // v2 is the newest non-current row; its body is written forward, not rewound,
    // and the restore labels its own version so the history explains itself.
    expect(updateSkillAsync.mock.calls[0]![0]).toEqual({
      id: "s1",
      patch: {
        body: "# PR Quality Rubric\n\nEvaluate the pull request.",
        version_message: "Restored from v2",
      },
    });
  });
});

describe("Evals tab", () => {
  it("says why it is empty instead of rendering fake eval results", () => {
    renderEditor("evals");
    expect(screen.getByText("Evals arrive with their own lesson")).toBeInTheDocument();
  });
});
