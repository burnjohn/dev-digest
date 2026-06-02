import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Skill } from "@devdigest/shared";
import messages from "../../../../../messages/en/skills.json";
import { SkillListItem } from "./SkillListItem";

afterEach(cleanup);

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

const SKILLS: Skill[] = [
  {
    id: "s1",
    name: "pr-quality-rubric",
    description: "Baseline review rubric",
    type: "rubric",
    source: "manual",
    body: "# Rubric",
    enabled: true,
    version: 1,
    evidence_files: null,
  },
  {
    id: "s2",
    name: "community-security",
    description: "Untrusted community skill",
    type: "security",
    source: "community",
    body: "# Security",
    enabled: false,
    version: 1,
    evidence_files: null,
  },
];

describe("A1 Skills list (smoke, both themes)", () => {
  (["dark", "light"] as const).forEach((theme) => {
    it(`renders the skill list in ${theme}`, () => {
      renderWithIntl(
        <div data-theme={theme}>
          {SKILLS.map((s) => (
            <SkillListItem key={s.id} s={s} active={false} onClick={() => {}} onToggle={() => {}} />
          ))}
        </div>,
      );
      expect(screen.getByText("pr-quality-rubric")).toBeInTheDocument();
      expect(screen.getByText("community-security")).toBeInTheDocument();
      // untrusted community skill (disabled) shows the vetting flag
      expect(screen.getByText(/needs vetting/i)).toBeInTheDocument();
    });
  });

  it("invokes onToggle when the enable switch is clicked", () => {
    const onToggle = vi.fn();
    renderWithIntl(<SkillListItem s={SKILLS[0]!} active onClick={() => {}} onToggle={onToggle} />);
    const sw = screen.getByRole("switch");
    sw.click();
    expect(onToggle).toHaveBeenCalledWith(false);
  });
});
