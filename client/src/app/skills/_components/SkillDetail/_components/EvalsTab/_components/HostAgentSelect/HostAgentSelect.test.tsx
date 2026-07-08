import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import skillsMessages from "../../../../../../../../../messages/en/skills.json";

// ---- Mocks -----------------------------------------------------------------
// `evals.hostAgent.*` keys are Step 8's responsibility to add to
// messages/en/skills.json — this step only ever references them via t(...),
// never hardcodes English. Merge a local stand-in here so the test exercises
// real next-intl resolution without editing the shared messages file
// out-of-scope for Step 9.
const messages = {
  skills: {
    ...skillsMessages,
    evals: {
      hostAgent: {
        label: "Host agent",
        noAgents: "No agents available — create one first",
      },
    },
  },
};

let agentsData: Array<{ id: string; name: string }> | undefined;

vi.mock("@/lib/hooks/agents", () => ({
  useAgents: () => ({ data: agentsData }),
}));

import { HostAgentSelect } from "./HostAgentSelect";

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  agentsData = undefined;
});

describe("HostAgentSelect — default resolution (AC-11)", () => {
  it('defaults to "General Reviewer" when present', () => {
    agentsData = [
      { id: "a1", name: "Security Reviewer" },
      { id: "a2", name: "General Reviewer" },
      { id: "a3", name: "Test Quality Reviewer" },
    ];
    const onChange = vi.fn();
    renderWithIntl(<HostAgentSelect value={null} onChange={onChange} />);

    expect(onChange).toHaveBeenCalledWith("a2");
  });

  it("falls back to the first agent when General Reviewer is absent", () => {
    agentsData = [
      { id: "a1", name: "Security Reviewer" },
      { id: "a3", name: "Test Quality Reviewer" },
    ];
    const onChange = vi.fn();
    renderWithIntl(<HostAgentSelect value={null} onChange={onChange} />);

    expect(onChange).toHaveBeenCalledWith("a1");
  });

  it("does not call onChange again once a value is already selected", () => {
    agentsData = [
      { id: "a1", name: "Security Reviewer" },
      { id: "a2", name: "General Reviewer" },
    ];
    const onChange = vi.fn();
    renderWithIntl(<HostAgentSelect value="a1" onChange={onChange} />);

    expect(onChange).not.toHaveBeenCalled();
  });

  it("renders a disabled/empty state when the workspace has zero agents", () => {
    agentsData = [];
    const onChange = vi.fn();
    renderWithIntl(<HostAgentSelect value={null} onChange={onChange} />);

    expect(screen.getByText("No agents available — create one first")).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("HostAgentSelect — manual re-selection", () => {
  it("calls onChange with the newly picked agent id", async () => {
    agentsData = [
      { id: "a1", name: "Security Reviewer" },
      { id: "a2", name: "General Reviewer" },
    ];
    const onChange = vi.fn();
    const user = userEvent.setup();
    renderWithIntl(<HostAgentSelect value="a2" onChange={onChange} />);

    await user.click(screen.getByRole("combobox"));
    await user.click(screen.getByRole("button", { name: "Security Reviewer" }));

    expect(onChange).toHaveBeenCalledWith("a1");
  });
});

describe("HostAgentSelect — not wrapped in a <label> (regression)", () => {
  // Guards against re-introducing client/insights.md's 2026-07-06 Mistake: a
  // raw <label> ancestor re-dispatches a discrete click to the first labelable
  // descendant (the first dropdown <button>), silently self-selecting
  // option[0] instead of opening the list.
  it("opens the dropdown on click without hijacking the value to the first option", async () => {
    agentsData = [
      { id: "a1", name: "Security Reviewer" },
      { id: "a2", name: "General Reviewer" },
      { id: "a3", name: "Test Quality Reviewer" },
    ];
    const onChange = vi.fn();
    const user = userEvent.setup();
    renderWithIntl(<HostAgentSelect value="a3" onChange={onChange} />);

    const trigger = screen.getByRole("combobox");
    expect(trigger).toHaveTextContent("Test Quality Reviewer");

    await user.click(trigger);

    // The dropdown actually opened (the other options are now clickable buttons)...
    const generalOption = screen.getByRole("button", { name: "General Reviewer" });
    expect(generalOption).toBeInTheDocument();
    // ...and the click did NOT silently flip the value to option[0].
    expect(onChange).not.toHaveBeenCalled();
    expect(trigger).toHaveTextContent("Test Quality Reviewer");

    // Explicitly picking a different option updates the value.
    await user.click(generalOption);
    expect(onChange).toHaveBeenCalledWith("a2");
  });
});
