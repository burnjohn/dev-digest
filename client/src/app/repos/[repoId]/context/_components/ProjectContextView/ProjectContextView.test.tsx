import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { SpecFile } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/context.json";

const SPECS: SpecFile[] = [
  { path: ".devdigest/specs/architecture.md", size: 2048, updated_at: null },
  { path: ".devdigest/specs/prd.md", size: 1024, updated_at: null },
];

vi.mock("next/navigation", () => ({
  useParams: () => ({ repoId: "r1" }),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
}));
vi.mock("../../../../../../components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("../../../../../../lib/repo-context", () => ({
  useActiveRepo: () => ({ activeRepo: { full_name: "octo/repo" } }),
}));
vi.mock("../../../../../../lib/hooks/context", () => ({
  useSpecs: () => ({ data: SPECS, isLoading: false, isError: false, error: undefined }),
  useReindex: () => ({ mutate: vi.fn(), isPending: false }),
  useIndexStatus: () => ({ data: { status: "done", pct: 100, message: "100% coverage", chunks_indexed: 7 } }),
  useSpecFile: () => ({ data: null, isLoading: true, isError: false }),
  useSaveSpec: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { ProjectContextView } from "./ProjectContextView";

afterEach(cleanup);

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ context: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("ProjectContextView (smoke)", () => {
  it("renders translated title, chunk badge + spec list (short paths)", () => {
    renderWithIntl(<ProjectContextView />);
    expect(screen.getAllByText("Project Context").length).toBeGreaterThan(0);
    expect(screen.getByText("7 chunks")).toBeInTheDocument();
    expect(screen.getByText("architecture.md")).toBeInTheDocument();
    expect(screen.getByText("prd.md")).toBeInTheDocument();
    expect(screen.getByText("2kb")).toBeInTheDocument();
  });
});
