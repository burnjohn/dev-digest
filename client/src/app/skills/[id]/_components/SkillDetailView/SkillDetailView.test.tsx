import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Skill } from "@devdigest/shared";
import messages from "../../../../../../messages/en/skills.json";

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "s1" }),
}));
vi.mock("../../../../../components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const SKILL: Skill = {
  id: "s1", name: "pr-quality-rubric", description: "Baseline rubric", type: "rubric",
  source: "manual", body: "# Rubric body", enabled: true, version: 1, evidence_files: null,
};

vi.mock("../../../../../lib/hooks/skills", () => ({
  useSkill: () => ({ data: SKILL, isLoading: false, isError: false, refetch: vi.fn() }),
  useUpdateSkill: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
}));

import { SkillDetailView } from "./SkillDetailView";

afterEach(cleanup);

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("SkillDetailView (smoke)", () => {
  it("renders the back link and the selected skill", () => {
    renderWithIntl(<SkillDetailView />);
    expect(screen.getByText(/All skills/)).toBeInTheDocument();
    expect(screen.getAllByText("pr-quality-rubric").length).toBeGreaterThan(0);
  });
});
