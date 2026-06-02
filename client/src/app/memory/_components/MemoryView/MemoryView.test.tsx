import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../messages/en/memory.json";
import type { MemoryDto } from "../../../../lib/hooks/memory";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
}));
vi.mock("../../../../components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const MEM: MemoryDto[] = [
  {
    id: "m1", repo_id: null, content: "Use feature flags for risky rollouts",
    scope: "global", kind: "decision", confidence: 0.9, sources: [],
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(), last_used_at: null,
  },
];

vi.mock("../../../../lib/hooks/memory", () => ({
  useMemory: () => ({ data: MEM, isLoading: false, isError: false, refetch: vi.fn() }),
  useUpdateMemory: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  useDeleteMemory: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
}));

import { MemoryView } from "./MemoryView";

afterEach(cleanup);

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ memory: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("MemoryView (smoke)", () => {
  it("renders heading, filters and a memory entry", () => {
    renderWithIntl(<MemoryView />);
    expect(screen.getByRole("heading", { name: "Memory" })).toBeInTheDocument();
    // content renders in both the card and the auto-selected detail panel
    expect(screen.getAllByText("Use feature flags for risky rollouts").length).toBeGreaterThan(0);
    expect(screen.getByText("Scope")).toBeInTheDocument();
  });
});
