import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, within, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Skill } from "@devdigest/shared";
import messages from "../../../../../../messages/en/skills.json";
import { ToastProvider } from "../../../../../lib/toast";

const updateMutate = vi.fn();
const updateMutateAsync = vi.fn();
const restoreMutateAsync = vi.fn();
const versions = vi.fn(() => ({
  data: [
    {
      skill_id: "sk1",
      version: 2,
      body: "second body",
      message: "Restored from v1",
      created_at: "2026-08-16T10:00:00.000Z",
    },
    {
      skill_id: "sk1",
      version: 1,
      body: "first body",
      message: null,
      created_at: "2026-08-15T10:00:00.000Z",
    },
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
  useUpdateSkill: () => ({ mutate: updateMutate, mutateAsync: updateMutateAsync, isPending: false }),
  useDeleteSkill: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSkillVersions: () => versions(),
  useRestoreSkillVersion: () => ({ mutateAsync: restoreMutateAsync, isPending: false }),
}));

import { SkillEditor } from "./SkillEditor";

afterEach(() => {
  cleanup();
  updateMutate.mockClear();
  updateMutateAsync.mockClear();
  restoreMutateAsync.mockReset();
});

beforeEach(() => {
  // The tab reads `version` off the resolved skill to decide between the
  // "restored as vN" and the "already current" toast.
  restoreMutateAsync.mockResolvedValue({ ...SKILL, version: 3, body: "first body" });
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

  it("hides Restore on the current version — only older ones are restorable", () => {
    renderEditor("versions");
    const items = screen.getAllByRole("listitem");
    expect(within(items[0]!).queryByRole("button", { name: "Restore" })).not.toBeInTheDocument();
    expect(within(items[1]!).getByRole("button", { name: "Restore" })).toBeInTheDocument();
  });

  it("renders a stored note verbatim", () => {
    // The note is server-authored audit text, not UI copy — it must survive to
    // the screen exactly as stored, with no i18n key in between.
    renderEditor("versions");
    expect(screen.getByText("Restored from v1")).toBeInTheDocument();
  });

  it("asks for confirmation before restoring, and writes nothing on cancel", () => {
    renderEditor("versions");
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Restore v1?")).toBeInTheDocument();
    expect(restoreMutateAsync).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(restoreMutateAsync).not.toHaveBeenCalled();
  });

  it("restores by VERSION NUMBER — never a body, never a translated note", async () => {
    renderEditor("versions");
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Restore" }));

    await waitFor(() => expect(restoreMutateAsync).toHaveBeenCalledTimes(1));
    // The whole point of POST /skills/:id/restore: the client identifies the
    // snapshot and the SERVER reads it. Sending a cached body is the lost update
    // this replaces; sending a note is how history ends up in a UI locale.
    expect(restoreMutateAsync).toHaveBeenCalledWith({ id: "sk1", version: 1 });
    const [payload] = restoreMutateAsync.mock.calls[0]!;
    expect(payload).not.toHaveProperty("body");
    expect(payload).not.toHaveProperty("version_message");
    expect(payload).not.toHaveProperty("patch");
  });

  it("never routes a restore through useUpdateSkill", async () => {
    // The direct anti-regression: a client-side restore was a PUT carrying the
    // body plus a translated message. If this tab ever reaches for the save
    // mutation again, this fails.
    renderEditor("versions");
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Restore" }));

    await waitFor(() => expect(restoreMutateAsync).toHaveBeenCalled());
    expect(updateMutate).not.toHaveBeenCalled();
    expect(updateMutateAsync).not.toHaveBeenCalled();
  });
});

describe("SkillEditor — Config tab remounts on a version change", () => {
  it("shows the RESTORED body after a restore, not the pre-restore one", () => {
    // ConfigTab seeds `body` into useState at mount, so the remount key decides
    // what the user sees here. Keyed on `skill.id` alone, a restore performed on
    // the Versions tab would leave this tab holding the OLD body, marked dirty —
    // one Save click from silently undoing the restore.
    const { rerender } = renderEditor("config");
    expect(screen.getByLabelText("Skill body")).toHaveValue(SKILL.body);

    const restored: Skill = { ...SKILL, version: 3, body: "# Restored\n\nOld text, back again." };
    rerender(
      <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
        <ToastProvider>
          <SkillEditor skill={restored} usedBy={1} tab="config" onTab={() => {}} />
        </ToastProvider>
      </NextIntlClientProvider>,
    );

    expect(screen.getByLabelText("Skill body")).toHaveValue(restored.body);
    // …and the freshly-loaded body is not dirty, so Save stays disabled.
    expect(screen.getByRole("button", { name: "Save skill" })).toBeDisabled();
  });
});
