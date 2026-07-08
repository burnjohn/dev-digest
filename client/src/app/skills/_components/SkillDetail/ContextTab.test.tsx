import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { Skill } from "@devdigest/shared";
import skillsMessages from "../../../../../messages/en/skills.json";

// Stub the sibling tabs so rendering SkillDetail doesn't pull in their hooks —
// we only care that the NEW Context tab is wired into TABS + the render switch.
// ConfigTab is left REAL (it no longer depends on context/intl hooks after the
// v2 move) so the "no longer embedded" assertion exercises the real component.
vi.mock("./PreviewTab", () => ({ PreviewTab: () => <div>preview-stub</div> }));
vi.mock("./EvalsTab", () => ({ EvalsTab: () => <div>evals-stub</div> }));
vi.mock("./StatsTab", () => ({ StatsTab: () => <div>stats-stub</div> }));
vi.mock("./VersionsTab", () => ({ VersionsTab: () => <div>versions-stub</div> }));

vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({
    repoId: "repo1",
    activeRepo: { id: "repo1", full_name: "acme/widgets" },
    repos: [{ id: "repo1", full_name: "acme/widgets" }],
    reposLoaded: true,
  }),
}));

vi.mock("@/lib/hooks/context-docs", () => ({
  useContextDocs: () => ({ data: [], isLoading: false }),
  useSkillContextDocs: () => ({ data: [], isLoading: false }),
  useSetSkillContextDocs: () => ({ mutate: vi.fn(), isPending: false }),
  useContextDocContent: () => ({ data: { path: "x", content: "x", source: "clone" }, isLoading: false, isError: false }),
}));

// Real ConfigTab needs its update hook — stubbed for the "no longer embedded" test.
vi.mock("@/lib/hooks/skills", () => ({
  useUpdateSkill: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { SkillDetail } from "./SkillDetail";
import { ConfigTab } from "./ConfigTab";

afterEach(() => cleanup());

const SKILL: Skill = {
  id: "sk1",
  name: "Security checklist",
  description: "Flags secrets",
  type: "security",
  source: "manual",
  body: "# Security",
  enabled: true,
  version: 1,
} as unknown as Skill;

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ skills: skillsMessages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("SkillDetail — dedicated Context tab (AC-35)", () => {
  it("exposes a Context tab that renders the attachment list when selected", async () => {
    const user = userEvent.setup();
    renderWithIntl(<SkillDetail skill={SKILL} />);

    // Default tab is Config → the attachment list is NOT shown yet.
    expect(screen.queryByText("Project context to use")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Context/ }));

    // The real skill ContextTab → ContextDocsList renders its title.
    expect(screen.getByText("Project context to use")).toBeInTheDocument();
  });
});

describe("SkillDetail ConfigTab — no longer embeds the context section", () => {
  it("does not render the 'Project context to use' section inside Config", () => {
    render(<ConfigTab skill={SKILL} />);
    expect(screen.queryByText("Project context to use")).not.toBeInTheDocument();
  });
});
