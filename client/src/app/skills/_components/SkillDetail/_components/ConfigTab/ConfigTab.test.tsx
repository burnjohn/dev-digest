import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Skill } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/skills.json";
import { ToastProvider } from "../../../../../../lib/toast";

const updateSkill = vi.fn((_vars, opts) => opts?.onSuccess?.({ name: "pr-quality-rubric", version: 6 }));
const deleteSkill = vi.fn((_id, opts) => opts?.onSuccess?.());

vi.mock("../../../../../../lib/hooks/skills", () => ({
  useUpdateSkill: () => ({ mutate: updateSkill, isPending: false }),
  useDeleteSkill: () => ({ mutate: deleteSkill, isPending: false }),
}));

import { ConfigTab } from "./ConfigTab";

afterEach(() => {
  cleanup();
  updateSkill.mockClear();
  deleteSkill.mockClear();
  vi.restoreAllMocks();
});

const SKILL: Skill = {
  id: "s1",
  name: "pr-quality-rubric",
  description: "Use when scoring a PR.",
  type: "rubric",
  source: "manual",
  body: "# Rubric\n\nScore honestly.",
  enabled: true,
  version: 5,
  evidence_files: null,
};

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      <ToastProvider>{ui}</ToastProvider>
    </NextIntlClientProvider>,
  );
}

/**
 * The body field is a plain `<textarea>` (SkillBodyEditor, not the vendored
 * `Textarea`), addressed by its `wrap="off"` attribute — the multi-line value
 * containing `\n\n` trips `getByDisplayValue`'s whitespace normalizer, so a
 * direct query is more reliable than a value match here.
 */
function bodyTextarea(container: HTMLElement): HTMLTextAreaElement {
  const el = container.querySelector('textarea[wrap="off"]');
  if (!el) throw new Error("body textarea not found");
  return el as HTMLTextAreaElement;
}

describe("ConfigTab", () => {
  it("renders the current name, description and body", () => {
    const { container } = renderWithIntl(<ConfigTab skill={SKILL} />);
    expect(screen.getByDisplayValue("pr-quality-rubric")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Use when scoring a PR.")).toBeInTheDocument();
    expect(bodyTextarea(container).value).toBe(SKILL.body);
  });

  it("the filename chip tracks the name field as it is edited", () => {
    renderWithIntl(<ConfigTab skill={SKILL} />);
    expect(screen.getByText("pr-quality-rubric.md")).toBeInTheDocument();
    fireEvent.change(screen.getByDisplayValue("pr-quality-rubric"), {
      target: { value: "renamed-rubric" },
    });
    expect(screen.getByText("renamed-rubric.md")).toBeInTheDocument();
  });

  it("disables Save until something changes, and shows the unsaved badge once it does", () => {
    const { container } = renderWithIntl(<ConfigTab skill={SKILL} />);
    expect(screen.getByText("Save")).toBeDisabled();
    expect(screen.queryByText("unsaved")).not.toBeInTheDocument();

    fireEvent.change(bodyTextarea(container), { target: { value: `${SKILL.body}!` } });

    expect(screen.getByText("Save")).not.toBeDisabled();
    expect(screen.getByText("unsaved")).toBeInTheDocument();
  });

  it("Save sends every field as the patch", () => {
    const { container } = renderWithIntl(<ConfigTab skill={SKILL} />);
    fireEvent.change(bodyTextarea(container), { target: { value: "# Rubric v2" } });
    fireEvent.click(screen.getByText("Save"));

    expect(updateSkill).toHaveBeenCalledWith(
      {
        id: "s1",
        patch: {
          name: "pr-quality-rubric",
          description: "Use when scoring a PR.",
          type: "rubric",
          body: "# Rubric v2",
        },
      },
      expect.anything(),
    );
  });

  it("the Enabled toggle saves immediately, independent of the unsaved draft", () => {
    renderWithIntl(<ConfigTab skill={SKILL} />);
    fireEvent.click(screen.getByRole("switch"));
    expect(updateSkill).toHaveBeenCalledWith({ id: "s1", patch: { enabled: false } });
    // No pending edit was created by toggling.
    expect(screen.getByText("Save")).toBeDisabled();
  });

  it("shows the untrusted-source notice for an imported skill", () => {
    renderWithIntl(<ConfigTab skill={{ ...SKILL, source: "community" }} />);
    expect(screen.getByText(/reaches the agent as instructions/)).toBeInTheDocument();
  });

  it("does nothing on delete when the confirm dialog is dismissed", () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    renderWithIntl(<ConfigTab skill={SKILL} />);
    fireEvent.click(screen.getByText("Delete skill"));
    expect(deleteSkill).not.toHaveBeenCalled();
  });

  it("deletes and calls onDeleted when the confirm dialog is accepted", () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const onDeleted = vi.fn();
    renderWithIntl(<ConfigTab skill={SKILL} onDeleted={onDeleted} />);
    fireEvent.click(screen.getByText("Delete skill"));
    expect(deleteSkill).toHaveBeenCalledWith("s1", expect.anything());
    expect(onDeleted).toHaveBeenCalledTimes(1);
  });
});
