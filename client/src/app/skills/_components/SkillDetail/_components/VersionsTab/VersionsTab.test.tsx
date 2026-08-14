import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Skill, SkillVersion } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/skills.json";
import { ToastProvider } from "../../../../../../lib/toast";

const updateSkill = vi.fn((_vars, opts) => opts?.onSuccess?.({ name: "pr-quality-rubric", version: 3 }));
let versions: SkillVersion[] = [];

vi.mock("../../../../../../lib/hooks/skills", () => ({
  useUpdateSkill: () => ({ mutate: updateSkill, isPending: false }),
  useSkillVersions: () => ({ data: versions, isLoading: false, isError: false, refetch: vi.fn() }),
}));

import { VersionsTab } from "./VersionsTab";

afterEach(() => {
  cleanup();
  updateSkill.mockClear();
  vi.restoreAllMocks();
});

const SKILL: Skill = {
  id: "s1",
  name: "pr-quality-rubric",
  description: "Use when scoring a PR.",
  type: "rubric",
  source: "manual",
  body: "# Rubric v2",
  enabled: true,
  version: 2,
  evidence_files: null,
};

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      <ToastProvider>{ui}</ToastProvider>
    </NextIntlClientProvider>,
  );
}

describe("VersionsTab", () => {
  it("shows an empty state when there is no history yet", () => {
    versions = [];
    renderWithIntl(<VersionsTab skill={SKILL} />);
    expect(screen.getByText("No history yet")).toBeInTheDocument();
  });

  it("lists every version newest-first, marking the current one", () => {
    versions = [
      { skill_id: "s1", version: 2, body: "# Rubric v2", created_at: "2026-08-01T00:00:00Z" },
      { skill_id: "s1", version: 1, body: "# Rubric v1", created_at: "2026-07-01T00:00:00Z" },
    ];
    renderWithIntl(<VersionsTab skill={SKILL} />);
    expect(screen.getByText("v2")).toBeInTheDocument();
    expect(screen.getByText("v1")).toBeInTheDocument();
    expect(screen.getByText("current")).toBeInTheDocument();
  });

  it("does not offer to restore the current version", () => {
    versions = [{ skill_id: "s1", version: 2, body: "# Rubric v2", created_at: "2026-08-01T00:00:00Z" }];
    renderWithIntl(<VersionsTab skill={SKILL} />);
    fireEvent.click(screen.getByText("v2"));
    expect(screen.queryByText("Restore")).not.toBeInTheDocument();
  });

  it("restoring an old version updates the body, creating a NEW version rather than rewriting history", () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    versions = [
      { skill_id: "s1", version: 2, body: "# Rubric v2", created_at: "2026-08-01T00:00:00Z" },
      { skill_id: "s1", version: 1, body: "# Rubric v1", created_at: "2026-07-01T00:00:00Z" },
    ];
    renderWithIntl(<VersionsTab skill={SKILL} />);

    // Expand the old (non-current) row and restore it.
    fireEvent.click(screen.getByText("v1"));
    fireEvent.click(screen.getByText("Restore"));

    expect(updateSkill).toHaveBeenCalledWith(
      { id: "s1", patch: { body: "# Rubric v1" } },
      expect.anything(),
    );
  });

  it("does nothing when the restore confirmation is dismissed", () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    versions = [
      { skill_id: "s1", version: 2, body: "# Rubric v2", created_at: "2026-08-01T00:00:00Z" },
      { skill_id: "s1", version: 1, body: "# Rubric v1", created_at: "2026-07-01T00:00:00Z" },
    ];
    renderWithIntl(<VersionsTab skill={SKILL} />);
    fireEvent.click(screen.getByText("v1"));
    fireEvent.click(screen.getByText("Restore"));
    expect(updateSkill).not.toHaveBeenCalled();
  });
});
