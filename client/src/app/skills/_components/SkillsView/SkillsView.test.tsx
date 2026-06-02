import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Skill } from "@devdigest/shared";
import messages from "../../../../../messages/en/skills.json";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
}));
vi.mock("../../../../components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const SKILLS: Skill[] = [
  {
    id: "s1", name: "pr-quality-rubric", description: "Baseline rubric", type: "rubric",
    source: "manual", body: "# Rubric", enabled: true, version: 1, evidence_files: null,
  },
];

vi.mock("../../../../lib/hooks/skills", () => ({
  useSkills: () => ({ data: SKILLS, isLoading: false, isError: false, refetch: vi.fn() }),
  useUpdateSkill: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
}));

import { SkillsView } from "./SkillsView";

afterEach(cleanup);

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("SkillsView (smoke)", () => {
  it("renders the heading and the skill list", () => {
    renderWithIntl(<SkillsView />);
    expect(screen.getByRole("heading", { name: "Skills" })).toBeInTheDocument();
    // name renders in both the list item and the auto-selected preview pane
    expect(screen.getAllByText("pr-quality-rubric").length).toBeGreaterThan(0);
  });
});
