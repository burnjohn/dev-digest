import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../messages/en/memory.json";
import type { MemoryDto } from "../../../../lib/hooks/memory";
import { MemoryCard } from "./MemoryCard";

afterEach(cleanup);

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ memory: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

const MEM: MemoryDto = {
  id: "m1",
  repo_id: null,
  content: "Prefer composition over inheritance",
  scope: "global",
  kind: "decision",
  confidence: 0.8,
  sources: [{ pr: 42, context: "Discussed in PR review" }],
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  last_used_at: null,
};

describe("MemoryCard (smoke)", () => {
  it("renders content, translated kind/scope, PR tag and never-used label", () => {
    renderWithIntl(<MemoryCard m={MEM} active={false} onClick={() => {}} />);
    expect(screen.getByText("Prefer composition over inheritance")).toBeInTheDocument();
    expect(screen.getByText("decision")).toBeInTheDocument();
    expect(screen.getByText("global")).toBeInTheDocument();
    expect(screen.getByText("#42")).toBeInTheDocument();
    expect(screen.getByText("never used")).toBeInTheDocument();
  });
});
