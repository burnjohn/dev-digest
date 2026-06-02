import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Skill } from "@devdigest/shared";
import messages from "../../../../../messages/en/skills.json";

vi.mock("../../../../lib/hooks/skills", () => ({
  useUpdateSkill: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
}));

import { SkillPreview } from "./SkillPreview";

afterEach(cleanup);

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

const MANUAL: Skill = {
  id: "s1",
  name: "pr-quality-rubric",
  description: "Baseline review rubric",
  type: "rubric",
  source: "manual",
  body: "# Rubric body",
  enabled: true,
  version: 2,
  evidence_files: null,
};

const COMMUNITY: Skill = { ...MANUAL, id: "s2", source: "community", enabled: false };

describe("SkillPreview (smoke)", () => {
  it("renders the skill name, version and body", () => {
    renderWithIntl(<SkillPreview skill={MANUAL} />);
    expect(screen.getByText("pr-quality-rubric")).toBeInTheDocument();
    expect(screen.getByText("v2")).toBeInTheDocument();
    expect(screen.getByText("Enabled")).toBeInTheDocument();
  });

  it("flags an untrusted (community) source", () => {
    renderWithIntl(<SkillPreview skill={COMMUNITY} />);
    expect(screen.getByText("untrusted source")).toBeInTheDocument();
  });
});
