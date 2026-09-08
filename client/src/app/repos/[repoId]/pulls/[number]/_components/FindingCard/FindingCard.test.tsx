import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";
import { FindingCard } from "./FindingCard";

afterEach(cleanup);

const FINDING: FindingRecord = {
  id: "f1",
  severity: "CRITICAL",
  category: "security",
  title: "Hardcoded Stripe secret key",
  file: "src/config.ts",
  start_line: 11,
  end_line: 11,
  rationale: "A **live** Stripe key is committed in source.",
  suggestion: "Move the key to an environment variable.",
  confidence: 0.95,
  kind: "finding",
  trifecta_components: null,
  evidence: null,
  review_id: "r1",
  accepted_at: null,
  dismissed_at: null,
};

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("FindingCard (smoke, both themes)", () => {
  (["dark", "light"] as const).forEach((theme) => {
    it(`renders severity + file:line + rationale in ${theme}`, () => {
      renderWithIntl(
        <div data-theme={theme}>
          <FindingCard f={FINDING} defaultExpanded onAction={() => {}} />
        </div>,
      );
      expect(screen.getByText("Hardcoded Stripe secret key")).toBeInTheDocument();
      expect(screen.getByText("src/config.ts:11")).toBeInTheDocument();
      // category label is shown alongside the severity badge
      expect(screen.getByText("security")).toBeInTheDocument();
    });
  });

  it("fires accept/dismiss actions", () => {
    const onAction = vi.fn();
    renderWithIntl(<FindingCard f={FINDING} defaultExpanded onAction={onAction} />);
    fireEvent.click(screen.getByText("Accept"));
    expect(onAction).toHaveBeenCalledWith("accept");
    fireEvent.click(screen.getByText("Dismiss"));
    expect(onAction).toHaveBeenCalledWith("dismiss");
  });
});

describe("FindingCard — Learn (specs/13-multi-agent-review.md D25, AC-63..65)", () => {
  it("is present on an untriaged finding (unlike 'turn into eval case') and fires the same onAction prop", () => {
    const onAction = vi.fn();
    renderWithIntl(<FindingCard f={FINDING} defaultExpanded onAction={onAction} />);
    fireEvent.click(screen.getByText("Learn"));
    expect(onAction).toHaveBeenCalledWith("learn");
  });

  it("stays present once accepted/dismissed too (D25 — not gated by triage)", () => {
    const accepted = { ...FINDING, accepted_at: "2026-01-01T00:00:00.000Z" };
    renderWithIntl(<FindingCard f={accepted} defaultExpanded onAction={() => {}} />);
    expect(screen.getByText("Learn")).toBeInTheDocument();
  });
});

describe("FindingCard — turn into eval case (specs/12-eval-pipeline.md AC-2)", () => {
  it("is absent on an untriaged finding", () => {
    renderWithIntl(<FindingCard f={FINDING} defaultExpanded onAction={() => {}} />);
    expect(screen.queryByText("Turn into eval case")).not.toBeInTheDocument();
  });

  it("renders once accepted, and fires the action through the same onAction prop", () => {
    const onAction = vi.fn();
    const accepted = { ...FINDING, accepted_at: "2026-01-01T00:00:00.000Z" };
    renderWithIntl(<FindingCard f={accepted} defaultExpanded onAction={onAction} />);
    fireEvent.click(screen.getByText("Turn into eval case"));
    expect(onAction).toHaveBeenCalledWith("turnIntoEvalCase");
  });

  it("renders once dismissed too", () => {
    const dismissed = { ...FINDING, dismissed_at: "2026-01-01T00:00:00.000Z" };
    renderWithIntl(<FindingCard f={dismissed} defaultExpanded onAction={() => {}} />);
    expect(screen.getByText("Turn into eval case")).toBeInTheDocument();
  });
});

describe("FindingCard — turn into skill eval case (specs/15-skill-eval-cases.md AC-1, AC-2)", () => {
  const accepted = { ...FINDING, accepted_at: "2026-01-01T00:00:00.000Z" };

  it("is absent on an untriaged finding, and absent even when triaged if the caller supplies no onSkillEvalCase handler", () => {
    renderWithIntl(<FindingCard f={FINDING} defaultExpanded onAction={() => {}} onSkillEvalCase={() => {}} />);
    expect(screen.queryByText("Turn into skill eval case")).not.toBeInTheDocument();

    renderWithIntl(<FindingCard f={accepted} defaultExpanded onAction={() => {}} />);
    expect(screen.queryByText("Turn into skill eval case")).not.toBeInTheDocument();
  });

  it("opens a menu stating offers are 'present, not causal', fetching offers lazily on open", () => {
    const onOpen = vi.fn();
    renderWithIntl(
      <FindingCard
        f={accepted}
        defaultExpanded
        onAction={() => {}}
        onSkillEvalCase={() => {}}
        onOpenSkillEvalOffers={onOpen}
        skillEvalOffers={undefined}
      />,
    );
    expect(onOpen).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Turn into skill eval case"));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(
      screen.getByText("A skill's presence in this run is not proof it caused this finding."),
    ).toBeInTheDocument();
    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });

  it("states an empty offer list rather than hiding the action", () => {
    renderWithIntl(
      <FindingCard
        f={accepted}
        defaultExpanded
        onAction={() => {}}
        onSkillEvalCase={() => {}}
        onOpenSkillEvalOffers={() => {}}
        skillEvalOffers={[]}
      />,
    );
    fireEvent.click(screen.getByText("Turn into skill eval case"));
    expect(screen.getByText("No skills were present in the review that produced this finding.")).toBeInTheDocument();
  });

  it("lists offered skills and fires onSkillEvalCase with the chosen skill id", () => {
    const onSelect = vi.fn();
    renderWithIntl(
      <FindingCard
        f={accepted}
        defaultExpanded
        onAction={() => {}}
        onSkillEvalCase={onSelect}
        onOpenSkillEvalOffers={() => {}}
        skillEvalOffers={[{ skill_id: "skill-1", skill_name: "secret-leakage-gate", has_case: false }]}
      />,
    );
    fireEvent.click(screen.getByText("Turn into skill eval case"));
    fireEvent.click(screen.getByText("secret-leakage-gate"));
    expect(onSelect).toHaveBeenCalledWith("skill-1");
  });
});
