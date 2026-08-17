import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent, AgentSkillLink, SkillListItem } from "@devdigest/shared";
import agentsMessages from "../../../../../../../../messages/en/agents.json";
import skillsMessages from "../../../../../../../../messages/en/skills.json";
import { ToastProvider } from "../../../../../../../lib/toast";

// Left un-settled on purpose: the component keeps its optimistic draft until
// the write lands, so a never-resolving mutation is exactly the in-flight state
// we want to assert against (the mocked links are static and would "revert" it).
const setSkills = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

const skill = (id: string, name: string, enabled = true): SkillListItem => ({
  id,
  name,
  description: `desc ${name}`,
  type: "rubric",
  source: "manual",
  body: "body",
  enabled,
  version: 1,
  evidence_files: null,
  used_by: 1,
});

const SKILLS: SkillListItem[] = [
  skill("s1", "alpha-rule"),
  skill("s2", "bravo-rule"),
  skill("s3", "charlie-rule", false), // globally disabled
];

// Linked in a NON-alphabetical order, so "linked first, in link order" is a
// real assertion rather than an accident of sorting.
const LINKS: AgentSkillLink[] = [
  { agent_id: "ag1", skill_id: "s2", order: 0 },
  { agent_id: "ag1", skill_id: "s1", order: 1 },
];

vi.mock("../../../../../../../lib/hooks/skills", () => ({
  useSkills: () => ({ data: SKILLS, isLoading: false, isError: false, refetch: vi.fn() }),
  useAgentSkills: () => ({ data: LINKS, isLoading: false }),
  useSetAgentSkills: () => ({ mutate: setSkills, isPending: false, isSuccess: false }),
}));

import { SkillsTab } from "./SkillsTab";

afterEach(() => {
  cleanup();
  setSkills.mockClear();
});

const AGENT = { id: "ag1", name: "Test Quality Reviewer" } as Agent;

function renderTab() {
  return render(
    <NextIntlClientProvider
      locale="en"
      messages={{ agents: agentsMessages, skills: skillsMessages }}
    >
      <ToastProvider>
        <SkillsTab agent={AGENT} />
      </ToastProvider>
    </NextIntlClientProvider>,
  );
}

/** The rows, in DOM order. */
function rowNames(): string[] {
  return screen.getAllByRole("listitem").map((li) => li.textContent ?? "");
}

/** The ids posted by the most recent save. */
function lastPosted(): string[] {
  return setSkills.mock.calls.at(-1)?.[0] as string[];
}

/**
 * jsdom implements no `DataTransfer`, so every drag test has to carry its own.
 * It is not decoration: `dragstart` MUST write to it (Firefox aborts a drag that
 * doesn't) and `dragover` MUST set `dropEffect`, and a stub is the only way this
 * suite can see either happen.
 */
function stubDataTransfer() {
  return {
    setData: vi.fn(),
    getData: vi.fn(),
    setDragImage: vi.fn(),
    effectAllowed: "none",
    dropEffect: "none",
  };
}

/** Drag `source` onto row `to`, via the same dataTransfer the browser would reuse. */
function dragFrom(source: Element, to: number, dataTransfer = stubDataTransfer()) {
  const rows = screen.getAllByRole("listitem");
  fireEvent.dragStart(source, { dataTransfer });
  fireEvent.dragOver(rows[to]!, { dataTransfer });
  fireEvent.drop(rows[to]!, { dataTransfer });
  return dataTransfer;
}

/** Drag row `from` onto row `to` (indices into the rendered list). */
function dragRow(from: number, to: number) {
  return dragFrom(screen.getAllByRole("listitem")[from]!, to);
}

describe("SkillsTab", () => {
  it("lists linked skills first, in LINK order, then the rest alphabetically", () => {
    renderTab();
    const names = rowNames();
    expect(names[0]).toContain("bravo-rule"); // order 0
    expect(names[1]).toContain("alpha-rule"); // order 1
    expect(names[2]).toContain("charlie-rule"); // unlinked
  });

  it("reports how many of the total are linked", () => {
    renderTab();
    expect(screen.getByText("2 of 3 enabled")).toBeInTheDocument();
  });

  it("checks exactly the linked skills", () => {
    renderTab();
    expect(screen.getByRole("checkbox", { name: "bravo-rule" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "charlie-rule" })).not.toBeChecked();
  });

  it("flags a linked skill that is globally disabled — it is silently skipped at review time", () => {
    renderTab();
    expect(screen.getByTitle(/disabled globally/i)).toBeInTheDocument();
  });

  it("has no Save button — the checkbox itself is the write", () => {
    renderTab();
    expect(screen.queryByRole("button", { name: /save/i })).not.toBeInTheDocument();
  });

  it("linking saves immediately, appending to the end of the order", () => {
    renderTab();
    fireEvent.click(screen.getByRole("checkbox", { name: "charlie-rule" }));
    expect(lastPosted()).toEqual(["s2", "s1", "s3"]);
  });

  it("unlinking saves immediately, removing it from the posted set", () => {
    renderTab();
    fireEvent.click(screen.getByRole("checkbox", { name: "bravo-rule" }));
    expect(lastPosted()).toEqual(["s1"]);
  });

  it("keeps the optimistic state on screen while the write is in flight", () => {
    renderTab();
    fireEvent.click(screen.getByRole("checkbox", { name: "bravo-rule" }));
    expect(screen.getByRole("checkbox", { name: "bravo-rule" })).not.toBeChecked();
  });

  it("unchecking leaves the row where it is — it does not fall to the bottom", () => {
    renderTab();
    fireEvent.click(screen.getByRole("checkbox", { name: "bravo-rule" }));
    expect(rowNames()[0]).toContain("bravo-rule");
    expect(rowNames()[1]).toContain("alpha-rule");
  });

  it("re-checking restores the skill to its own row's position in the prompt order", () => {
    renderTab();
    fireEvent.click(screen.getByRole("checkbox", { name: "bravo-rule" })); // → ["s1"]
    fireEvent.click(screen.getByRole("checkbox", { name: "bravo-rule" }));
    // Back at the FRONT (its row is still row 0), not appended after alpha-rule.
    expect(lastPosted()).toEqual(["s2", "s1"]);
    expect(rowNames()[0]).toContain("bravo-rule");
  });

  it("dragging past an unchecked row shifts that row down — it is a real sortable list", () => {
    renderTab();
    fireEvent.click(screen.getByRole("checkbox", { name: "charlie-rule" })); // link all three
    fireEvent.click(screen.getByRole("checkbox", { name: "alpha-rule" })); // unlink the middle row
    dragRow(2, 0); // charlie-rule onto bravo-rule, over the unchecked alpha-rule
    expect(lastPosted()).toEqual(["s3", "s2"]);
    expect(rowNames()[0]).toContain("charlie-rule");
    expect(rowNames()[1]).toContain("bravo-rule");
    expect(rowNames()[2]).toContain("alpha-rule"); // pushed down by one, like any row
  });

  it("dragging a row onto another reorders and saves", () => {
    renderTab();
    dragRow(1, 0); // alpha-rule above bravo-rule
    expect(lastPosted()).toEqual(["s1", "s2"]);
    expect(rowNames()[0]).toContain("alpha-rule");
  });

  it("dropping onto an UNLINKED row lands there — every row is a drop target", () => {
    // The bug this file exists to guard: unlinked rows used to refuse the drop
    // (no preventDefault in dragover), so a list with disabled skills mixed in
    // silently ate most drags.
    renderTab();
    dragRow(0, 2); // bravo-rule onto charlie-rule (unlinked)
    expect(lastPosted()).toEqual(["s1", "s2"]);
    expect(rowNames()[0]).toContain("alpha-rule");
    expect(rowNames()[1]).toContain("charlie-rule");
    expect(rowNames()[2]).toContain("bravo-rule");
  });

  it("moving a row without changing the prompt order writes nothing", () => {
    renderTab();
    dragRow(1, 2); // alpha-rule below the unlinked charlie-rule
    // bravo still precedes alpha, so the assembled prompt is untouched…
    expect(setSkills).not.toHaveBeenCalled();
    // …but the row did move, and that position is remembered.
    expect(rowNames()[1]).toContain("charlie-rule");
    expect(rowNames()[2]).toContain("alpha-rule");
  });

  it("writes to dataTransfer on dragstart — Firefox aborts a drag that doesn't", () => {
    renderTab();
    const dt = dragRow(1, 0);
    expect(dt.setData).toHaveBeenCalledWith("text/plain", "s1");
    expect(dt.effectAllowed).toBe("move");
    expect(dt.dropEffect).toBe("move");
  });

  it("the grip handle is itself a drag source, not just a cursor", () => {
    // A mousedown on a <button> does not start an ancestor's drag, so the handle
    // has to carry `draggable` or the only grab-cursor in the row is a dead spot.
    renderTab();
    const handles = screen.getAllByRole("button", { name: /^Reorder/ });
    expect(handles[1]).toHaveAttribute("draggable", "true");
    expect(handles[2]).not.toHaveAttribute("draggable", "true"); // unlinked row
    dragFrom(handles[1]!, 0); // alpha-rule's grip, onto bravo-rule
    expect(lastPosted()).toEqual(["s1", "s2"]);
    expect(rowNames()[0]).toContain("alpha-rule");
  });

  it("the drag handle reorders from the keyboard", () => {
    renderTab();
    const handles = screen.getAllByRole("button", { name: /^Reorder/ });
    fireEvent.keyDown(handles[1]!, { key: "ArrowUp" }); // alpha-rule up
    expect(lastPosted()).toEqual(["s1", "s2"]);
    expect(rowNames()[0]).toContain("alpha-rule");
  });

  it("arrowing past a boundary writes nothing", () => {
    renderTab();
    const handles = screen.getAllByRole("button", { name: /^Reorder/ });
    fireEvent.keyDown(handles[0]!, { key: "ArrowUp" }); // already at the top
    expect(setSkills).not.toHaveBeenCalled();
  });

  it("names each handle with its position, and disables it on an unlinked row", () => {
    renderTab();
    expect(
      screen.getByRole("button", { name: /Reorder bravo-rule — position 1 of 2/ }),
    ).toBeEnabled();
    expect(screen.getByRole("button", { name: /Reorder charlie-rule/ })).toBeDisabled();
  });

  it("filters rows by name without losing the draft", () => {
    renderTab();
    fireEvent.change(screen.getByLabelText("Filter skills…"), {
      target: { value: "charlie" },
    });
    expect(rowNames()).toHaveLength(1);
    expect(rowNames()[0]).toContain("charlie-rule");
  });

  it("says so when the filter matches nothing", () => {
    renderTab();
    fireEvent.change(screen.getByLabelText("Filter skills…"), { target: { value: "zzz" } });
    expect(screen.getByText("No skills match that filter.")).toBeInTheDocument();
  });
});
